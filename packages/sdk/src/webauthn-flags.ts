import { Buffer } from "buffer";

/**
 * W3C WebAuthn Level 3 §6.1 Authenticator Data bitmask constants (byte 32).
 */
export const WEBAUTHN_FLAG_UP = 0x01; // Bit 0: User Present (UP)
export const WEBAUTHN_FLAG_UV = 0x04; // Bit 2: User Verified (UV)
export const WEBAUTHN_FLAG_BE = 0x08; // Bit 3: Backup Eligibility (BE)
export const WEBAUTHN_FLAG_BS = 0x10; // Bit 4: Backup State (BS)
export const WEBAUTHN_FLAG_AT = 0x40; // Bit 6: Attested Credential Data Included (AT)
export const WEBAUTHN_FLAG_ED = 0x80; // Bit 7: Extension Data Included (ED)

/** Minimum valid WebAuthn authenticatorData length: 32B rpIdHash + 1B flags + 4B signCount */
export const MIN_AUTHENTICATOR_DATA_BYTES = 37;

export interface AuthenticatorFlags {
  /** Raw 32-byte SHA-256 hash of the Relying Party ID */
  rpIdHash: Buffer;
  /** Hex-encoded 32-byte rpIdHash */
  rpIdHashHex: string;
  /** Raw flags byte at index 32 */
  rawFlags: number;
  /** Bit 0 (0x01): User Present (UP) */
  userPresent: boolean;
  /** Bit 2 (0x04): User Verified (UV) */
  userVerified: boolean;
  /** Bit 3 (0x08): Backup Eligibility (BE) - multi-device / cloud-sync eligible */
  backupEligible: boolean;
  /** Bit 4 (0x10): Backup State (BS) - credential is currently backed up / synced */
  backupState: boolean;
  /** Bit 6 (0x40): Attested Credential Data Included (AT) */
  attestedCredentialData: boolean;
  /** Bit 7 (0x80): Extension Data Included (ED) */
  extensionDataIncluded: boolean;
  /** 32-bit unsigned big-endian signature counter (bytes 33..36) */
  signCount: number;
}

/**
 * Parses a WebAuthn `authenticatorData` byte buffer (minimum 37 bytes) according to
 * W3C WebAuthn Level 3 §6.1, extracting `rpIdHash`, bitmask flags (`UP`, `UV`, `BE`, `BS`, `AT`, `ED`),
 * and the 32-bit big-endian `signCount`.
 */
export function parseAuthenticatorDataFlags(authData: Uint8Array): AuthenticatorFlags {
  if (!(authData instanceof Uint8Array)) {
    throw new TypeError("Expected authData to be a Uint8Array");
  }
  if (authData.byteLength < MIN_AUTHENTICATOR_DATA_BYTES) {
    throw new RangeError(
      `Invalid authenticatorData length: expected at least ${MIN_AUTHENTICATOR_DATA_BYTES} bytes, received ${authData.byteLength}`
    );
  }

  const buf = Buffer.from(authData.buffer, authData.byteOffset, authData.byteLength);
  const rpIdHash = Buffer.from(buf.subarray(0, 32));
  const rawFlags = buf[32] ?? 0;
  const signCount = buf.readUInt32BE(33);

  const userPresent = (rawFlags & WEBAUTHN_FLAG_UP) !== 0;
  const userVerified = (rawFlags & WEBAUTHN_FLAG_UV) !== 0;
  const backupEligible = (rawFlags & WEBAUTHN_FLAG_BE) !== 0;
  const backupState = (rawFlags & WEBAUTHN_FLAG_BS) !== 0;
  const attestedCredentialData = (rawFlags & WEBAUTHN_FLAG_AT) !== 0;
  const extensionDataIncluded = (rawFlags & WEBAUTHN_FLAG_ED) !== 0;

  // Per W3C WebAuthn Level 3 §6.1: BS MUST NOT be set if BE is not set.
  if (backupState && !backupEligible) {
    throw new Error(
      "Invalid WebAuthn authenticatorData flags: Backup State (BS) cannot be set when Backup Eligibility (BE) is false"
    );
  }

  return {
    rpIdHash,
    rpIdHashHex: rpIdHash.toString("hex"),
    rawFlags,
    userPresent,
    userVerified,
    backupEligible,
    backupState,
    attestedCredentialData,
    extensionDataIncluded,
    signCount,
  };
}
