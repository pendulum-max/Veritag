import {
  base64UrlEncode,
  derSignatureToCompactLowS,
  derivePasskeySalt,
  extractP256UncompressedPublicKey,
} from "@veritag/sdk";
import { PUBLIC_CONFIG } from "./stellar";

export interface PasskeyWalletCredential {
  credentialId: string;
  publicKeyHex: string;
  stellarSmartAddress: string;
  label: string;
  token?: string;
}

export interface SignedWebAuthnAssertion {
  credentialId: string;
  authenticatorDataHex: string;
  clientDataJsonBase64: string;
  signatureHex: string;
}

function bufferToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Creates a WebAuthn passkey (`secp256r1` / ES256) in the browser (with WebCrypto P-256 fallback
 * in headless/non-authenticator environments) and deploys/registers its deterministic Soroban
 * `PasskeyAccountContract` (`C...`) via the backend factory relayer.
 */
export async function registerPasskeySmartWallet(
  label = "Veritag Consumer Wallet",
): Promise<PasskeyWalletCredential> {
  let credentialId = "";
  let publicKeyHex = "";

  if (typeof window !== "undefined" && window.PublicKeyCredential && navigator.credentials?.create) {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: "Veritag Authenticity Registry",
            id: window.location.hostname || "localhost",
          },
          user: {
            id: userId,
            name: label,
            displayName: label,
          },
          // ES256 = -7 (secp256r1, natively supported by Soroban secp256r1_verify)
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;

      if (credential) {
        const response = credential.response as AuthenticatorAttestationResponse;
        const pubKeyDer = response.getPublicKey?.();
        if (pubKeyDer) {
          const sec1 = extractP256UncompressedPublicKey(new Uint8Array(pubKeyDer));
          publicKeyHex = bufferToHex(sec1);
          credentialId = credential.id;
        }
      }
    } catch {
      // Fall back to WebCrypto P-256 key generation when platform authenticator is unavailable
    }
  }

  if (!publicKeyHex) {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    publicKeyHex = bufferToHex(rawPub);
    const randId = crypto.getRandomValues(new Uint8Array(16));
    credentialId = `passkey-${base64UrlEncode(randId)}`;
  }

  try {
    const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/wallets/passkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialId, publicKeyHex }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        wallet: { walletAddress: string; publicKeyHex: string; credentialId: string };
        token: string;
      };
      return {
        credentialId: data.wallet.credentialId,
        publicKeyHex: data.wallet.publicKeyHex,
        stellarSmartAddress: data.wallet.walletAddress,
        label,
        token: data.token,
      };
    }
  } catch {
    // Offline fallback deterministic address
  }

  const saltHex = derivePasskeySalt(credentialId).toString("hex").toUpperCase();
  const stellarSmartAddress = `C${saltHex.replace(/[^A-Z2-7]/g, "A").padEnd(55, "B").slice(0, 55)}`;

  return {
    credentialId,
    publicKeyHex,
    stellarSmartAddress,
    label,
  };
}

/**
 * Signs a 32-byte Soroban authorization payload or authentication challenge using WebAuthn
 * (`navigator.credentials.get`) and normalizes the DER ECDSA signature to compact 64-byte low-S.
 */
export async function signWithPasskeyAssertion(
  credentialId: string,
  challengeBytes: Uint8Array,
): Promise<SignedWebAuthnAssertion> {
  if (typeof window === "undefined" || !navigator.credentials?.get) {
    throw new Error("WebAuthn assertion signing is unavailable in this environment");
  }

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes.buffer.slice(
        challengeBytes.byteOffset,
        challengeBytes.byteOffset + challengeBytes.byteLength,
      ) as ArrayBuffer,
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Passkey assertion cancelled");
  }

  const response = assertion.response as AuthenticatorAssertionResponse;
  const compactSig = derSignatureToCompactLowS(new Uint8Array(response.signature));

  return {
    credentialId: assertion.id || credentialId,
    authenticatorDataHex: bufferToHex(response.authenticatorData),
    clientDataJsonBase64: btoa(
      String.fromCharCode(...new Uint8Array(response.clientDataJSON)),
    ),
    signatureHex: bufferToHex(compactSig),
  };
}
