import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

// ---------------------------------------------------------------------------
// Common & Shared Schemas
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: "Error code or failure reason" }),
    details: z.any().optional().openapi({ description: "Optional validation error details" }),
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.string().openapi({ example: "ok" }),
    service: z.string().openapi({ example: "veritag-backend" }),
    network: z.string().openapi({ example: "testnet" }),
    contractId: z.string().openapi({
      example: "CCOY35YSS7ICXGYOSZOF4QXZP5OG2MFSEFXZUYJEFUUXG5HHZ3ZUZQND",
    }),
    accountFactoryContractId: z.string().openapi({
      example: "CDIHHVXIPD4GGRJ24375YZ5T6LIIH4USUWA2WZ5VJAJ4KNL7LFMW63C4",
    }),
  })
  .openapi("HealthResponse");

// ---------------------------------------------------------------------------
// Auth & Wallets Schemas
// ---------------------------------------------------------------------------

export const AuthChallengeRequestSchema = z
  .object({
    account: z.string().min(56).openapi({
      description: "Stellar G... Ed25519 public key or C... Soroban contract address",
      example: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWAC",
    }),
  })
  .openapi("AuthChallengeRequest");

export const AuthChallengeResponseSchema = z
  .object({
    nonce: z.string().openapi({ description: "Unique challenge nonce" }),
    message: z.string().openapi({ description: "Challenge text to be signed" }),
  })
  .openapi("AuthChallengeResponse");

export const AuthVerifyRequestSchema = z
  .object({
    nonce: z.string().min(8).openapi({ description: "Challenge nonce issued by /auth/challenge" }),
    signature: z.string().min(16).openapi({ description: "Hex-encoded signature or assertion" }),
    passkeyAssertion: z
      .object({
        publicKeyHex: z.string().min(128).optional().openapi({ description: "Uncompressed P-256 public key hex" }),
        authenticatorDataHex: z.string().optional().openapi({ description: "WebAuthn authenticatorData hex" }),
        clientDataJsonBase64: z.string().optional().openapi({ description: "WebAuthn clientDataJSON base64" }),
      })
      .optional()
      .openapi({ description: "Passkey assertion details for Soroban smart accounts" }),
  })
  .openapi("AuthVerifyRequest");

export const AuthVerifyResponseSchema = z
  .object({
    token: z.string().openapi({ description: "HS256 Bearer JWT" }),
  })
  .openapi("AuthVerifyResponse");

export const PasskeyWalletRecordSchema = z
  .object({
    credentialId: z.string(),
    walletAddress: z.string(),
    publicKeyHex: z.string(),
    saltHex: z.string(),
    recoveryAddress: z.string().nullable().optional(),
    deployed: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("PasskeyWalletRecord");

export const PasskeyWalletCreateRequestSchema = z
  .object({
    credentialId: z.string().min(4).max(512).openapi({ description: "WebAuthn credential ID" }),
    publicKeyHex: z.string().min(128).max(256).openapi({ description: "65-byte uncompressed SEC1 P-256 public key hex" }),
    recoveryAddress: z.string().min(56).optional().openapi({ description: "Optional recovery Stellar account address" }),
  })
  .openapi("PasskeyWalletCreateRequest");

export const PasskeyWalletCreateResponseSchema = z
  .object({
    wallet: PasskeyWalletRecordSchema,
    deployTxHash: z.string().openapi({ description: "Transaction hash of factory deployment" }),
    token: z.string().openapi({ description: "Bearer JWT for deployed smart account" }),
  })
  .openapi("PasskeyWalletCreateResponse");

export const PasskeyWalletLookupResponseSchema = z
  .object({
    wallet: PasskeyWalletRecordSchema,
    token: z.string(),
  })
  .openapi("PasskeyWalletLookupResponse");

// ---------------------------------------------------------------------------
// Brand Schemas
// ---------------------------------------------------------------------------

export const BrandRecordSchema = z
  .object({
    address: z.string(),
    admin: z.string(),
    domain: z.string(),
    verified: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("BrandRecord");

export const BrandProfileResponseSchema = z
  .object({
    brand: BrandRecordSchema.nullable(),
    serviceCenters: z.array(z.string()),
    batchCount: z.number().int(),
  })
  .openapi("BrandProfileResponse");

export const BrandRegisterRequestSchema = z
  .object({
    domain: z.string().min(3).max(253).openapi({ example: "chronos-watches.swiss" }),
    verified: z.boolean().optional(),
    signedTxXdr: z.string().min(16).optional().openapi({ description: "Optional signed Soroban transaction XDR for fee sponsorship" }),
  })
  .openapi("BrandRegisterRequest");

export const BrandRegisterResponseSchema = z
  .object({
    address: z.string(),
    domain: z.string(),
    verified: z.boolean(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("BrandRegisterResponse");

export const BrandVerifyDomainResponseSchema = z
  .object({
    verified: z.boolean(),
    domain: z.string(),
    matchedField: z.string().optional(),
    txHash: z.string().optional(),
  })
  .openapi("BrandVerifyDomainResponse");

export const ServiceCenterAuthorizeRequestSchema = z
  .object({
    serviceCenter: z.string().min(56).openapi({ description: "Stellar account address of service center" }),
    authorized: z.boolean().default(true),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("ServiceCenterAuthorizeRequest");

export const ServiceCenterAuthorizeResponseSchema = z
  .object({
    brand: z.string(),
    serviceCenter: z.string(),
    authorized: z.boolean(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("ServiceCenterAuthorizeResponse");

// ---------------------------------------------------------------------------
// Batch Schemas
// ---------------------------------------------------------------------------

export const BatchRecordSchema = z
  .object({
    batchId: z.string().openapi({ description: "64-character hex batch ID" }),
    brand: z.string(),
    batchCode: z.string(),
    merkleRoot: z.string().openapi({ description: "32-byte hex Merkle root" }),
    warrantyMonths: z.number().int(),
    productMetaHash: z.string(),
    unitCount: z.number().int(),
    recalled: z.boolean(),
    recalledAt: z.number().nullable().optional(),
    recallReasonHash: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi("BatchRecord");

export const BatchCreateRequestSchema = z
  .object({
    batchCode: z.string().min(2).max(128).openapi({ example: "CH-2026-LOT1" }),
    warrantyMonths: z.number().int().min(0).max(240).openapi({ example: 24 }),
    productMeta: z.union([z.string().min(1), z.record(z.unknown())]).openapi({
      description: "Product metadata string or JSON object",
      example: { model: "Chronos Titan", sku: "CT-01" },
    }),
    count: z.number().int().min(1).max(50_000).optional().openapi({ description: "Units to generate auto-serials for", example: 100 }),
    serials: z.array(z.string().min(1)).max(50_000).optional().openapi({ description: "Explicit list of serial numbers" }),
    signedTxXdr: z.string().min(16).optional().openapi({ description: "Optional signed commit_batch transaction XDR for fee sponsorship" }),
  })
  .openapi("BatchCreateRequest");

export const BatchCreateResponseSchema = z
  .object({
    batch: BatchRecordSchema,
    sponsoredTxHash: z.string().optional(),
    contractCall: z.object({
      contractId: z.string(),
      method: z.literal("commit_batch"),
      args: z.object({
        brand: z.string(),
        batch_id: z.string(),
        merkle_root: z.string(),
        warranty_months: z.number().int(),
        product_meta_hash: z.string(),
        unit_count: z.number().int(),
      }),
    }),
  })
  .openapi("BatchCreateResponse");

export const PrintableUnitExportSchema = z
  .object({
    unitId: z.string(),
    serial: z.string(),
    scratchSecret: z.string(),
    serialHash: z.string(),
    qrUrl: z.string(),
    qrSvg: z.string().optional(),
    qrDataUrl: z.string().optional(),
  })
  .openapi("PrintableUnitExport");

export const BatchExportResponseSchema = z
  .object({
    batchId: z.string(),
    merkleRoot: z.string(),
    unitCount: z.number().int(),
    secretsPurged: z.boolean(),
    units: z.array(PrintableUnitExportSchema),
  })
  .openapi("BatchExportResponse");

export const BrandRecallRequestSchema = z
  .object({
    mode: z.enum(["batch", "unit"]).openapi({ description: "Recall full batch or flag individual unit" }),
    batchId: z.string().length(64).optional().openapi({ description: "Batch ID (required if mode=batch)" }),
    unitId: z.string().length(64).optional().openapi({ description: "Unit ID (required if mode=unit)" }),
    reason: z.string().min(3).openapi({ description: "Human-readable recall reason" }),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("BrandRecallRequest");

export const BrandRecallResponseSchema = z
  .object({
    recalled: z.boolean().optional(),
    flagged: z.boolean().optional(),
    batchId: z.string().optional(),
    unitId: z.string().optional(),
    reasonHash: z.string(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("BrandRecallResponse");

// ---------------------------------------------------------------------------
// Unit & Verification Schemas
// ---------------------------------------------------------------------------

export const UnitRecordSchema = z
  .object({
    unitId: z.string(),
    brand: z.string(),
    batchId: z.string(),
    owner: z.string(),
    status: z.enum(["Active", "Flagged", "Retired", "Recalled"]),
    activatedAt: z.number(),
    warrantyExpiry: z.number(),
    claimsUsed: z.number(),
    duplicateAttempts: z.number(),
    scanCount: z.number(),
  })
  .openapi("UnitRecord");

export const UnitVerificationResponseSchema = z
  .object({
    status: z.enum([
      "AuthenticInactive",
      "AuthenticActive",
      "AlreadyClaimedWarning",
      "Flagged",
      "Recalled",
      "Retired",
      "Unknown",
    ]),
    authentic: z.boolean(),
    unitId: z.string(),
    brand: z
      .object({
        address: z.string(),
        domain: z.string().nullable(),
        verified: z.boolean(),
      })
      .optional(),
    batch: z
      .object({
        batchId: z.string(),
        merkleRoot: z.string(),
        warrantyMonths: z.number().int(),
        recalled: z.boolean(),
      })
      .optional(),
    unit: z
      .object({
        ownerAnonymized: z.string(),
        status: z.string(),
        activatedAt: z.number(),
        warrantyExpiry: z.number(),
        warrantyValid: z.boolean(),
        claimsUsed: z.number(),
        duplicateAttempts: z.number(),
        ownershipTransfers: z.number(),
      })
      .optional(),
    proof: z.array(z.string()).optional(),
    serialHash: z.string().optional(),
    scanCount: z.number(),
    suspiciousScanVolume: z.boolean().optional(),
    contractId: z.string(),
  })
  .openapi("UnitVerificationResponse");

export const ClaimRecordSchema = z
  .object({
    unitId: z.string(),
    claimId: z.number(),
    serviceCenter: z.string(),
    outcome: z.enum(["Pending", "Approved", "Rejected", "Repaired", "Replaced"]),
    reportHash: z.string(),
    filedAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .openapi("ClaimRecord");

export const TimelineEventSchema = z
  .object({
    id: z.string(),
    unitId: z.string(),
    brand: z.string(),
    batchId: z.string(),
    type: z.string(),
    data: z.record(z.unknown()),
    ledger: z.number(),
    txHash: z.string(),
    finalized: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("TimelineEvent");

export const UnitDetailsResponseSchema = z
  .object({
    unit: UnitRecordSchema.extend({
      warrantyValid: z.boolean(),
      ownerAnonymized: z.string(),
    }),
    claims: z.array(ClaimRecordSchema),
    timeline: z.array(TimelineEventSchema),
  })
  .openapi("UnitDetailsResponse");

export const UnitActivateRequestSchema = z
  .object({
    brand: z.string().min(56),
    batchId: z.string().length(64),
    serial: z.string().min(1),
    secret: z.string().min(1),
    firstOwner: z.string().min(56),
    proof: z.array(z.string().length(64)).optional(),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("UnitActivateRequest");

export const UnitActivateResponseSchema = z
  .object({
    unitId: z.string(),
    owner: z.string(),
    activatedAt: z.number(),
    warrantyExpiry: z.number(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("UnitActivateResponse");

export const TransferOfferRequestSchema = z
  .object({
    unitId: z.string().length(64),
    ttlSeconds: z.number().int().min(60).max(7 * 86_400).default(86_400),
    codeHash: z.string().length(64).optional(),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("TransferOfferRequest");

export const TransferOfferResponseSchema = z
  .object({
    unitId: z.string(),
    transferCode: z.string().nullable().optional(),
    codeHash: z.string(),
    expiresAt: z.number(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("TransferOfferResponse");

export const TransferRedeemRequestSchema = z
  .object({
    unitId: z.string().length(64),
    code: z.string().min(4),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("TransferRedeemRequest");

export const TransferRedeemResponseSchema = z
  .object({
    unitId: z.string(),
    from: z.string(),
    to: z.string(),
    warrantyExpiry: z.number(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("TransferRedeemResponse");

// ---------------------------------------------------------------------------
// Claim Schemas
// ---------------------------------------------------------------------------

export const ClaimFileRequestSchema = z
  .object({
    unitId: z.string().length(64),
    serviceCenter: z.string().min(56),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("ClaimFileRequest");

export const ClaimFileResponseSchema = z
  .object({
    unitId: z.string(),
    claimId: z.number(),
    outcome: z.literal("Pending"),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("ClaimFileResponse");

export const ClaimResolveRequestSchema = z
  .object({
    unitId: z.string().length(64),
    outcome: z.enum(["Approved", "Rejected", "Repaired", "Replaced"]),
    reportHash: z.string().length(64),
    signedTxXdr: z.string().min(16).optional(),
  })
  .openapi("ClaimResolveRequest");

export const ClaimResolveResponseSchema = z
  .object({
    unitId: z.string(),
    claimId: z.number(),
    outcome: z.enum(["Approved", "Rejected", "Repaired", "Replaced"]),
    reportHash: z.string(),
    resolvedAt: z.number(),
    sponsoredTxHash: z.string().optional(),
  })
  .openapi("ClaimResolveResponse");

// ---------------------------------------------------------------------------
// Relayer & Maintenance Schemas
// ---------------------------------------------------------------------------

export const SponsorTxRequestSchema = z
  .object({
    innerTxXdr: z.string().min(16).openapi({ description: "Base64-encoded inner transaction XDR signed by user" }),
    submit: z.boolean().optional().openapi({ description: "Whether backend should immediately submit the sponsored transaction to RPC" }),
  })
  .openapi("SponsorTxRequest");

export const SponsorTxResponseSchema = z
  .object({
    feeBumpTxXdr: z.string(),
    sponsoredTxHash: z.string().optional(),
    submission: z.record(z.unknown()).optional(),
  })
  .openapi("SponsorTxResponse");

export const MaintenanceSweepResponseSchema = z
  .object({
    checked: z.number(),
    extended: z.number(),
    failed: z.number(),
    errors: z.array(z.string()),
  })
  .openapi("MaintenanceSweepResponse");

// ---------------------------------------------------------------------------
// File Storage Schemas
// ---------------------------------------------------------------------------

export const FileUploadRequestSchema = z
  .object({
    contentBase64: z.string().min(1).openapi({ description: "Base64-encoded file content (<= 10MB)" }),
    mime: z.string().min(3).max(128).openapi({ example: "application/pdf" }),
  })
  .openapi("FileUploadRequest");

export const FileMetadataResponseSchema = z
  .object({
    hash: z.string().openapi({ description: "SHA-256 hash of file content" }),
    uploader: z.string(),
    mime: z.string(),
    size: z.number().int(),
    storageKey: z.string(),
    createdAt: z.string(),
  })
  .openapi("FileMetadataResponse");

// ---------------------------------------------------------------------------
// Route Definitions
// ---------------------------------------------------------------------------

// Health
export const getHealthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  description: "Returns service status, network environment, and deployed smart contract addresses.",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

export const getApiHealthRoute = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["Health"],
  summary: "Health check (API alias)",
  description: "Alternative /api/health endpoint returning service status and contract addresses.",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

// Authentication & Passkey Wallets
export const authChallengeRoute = createRoute({
  method: "post",
  path: "/v1/auth/challenge",
  tags: ["Authentication"],
  summary: "Issue authentication challenge",
  description: "Issues a short-lived cryptographic nonce challenge for a Stellar account or Soroban smart account.",
  request: {
    body: { content: { "application/json": { schema: AuthChallengeRequestSchema } } },
  },
  responses: {
    200: {
      description: "Challenge issued successfully",
      content: { "application/json": { schema: AuthChallengeResponseSchema } },
    },
    400: { description: "Invalid account address", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const authVerifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/verify",
  tags: ["Authentication"],
  summary: "Verify challenge and issue JWT",
  description: "Verifies an Ed25519 signature or WebAuthn/Passkey assertion and returns a Bearer JWT.",
  request: {
    body: { content: { "application/json": { schema: AuthVerifyRequestSchema } } },
  },
  responses: {
    200: {
      description: "Authentication successful",
      content: { "application/json": { schema: AuthVerifyResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized / Signature verification failed", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const createPasskeyWalletRoute = createRoute({
  method: "post",
  path: "/v1/wallets/passkey",
  tags: ["Wallets"],
  summary: "Deploy Passkey Smart Account",
  description: "Computes deterministic contract address via AccountFactory, relays deployment, and returns wallet record with JWT.",
  request: {
    body: { content: { "application/json": { schema: PasskeyWalletCreateRequestSchema } } },
  },
  responses: {
    201: {
      description: "Passkey wallet deployed successfully",
      content: { "application/json": { schema: PasskeyWalletCreateResponseSchema } },
    },
    400: { description: "Invalid passkey public key or parameters", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const getPasskeyWalletRoute = createRoute({
  method: "get",
  path: "/v1/wallets/passkey/{credentialId}",
  tags: ["Wallets"],
  summary: "Lookup Passkey Smart Account",
  description: "Looks up deployed passkey smart account by WebAuthn credential ID.",
  request: {
    params: z.object({ credentialId: z.string() }),
  },
  responses: {
    200: {
      description: "Wallet found",
      content: { "application/json": { schema: PasskeyWalletLookupResponseSchema } },
    },
    404: { description: "Wallet not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Brand Registration
export const getBrandMeRoute = createRoute({
  method: "get",
  path: "/v1/brands/me",
  tags: ["Brand Registration"],
  summary: "Get authenticated brand profile",
  description: "Returns the authenticated brand's registration details, stellar.toml verification status, and service centers.",
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Brand profile details",
      content: { "application/json": { schema: BrandProfileResponseSchema } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const registerBrandRoute = createRoute({
  method: "post",
  path: "/v1/brands/register",
  tags: ["Brand Registration"],
  summary: "Register or update brand domain",
  description: "Registers domain metadata for the brand account, optionally sponsoring on-chain registration.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: BrandRegisterRequestSchema } } },
  },
  responses: {
    201: {
      description: "Brand registered successfully",
      content: { "application/json": { schema: BrandRegisterResponseSchema } },
    },
    400: { description: "Invalid parameters", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    429: { description: "Rate limit exceeded", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const verifyBrandDomainRoute = createRoute({
  method: "post",
  path: "/v1/brands/verify-domain",
  tags: ["Brand Registration"],
  summary: "Verify domain via stellar.toml",
  description: "Fetches domain stellar.toml with SSRF protection, verifies account binding, and relays on-chain verification.",
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Domain successfully verified on-chain",
      content: { "application/json": { schema: BrandVerifyDomainResponseSchema } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Brand not registered", content: { "application/json": { schema: ErrorResponseSchema } } },
    422: { description: "stellar.toml verification failed", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const setServiceCenterRoute = createRoute({
  method: "post",
  path: "/v1/brands/service-centers",
  tags: ["Brand Registration"],
  summary: "Authorize or revoke service center",
  description: "Adds or removes an authorized service center for warranty repair and replacement fulfillment.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: ServiceCenterAuthorizeRequestSchema } } },
  },
  responses: {
    200: {
      description: "Service center updated",
      content: { "application/json": { schema: ServiceCenterAuthorizeResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Brand not verified", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Batches
export const listBrandBatchesRoute = createRoute({
  method: "get",
  path: "/v1/brands/batches",
  tags: ["Batches"],
  summary: "List brand batches",
  description: "Lists all production batches committed by the authenticated brand.",
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Batches list",
      content: { "application/json": { schema: z.object({ batches: z.array(BatchRecordSchema) }) } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const createBatchRoute = createRoute({
  method: "post",
  path: "/v1/brands/batches",
  tags: ["Batches"],
  summary: "Create production batch",
  description: "Generates serials and scratch secrets, computes sorted-pair SHA-256 Merkle root, and returns commit parameters.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: BatchCreateRequestSchema } } },
  },
  responses: {
    201: {
      description: "Batch created successfully",
      content: { "application/json": { schema: BatchCreateResponseSchema } },
    },
    400: { description: "Invalid parameters", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Brand not verified", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Batch already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const exportBatchRoute = createRoute({
  method: "get",
  path: "/v1/brands/batches/{id}/export",
  tags: ["Batches"],
  summary: "Export batch label printing data",
  description: "Exports serial numbers, scratch-off secrets, and QR codes for factory label printing. Optional purge permanently deletes secrets.",
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().openapi({ description: "Batch ID hex" }) }),
    query: z.object({
      format: z.enum(["json", "csv"]).default("json").openapi({ description: "Export format" }),
      purge: z.string().optional().openapi({ description: "If 'true', purges encrypted secrets from backend" }),
      qrSvg: z.string().optional().openapi({ description: "Include SVG QR code strings" }),
    }),
  },
  responses: {
    200: {
      description: "Batch export data (JSON or CSV)",
      content: {
        "application/json": { schema: BatchExportResponseSchema },
        "text/csv": { schema: z.string() },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Batch not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    410: { description: "Secrets already purged", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const recallBatchOrUnitRoute = createRoute({
  method: "post",
  path: "/v1/brands/recall",
  tags: ["Batches"],
  summary: "Recall batch or flag unit",
  description: "Brands can recall an entire production batch or flag a compromised individual unit on-chain.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: BrandRecallRequestSchema } } },
  },
  responses: {
    200: {
      description: "Recall or flag recorded",
      content: { "application/json": { schema: BrandRecallResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Not authorized for unit", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Batch or unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Units & Verification
export const verifyProductRoute = createRoute({
  method: "get",
  path: "/v1/verify/{brand}/{batch}/{serial}",
  tags: ["Units"],
  summary: "Public product verification",
  description: "Computes unit_id, logs anonymized scan, and returns aggregated verification state (Authentic, Recalled, Flagged, etc.).",
  request: {
    params: z.object({
      brand: z.string().openapi({ description: "Brand Stellar public key" }),
      batch: z.string().openapi({ description: "64-character batch ID hex" }),
      serial: z.string().openapi({ description: "Unit serial number" }),
    }),
  },
  responses: {
    200: {
      description: "Product authenticity and warranty state",
      content: { "application/json": { schema: UnitVerificationResponseSchema } },
    },
    400: { description: "Invalid address or batch ID", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const getUnitDetailsRoute = createRoute({
  method: "get",
  path: "/v1/units/{unitId}",
  tags: ["Units"],
  summary: "Get unit details and history timeline",
  description: "Returns unit warranty status, filed claims, and ordered lifecycle event timeline.",
  request: {
    params: z.object({
      unitId: z.string().length(64).openapi({ description: "32-byte hex unit ID" }),
    }),
  },
  responses: {
    200: {
      description: "Unit details and history",
      content: { "application/json": { schema: UnitDetailsResponseSchema } },
    },
    404: { description: "Unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const listOwnerUnitsRoute = createRoute({
  method: "get",
  path: "/v1/owners/{owner}/units",
  tags: ["Units"],
  summary: "List units owned by account",
  description: "Lists all registered active and retired units owned by the caller.",
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ owner: z.string().min(56) }),
  },
  responses: {
    200: {
      description: "Owner units list",
      content: { "application/json": { schema: z.object({ units: z.array(UnitRecordSchema) }) } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const activateUnitRoute = createRoute({
  method: "post",
  path: "/v1/activate",
  tags: ["Units"],
  summary: "Activate unit on first sale",
  description: "Validates Merkle proof and scratch-off secret against batch root; activates warranty and records first owner.",
  request: {
    body: { content: { "application/json": { schema: UnitActivateRequestSchema } } },
  },
  responses: {
    201: {
      description: "Unit successfully activated",
      content: { "application/json": { schema: UnitActivateResponseSchema } },
    },
    400: { description: "Invalid proof or payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Batch not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Unit already activated or batch recalled", content: { "application/json": { schema: ErrorResponseSchema } } },
    429: { description: "Rate limit exceeded", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const createTransferOfferRoute = createRoute({
  method: "post",
  path: "/v1/transfer/offer",
  tags: ["Units"],
  summary: "Create resale warranty transfer offer",
  description: "Current owner creates a time-bounded one-time code to transfer ownership and remaining warranty.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: TransferOfferRequestSchema } } },
  },
  responses: {
    200: {
      description: "Transfer offer created",
      content: { "application/json": { schema: TransferOfferResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Not unit owner", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Unit or batch not eligible for transfer", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const redeemTransferOfferRoute = createRoute({
  method: "post",
  path: "/v1/transfer/redeem",
  tags: ["Units"],
  summary: "Redeem transfer offer",
  description: "New owner redeems one-time code to assume unit ownership and preserve remaining warranty.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: TransferRedeemRequestSchema } } },
  },
  responses: {
    200: {
      description: "Ownership transferred successfully",
      content: { "application/json": { schema: TransferRedeemResponseSchema } },
    },
    400: { description: "Invalid code or payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Offer or unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    410: { description: "Transfer offer expired", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Claims
export const listServiceCenterClaimsRoute = createRoute({
  method: "get",
  path: "/v1/service-centers/{address}/claims",
  tags: ["Claims"],
  summary: "List service center claims",
  description: "Lists all warranty claims assigned to the authorized service center.",
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ address: z.string().min(56) }),
  },
  responses: {
    200: {
      description: "Assigned claims list",
      content: { "application/json": { schema: z.object({ claims: z.array(ClaimRecordSchema) }) } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const fileClaimRoute = createRoute({
  method: "post",
  path: "/v1/claims",
  tags: ["Claims"],
  summary: "File warranty claim",
  description: "Unit owner files a claim with an authorized service center if warranty is valid and limits permit.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: ClaimFileRequestSchema } } },
  },
  responses: {
    201: {
      description: "Claim filed successfully",
      content: { "application/json": { schema: ClaimFileResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Not owner or service center not authorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Warranty expired or claim limit reached", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const resolveClaimRoute = createRoute({
  method: "post",
  path: "/v1/claims/{id}/resolve",
  tags: ["Claims"],
  summary: "Resolve warranty claim",
  description: "Authorized service center resolves claim (Approved, Rejected, Repaired, Replaced) with service report hash.",
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().openapi({ description: "Claim ID integer" }) }),
    body: { content: { "application/json": { schema: ClaimResolveRequestSchema } } },
  },
  responses: {
    200: {
      description: "Claim resolved",
      content: { "application/json": { schema: ClaimResolveResponseSchema } },
    },
    400: { description: "Invalid resolution payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Not authorized service center", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Claim or unit not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Claim already resolved", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Files
export const uploadFileRoute = createRoute({
  method: "post",
  path: "/v1/files",
  tags: ["Files"],
  summary: "Upload receipt or service report",
  description: "Stores file in content-addressed storage (<= 10MB) and returns SHA-256 hash for on-chain anchoring.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: FileUploadRequestSchema } } },
  },
  responses: {
    201: {
      description: "File uploaded successfully",
      content: { "application/json": { schema: FileMetadataResponseSchema } },
    },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    413: { description: "File size exceeds 10MB limit", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const downloadFileRoute = createRoute({
  method: "get",
  path: "/v1/files/{hash}",
  tags: ["Files"],
  summary: "Download content-addressed file",
  description: "Retrieves uploaded file content by its SHA-256 hash with nosniff security headers.",
  request: {
    params: z.object({ hash: z.string().length(64) }),
  },
  responses: {
    200: {
      description: "File content binary",
      content: { "application/octet-stream": { schema: z.string() } },
    },
    400: { description: "Invalid hash", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "File not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Relayer
export const sponsorTxRoute = createRoute({
  method: "post",
  path: "/v1/sponsor",
  tags: ["Relayer"],
  summary: "Sponsor transaction with Fee-Bump",
  description: "Wraps a user-signed Soroban transaction into a sponsored FeeBumpTransaction, optionally submitting to RPC.",
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: SponsorTxRequestSchema } } },
  },
  responses: {
    200: {
      description: "Transaction sponsored successfully",
      content: { "application/json": { schema: SponsorTxResponseSchema } },
    },
    400: { description: "Invalid XDR", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    429: { description: "Sponsorship quota or rate limit exceeded", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

export const maintenanceTtlSweepRoute = createRoute({
  method: "post",
  path: "/v1/maintenance/ttl-sweep",
  tags: ["Relayer"],
  summary: "Run TTL maintenance sweep",
  description: "On-demand extension sweep across active batches and units approaching archival threshold.",
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Sweep report",
      content: { "application/json": { schema: MaintenanceSweepResponseSchema } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// ---------------------------------------------------------------------------
// OpenAPI App & Spec Generator
// ---------------------------------------------------------------------------

export function createOpenApiApp(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT token obtained via /v1/auth/verify or /v1/wallets/passkey",
  });

  // Dummy handlers for schema extraction
  const noop = (c: any) => c.json({});

  app.openapi(getHealthRoute, noop);
  app.openapi(getApiHealthRoute, noop);
  app.openapi(authChallengeRoute, noop);
  app.openapi(authVerifyRoute, noop);
  app.openapi(createPasskeyWalletRoute, noop);
  app.openapi(getPasskeyWalletRoute, noop);
  app.openapi(getBrandMeRoute, noop);
  app.openapi(registerBrandRoute, noop);
  app.openapi(verifyBrandDomainRoute, noop);
  app.openapi(setServiceCenterRoute, noop);
  app.openapi(listBrandBatchesRoute, noop);
  app.openapi(createBatchRoute, noop);
  app.openapi(exportBatchRoute, noop);
  app.openapi(recallBatchOrUnitRoute, noop);
  app.openapi(verifyProductRoute, noop);
  app.openapi(getUnitDetailsRoute, noop);
  app.openapi(listOwnerUnitsRoute, noop);
  app.openapi(activateUnitRoute, noop);
  app.openapi(createTransferOfferRoute, noop);
  app.openapi(redeemTransferOfferRoute, noop);
  app.openapi(listServiceCenterClaimsRoute, noop);
  app.openapi(fileClaimRoute, noop);
  app.openapi(resolveClaimRoute, noop);
  app.openapi(uploadFileRoute, noop);
  app.openapi(downloadFileRoute, noop);
  app.openapi(sponsorTxRoute, noop);
  app.openapi(maintenanceTtlSweepRoute, noop);

  return app;
}

export function getOpenApiSpec() {
  const app = createOpenApiApp();
  return app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: "Veritag Backend REST API",
      version: "0.1.0",
      description:
        "On-chain product authenticity verification, digital warranty registry, and fee sponsorship on Stellar Soroban.",
    },
    servers: [
      {
        url: "/",
        description: "Default server",
      },
    ],
    tags: [
      { name: "Health", description: "Backend status and contract bindings" },
      { name: "Authentication", description: "SEP-10 and Passkey challenge-response auth" },
      { name: "Wallets", description: "Soroban Passkey Smart Account factory & lookups" },
      { name: "Brand Registration", description: "Domain registration and stellar.toml verification" },
      { name: "Batches", description: "Production batch Merkle commits and label exports" },
      { name: "Units", description: "Authenticity verification, activation, and resale transfer" },
      { name: "Claims", description: "Warranty claims filing and service center resolution" },
      { name: "Relayer", description: "Stellar Fee-Bump transaction sponsorship & TTL sweeps" },
      { name: "Files", description: "Content-addressed receipts and service reports" },
    ],
  });
}

