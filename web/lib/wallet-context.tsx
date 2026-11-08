"use client";

import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { registerPasskeySmartWallet } from "./passkey";
import { PUBLIC_CONFIG } from "./stellar";

export type WalletType = "freighter" | "passkey" | "keypair";
export type DemoRole = "brand" | "owner" | "service";

export interface WalletSession {
  address: string;
  walletType: WalletType;
  token: string | null;
  label: string;
}

interface WalletContextValue {
  session: WalletSession | null;
  connecting: boolean;
  error: string | null;
  connectFreighter: () => Promise<WalletSession | null>;
  connectPasskey: (label?: string) => Promise<WalletSession | null>;
  connectRoleKeypair: (role: DemoRole) => Promise<WalletSession | null>;
  disconnect: () => void;
}

const STORAGE_KEY = "veritag_wallet_session_v1";
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
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSession(JSON.parse(raw) as WalletSession);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const persistSession = useCallback((next: WalletSession | null) => {
    setSession(next);
    try {
      if (next) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(STORAGE_KEY);
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

  const disconnect = useCallback(() => {
    persistSession(null);
    setError(null);
  }, [persistSession]);

  return (
    <WalletContext.Provider
      value={{
        session,
        connecting,
        error,
        connectFreighter,
        connectPasskey,
        connectRoleKeypair,
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
