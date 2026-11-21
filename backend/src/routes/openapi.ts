/**
 * openapi.ts
 * ----------
 * Hand-authored OpenAPI 3.0 specification for the Veritag Backend REST API,
 * served at:
 *   GET /api/openapi.json   — raw OpenAPI JSON
 *   GET /docs               — Swagger UI (served via swagger-ui-dist)
 *
 * The spec is defined inline as a plain OpenAPIObject literal so there is
 * no build-time code generation step and no extra CLI dependency.  It is
 * kept in sync with the route implementations in api.ts.
 *
 * To add a new endpoint:
 *   1. Add a path + operation block to `openapiSpec.paths` below.
 *   2. Add any new reusable schemas to `openapiSpec.components.schemas`.
 *   3. Update docs/api.md to match.
 */

import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// OpenAPI 3.0 specification
// ---------------------------------------------------------------------------

const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Veritag Backend API",
    version: "1.0.0",
    description:
      "REST API for the Veritag on-chain product authenticity and warranty registry " +
      "built on Stellar Soroban.  Authenticated endpoints require a Bearer JWT obtained " +
      "via the `/v1/auth/challenge` + `/v1/auth/verify` flow.",
    license: { name: "MIT" },
    contact: {
      name: "Veritag Open Source",
      url: "https://github.com/pendulum-max/Veritag",
    },
  },
  servers: [
    { url: "/", description: "This server" },
  ],
  tags: [
    { name: "Brand Registration",    description: "Brand onboarding and stellar.toml domain verification" },
    { name: "Batches",               description: "Production batch management, Merkle tree generation and printing export" },
    { name: "Units",                 description: "Public unit verification and history timeline" },
    { name: "Claims",                description: "Warranty claim filing and resolution" },
    { name: "Relayer",               description: "Fee-bump transaction sponsorship and TTL maintenance" },
    { name: "Auth",                  description: "SEP-10 Ed25519 and Passkey (secp256r1) authentication" },
    { name: "Passkey Wallets",       description: "Smart wallet factory and credential lookup" },
    { name: "Files",                 description: "Content-addressed document upload and download" },
  ],

  // -------------------------------------------------------------------------
  // Reusable schemas
  // -------------------------------------------------------------------------
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "HS256 JWT obtained from POST /v1/auth/verify",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error:   { type: "string", example: "BrandNotFound" },
          details: { type: "object", description: "Zod validation details when present" },
        },
      },
      Brand: {
        type: "object",
        properties: {
          address:   { type: "string", example: "GCFG...ZELXR" },
          admin:     { type: "string", example: "GCFG...ZELXR" },
          domain:    { type: "string", example: "example.com" },
          verified:  { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Batch: {
        type: "object",
        properties: {
          batchId:         { type: "string", minLength: 64, maxLength: 64, description: "32-byte hex batch ID" },
          brand:           { type: "string" },
          merkleRoot:      { type: "string", minLength: 64, maxLength: 64 },
          warrantyMonths:  { type: "integer", minimum: 0 },
          unitCount:       { type: "integer", minimum: 1 },
          recalled:        { type: "boolean" },
          createdAt:       { type: "string", format: "date-time" },
        },
      },
      Unit: {
        type: "object",
        properties: {
          unitId:            { type: "string", minLength: 64, maxLength: 64 },
          brand:             { type: "string" },
          batchId:           { type: "string" },
          ownerAnonymized:   { type: "string", example: "GCFG...ELXR" },
          status:            { type: "string", enum: ["Active", "Flagged", "Recalled", "Retired"] },
          activatedAt:       { type: "integer", description: "Unix timestamp" },
          warrantyExpiry:    { type: "integer", description: "Unix timestamp" },
          warrantyValid:     { type: "boolean" },
          claimsUsed:        { type: "integer" },
          duplicateAttempts: { type: "integer" },
        },
      },
      VerifyResult: {
        type: "object",
        required: ["status", "authentic", "unitId"],
        properties: {
          status: {
            type: "string",
            enum: [
              "AuthenticInactive", "AuthenticActive", "AlreadyClaimedWarning",
              "Flagged", "Recalled", "Retired", "Unknown",
            ],
          },
          authentic:            { type: "boolean" },
          unitId:               { type: "string" },
          scanCount:            { type: "integer" },
          suspiciousScanVolume: { type: "boolean" },
          contractId:           { type: "string" },
          brand: {
            type: "object",
            properties: {
              address:  { type: "string" },
              domain:   { type: "string", nullable: true },
              verified: { type: "boolean" },
            },
          },
          batch: {
            type: "object",
            properties: {
              batchId:        { type: "string" },
              merkleRoot:     { type: "string" },
              warrantyMonths: { type: "integer" },
              recalled:       { type: "boolean" },
            },
          },
          unit: { $ref: "#/components/schemas/Unit" },
        },
      },
      Claim: {
        type: "object",
        properties: {
          id:            { type: "integer" },
          unitId:        { type: "string" },
          serviceCenter: { type: "string" },
          filedAt:       { type: "integer" },
          resolvedAt:    { type: "integer", nullable: true },
          outcome: {
            type: "string",
            enum: ["Pending", "Approved", "Rejected", "Repaired", "Replaced"],
          },
          reportHash: { type: "string", nullable: true },
        },
      },
      JwtToken: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string", description: "HS256 Bearer JWT" },
        },
      },
      PasskeyWallet: {
        type: "object",
        properties: {
          credentialId:    { type: "string" },
          walletAddress:   { type: "string", description: "Soroban contract address (C...)" },
          publicKeyHex:    { type: "string", description: "65-byte uncompressed SEC1 P-256 key (hex)" },
          saltHex:         { type: "string" },
          recoveryAddress: { type: "string", nullable: true },
          deployed:        { type: "boolean" },
          createdAt:       { type: "string", format: "date-time" },
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Paths
  // -------------------------------------------------------------------------
  paths: {
    // ------------------------------------------------------------------
    // Authentication
    // ------------------------------------------------------------------
    "/v1/auth/challenge": {
      post: {
        tags: ["Auth"],
        summary: "Issue an authentication challenge",
        description:
          "Issues a short-lived nonce for a Stellar G… Ed25519 account or Soroban C… Passkey Smart Account.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["account"],
                properties: {
                  account: { type: "string", minLength: 56, example: "GCFG...ZELXR" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Challenge nonce",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    nonce:     { type: "string" },
                    message:   { type: "string" },
                    expiresAt: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid account", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },

    "/v1/auth/verify": {
      post: {
        tags: ["Auth"],
        summary: "Verify signature and return JWT",
        description:
          "Verifies an Ed25519 signature (G… account) or P-256 WebAuthn assertion (C… account) and returns a Bearer JWT.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nonce", "signature"],
                properties: {
                  nonce:     { type: "string" },
                  signature: { type: "string" },
                  passkeyAssertion: {
                    type: "object",
                    properties: {
                      publicKeyHex:         { type: "string" },
                      authenticatorDataHex: { type: "string" },
                      clientDataJsonBase64: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "JWT token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/JwtToken" } } },
          },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Passkey Wallets
    // ------------------------------------------------------------------
    "/v1/wallets/passkey": {
      post: {
        tags: ["Passkey Wallets"],
        summary: "Create a Passkey Smart Account",
        description:
          "Validates the P-256 public key, computes the deterministic contract address, deploys it via AccountFactory, and returns a JWT.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["credentialId", "publicKeyHex"],
                properties: {
                  credentialId:    { type: "string", maxLength: 512 },
                  publicKeyHex:    { type: "string", minLength: 128, maxLength: 256 },
                  recoveryAddress: { type: "string", minLength: 56 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Wallet deployed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    wallet:       { $ref: "#/components/schemas/PasskeyWallet" },
                    deployTxHash: { type: "string" },
                    token:        { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid payload", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },

    "/v1/wallets/passkey/{credentialId}": {
      get: {
        tags: ["Passkey Wallets"],
        summary: "Look up a Passkey Smart Account by credential ID",
        parameters: [
          { name: "credentialId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Wallet record and JWT",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    wallet: { $ref: "#/components/schemas/PasskeyWallet" },
                    token:  { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Brand Registration
    // ------------------------------------------------------------------
    "/v1/brands/me": {
      get: {
        tags: ["Brand Registration"],
        summary: "Get the authenticated brand's profile",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Brand profile, service centers, and batch count",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    brand:          { $ref: "#/components/schemas/Brand" },
                    serviceCenters: { type: "array", items: { type: "object" } },
                    batchCount:     { type: "integer" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/v1/brands/register": {
      post: {
        tags: ["Brand Registration"],
        summary: "Register or update a brand",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["domain"],
                properties: {
                  domain:       { type: "string", minLength: 3, maxLength: 253, example: "example.com" },
                  verified:     { type: "boolean" },
                  signedTxXdr:  { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Brand registered",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Brand" } } },
          },
          "400": { description: "Invalid payload" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/v1/brands/verify-domain": {
      post: {
        tags: ["Brand Registration"],
        summary: "Verify brand domain via stellar.toml",
        description:
          "Fetches `https://<domain>/.well-known/stellar.toml`, confirms the brand address appears in SIGNING_KEY or ACCOUNTS, marks the brand verified, and relays `verify_brand` on-chain.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Domain verified",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    verified:     { type: "boolean" },
                    domain:       { type: "string" },
                    matchedField: { type: "string" },
                    txHash:       { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "404": { description: "BrandNotFound" },
          "422": { description: "DomainVerificationFailed" },
        },
      },
    },

    "/v1/brands/service-centers": {
      post: {
        tags: ["Brand Registration"],
        summary: "Authorize or revoke a service center",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["serviceCenter"],
                properties: {
                  serviceCenter: { type: "string", minLength: 56 },
                  authorized:    { type: "boolean", default: true },
                  signedTxXdr:   { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Service center updated" },
          "401": { description: "Unauthorized" },
          "403": { description: "BrandNotVerified" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Batches
    // ------------------------------------------------------------------
    "/v1/brands/batches": {
      get: {
        tags: ["Batches"],
        summary: "List all batches for the authenticated brand",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "List of batches",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { batches: { type: "array", items: { $ref: "#/components/schemas/Batch" } } },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["Batches"],
        summary: "Create a production batch",
        description:
          "Generates serials and 128-bit scratch-off secrets, builds the Merkle tree, " +
          "stores AES-256-GCM encrypted secrets for printing, and returns the ready-to-sign " +
          "`commit_batch` contract call parameters.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["batchCode", "warrantyMonths", "productMeta"],
                properties: {
                  batchCode:      { type: "string", minLength: 2, maxLength: 128 },
                  warrantyMonths: { type: "integer", minimum: 0, maximum: 240 },
                  productMeta:    {
                    oneOf: [
                      { type: "string", minLength: 1 },
                      { type: "object" },
                    ],
                  },
                  count:        { type: "integer", minimum: 1, maximum: 50000 },
                  serials:      { type: "array", items: { type: "string" }, maxItems: 50000 },
                  signedTxXdr:  { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Batch created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    batch:        { $ref: "#/components/schemas/Batch" },
                    contractCall: { type: "object", description: "Ready-to-sign commit_batch parameters" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid parameters" },
          "401": { description: "Unauthorized" },
          "403": { description: "BrandNotVerified" },
          "409": { description: "BatchExists" },
        },
      },
    },

    "/v1/brands/batches/{id}/export": {
      get: {
        tags: ["Batches"],
        summary: "Export batch unit data for factory printing",
        description:
          "Returns `(unit_id, serial, scratch_secret, qr_url, qr_svg)` for every unit.  " +
          "Use `purge=true` to permanently delete secrets after export (HTTP 410 on subsequent calls).",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id",     in: "path",  required: true,  schema: { type: "string" } },
          { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv"], default: "json" } },
          { name: "purge",  in: "query", required: false, schema: { type: "boolean", default: false } },
          { name: "qrSvg",  in: "query", required: false, schema: { type: "boolean", default: true } },
        ],
        responses: {
          "200": { description: "Export data (JSON or CSV)" },
          "401": { description: "Unauthorized" },
          "404": { description: "BatchNotFound" },
          "410": { description: "SecretsAlreadyPurged" },
        },
      },
    },

    "/v1/brands/recall": {
      post: {
        tags: ["Batches"],
        summary: "Recall a batch or flag a unit",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["mode", "batchId", "reason"],
                    properties: {
                      mode:    { type: "string", enum: ["batch"] },
                      batchId: { type: "string", minLength: 64, maxLength: 64 },
                      reason:  { type: "string" },
                    },
                  },
                  {
                    type: "object",
                    required: ["mode", "unitId", "reason"],
                    properties: {
                      mode:   { type: "string", enum: ["unit"] },
                      unitId: { type: "string", minLength: 64, maxLength: 64 },
                      reason: { type: "string" },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": { description: "Recalled / flagged" },
          "401": { description: "Unauthorized" },
          "403": { description: "NotAuthorized" },
          "404": { description: "BatchNotFound or UnitNotFound" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Units
    // ------------------------------------------------------------------
    "/v1/verify/{brand}/{batch}/{serial}": {
      get: {
        tags: ["Units"],
        summary: "Public QR-code verification",
        description:
          "Logs an anonymized scan and returns the aggregated authenticity and warranty status.",
        parameters: [
          { name: "brand",  in: "path", required: true, schema: { type: "string" }, description: "Brand Stellar address" },
          { name: "batch",  in: "path", required: true, schema: { type: "string" }, description: "64-char hex batch ID" },
          { name: "serial", in: "path", required: true, schema: { type: "string" }, description: "Human-readable serial number" },
        ],
        responses: {
          "200": {
            description: "Verification result",
            content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyResult" } } },
          },
          "400": { description: "Invalid batch ID or brand address" },
        },
      },
    },

    "/v1/units/{unitId}": {
      get: {
        tags: ["Units"],
        summary: "Get unit state and event timeline",
        parameters: [
          { name: "unitId", in: "path", required: true, schema: { type: "string", minLength: 64, maxLength: 64 } },
        ],
        responses: {
          "200": {
            description: "Unit details, claims, and ordered event timeline",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    unit:     { $ref: "#/components/schemas/Unit" },
                    claims:   { type: "array", items: { $ref: "#/components/schemas/Claim" } },
                    timeline: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "404": { description: "UnitNotFound" },
        },
      },
    },

    "/v1/activate": {
      post: {
        tags: ["Units"],
        summary: "Activate a unit (first sale / first scan)",
        description:
          "Verifies the Merkle proof and scratch-off secret.  Creates the unit record or increments `duplicate_attempts`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["brand", "batchId", "serial", "secret", "firstOwner"],
                properties: {
                  brand:       { type: "string", minLength: 56 },
                  batchId:     { type: "string", minLength: 64, maxLength: 64 },
                  serial:      { type: "string", minLength: 1 },
                  secret:      { type: "string", minLength: 1 },
                  firstOwner:  { type: "string", minLength: 56 },
                  proof:       { type: "array", items: { type: "string", minLength: 64, maxLength: 64 } },
                  signedTxXdr: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Unit activated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    unitId:         { type: "string" },
                    owner:          { type: "string" },
                    activatedAt:    { type: "integer" },
                    warrantyExpiry: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "InvalidProof or invalid payload" },
          "404": { description: "BatchNotFound" },
          "409": { description: "UnitAlreadyActivated or BatchRecalled" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Transfer
    // ------------------------------------------------------------------
    "/v1/transfer/offer": {
      post: {
        tags: ["Units"],
        summary: "Create a resale transfer offer",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["unitId"],
                properties: {
                  unitId:      { type: "string", minLength: 64, maxLength: 64 },
                  ttlSeconds:  { type: "integer", minimum: 60, maximum: 604800, default: 86400 },
                  codeHash:    { type: "string", minLength: 64, maxLength: 64 },
                  signedTxXdr: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Transfer offer created" },
          "401": { description: "Unauthorized" },
          "403": { description: "NotUnitOwner" },
          "404": { description: "UnitNotFound" },
        },
      },
    },

    "/v1/transfer/redeem": {
      post: {
        tags: ["Units"],
        summary: "Redeem a transfer code",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["unitId", "code"],
                properties: {
                  unitId:      { type: "string", minLength: 64, maxLength: 64 },
                  code:        { type: "string", minLength: 8 },
                  signedTxXdr: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Transfer redeemed — ownership transferred" },
          "400": { description: "InvalidTransferCode or offer expired" },
          "401": { description: "Unauthorized" },
          "404": { description: "UnitNotFound or no active offer" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------
    "/v1/claims": {
      post: {
        tags: ["Claims"],
        summary: "File a warranty claim",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["unitId", "serviceCenter"],
                properties: {
                  unitId:        { type: "string", minLength: 64, maxLength: 64 },
                  serviceCenter: { type: "string", minLength: 56 },
                  signedTxXdr:   { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Claim filed", content: { "application/json": { schema: { $ref: "#/components/schemas/Claim" } } } },
          "400": { description: "Invalid payload or WarrantyExpired" },
          "401": { description: "Unauthorized" },
          "403": { description: "NotUnitOwner" },
          "404": { description: "UnitNotFound" },
          "409": { description: "ClaimLimitReached" },
        },
      },
    },

    "/v1/claims/{id}/resolve": {
      post: {
        tags: ["Claims"],
        summary: "Resolve a warranty claim",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["unitId", "outcome"],
                properties: {
                  unitId:      { type: "string", minLength: 64, maxLength: 64 },
                  outcome: {
                    type: "string",
                    enum: ["Approved", "Rejected", "Repaired", "Replaced"],
                  },
                  reportHash:  { type: "string", minLength: 64, maxLength: 64 },
                  signedTxXdr: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Claim resolved" },
          "401": { description: "Unauthorized" },
          "403": { description: "ServiceCenterNotAuthorized" },
          "404": { description: "ClaimNotFound" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Files
    // ------------------------------------------------------------------
    "/v1/files": {
      post: {
        tags: ["Files"],
        summary: "Upload a document (receipt, service report)",
        description: "Accepts any file up to 10 MB. Returns the SHA-256 content-addressed hash.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: {
          "201": {
            description: "File stored",
            content: { "application/json": { schema: { type: "object", properties: { hash: { type: "string" }, size: { type: "integer" } } } } },
          },
          "400": { description: "File too large or invalid content type" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/v1/files/{hash}": {
      get: {
        tags: ["Files"],
        summary: "Download a content-addressed document",
        parameters: [
          { name: "hash", in: "path", required: true, schema: { type: "string", minLength: 64, maxLength: 64 } },
        ],
        responses: {
          "200": { description: "File contents" },
          "404": { description: "FileNotFound" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Relayer
    // ------------------------------------------------------------------
    "/v1/sponsor": {
      post: {
        tags: ["Relayer"],
        summary: "Wrap a Soroban transaction in a fee-bump",
        description:
          "Signs the inner transaction as the fee-bump sponsor and optionally submits it to the Soroban RPC.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["innerTxXdr"],
                properties: {
                  innerTxXdr: { type: "string", description: "Base64-encoded signed inner transaction XDR" },
                  submit:     { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Fee-bump transaction",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    feeBumpTxXdr: { type: "string" },
                    txHash:       { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid XDR" },
          "401": { description: "Unauthorized" },
          "429": { description: "SponsorQuotaExceeded" },
        },
      },
    },

    "/v1/maintenance/ttl-sweep": {
      post: {
        tags: ["Relayer"],
        summary: "Run an on-demand TTL extension sweep",
        description: "Extends TTL for active batches and units approaching expiry.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Sweep results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    extended: { type: "integer" },
                    skipped:  { type: "integer" },
                    errors:   { type: "integer" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },

    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------
    "/health": {
      get: {
        tags: [],
        summary: "Health check",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status:     { type: "string", example: "ok" },
                    service:    { type: "string" },
                    network:    { type: "string" },
                    contractId: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Swagger UI HTML (uses swagger-ui-dist CDN — no extra npm dep required)
// ---------------------------------------------------------------------------
function swaggerUiHtml(openapiJsonUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Veritag API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "${openapiJsonUrl}",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Registers the OpenAPI JSON and Swagger UI endpoints on `app`.
 *
 * - `GET /api/openapi.json` — machine-readable spec
 * - `GET /docs`             — interactive Swagger UI
 */
export function registerOpenApiRoutes(app: Hono): void {
  // Serve the raw OpenAPI spec
  app.get("/api/openapi.json", (c) => {
    return c.json(openapiSpec);
  });

  // Serve the Swagger UI
  app.get("/docs", (c) => {
    // Build an absolute URL for the spec so the UI can fetch it
    const baseUrl = new URL(c.req.url);
    const specUrl = `${baseUrl.origin}/api/openapi.json`;
    return c.html(swaggerUiHtml(specUrl));
  });
}
