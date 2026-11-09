import { Address, xdr } from "@stellar/stellar-sdk";
import {
  computeLeaf,
  computeSecretHash,
  computeSerialHash,
  computeUnitId,
  extractP256UncompressedPublicKey,
  hexToBytes32,
  sha256,
  verifyMerkleProof,
} from "@veritag/sdk";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { BackendConfig } from "../config.js";
import type { Repository, UnitRecord } from "../db/repository.js";
import {
  AuthService,
  type PasskeyAssertionInput,
  SlidingWindowRateLimiter,
} from "../services/auth.js";
import { buildProductionBatch } from "../services/merkle.js";
import { formatPrintableExport, toCsvExport } from "../services/qr.js";
import type { RelayerService } from "../services/relayer.js";
import {
  type SorobanTransactionService,
  computeDeterministicPasskeyAddress,
} from "../services/soroban-tx.js";
import { verifyBrandDomainToml } from "../services/stellar-toml.js";
import type { ObjectStorageAdapter } from "../services/storage.js";
import type { TtlMaintenanceWorker } from "../services/ttl-worker.js";

const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

export interface ApiDependencies {
  config: BackendConfig;
  repo: Repository;
  auth: AuthService;
  rateLimiter: SlidingWindowRateLimiter;
  storage: ObjectStorageAdapter;
  relayer: RelayerService;
  sorobanTx: SorobanTransactionService;
  ttlWorker: TtlMaintenanceWorker;
  tomlFetch?: typeof fetch;
}

type AppVariables = {
  callerAccount: string;
};

function getCallerIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "127.0.0.1"
  );
}

function anonymizeAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

export function createV1Router(deps: ApiDependencies): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();

  const requireAuth = async (
    c: Context<{ Variables: AppVariables }>,
    next: () => Promise<void>,
  ) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }
    try {
      const payload = deps.auth.verifyToken(authHeader.slice("Bearer ".length));
      c.set("callerAccount", payload.sub);
      await next();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Unauthorized" },
        401,
      );
    }
  };

  const rateLimitWrite = (bucketPrefix: string) => {
    return async (c: Context<{ Variables: AppVariables }>, next: () => Promise<void>) => {
      const caller = c.get("callerAccount") || getCallerIp(c);
      const decision = deps.rateLimiter.check(`${bucketPrefix}:${caller}`);
      c.header("X-RateLimit-Limit", String(decision.limit));
      c.header("X-RateLimit-Remaining", String(decision.remaining));
      c.header("X-RateLimit-Reset", String(decision.resetAtSec));
      if (!decision.allowed) {
        return c.json({ error: "RateLimitExceeded" }, 429);
      }
      await next();
    };
  };

  const sponsorOptionalClientTx = async (
    signedTxXdr: string | undefined,
    callerAccount: string,
    callerIp: string,
  ): Promise<{ sponsoredTxHash: string; feeBumpTxXdr: string } | null> => {
    if (!signedTxXdr) return null;
    const sponsored = await deps.relayer.sponsorFeeBump({
      innerTxXdr: signedTxXdr,
      callerAccount,
      callerIp,
    });
    const submission = await deps.sorobanTx.submitSponsoredEnvelope(sponsored.feeBumpTxXdr);
    return {
      sponsoredTxHash: submission.txHash,
      feeBumpTxXdr: sponsored.feeBumpTxXdr,
    };
  };

  // ---------------------------------------------------------------------------
  // Authentication (SEP-10 Ed25519 + Soroban secp256r1 Passkey Smart Accounts)
  // ---------------------------------------------------------------------------

  router.post("/auth/challenge", rateLimitWrite("auth-challenge"), async (c) => {
    const schema = z.object({ account: z.string().min(56) });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid account", details: parsed.error.flatten() }, 400);
    }
    try {
      const challenge = deps.auth.createChallenge(parsed.data.account);
      return c.json(challenge);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Bad request" }, 400);
    }
  });

  router.post("/auth/verify", rateLimitWrite("auth-verify"), async (c) => {
    const schema = z.object({
      nonce: z.string().min(8),
      signature: z.string().min(16),
      passkeyAssertion: z
        .object({
          publicKeyHex: z.string().min(128).optional(),
          authenticatorDataHex: z.string().optional(),
          clientDataJsonBase64: z.string().optional(),
        })
        .optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
    }
    try {
      const pending = deps.auth.peekChallenge(parsed.data.nonce);
      let assertion: PasskeyAssertionInput | undefined = parsed.data.passkeyAssertion
        ? {
            publicKeyHex: parsed.data.passkeyAssertion.publicKeyHex ?? "",
            authenticatorDataHex: parsed.data.passkeyAssertion.authenticatorDataHex,
            clientDataJsonBase64: parsed.data.passkeyAssertion.clientDataJsonBase64,
          }
        : undefined;

      if (pending?.account.startsWith("C")) {
        const registeredWallet = await deps.repo.getPasskeyWalletByAddress(pending.account);
        if (registeredWallet) {
          if (
            assertion?.publicKeyHex &&
            assertion.publicKeyHex.toLowerCase() !== registeredWallet.publicKeyHex.toLowerCase()
          ) {
            return c.json({ error: "PasskeyPublicKeyMismatch" }, 401);
          }
          assertion = {
            ...assertion,
            publicKeyHex: registeredWallet.publicKeyHex,
          };
        }
      }

      const token = deps.auth.verifyChallenge(
        parsed.data.nonce,
        parsed.data.signature,
        3600,
        assertion?.publicKeyHex ? assertion : undefined,
      );
      return c.json({ token });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Unauthorized" }, 401);
    }
  });

  // ---------------------------------------------------------------------------
  // Passkey Smart Account Wallet Factory & Lookup
  // ---------------------------------------------------------------------------

  router.post("/wallets/passkey", rateLimitWrite("passkey-wallet"), async (c) => {
    const schema = z.object({
      credentialId: z.string().min(4).max(512),
      publicKeyHex: z.string().min(128).max(256),
      recoveryAddress: z.string().min(56).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid passkey wallet payload", details: parsed.error.flatten() }, 400);
    }

    let pubKeyBuf: Buffer;
    try {
      pubKeyBuf = extractP256UncompressedPublicKey(Buffer.from(parsed.data.publicKeyHex, "hex"));
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "InvalidPasskeyPublicKey" },
        400,
      );
    }

    const { walletAddress, salt } = computeDeterministicPasskeyAddress(
      deps.config.accountFactoryContractId,
      parsed.data.credentialId,
      deps.config.networkPassphrase,
    );

    const deployReceipt = await deps.sorobanTx.relayContractCall({
      contractId: deps.config.accountFactoryContractId,
      method: "deploy",
      args: [
        xdr.ScVal.scvBytes(salt),
        xdr.ScVal.scvBytes(Buffer.from(parsed.data.credentialId, "utf8")),
        xdr.ScVal.scvBytes(pubKeyBuf),
        parsed.data.recoveryAddress
          ? xdr.ScVal.scvVec([Address.fromString(parsed.data.recoveryAddress).toScVal()])
          : xdr.ScVal.scvVec([]),
      ],
    });

    const record = {
      credentialId: parsed.data.credentialId,
      walletAddress,
      publicKeyHex: pubKeyBuf.toString("hex"),
      saltHex: salt.toString("hex"),
      recoveryAddress: parsed.data.recoveryAddress ?? null,
      deployed: true,
      createdAt: new Date().toISOString(),
    };
    await deps.repo.upsertPasskeyWallet(record);

    const token = deps.auth.signToken(walletAddress);
    return c.json({ wallet: record, deployTxHash: deployReceipt.txHash, token }, 201);
  });

  router.get("/wallets/passkey/:credentialId", async (c) => {
    const credentialId = c.req.param("credentialId");
    const wallet = await deps.repo.getPasskeyWallet(credentialId);
    if (!wallet) {
      return c.json({ error: "PasskeyWalletNotFound" }, 404);
    }
    const token = deps.auth.signToken(wallet.walletAddress);
    return c.json({ wallet, token });
  });

  // ---------------------------------------------------------------------------
  // Brand Onboarding, stellar.toml Domain Verification & Service Centers
  // ---------------------------------------------------------------------------

  router.get("/brands/me", requireAuth, async (c) => {
    const caller = c.get("callerAccount");
    const [brand, serviceCenters, batches] = await Promise.all([
      deps.repo.getBrand(caller),
      deps.repo.listBrandServiceCenters(caller),
      deps.repo.listBrandBatches(caller),
    ]);
    return c.json({
      brand,
      serviceCenters,
      batchCount: batches.length,
    });
  });

  router.post("/brands/register", requireAuth, rateLimitWrite("brand-write"), async (c) => {
    const schema = z.object({
      domain: z.string().min(3).max(253),
      verified: z.boolean().optional(),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid brand payload", details: parsed.error.flatten() }, 400);
    }
    const caller = c.get("callerAccount");
    const existing = await deps.repo.getBrand(caller);
    const verified = parsed.data.verified ?? existing?.verified ?? false;

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );

    await deps.repo.upsertBrand({
      address: caller,
      admin: caller,
      domain: parsed.data.domain,
      verified,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    return c.json(
      {
        address: caller,
        domain: parsed.data.domain,
        verified,
        ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
      },
      201,
    );
  });

  router.post("/brands/verify-domain", requireAuth, rateLimitWrite("brand-write"), async (c) => {
    const caller = c.get("callerAccount");
    const brand = await deps.repo.getBrand(caller);
    if (!brand) {
      return c.json({ error: "BrandNotFound" }, 404);
    }

    const tomlCheck = await verifyBrandDomainToml({
      domain: brand.domain,
      brandAddress: caller,
      fetchImpl: deps.tomlFetch,
    });

    if (!tomlCheck.verified) {
      return c.json(
        {
          verified: false,
          domain: brand.domain,
          error: tomlCheck.error ?? "DomainVerificationFailed",
        },
        422,
      );
    }

    await deps.repo.upsertBrand({ ...brand, verified: true });

    const txReceipt = await deps.sorobanTx.relayContractCall({
      contractId: deps.config.registryContractId,
      method: "verify_brand",
      args: [Address.fromString(caller).toScVal(), xdr.ScVal.scvBool(true)],
      useAdminSigner: true,
    });

    return c.json({
      verified: true,
      domain: brand.domain,
      matchedField: tomlCheck.matchedField,
      txHash: txReceipt.txHash,
    });
  });

  router.post("/brands/service-centers", requireAuth, rateLimitWrite("brand-write"), async (c) => {
    const schema = z.object({
      serviceCenter: z.string().min(56),
      authorized: z.boolean().default(true),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
    }
    const caller = c.get("callerAccount");
    const brand = await deps.repo.getBrand(caller);
    if (!brand || !brand.verified) {
      return c.json({ error: "BrandNotVerified" }, 403);
    }
    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );
    await deps.repo.setServiceCenter(caller, parsed.data.serviceCenter, parsed.data.authorized);
    return c.json({
      brand: caller,
      serviceCenter: parsed.data.serviceCenter,
      authorized: parsed.data.authorized,
      ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
    });
  });

  // ---------------------------------------------------------------------------
  // Public Verification & Unit Timeline
  // ---------------------------------------------------------------------------

  router.get("/verify/:brand/:batch/:serial", async (c) => {
    const brandAddr = c.req.param("brand");
    const batchIdHex = c.req.param("batch");
    const serial = c.req.param("serial");

    let batchIdBuf: Buffer;
    try {
      batchIdBuf = hexToBytes32(batchIdHex);
    } catch {
      return c.json({ error: "Invalid 32-byte hex batch ID" }, 400);
    }

    const serialHashBuf = computeSerialHash(serial);
    const serialHashHex = serialHashBuf.toString("hex");
    let unitIdHex: string;
    try {
      unitIdHex = computeUnitId(brandAddr, batchIdBuf, serialHashBuf).toString("hex");
    } catch {
      return c.json({ error: "Invalid Stellar brand address" }, 400);
    }

    const ipHash = sha256(getCallerIp(c)).toString("hex");
    const uaHash = sha256(c.req.header("user-agent") ?? "unknown").toString("hex");
    const scanCount = await deps.repo.recordScan(unitIdHex, ipHash, uaHash);

    const [brand, batch, provision, unit, events] = await Promise.all([
      deps.repo.getBrand(brandAddr),
      deps.repo.getBatch(brandAddr, batchIdHex),
      deps.repo.getBatchUnitBySerialHash(brandAddr, batchIdHex, serialHashHex),
      deps.repo.getUnit(unitIdHex),
      deps.repo.getUnitEvents(unitIdHex),
    ]);

    if (!batch) {
      return c.json({
        status: "Unknown",
        authentic: false,
        unitId: unitIdHex,
        brandVerified: Boolean(brand?.verified),
        scanCount,
        contractId: deps.config.registryContractId,
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    if (unit) {
      const effectiveStatus =
        batch.recalled && unit.status === "Active" ? "Recalled" : unit.status;
      const warrantyValid =
        !batch.recalled && effectiveStatus === "Active" && nowSec <= unit.warrantyExpiry;

      const verifyState =
        effectiveStatus === "Recalled"
          ? "Recalled"
          : effectiveStatus === "Flagged"
            ? "Flagged"
            : effectiveStatus === "Retired"
              ? "Retired"
              : unit.duplicateAttempts > 0
                ? "AlreadyClaimedWarning"
                : "AuthenticActive";

      const transferCount = events.filter((e) => e.type === "unit_transferred").length;

      return c.json({
        status: verifyState,
        authentic: effectiveStatus !== "Flagged",
        unitId: unitIdHex,
        brand: {
          address: brandAddr,
          domain: brand?.domain ?? null,
          verified: Boolean(brand?.verified),
        },
        batch: {
          batchId: batch.batchId,
          merkleRoot: batch.merkleRoot,
          warrantyMonths: batch.warrantyMonths,
          recalled: batch.recalled,
        },
        unit: {
          ownerAnonymized: anonymizeAddress(unit.owner),
          status: effectiveStatus,
          activatedAt: unit.activatedAt,
          warrantyExpiry: unit.warrantyExpiry,
          warrantyValid,
          claimsUsed: unit.claimsUsed,
          duplicateAttempts: unit.duplicateAttempts,
          ownershipTransfers: transferCount,
        },
        scanCount,
        suspiciousScanVolume: scanCount > 50,
        contractId: deps.config.registryContractId,
      });
    }

    if (!provision) {
      return c.json({
        status: "Unknown",
        authentic: false,
        unitId: unitIdHex,
        brandVerified: Boolean(brand?.verified),
        scanCount,
        contractId: deps.config.registryContractId,
      });
    }

    return c.json({
      status: batch.recalled ? "Recalled" : "AuthenticInactive",
      authentic: true,
      unitId: unitIdHex,
      brand: {
        address: brandAddr,
        domain: brand?.domain ?? null,
        verified: Boolean(brand?.verified),
      },
      batch: {
        batchId: batch.batchId,
        merkleRoot: batch.merkleRoot,
        warrantyMonths: batch.warrantyMonths,
        recalled: batch.recalled,
      },
      proof: provision.proof,
      serialHash: provision.serialHash,
      scanCount,
      suspiciousScanVolume: scanCount > 50,
      contractId: deps.config.registryContractId,
    });
  });

  router.get("/units/:unitId", async (c) => {
    const unitId = c.req.param("unitId");
    const [unit, claims, events] = await Promise.all([
      deps.repo.getUnit(unitId),
      deps.repo.listUnitClaims(unitId),
      deps.repo.getUnitEvents(unitId),
    ]);

    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }

    const batch = await deps.repo.getBatch(unit.brand, unit.batchId);
    const nowSec = Math.floor(Date.now() / 1000);
    const effectiveStatus =
      batch?.recalled && unit.status === "Active" ? "Recalled" : unit.status;
    const warrantyValid =
      !batch?.recalled && effectiveStatus === "Active" && nowSec <= unit.warrantyExpiry;

    return c.json({
      unit: {
        ...unit,
        status: effectiveStatus,
        warrantyValid,
        ownerAnonymized: anonymizeAddress(unit.owner),
      },
      claims,
      timeline: events,
    });
  });

  router.get("/owners/:owner/units", requireAuth, async (c) => {
    const owner = c.req.param("owner");
    if (c.get("callerAccount") !== owner) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const units = await deps.repo.listOwnerUnits(owner);
    return c.json({ units });
  });

  // ---------------------------------------------------------------------------
  // Brand Production Batches, Printing Export & Recalls
  // ---------------------------------------------------------------------------

  router.get("/brands/batches", requireAuth, async (c) => {
    const caller = c.get("callerAccount");
    const batches = await deps.repo.listBrandBatches(caller);
    return c.json({ batches });
  });

  router.post("/brands/batches", requireAuth, rateLimitWrite("brand-write"), async (c) => {
    const caller = c.get("callerAccount");
    const brand = await deps.repo.getBrand(caller);
    if (!brand) {
      return c.json({ error: "BrandNotFound" }, 404);
    }
    if (!brand.verified) {
      return c.json({ error: "BrandNotVerified" }, 403);
    }

    const schema = z.object({
      batchCode: z.string().min(2).max(128),
      warrantyMonths: z.number().int().min(0).max(240),
      productMeta: z.union([z.string().min(1), z.record(z.unknown())]),
      count: z.number().int().min(1).max(50_000).optional(),
      serials: z.array(z.string().min(1)).max(50_000).optional(),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid batch parameters", details: parsed.error.flatten() }, 400);
    }

    try {
      const sponsored = await sponsorOptionalClientTx(
        parsed.data.signedTxXdr,
        caller,
        getCallerIp(c),
      );
      const built = buildProductionBatch({
        brand: caller,
        batchCode: parsed.data.batchCode,
        warrantyMonths: parsed.data.warrantyMonths,
        productMeta: parsed.data.productMeta,
        count: parsed.data.count,
        serials: parsed.data.serials,
        encryptionKeySecret: deps.config.jwtSecret,
      });

      await deps.repo.insertBatch(built.batch, built.units);
      return c.json(
        {
          batch: built.batch,
          ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
          contractCall: {
            contractId: deps.config.registryContractId,
            method: "commit_batch",
            args: {
              brand: caller,
              batch_id: built.batch.batchId,
              merkle_root: built.batch.merkleRoot,
              warranty_months: built.batch.warrantyMonths,
              product_meta_hash: built.batch.productMetaHash,
              unit_count: built.batch.unitCount,
            },
          },
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "BatchCreationFailed";
      const status = message === "BatchExists" ? 409 : 400;
      return c.json({ error: message }, status);
    }
  });

  router.get("/brands/batches/:id/export", requireAuth, async (c) => {
    const caller = c.get("callerAccount");
    const batchId = c.req.param("id") ?? "";
    const format = c.req.query("format") ?? "json";
    const purgeAfterExport = c.req.query("purge") === "true";
    const includeQrSvg = c.req.query("qrSvg") !== "false";

    const batch = await deps.repo.getBatch(caller, batchId);
    if (!batch) {
      return c.json({ error: "BatchNotFound" }, 404);
    }

    const units = await deps.repo.getBatchUnits(caller, batchId);
    try {
      const printable = formatPrintableExport(
        units,
        deps.config.appBaseUrl,
        deps.config.jwtSecret,
        includeQrSvg,
      );

      if (purgeAfterExport) {
        await deps.repo.purgeBatchSecrets(caller, batchId);
      }

      if (format === "csv") {
        const csv = toCsvExport(printable);
        return c.text(csv, 200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="batch-${batchId.slice(0, 12)}.csv"`,
        });
      }

      return c.json({
        batchId,
        merkleRoot: batch.merkleRoot,
        unitCount: printable.length,
        secretsPurged: purgeAfterExport,
        units: printable,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ExportFailed";
      return c.json({ error: msg }, msg === "SecretsAlreadyPurged" ? 410 : 400);
    }
  });

  router.post("/brands/recall", requireAuth, rateLimitWrite("brand-write"), async (c) => {
    const caller = c.get("callerAccount");
    const schema = z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("batch"),
        batchId: z.string().length(64),
        reason: z.string().min(3),
        signedTxXdr: z.string().min(16).optional(),
      }),
      z.object({
        mode: z.literal("unit"),
        unitId: z.string().length(64),
        reason: z.string().min(3),
        signedTxXdr: z.string().min(16).optional(),
      }),
    ]);

    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid recall request", details: parsed.error.flatten() }, 400);
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );
    const reasonHash = sha256(parsed.data.reason).toString("hex");

    if (parsed.data.mode === "batch") {
      const batch = await deps.repo.getBatch(caller, parsed.data.batchId);
      if (!batch) {
        return c.json({ error: "BatchNotFound" }, 404);
      }
      await deps.repo.markBatchRecalled(caller, parsed.data.batchId, reasonHash);
      return c.json({
        recalled: true,
        batchId: parsed.data.batchId,
        reasonHash,
        ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
      });
    }

    const unit = await deps.repo.getUnit(parsed.data.unitId);
    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }
    if (unit.brand !== caller) {
      return c.json({ error: "NotAuthorized" }, 403);
    }

    await deps.repo.deleteTransferOffer(unit.unitId);
    await deps.repo.upsertUnit({ ...unit, status: "Flagged" });
    await deps.repo.appendEvent({
      id: `flag:${unit.unitId}:${Date.now()}`,
      unitId: unit.unitId,
      brand: unit.brand,
      batchId: unit.batchId,
      type: "unit_flagged",
      data: { reason_hash: reasonHash },
      ledger: Date.now(),
      txHash:
        sponsored?.sponsoredTxHash ??
        sha256(`flag:${unit.unitId}:${reasonHash}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });
    return c.json({
      flagged: true,
      unitId: unit.unitId,
      reasonHash,
      ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
    });
  });

  // ---------------------------------------------------------------------------
  // Public Rate-Limited Unit Activation (First Sale / First Scan)
  // ---------------------------------------------------------------------------

  router.post("/activate", rateLimitWrite("activate"), async (c) => {
    const ip = getCallerIp(c);

    const schema = z.object({
      brand: z.string().min(56),
      batchId: z.string().length(64),
      serial: z.string().min(1),
      secret: z.string().min(1),
      firstOwner: z.string().min(56),
      proof: z.array(z.string().length(64)).optional(),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid activation payload", details: parsed.error.flatten() }, 400);
    }

    const { brand, batchId, serial, secret, firstOwner } = parsed.data;
    const batch = await deps.repo.getBatch(brand, batchId);
    if (!batch) {
      return c.json({ error: "BatchNotFound" }, 404);
    }
    if (batch.recalled) {
      return c.json({ error: "BatchRecalled" }, 409);
    }

    const serialHashBuf = computeSerialHash(serial);
    const secretHashBuf = computeSecretHash(secret);
    const leafBuf = computeLeaf(serialHashBuf, secretHashBuf);
    const batchIdBuf = hexToBytes32(batchId);
    const unitIdHex = computeUnitId(brand, batchIdBuf, serialHashBuf).toString("hex");

    const provision = await deps.repo.getBatchUnitBySerialHash(
      brand,
      batchId,
      serialHashBuf.toString("hex"),
    );
    const proofHexList = parsed.data.proof ?? provision?.proof ?? [];
    const proofBuffers = proofHexList.map((hex) => hexToBytes32(hex));

    if (!verifyMerkleProof(hexToBytes32(batch.merkleRoot), leafBuf, proofBuffers)) {
      return c.json({ error: "InvalidProof" }, 400);
    }

    const existingUnit = await deps.repo.getUnit(unitIdHex);
    if (existingUnit) {
      const updatedDuplicates = existingUnit.duplicateAttempts + 1;
      await deps.repo.upsertUnit({
        ...existingUnit,
        duplicateAttempts: updatedDuplicates,
      });
      await deps.repo.appendEvent({
        id: `dup:${unitIdHex}:${updatedDuplicates}`,
        unitId: unitIdHex,
        brand,
        batchId,
        type: "duplicate_attempt",
        data: { caller: firstOwner },
        ledger: Date.now(),
        txHash: sha256(`dup:${unitIdHex}:${updatedDuplicates}`).toString("hex"),
        finalized: true,
        createdAt: new Date().toISOString(),
      });
      return c.json(
        {
          error: "UnitAlreadyActivated",
          unitId: unitIdHex,
          duplicateAttempts: updatedDuplicates,
        },
        409,
      );
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      firstOwner,
      ip,
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const warrantyExpiry = nowSec + batch.warrantyMonths * SECONDS_PER_MONTH;

    const created: UnitRecord = {
      unitId: unitIdHex,
      brand,
      batchId,
      owner: firstOwner,
      status: "Active",
      activatedAt: nowSec,
      warrantyExpiry,
      claimsUsed: 0,
      duplicateAttempts: 0,
      scanCount: 0,
    };
    await deps.repo.upsertUnit(created);
    await deps.repo.appendEvent({
      id: `act:${unitIdHex}`,
      unitId: unitIdHex,
      brand,
      batchId,
      type: "unit_activated",
      data: { owner: firstOwner, warranty_expiry: warrantyExpiry },
      ledger: Date.now(),
      txHash: sponsored?.sponsoredTxHash ?? sha256(`act:${unitIdHex}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });

    return c.json(
      {
        unitId: unitIdHex,
        owner: firstOwner,
        activatedAt: nowSec,
        warrantyExpiry,
        ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
      },
      201,
    );
  });

  // ---------------------------------------------------------------------------
  // Resale Ownership & Warranty Transfer
  // ---------------------------------------------------------------------------

  router.post("/transfer/offer", requireAuth, rateLimitWrite("transfer"), async (c) => {
    const caller = c.get("callerAccount");
    const schema = z.object({
      unitId: z.string().length(64),
      ttlSeconds: z.number().int().min(60).max(7 * 86_400).default(86_400),
      codeHash: z.string().length(64).optional(),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid offer payload", details: parsed.error.flatten() }, 400);
    }

    const unit = await deps.repo.getUnit(parsed.data.unitId);
    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }
    if (unit.owner !== caller) {
      return c.json({ error: "NotAuthorized" }, 403);
    }
    const batch = await deps.repo.getBatch(unit.brand, unit.batchId);
    if (batch?.recalled || unit.status === "Recalled") {
      return c.json({ error: "BatchRecalled" }, 409);
    }
    if (unit.status !== "Active") {
      return c.json({ error: `Unit${unit.status}` }, 409);
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );

    const generatedCode = parsed.data.codeHash
      ? null
      : sha256(`${unit.unitId}:${Date.now()}:${Math.random()}`).toString("hex").slice(0, 16).toUpperCase();
    const codeHash =
      parsed.data.codeHash ?? sha256(generatedCode!).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + parsed.data.ttlSeconds;

    await deps.repo.setTransferOffer({
      unitId: unit.unitId,
      codeHash,
      expiresAt,
    });
    await deps.repo.appendEvent({
      id: `offer:${unit.unitId}:${expiresAt}`,
      unitId: unit.unitId,
      brand: unit.brand,
      batchId: unit.batchId,
      type: "transfer_offered",
      data: { code_hash: codeHash, expires_at: expiresAt },
      ledger: Date.now(),
      txHash:
        sponsored?.sponsoredTxHash ??
        sha256(`offer:${unit.unitId}:${expiresAt}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      unitId: unit.unitId,
      transferCode: generatedCode,
      codeHash,
      expiresAt,
      ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
    });
  });

  router.post("/transfer/redeem", requireAuth, rateLimitWrite("transfer"), async (c) => {
    const caller = c.get("callerAccount");
    const schema = z.object({
      unitId: z.string().length(64),
      code: z.string().min(4),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid redeem payload", details: parsed.error.flatten() }, 400);
    }

    const unit = await deps.repo.getUnit(parsed.data.unitId);
    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }
    const batch = await deps.repo.getBatch(unit.brand, unit.batchId);
    if (batch?.recalled || unit.status === "Recalled") {
      return c.json({ error: "BatchRecalled" }, 409);
    }
    if (unit.status !== "Active") {
      return c.json({ error: `Unit${unit.status}` }, 409);
    }

    const offer = await deps.repo.getTransferOffer(unit.unitId);
    if (!offer) {
      return c.json({ error: "TransferOfferNotFound" }, 404);
    }
    if (Math.floor(Date.now() / 1000) > offer.expiresAt) {
      return c.json({ error: "TransferOfferExpired" }, 410);
    }
    if (sha256(parsed.data.code).toString("hex") !== offer.codeHash) {
      return c.json({ error: "InvalidTransferCode" }, 400);
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );

    const previousOwner = unit.owner;
    await deps.repo.deleteTransferOffer(unit.unitId);
    await deps.repo.upsertUnit({ ...unit, owner: caller });
    await deps.repo.appendEvent({
      id: `xfer:${unit.unitId}:${Date.now()}`,
      unitId: unit.unitId,
      brand: unit.brand,
      batchId: unit.batchId,
      type: "unit_transferred",
      data: { from: previousOwner, to: caller },
      ledger: Date.now(),
      txHash:
        sponsored?.sponsoredTxHash ??
        sha256(`xfer:${unit.unitId}:${caller}:${Date.now()}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      unitId: unit.unitId,
      from: previousOwner,
      to: caller,
      warrantyExpiry: unit.warrantyExpiry,
      ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
    });
  });

  // ---------------------------------------------------------------------------
  // Warranty Claims
  // ---------------------------------------------------------------------------

  router.get("/service-centers/:address/claims", requireAuth, async (c) => {
    const address = c.req.param("address");
    if (c.get("callerAccount") !== address) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const claims = await deps.repo.listServiceCenterClaims(address);
    return c.json({ claims });
  });

  router.post("/claims", requireAuth, rateLimitWrite("claims"), async (c) => {
    const caller = c.get("callerAccount");
    const schema = z.object({
      unitId: z.string().length(64),
      serviceCenter: z.string().min(56),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid claim payload", details: parsed.error.flatten() }, 400);
    }

    const unit = await deps.repo.getUnit(parsed.data.unitId);
    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }
    if (unit.owner !== caller) {
      return c.json({ error: "NotAuthorized" }, 403);
    }
    const batch = await deps.repo.getBatch(unit.brand, unit.batchId);
    if (batch?.recalled || unit.status === "Recalled") {
      return c.json({ error: "BatchRecalled" }, 409);
    }
    if (unit.status !== "Active") {
      return c.json({ error: `Unit${unit.status}` }, 409);
    }

    const authorizedSc = await deps.repo.isServiceCenter(unit.brand, parsed.data.serviceCenter);
    if (!authorizedSc) {
      return c.json({ error: "ServiceCenterNotAuthorized" }, 403);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > unit.warrantyExpiry) {
      return c.json({ error: "WarrantyExpired" }, 409);
    }
    if (unit.claimsUsed >= 5) {
      return c.json({ error: "ClaimLimitReached" }, 409);
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );

    const claimId = unit.claimsUsed + 1;
    await deps.repo.upsertUnit({ ...unit, claimsUsed: claimId });
    await deps.repo.upsertClaim({
      unitId: unit.unitId,
      claimId,
      serviceCenter: parsed.data.serviceCenter,
      outcome: "Pending",
      reportHash: "0".repeat(64),
      filedAt: nowSec,
      resolvedAt: null,
    });
    await deps.repo.appendEvent({
      id: `claim:${unit.unitId}:${claimId}`,
      unitId: unit.unitId,
      brand: unit.brand,
      batchId: unit.batchId,
      type: "claim_filed",
      data: { claim_id: claimId, service_center: parsed.data.serviceCenter },
      ledger: Date.now(),
      txHash:
        sponsored?.sponsoredTxHash ??
        sha256(`claim:${unit.unitId}:${claimId}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });

    return c.json(
      {
        unitId: unit.unitId,
        claimId,
        outcome: "Pending",
        ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
      },
      201,
    );
  });

  router.post("/claims/:id/resolve", requireAuth, rateLimitWrite("claims"), async (c) => {
    const caller = c.get("callerAccount");
    const claimId = Number(c.req.param("id"));
    if (!Number.isInteger(claimId) || claimId <= 0) {
      return c.json({ error: "Invalid claim ID" }, 400);
    }

    const schema = z.object({
      unitId: z.string().length(64),
      outcome: z.enum(["Approved", "Rejected", "Repaired", "Replaced"]),
      reportHash: z.string().length(64),
      signedTxXdr: z.string().min(16).optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid resolution payload", details: parsed.error.flatten() }, 400);
    }

    const unit = await deps.repo.getUnit(parsed.data.unitId);
    if (!unit) {
      return c.json({ error: "UnitNotFound" }, 404);
    }

    const claim = await deps.repo.getClaim(unit.unitId, claimId);
    if (!claim) {
      return c.json({ error: "ClaimNotFound" }, 404);
    }
    if (claim.outcome !== "Pending") {
      return c.json({ error: "ClaimAlreadyResolved" }, 409);
    }
    if (claim.serviceCenter !== caller) {
      return c.json({ error: "ServiceCenterNotAuthorized" }, 403);
    }

    const stillAuthorized = await deps.repo.isServiceCenter(unit.brand, caller);
    if (!stillAuthorized) {
      return c.json({ error: "ServiceCenterNotAuthorized" }, 403);
    }

    const sponsored = await sponsorOptionalClientTx(
      parsed.data.signedTxXdr,
      caller,
      getCallerIp(c),
    );

    const resolvedAt = Math.floor(Date.now() / 1000);
    await deps.repo.upsertClaim({
      ...claim,
      outcome: parsed.data.outcome,
      reportHash: parsed.data.reportHash,
      resolvedAt,
    });

    if (parsed.data.outcome === "Replaced") {
      await deps.repo.upsertUnit({ ...unit, status: "Retired" });
    }

    await deps.repo.appendEvent({
      id: `resolve:${unit.unitId}:${claimId}`,
      unitId: unit.unitId,
      brand: unit.brand,
      batchId: unit.batchId,
      type: "claim_resolved",
      data: {
        claim_id: claimId,
        outcome: parsed.data.outcome,
        report_hash: parsed.data.reportHash,
      },
      ledger: Date.now(),
      txHash:
        sponsored?.sponsoredTxHash ??
        sha256(`resolve:${unit.unitId}:${claimId}`).toString("hex"),
      finalized: true,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      unitId: unit.unitId,
      claimId,
      outcome: parsed.data.outcome,
      reportHash: parsed.data.reportHash,
      resolvedAt,
      ...(sponsored ? { sponsoredTxHash: sponsored.sponsoredTxHash } : {}),
    });
  });

  // ---------------------------------------------------------------------------
  // Off-chain Document Storage (Upload & Content-Addressed Download)
  // ---------------------------------------------------------------------------

  router.post("/files", requireAuth, rateLimitWrite("files"), async (c) => {
    const caller = c.get("callerAccount");
    const schema = z.object({
      contentBase64: z.string().min(1),
      mime: z.string().min(3).max(128),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid file upload payload", details: parsed.error.flatten() }, 400);
    }

    const bytes = Buffer.from(parsed.data.contentBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
      return c.json({ error: "File size must be between 1B and 10MB" }, 413);
    }

    const stored = await deps.storage.put(bytes, parsed.data.mime);
    const meta = {
      hash: stored.hash,
      uploader: caller,
      mime: parsed.data.mime,
      size: stored.size,
      storageKey: stored.storageKey,
      createdAt: new Date().toISOString(),
    };
    await deps.repo.saveFileMetadata(meta);
    return c.json(meta, 201);
  });

  router.get("/files/:hash", async (c) => {
    const hash = c.req.param("hash");
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      return c.json({ error: "Invalid file hash" }, 400);
    }
    const meta = await deps.repo.getFileMetadata(hash.toLowerCase());
    if (!meta) {
      return c.json({ error: "FileNotFound" }, 404);
    }
    const content = await deps.storage.get(meta.storageKey);
    if (!content) {
      return c.json({ error: "FileBlobMissing" }, 404);
    }

    return new Response(Buffer.from(content), {
      status: 200,
      headers: {
        "Content-Type": meta.mime,
        "Content-Length": String(meta.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${meta.hash}"`,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Fee-Bump Sponsorship, Soroban RPC Submission & TTL Maintenance
  // ---------------------------------------------------------------------------

  router.post("/sponsor", requireAuth, async (c) => {
    const caller = c.get("callerAccount");
    const ip = getCallerIp(c);
    if (
      !deps.rateLimiter.allow(`sponsor:${caller}`) ||
      !deps.rateLimiter.allow(`sponsor-ip:${ip}`)
    ) {
      return c.json({ error: "RateLimitExceeded" }, 429);
    }

    const schema = z.object({
      innerTxXdr: z.string().min(16),
      submit: z.boolean().optional(),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid transaction XDR", details: parsed.error.flatten() }, 400);
    }

    try {
      const sponsored = await deps.relayer.sponsorFeeBump({
        innerTxXdr: parsed.data.innerTxXdr,
        callerAccount: caller,
        callerIp: ip,
      });

      if (parsed.data.submit) {
        const submission = await deps.sorobanTx.submitSponsoredEnvelope(sponsored.feeBumpTxXdr);
        return c.json({ ...sponsored, submission });
      }
      return c.json(sponsored);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SponsorshipFailed";
      const code = msg === "SponsorQuotaExceeded" ? 429 : 400;
      return c.json({ error: msg }, code);
    }
  });

  router.post("/maintenance/ttl-sweep", requireAuth, rateLimitWrite("maintenance"), async (c) => {
    const report = await deps.ttlWorker.runSweep();
    return c.json(report);
  });

  return router;
}
