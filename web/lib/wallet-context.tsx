"use client";

import { Keypair, type xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { registerPasskeySmartWallet, signWithPasskeyAssertion } from "./passkey";
import {
  buildUnsignedRegistryTxXdr,
  PUBLIC_CONFIG,
  requestAlbedoPublicKey,
  signRegistryTxWithSecret,
  signTxWithAlbedo,
} from "./stellar";

export type WalletType = "freighter" | "xbull" | "albedo" | "passkey" | "keypair";
export type DemoRole = "brand" | "owner" | "service";

export interface WalletSession {
  address: string;
  walletType: WalletType;
  token: string | null;
  label: string;
  role?: DemoRole;
  credentialId?: string;
}

export interface WalletConnectorHandlers {
  freighter: () => Promise<WalletSession | null>;
  xbull: () => Promise<WalletSession | null>;
  albedo: () => Promise<WalletSession | null>;
  passkey: (label?: string) => Promise<WalletSession | null>;
  keypair: (role?: DemoRole) => Promise<WalletSession | null>;
}

/**
 * Pure dispatcher that routes a `WalletType` selection to the corresponding connector handler.
 */
export async function dispatchWalletConnection(
  type: WalletType,
  handlers: WalletConnectorHandlers,
  options?: { label?: string; role?: DemoRole },
): Promise<WalletSession | null> {
  switch (type) {
    case "freighter":
      return handlers.freighter();
    case "xbull":
      return handlers.xbull();
    case "albedo":
      return handlers.albedo();
    case "passkey":
      return handlers.passkey(options?.label);
    case "keypair":
      return handlers.keypair(options?.role ?? "owner");
  }
}

interface WalletContextValue {
  session: WalletSession | null;
  activeConnector: WalletType | null;
  connecting: boolean;
  error: string | null;
  connectFreighter: () => Promise<WalletSession | null>;
  connectXBull: () => Promise<WalletSession | null>;
  connectAlbedo: () => Promise<WalletSession | null>;
  connectPasskey: (label?: string) => Promise<WalletSession | null>;
  connectRoleKeypair: (role: DemoRole) => Promise<WalletSession | null>;
  connectWallet: (
    type: WalletType,
    options?: { label?: string; role?: DemoRole },
  ) => Promise<WalletSession | null>;
  signContractAction: (method: string, args?: xdr.ScVal[]) => Promise<string | null>;
  clearError: () => void;
  disconnect: () => void;
}

export const WALLET_STORAGE_KEY = "veritag_wallet_session_v1";
export const CONNECTOR_STORAGE_KEY = "veritag_wallet_connector_v1";
const KEYPAIR_STORAGE_PREFIX = "veritag_role_secret_v1_";

const WalletContext = createContext<WalletContextValue | null>(null);

declare global {
  interface Window {
    freighterApi?: {
      isConnected?: () => Promise<boolean>;
      getPublicKey?: () => Promise<string>;
      getAddress?: () => Promise<{ address: string }>;
      signMessage?: (
        message: string,
        opts?: { address?: string },
      ) => Promise<string | { signedMessage: string }>;
      signTransaction?: (
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string },
      ) => Promise<string | { signedTxXdr: string }>;
    };
    xBullSDK?: {
      connect: (opts?: { canRequestPublicKey?: boolean; canRequestSign?: boolean }) => Promise<void>;
      getPublicKey: () => Promise<string>;
      sign: (opts: { xdr: string; network?: string; publicKey?: string }) => Promise<string>;
    };
    xbull?: {
      connect?: () => Promise<void>;
      getPublicKey?: () => Promise<string>;
      sign?: (opts: { xdr: string; network?: string; publicKey?: string }) => Promise<string>;
    };
  }
}

async function authenticateEd25519Keypair(kp: Keypair): Promise<string | null> {
  try {
    const chRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: kp.publicKey() }),
    });
    if (!chRes.ok) return null;
    const challenge = (await chRes.json()) as { nonce: string; message: string };
    const sigHex = Buffer.from(kp.sign(Buffer.from(challenge.message, "utf8"))).toString("hex");

    const verRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: challenge.nonce, signature: sigHex }),
    });
    if (!verRes.ok) return null;
    const { token } = (await verRes.json()) as { token: string };
    return token;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [activeConnector, setActiveConnector] = useState<WalletType | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WALLET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WalletSession;
        setSession(parsed);
        setActiveConnector(parsed.walletType);
        return;
      }
      const savedConnector = localStorage.getItem(CONNECTOR_STORAGE_KEY) as WalletType | null;
      if (savedConnector) {
        setActiveConnector(savedConnector);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const persistSession = useCallback((next: WalletSession | null) => {
    setSession(next);
    setActiveConnector(next ? next.walletType : null);
    try {
      if (next) {
        localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(CONNECTOR_STORAGE_KEY, next.walletType);
      } else {
        localStorage.removeItem(WALLET_STORAGE_KEY);
        localStorage.removeItem(CONNECTOR_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const connectFreighter = useCallback(async (): Promise<WalletSession | null> => {
    setConnecting(true);
    setError(null);
    try {
      const api = typeof window !== "undefined" ? window.freighterApi : undefined;
      if (!api) {
        throw new Error(
          "Freighter extension not detected. Use Passkey or Role Signer below, or install Freighter.",
        );
      }
      const pubKey = api.getAddress
        ? (await api.getAddress()).address
        : api.getPublicKey
          ? await api.getPublicKey()
          : "";
      if (!pubKey) {
        throw new Error("Freighter did not return a public key");
      }

      let token: string | null = null;
      if (api.signMessage) {
        try {
          const chRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/auth/challenge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: pubKey }),
          });
          if (chRes.ok) {
            const challenge = (await chRes.json()) as { nonce: string; message: string };
            const signed = await api.signMessage(challenge.message, { address: pubKey });
            const signature = typeof signed === "string" ? signed : signed.signedMessage;
            const verRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/auth/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nonce: challenge.nonce, signature }),
            });
            if (verRes.ok) {
              const data = (await verRes.json()) as { token: string };
              token = data.token;
            }
          }
        } catch {
          // Continue with address even if backend challenge is offline
        }
      }

      const next: WalletSession = {
        address: pubKey,
        walletType: "freighter",
        token,
        label: "Freighter Wallet",
      };
      persistSession(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Freighter connection failed");
      return null;
    } finally {
      setConnecting(false);
    }
  }, [persistSession]);

  const connectXBull = useCallback(async (): Promise<WalletSession | null> => {
    setConnecting(true);
    setError(null);
    try {
      const sdk =
        typeof window !== "undefined" ? (window.xBullSDK ?? window.xbull) : undefined;
      if (!sdk?.getPublicKey) {
        throw new Error(
          "xBull extension not detected. Install xBull Wallet or choose Albedo / Passkey.",
        );
      }
      if (sdk.connect) {
        await sdk.connect({ canRequestPublicKey: true, canRequestSign: true });
      }
      const pubKey = await sdk.getPublicKey();
      if (!pubKey) {
        throw new Error("xBull did not return a public key");
      }
      const next: WalletSession = {
        address: pubKey,
        walletType: "xbull",
        token: null,
        label: "xBull Wallet",
      };
      persistSession(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "xBull connection failed");
      return null;
    } finally {
      setConnecting(false);
    }
  }, [persistSession]);

  const connectAlbedo = useCallback(async (): Promise<WalletSession | null> => {
    setConnecting(true);
    setError(null);
    try {
      const { pubkey } = await requestAlbedoPublicKey("veritag-session");
      const next: WalletSession = {
        address: pubkey,
        walletType: "albedo",
        token: null,
        label: "Albedo Wallet",
      };
      persistSession(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Albedo popup connection failed");
      return null;
    } finally {
      setConnecting(false);
    }
  }, [persistSession]);

  const connectPasskey = useCallback(
    async (label = "Veritag Passkey Wallet"): Promise<WalletSession | null> => {
      setConnecting(true);
      setError(null);
      try {
        const cred = await registerPasskeySmartWallet(label);
        const next: WalletSession = {
          address: cred.stellarSmartAddress,
          walletType: "passkey",
          token: cred.token ?? null,
          label: "Passkey Smart Account (secp256r1)",
          credentialId: cred.credentialId,
        };
        persistSession(next);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Passkey wallet creation failed");
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [persistSession],
  );

  const connectRoleKeypair = useCallback(
    async (role: DemoRole): Promise<WalletSession | null> => {
      setConnecting(true);
      setError(null);
      try {
        const secretStorageKey = `${KEYPAIR_STORAGE_PREFIX}${role}`;
        let secret = localStorage.getItem(secretStorageKey);
        let kp: Keypair;
        if (secret) {
          kp = Keypair.fromSecret(secret);
        } else {
          kp = Keypair.random();
          localStorage.setItem(secretStorageKey, kp.secret());
        }

        const token = await authenticateEd25519Keypair(kp);
        const roleLabels: Record<DemoRole, string> = {
          brand: "Brand Admin Signer",
          owner: "Consumer Keypair Signer",
          service: "Service Center Signer",
        };
        const next: WalletSession = {
          address: kp.publicKey(),
          walletType: "keypair",
          token,
          label: roleLabels[role],
          role,
        };
        persistSession(next);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Keypair connection failed");
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [persistSession],
  );

  const signContractAction = useCallback(
    async (method: string, args?: xdr.ScVal[]): Promise<string | null> => {
      if (!session) return null;
      try {
        const unsignedXdr = buildUnsignedRegistryTxXdr({
          callerAddress: session.address,
          method,
          args,
        });

        if (session.walletType === "freighter") {
          const api = typeof window !== "undefined" ? window.freighterApi : undefined;
          if (api?.signTransaction) {
            const signed = await api.signTransaction(unsignedXdr, {
              networkPassphrase: PUBLIC_CONFIG.networkPassphrase,
              address: session.address,
            });
            return typeof signed === "string" ? signed : signed.signedTxXdr;
          }
          return unsignedXdr;
        }

        if (session.walletType === "xbull") {
          const sdk =
            typeof window !== "undefined" ? (window.xBullSDK ?? window.xbull) : undefined;
          if (sdk?.sign) {
            const network = PUBLIC_CONFIG.networkPassphrase.includes("Public")
              ? "public"
              : "testnet";
            return await sdk.sign({ xdr: unsignedXdr, network, publicKey: session.address });
          }
          return unsignedXdr;
        }

        if (session.walletType === "albedo") {
          const network = PUBLIC_CONFIG.networkPassphrase.includes("Public")
            ? "public"
            : "testnet";
          return await signTxWithAlbedo(unsignedXdr, network);
        }

        if (session.walletType === "keypair") {
          const rolesToCheck: DemoRole[] = session.role
            ? [session.role, "brand", "owner", "service"]
            : ["brand", "owner", "service"];
          for (const r of rolesToCheck) {
            const secret = localStorage.getItem(`${KEYPAIR_STORAGE_PREFIX}${r}`);
            if (secret) {
              const kp = Keypair.fromSecret(secret);
              if (kp.publicKey() === session.address) {
                return signRegistryTxWithSecret(unsignedXdr, secret);
              }
            }
          }
          return unsignedXdr;
        }

        if (session.walletType === "passkey" && session.credentialId) {
          try {
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(unsignedXdr),
            );
            await signWithPasskeyAssertion(session.credentialId, new Uint8Array(digest));
          } catch {
            // Headless / non-authenticator fallback uses envelope XDR for fee-sponsor relay
          }
          return unsignedXdr;
        }

        return unsignedXdr;
      } catch {
        return null;
      }
    },
    [session],
  );

  const connectWallet = useCallback(
    async (
      type: WalletType,
      options?: { label?: string; role?: DemoRole },
    ): Promise<WalletSession | null> => {
      return dispatchWalletConnection(
        type,
        {
          freighter: connectFreighter,
          xbull: connectXBull,
          albedo: connectAlbedo,
          passkey: connectPasskey,
          keypair: (r = "owner") => connectRoleKeypair(r),
        },
        options,
      );
    },
    [connectAlbedo, connectFreighter, connectPasskey, connectRoleKeypair, connectXBull],
  );

  const clearError = useCallback(() => setError(null), []);

  const disconnect = useCallback(() => {
    persistSession(null);
    setError(null);
  }, [persistSession]);

  return (
    <WalletContext.Provider
      value={{
        session,
        activeConnector,
        connecting,
        error,
        connectFreighter,
        connectXBull,
        connectAlbedo,
        connectPasskey,
        connectRoleKeypair,
        connectWallet,
        signContractAction,
        clearError,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
