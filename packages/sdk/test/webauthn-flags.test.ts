import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import {
  MIN_AUTHENTICATOR_DATA_BYTES,
  WEBAUTHN_FLAG_AT,
  WEBAUTHN_FLAG_BE,
  WEBAUTHN_FLAG_BS,
  WEBAUTHN_FLAG_ED,
  WEBAUTHN_FLAG_UP,
  WEBAUTHN_FLAG_UV,
  parseAuthenticatorDataFlags,
  sha256,
} from "../src/index.js";

function buildMockAuthData(flags: number, signCount: number, rpId = "veritag.stellar.org"): Buffer {
  const rpIdHash = sha256(rpId);
  const tail = Buffer.alloc(5);
  tail[0] = flags & 0xff;
  tail.writeUInt32BE(signCount >>> 0, 1);
  return Buffer.concat([rpIdHash, tail]);
}

describe("@veritag/sdk webauthn-flags parser", () => {
  it("parses UP, UV, BE, BS, AT, ED bitmask flags and big-endian signCount", () => {
    const flags =
      WEBAUTHN_FLAG_UP |
      WEBAUTHN_FLAG_UV |
      WEBAUTHN_FLAG_BE |
      WEBAUTHN_FLAG_BS |
      WEBAUTHN_FLAG_AT |
      WEBAUTHN_FLAG_ED;
    const authData = buildMockAuthData(flags, 0x01020304, "veritag.app");

    const parsed = parseAuthenticatorDataFlags(authData);
    expect(parsed.rawFlags).toBe(flags);
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.backupEligible).toBe(true);
    expect(parsed.backupState).toBe(true);
    expect(parsed.attestedCredentialData).toBe(true);
    expect(parsed.extensionDataIncluded).toBe(true);
    expect(parsed.signCount).toBe(0x01020304);
    expect(parsed.rpIdHash.equals(sha256("veritag.app"))).toBe(true);
    expect(parsed.rpIdHashHex).toBe(sha256("veritag.app").toString("hex"));
  });

  it("distinguishes hardware-bound passkeys (UP only) from synced cloud passkeys (UP|UV|BE|BS)", () => {
    const hardwareKeyAuth = buildMockAuthData(WEBAUTHN_FLAG_UP, 42);
    const hw = parseAuthenticatorDataFlags(hardwareKeyAuth);
    expect(hw.userPresent).toBe(true);
    expect(hw.userVerified).toBe(false);
    expect(hw.backupEligible).toBe(false);
    expect(hw.backupState).toBe(false);
    expect(hw.attestedCredentialData).toBe(false);
    expect(hw.extensionDataIncluded).toBe(false);
    expect(hw.signCount).toBe(42);

    const backupEligibleNotBackedUp = buildMockAuthData(
      WEBAUTHN_FLAG_UP | WEBAUTHN_FLAG_UV | WEBAUTHN_FLAG_BE,
      0
    );
    const beOnly = parseAuthenticatorDataFlags(backupEligibleNotBackedUp);
    expect(beOnly.backupEligible).toBe(true);
    expect(beOnly.backupState).toBe(false);
    expect(beOnly.signCount).toBe(0);
  });

  it("handles maximum unsigned 32-bit signCount values without signed overflow", () => {
    const authData = buildMockAuthData(WEBAUTHN_FLAG_UP, 0xffffffff);
    const parsed = parseAuthenticatorDataFlags(authData);
    expect(parsed.signCount).toBe(4294967295);
  });

  it("rejects truncated authenticatorData buffers shorter than 37 bytes", () => {
    const shortBuf = Buffer.alloc(MIN_AUTHENTICATOR_DATA_BYTES - 1);
    expect(() => parseAuthenticatorDataFlags(shortBuf)).toThrow(/at least 37 bytes/i);
  });

  it("rejects invalid W3C WebAuthn flag combination where BS is set without BE", () => {
    const invalidAuthData = buildMockAuthData(WEBAUTHN_FLAG_UP | WEBAUTHN_FLAG_BS, 1);
    expect(() => parseAuthenticatorDataFlags(invalidAuthData)).toThrow(
      /Backup State \(BS\) cannot be set when Backup Eligibility \(BE\) is false/i
    );
  });
});
