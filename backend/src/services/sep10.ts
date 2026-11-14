import { randomBytes } from "node:crypto";
import {
  Account,
  Keypair,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { sha256 } from "@veritag/sdk";
import type { BackendConfig } from "../config.js";
import type { AuthService } from "./auth.js";

export interface Sep10ChallengeResponse {
  transaction: string;
  network_passphrase: string;
  serverAccount: string;
  homeDomain: string;
  webAuthDomain: string;
  expiresAt: number;
}

export interface Sep10VerifyResult {
  token: string;
  account: string;
}

function resolveServerKeypair(config: BackendConfig): Keypair {
  const candidateSecret =
    config.sep10SigningSecret || config.sponsorSecret || config.registryAdminSecret;
  if (candidateSecret && StrKey.isValidEd25519SecretSeed(candidateSecret)) {
    return Keypair.fromSecret(candidateSecret);
  }
  const deterministicSeed = sha256(`VERITAG_SEP10_SERVER_KEY:${config.jwtSecret}`);
  return Keypair.fromRawEd25519Seed(deterministicSeed);
}

export class Sep10Service {
  private readonly serverKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly homeDomain: string;
  private readonly webAuthDomain: string;
  private readonly auth: AuthService;
  private readonly consumedChallenges = new Set<string>();

  constructor(config: BackendConfig, auth: AuthService) {
    this.serverKeypair = resolveServerKeypair(config);
    this.networkPassphrase = config.networkPassphrase;
    this.homeDomain = config.sep10HomeDomain ?? "veritag.stellar.org";
    this.webAuthDomain = config.sep10WebAuthDomain ?? "api.veritag.stellar.org";
    this.auth = auth;
  }

  get serverPublicKey(): string {
    return this.serverKeypair.publicKey();
  }

  /**
   * Builds and signs a Stellar SEP-0010 challenge transaction (sequence number 0)
   * bound to `clientAccount`, `homeDomain`, `webAuthDomain`, and short-lived timebounds.
   */
  buildChallenge(
    clientAccount: string,
    options?: {
      homeDomain?: string;
      ttlSeconds?: number;
      nowSeconds?: number;
    },
  ): Sep10ChallengeResponse {
    if (!StrKey.isValidEd25519PublicKey(clientAccount)) {
      throw new Error("Invalid Stellar Ed25519 public key (G...)");
    }

    const domain = options?.homeDomain || this.homeDomain;
    if (domain !== this.homeDomain) {
      throw new Error("Unsupported home_domain");
    }

    const nowSec = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const ttlSec = options?.ttlSeconds ?? 300;
    const minTime = nowSec;
    const maxTime = nowSec + ttlSec;

    // Sequence number "-1" incremented by TransactionBuilder produces sequence number "0" per SEP-10
    const serverSource = new Account(this.serverKeypair.publicKey(), "-1");
    const randomNonceBase64 = randomBytes(48).toString("base64");

    const tx = new TransactionBuilder(serverSource, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
      timebounds: { minTime, maxTime },
    })
      .addOperation(
        Operation.manageData({
          source: clientAccount,
          name: `${domain} auth`,
          value: Buffer.from(randomNonceBase64, "utf8"),
        }),
      )
      .addOperation(
        Operation.manageData({
          source: this.serverKeypair.publicKey(),
          name: "web_auth_domain",
          value: Buffer.from(this.webAuthDomain, "utf8"),
        }),
      )
      .build();

    tx.sign(this.serverKeypair);

    return {
      transaction: tx.toXDR(),
      network_passphrase: this.networkPassphrase,
      serverAccount: this.serverKeypair.publicKey(),
      homeDomain: domain,
      webAuthDomain: this.webAuthDomain,
      expiresAt: maxTime,
    };
  }

  /**
   * Verifies a client-signed SEP-0010 challenge transaction XDR:
   * 1. Sequence number === "0" and source === server signing account.
   * 2. Timebounds exist and current time falls within `[minTime, maxTime]`.
   * 3. First operation is `manageData` with source = client `G...` key and name = `<homeDomain> auth`.
   * 4. `web_auth_domain` operation matches configured `webAuthDomain`.
   * 5. Both the server signature and the client master key signature are valid over `tx.hash()`.
   * 6. Challenge transaction hash has not been replayed.
   */
  verifyChallenge(
    transactionXdr: string,
    options?: {
      nowSeconds?: number;
      tokenTtlSeconds?: number;
    },
  ): Sep10VerifyResult {
    let tx: Transaction;
    try {
      tx = new Transaction(transactionXdr, this.networkPassphrase);
    } catch {
      throw new Error("MalformedChallengeTransaction");
    }

    if (tx.sequence !== "0") {
      throw new Error("InvalidChallengeSequence");
    }

    if (tx.source !== this.serverKeypair.publicKey()) {
      throw new Error("InvalidChallengeSource");
    }

    const nowSec = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const minTime = Number(tx.timeBounds?.minTime ?? 0);
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    if (!tx.timeBounds || maxTime === 0 || nowSec < minTime || nowSec > maxTime) {
      throw new Error("ChallengeExpired");
    }

    if (tx.operations.length < 1) {
      throw new Error("MissingChallengeOperations");
    }

    const firstOp = tx.operations[0]!;
    if (firstOp.type !== "manageData") {
      throw new Error("InvalidChallengeOperationType");
    }

    const clientAccount = firstOp.source;
    if (!clientAccount || !StrKey.isValidEd25519PublicKey(clientAccount)) {
      throw new Error("InvalidClientAccount");
    }

    if (firstOp.name !== `${this.homeDomain} auth`) {
      throw new Error("DomainMismatch");
    }

    if (!firstOp.value || firstOp.value.length < 48) {
      throw new Error("InvalidChallengeNonce");
    }

    for (const op of tx.operations.slice(1)) {
      if (op.type !== "manageData") {
        throw new Error("InvalidChallengeOperationType");
      }
      if (op.name === "web_auth_domain") {
        if (op.source && op.source !== this.serverKeypair.publicKey()) {
          throw new Error("InvalidWebAuthDomainSource");
        }
        const domainVal = op.value ? op.value.toString("utf8") : "";
        if (domainVal !== this.webAuthDomain) {
          throw new Error("WebAuthDomainMismatch");
        }
      }
    }

    const txHash = tx.hash();
    const txHashHex = txHash.toString("hex");
    if (this.consumedChallenges.has(txHashHex)) {
      throw new Error("ChallengeAlreadyUsed");
    }

    const clientKeypair = Keypair.fromPublicKey(clientAccount);
    let hasValidServerSig = false;
    let hasValidClientSig = false;

    for (const decoratedSig of tx.signatures) {
      const sigBytes = decoratedSig.signature();
      if (!hasValidServerSig && this.serverKeypair.verify(txHash, sigBytes)) {
        hasValidServerSig = true;
      }
      if (!hasValidClientSig && clientKeypair.verify(txHash, sigBytes)) {
        hasValidClientSig = true;
      }
    }

    if (!hasValidServerSig) {
      throw new Error("ServerSignatureMissing");
    }
    if (!hasValidClientSig) {
      throw new Error("InvalidClientSignature");
    }

    this.consumedChallenges.add(txHashHex);
    const token = this.auth.signToken(clientAccount, options?.tokenTtlSeconds ?? 3600);
    return { token, account: clientAccount };
  }
}
