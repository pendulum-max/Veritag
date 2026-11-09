import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { base64UrlEncode, sha256 } from "@veritag/sdk";

export interface AuthTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface ChallengeRecord {
  nonce: string;
  account: string;
  challengeHashHex: string;
  message: string;
  expiresAt: number;
}

export interface PasskeyAssertionInput {
  publicKeyHex: string;
  authenticatorDataHex?: string;
  clientDataJsonBase64?: string;
}

const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

export class AuthService {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly secret: string;

  constructor(jwtSecret: string) {
    this.secret = jwtSecret;
  }

  /**
   * Issues a SEP-10 style challenge message bound to `account` (either a Stellar G... Ed25519
   * public key or a Soroban C... passkey smart contract address) and a short-lived nonce.
   */
  createChallenge(account: string, ttlSeconds = 300): ChallengeRecord {
    if (!StrKey.isValidEd25519PublicKey(account) && !StrKey.isValidContract(account)) {
      throw new Error("Invalid Stellar account or Soroban contract address");
    }
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const message = `Veritag Authentication\nAccount: ${account}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
    const challengeHashHex = sha256(message).toString("hex");

    const record: ChallengeRecord = {
      nonce,
      account,
      challengeHashHex,
      message,
      expiresAt,
    };
    this.challenges.set(nonce, record);
    return record;
  }

  peekChallenge(nonce: string): ChallengeRecord | undefined {
    return this.challenges.get(nonce);
  }

  /**
   * Verifies an Ed25519 signature (for G... accounts) or a P-256 / WebAuthn signature
   * (for C... passkey smart contract accounts), burns the challenge nonce, and returns a JWT.
   */
  verifyChallenge(
    nonce: string,
    signatureInput: string,
    tokenTtlSeconds = 3600,
    passkeyAssertion?: PasskeyAssertionInput,
  ): string {
    const challenge = this.challenges.get(nonce);
    if (!challenge) {
      throw new Error("ChallengeNotFound");
    }
    this.challenges.delete(nonce);

    const now = Math.floor(Date.now() / 1000);
    if (now > challenge.expiresAt) {
      throw new Error("ChallengeExpired");
    }

    const sigBytes = /^[0-9a-fA-F]{128}$/.test(signatureInput)
      ? Buffer.from(signatureInput, "hex")
      : Buffer.from(signatureInput, "base64");

    if (StrKey.isValidEd25519PublicKey(challenge.account)) {
      const kp = Keypair.fromPublicKey(challenge.account);
      const valid = kp.verify(Buffer.from(challenge.message, "utf8"), sigBytes);
      if (!valid) {
        throw new Error("InvalidSignature");
      }
      return this.signToken(challenge.account, tokenTtlSeconds);
    }

    // Soroban C... Passkey Smart Account verification via secp256r1
    if (!passkeyAssertion?.publicKeyHex) {
      throw new Error("MissingPasskeyPublicKey");
    }
    const pubKeyBuf = Buffer.from(passkeyAssertion.publicKeyHex, "hex");
    if (pubKeyBuf.length !== 65 || pubKeyBuf[0] !== 0x04) {
      throw new Error("InvalidPasskeyPublicKey");
    }

    const spkiDer = Buffer.concat([P256_SPKI_PREFIX, pubKeyBuf]);
    const keyObject = createPublicKey({ key: spkiDer, format: "der", type: "spki" });

    let signedPayload: Buffer;
    if (passkeyAssertion.authenticatorDataHex && passkeyAssertion.clientDataJsonBase64) {
      const authData = Buffer.from(passkeyAssertion.authenticatorDataHex, "hex");
      const clientDataJson = Buffer.from(passkeyAssertion.clientDataJsonBase64, "base64");
      const expectedChallengeB64 = base64UrlEncode(Buffer.from(challenge.challengeHashHex, "hex"));
      if (!clientDataJson.toString("utf8").includes(`"challenge":"${expectedChallengeB64}"`)) {
        throw new Error("ChallengeMismatch");
      }
      const clientDataHash = sha256(clientDataJson);
      signedPayload = Buffer.concat([authData, clientDataHash]);
    } else {
      signedPayload = Buffer.from(challenge.message, "utf8");
    }

    const validP256 = verify(
      "sha256",
      signedPayload,
      { key: keyObject, dsaEncoding: "ieee-p1363" },
      sigBytes,
    );
    if (!validP256) {
      throw new Error("InvalidSignature");
    }

    return this.signToken(challenge.account, tokenTtlSeconds);
  }

  signToken(account: string, ttlSeconds = 3600): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payloadObj: AuthTokenPayload = {
      sub: account,
      iat: now,
      exp: now + ttlSeconds,
    };
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const sig = createHmac("sha256", this.secret).update(signingInput).digest("base64url");
    return `${signingInput}.${sig}`;
  }

  verifyToken(token: string): AuthTokenPayload {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error("MalformedToken");
    }
    const [header, payload, providedSig] = parts;
    const signingInput = `${header}.${payload}`;
    const expectedSig = createHmac("sha256", this.secret).update(signingInput).digest();
    const actualSig = Buffer.from(providedSig, "base64url");

    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      throw new Error("InvalidTokenSignature");
    }

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AuthTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number" || now > decoded.exp) {
      throw new Error("TokenExpired");
    }
    return decoded;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtSec: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxHits: number;
  private readonly windowMs: number;

  constructor(maxHitsPerWindow: number, windowMs = 60_000) {
    this.maxHits = maxHitsPerWindow;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): RateLimitDecision {
    const cutoff = nowMs - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (existing.length >= this.maxHits) {
      this.hits.set(key, existing);
      const oldest = existing[0] ?? nowMs;
      return {
        allowed: false,
        limit: this.maxHits,
        remaining: 0,
        resetAtSec: Math.ceil((oldest + this.windowMs) / 1000),
      };
    }
    existing.push(nowMs);
    this.hits.set(key, existing);
    const oldest = existing[0] ?? nowMs;
    return {
      allowed: true,
      limit: this.maxHits,
      remaining: Math.max(0, this.maxHits - existing.length),
      resetAtSec: Math.ceil((oldest + this.windowMs) / 1000),
    };
  }

  allow(key: string, nowMs = Date.now()): boolean {
    return this.check(key, nowMs).allowed;
  }
}
