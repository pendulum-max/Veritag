import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export interface AuthTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface ChallengeRecord {
  nonce: string;
  account: string;
  message: string;
  expiresAt: number;
}

export class AuthService {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly secret: string;

  constructor(jwtSecret: string) {
    this.secret = jwtSecret;
  }

  /**
   * Issues a SEP-10 style challenge message bound to `account` and a short-lived nonce.
   */
  createChallenge(account: string, ttlSeconds = 300): ChallengeRecord {
    if (!StrKey.isValidEd25519PublicKey(account)) {
      throw new Error("Invalid Stellar Ed25519 public key");
    }
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const message = `Veritag Authentication\nAccount: ${account}\nNonce: ${nonce}\nExpires: ${expiresAt}`;

    const record: ChallengeRecord = { nonce, account, message, expiresAt };
    this.challenges.set(nonce, record);
    return record;
  }

  /**
   * Verifies a hex-encoded or base64-encoded Ed25519 signature over the challenge message,
   * burns the challenge nonce, and returns a signed HS256 bearer token.
   */
  verifyChallenge(nonce: string, signatureInput: string, tokenTtlSeconds = 3600): string {
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

    const kp = Keypair.fromPublicKey(challenge.account);
    const valid = kp.verify(Buffer.from(challenge.message, "utf8"), sigBytes);
    if (!valid) {
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

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number" || now > decoded.exp) {
      throw new Error("TokenExpired");
    }
    return decoded;
  }
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxHits: number;
  private readonly windowMs: number;

  constructor(maxHitsPerWindow: number, windowMs = 60_000) {
    this.maxHits = maxHitsPerWindow;
    this.windowMs = windowMs;
  }

  allow(key: string, nowMs = Date.now()): boolean {
    const cutoff = nowMs - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (existing.length >= this.maxHits) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(nowMs);
    this.hits.set(key, existing);
    return true;
  }
}
