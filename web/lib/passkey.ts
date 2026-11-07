export interface PasskeyWalletCredential {
  credentialId: string;
  publicKeyHex: string;
  stellarSmartAddress: string;
  label: string;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Creates a WebAuthn passkey (`secp256r1` / ES256) in the browser for seedless
 * consumer smart-wallet authentication on Soroban.
 */
export async function registerPasskeySmartWallet(
  label = "Veritag Consumer Wallet",
): Promise<PasskeyWalletCredential> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new Error("WebAuthn passkeys are not supported in this browser environment");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: "Veritag Authenticity Registry",
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: label,
        displayName: label,
      },
      // ES256 = -7 (secp256r1, natively supported by Soroban host function verify_sig_ecdsa_secp256r1)
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey registration cancelled");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const pubKeyDer = response.getPublicKey?.();
  const publicKeyHex = pubKeyDer ? bufferToHex(pubKeyDer) : bufferToHex(credential.rawId);

  // Deterministic preview smart-contract address representation derived from credential ID
  const hashBuf = await crypto.subtle.digest("SHA-256", credential.rawId);
  const hashHex = bufferToHex(hashBuf).toUpperCase();
  const stellarSmartAddress = `C${hashHex.replace(/[^A-Z2-7]/g, "A").padEnd(55, "B").slice(0, 55)}`;

  return {
    credentialId: credential.id,
    publicKeyHex,
    stellarSmartAddress,
    label,
  };
}
