"use client";

import React, { useEffect, useState } from "react";

export const STELLAR_STATUS_URL = "https://status.stellar.org";
export const DEFAULT_RETRY_SECONDS = 10;

export interface RpcErrorDiagnostics {
  isRpcTimeout: boolean;
  statusCode?: number;
  title: string;
  description: string;
}

/**
 * Classifies client/network errors to provide friendly diagnostics for Stellar RPC timeouts (e.g. HTTP 504).
 */
export function classifyRpcError(error: unknown): RpcErrorDiagnostics {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unexpected error";
  const lower = message.toLowerCase();
  const is504 = /\b504\b/.test(lower) || lower.includes("gateway timeout");
  const isTimeout =
    is504 ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("aborterror") ||
    lower.includes("etimedout");
  const isRpc =
    lower.includes("rpc") ||
    lower.includes("soroban") ||
    lower.includes("stellar") ||
    lower.includes("fetch failed") ||
    lower.includes("network");

  if (isTimeout || (isRpc && is504)) {
    return {
      isRpcTimeout: true,
      ...(is504 ? { statusCode: 504 } : {}),
      title: "Stellar RPC Connection Timed Out",
      description:
        "The Stellar testnet RPC node is temporarily busy or undergoing maintenance (HTTP 504 / timeout). Your product data is safe on-chain — we will automatically retry shortly.",
    };
  }

  if (isRpc) {
    return {
      isRpcTimeout: true,
      title: "Unable to Reach Stellar Soroban RPC",
      description:
        "We could not establish a connection to the Stellar RPC endpoint. Check the Stellar network status or retry in a few seconds.",
    };
  }

  return {
    isRpcTimeout: false,
    title: "Something Went Wrong",
    description:
      message || "An unexpected client error occurred while rendering this view.",
  };
}

interface ErrorDiagnosticsCardProps {
  error: unknown;
  onReset?: () => void;
  retrySeconds?: number;
}

/**
 * Friendly error fallback card with illustration, automatic retry countdown, and Stellar status link.
 */
export function ErrorDiagnosticsCard({
  error,
  onReset,
  retrySeconds = DEFAULT_RETRY_SECONDS,
}: ErrorDiagnosticsCardProps) {
  const diagnostics = classifyRpcError(error);
  const [countdown, setCountdown] = useState(retrySeconds);

  useEffect(() => {
    setCountdown(retrySeconds);
  }, [error, retrySeconds]);

  useEffect(() => {
    if (!onReset || countdown <= 0) {
      if (onReset && countdown === 0) {
        onReset();
      }
      return;
    }
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown, onReset]);

  return (
    <div
      role="alert"
      className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-5"
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <svg
          className="h-9 w-9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2a10 10 0 0 0-7.07 17.07" />
          <path d="M19.07 4.93A10 10 0 0 1 12 22" />
          <path d="M8.5 8.5l7 7" />
          <path d="M15.5 8.5l-7 7" />
        </svg>
      </div>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {diagnostics.statusCode ? `HTTP ${diagnostics.statusCode} · ` : ""}
          {diagnostics.isRpcTimeout ? "Stellar RPC Diagnostics" : "Client Recovery"}
        </div>
        <h2 className="text-xl font-bold text-slate-900">{diagnostics.title}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{diagnostics.description}</p>
      </div>

      {onReset && (
        <div className="rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          Automatic retry in <strong className="font-mono text-slate-900">{countdown}s</strong>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Retry Now
          </button>
        )}
        <a
          href={STELLAR_STATUS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
        >
          Check Stellar RPC Status →
        </a>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  retrySeconds?: number;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React Error Boundary catching client and RPC timeout errors with friendly diagnostics.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorDiagnosticsCard
          error={this.state.error}
          onReset={this.handleReset}
          retrySeconds={this.props.retrySeconds}
        />
      );
    }
    return this.props.children;
  }
}
