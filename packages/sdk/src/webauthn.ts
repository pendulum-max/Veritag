import { Buffer } from "buffer";
import { sha256 } from "./merkle.js";

export const P256_CURVE_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const P256_HALF_ORDER = P256_CURVE_ORDER >> 1n;

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function bigIntToBytes32(value: bigint): Buffer {
  if (value <= 0n || value >= P256_CURVE_ORDER) {
    throw new Error("ECDSA scalar out of P-256 curve order range");
  }
  const hex = value.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

/**
 * Extracts a 65-byte uncompressed SEC1 P-256 public key (0x04 || X || Y)
 * from a WebAuthn SPKI DER buffer, COSE_Key CBOR buffer, 64-byte raw XY, or 65-byte SEC1 key.
 */
export function extractP256UncompressedPublicKey(input: Uint8Array): Buffer {
  const buf = Buffer.from(input);

  // 1. Already 65-byte uncompressed SEC1 key (0x04 || X || Y)
  if (buf.length === 65 && buf[0] === 0x04) {
    return Buffer.from(buf);
  }

  // 2. Raw 64-byte X || Y coordinates
  if (buf.length === 64) {
    return Buffer.concat([Buffer.from([0x04]), buf]);
  }

  // 3. SubjectPublicKeyInfo (SPKI) DER: ends with BIT STRING header 0x03 0x42 0x00 0x04 <64-bytes>
  if (buf.length >= 68) {
    const tailOffset = buf.length - 65;
    if (
      buf[tailOffset] === 0x04 &&
      buf[tailOffset - 1] === 0x00 &&
      buf[tailOffset - 2] === 0x42 &&
      buf[tailOffset - 3] === 0x03
    ) {
      return Buffer.from(buf.subarray(tailOffset, tailOffset + 65));
    }
  }

  // 4. COSE_Key CBOR map containing -2 (0x21, 0x58, 0x20, <32B X>) and -3 (0x22, 0x58, 0x20, <32B Y>)
  let xCoord: Buffer | null = null;
  let yCoord: Buffer | null = null;
  for (let i = 0; i <= buf.length - 35; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0x58 && buf[i + 2] === 0x20 && !xCoord) {
      xCoord = Buffer.from(buf.subarray(i + 3, i + 35));
    }
    if (buf[i] === 0x22 && buf[i + 1] === 0x58 && buf[i + 2] === 0x20 && !yCoord) {
      yCoord = Buffer.from(buf.subarray(i + 3, i + 35));
    }
  }
  if (xCoord && yCoord) {
    return Buffer.concat([Buffer.from([0x04]), xCoord, yCoord]);
  }

  throw new Error(
    `Unable to extract 65-byte uncompressed P-256 public key (received ${buf.length} bytes)`
  );
}

/**
 * Converts an ASN.1 DER-encoded ECDSA signature (or 64-byte raw r||s) into a
 * 64-byte compact P-256 signature with low-S normalization required by Soroban secp256r1_verify.
 */
export function derSignatureToCompactLowS(sigInput: Uint8Array): Buffer {
  const buf = Buffer.from(sigInput);
  let r: bigint;
  let s: bigint;

  if (buf.length === 64 && buf[0] !== 0x30) {
    r = bytesToBigInt(buf.subarray(0, 32));
    s = bytesToBigInt(buf.subarray(32, 64));
  } else {
    if (buf.length < 8 || buf[0] !== 0x30) {
      throw new Error("Invalid ASN.1 DER ECDSA signature header");
    }
    let offset = 1;
    let seqLen = buf[offset++] ?? 0;
    if (seqLen & 0x80) {
      const lenBytes = seqLen & 0x7f;
      if (lenBytes !== 1 || offset >= buf.length) {
        throw new Error("Invalid ASN.1 DER sequence length");
      }
      seqLen = buf[offset++] ?? 0;
    }
    if (offset + seqLen > buf.length) {
      throw new Error("ASN.1 DER signature truncated");
    }
    if (buf[offset++] !== 0x02) {
      throw new Error("Expected ASN.1 INTEGER tag for r");
    }
    const rLen = buf[offset++] ?? 0;
    const rSlice = buf.subarray(offset, offset + rLen);
    offset += rLen;

    if (buf[offset++] !== 0x02) {
      throw new Error("Expected ASN.1 INTEGER tag for s");
    }
    const sLen = buf[offset++] ?? 0;
    const sSlice = buf.subarray(offset, offset + sLen);

    r = bytesToBigInt(rSlice);
    s = bytesToBigInt(sSlice);
  }

  if (s > P256_HALF_ORDER) {
    s = P256_CURVE_ORDER - s;
  }

  return Buffer.concat([bigIntToBytes32(r), bigIntToBytes32(s)]);
}

/**
 * Derives a deterministic 32-byte salt from a WebAuthn credential ID for AccountFactoryContract.
 */
export function derivePasskeySalt(credentialId: Uint8Array | string): Buffer {
  const idBytes =
    typeof credentialId === "string" ? Buffer.from(credentialId, "utf8") : Buffer.from(credentialId);
  return sha256(Buffer.concat([Buffer.from("VERITAG_PASSKEY_SALT_V1:", "utf8"), idBytes]));
}
