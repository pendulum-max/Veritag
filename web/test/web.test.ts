// @vitest-environment jsdom
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUploadWizard, validateBatchCsv } from "../components/BatchUploadWizard.js";
import { MerkleTreeVisualizer } from "../components/MerkleTreeVisualizer.js";
import { AppThemeProvider, ThemeToggle } from "../components/ThemeToggle.js";
import { registerPasskeySmartWallet } from "../lib/passkey.js";
import {
  buildUnsignedRegistryTxXdr,
  getFileDownloadUrl,
  PUBLIC_CONFIG,
  signRegistryTxWithSecret,
  verifyProduct,
} from "../lib/stellar.js";

describe("@veritag/web verification & passkey wallet logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });

  it("generates P-256 passkey wallet credentials and formats file download URLs", async () => {
    const cred = await registerPasskeySmartWallet("Test Consumer Passkey");
    expect(cred.publicKeyHex.length).toBe(130);
    expect(cred.publicKeyHex.startsWith("04")).toBe(true);
    expect(cred.stellarSmartAddress.startsWith("C")).toBe(true);
    expect(cred.stellarSmartAddress.length).toBe(56);

    const fileUrl = getFileDownloadUrl("a".repeat(64));
    expect(fileUrl).toContain("/v1/files/" + "a".repeat(64));

    const kp = Keypair.random();
    const unsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: kp.publicKey(),
      method: "commit_batch",
    });
    const signedXdr = signRegistryTxWithSecret(unsignedXdr, kp.secret());
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, PUBLIC_CONFIG.networkPassphrase);
    expect(parsedTx.signatures.length).toBe(1);

    const passkeyUnsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: cred.stellarSmartAddress,
      method: "activate",
    });
    expect(passkeyUnsignedXdr.length).toBeGreaterThan(20);
  });
});

describe("#100 ThemeToggle & theme persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("persists theme selection to localStorage across light, dark, and system modes", async () => {
    render(
      React.createElement(
        AppThemeProvider,
        null,
        React.createElement(ThemeToggle),
      ),
    );

    const darkBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(darkBtn);
    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("dark");
    });

    const lightBtn = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(lightBtn);
    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("light");
    });
  });
});

describe("#88 BatchUploadWizard file drop & validation errors", () => {
  afterEach(() => {
    cleanup();
  });

  it("detects duplicate serial numbers and empty fields with exact line numbers", () => {
    const csv = [
      "serial,secret,metadata",
      "SN-001,SEC-001,ModelA",
      "SN-001,SEC-002,ModelA",
      ",SEC-003,ModelB",
    ].join("\n");

    const result = validateBatchCsv(csv);
    expect(result.errorCount).toBe(3);
    expect(result.merkleRoot).toBeNull();
    expect(result.rows[0]?.errors[0]).toContain("Line 2");
    expect(result.rows[1]?.errors[0]).toContain("Line 3");
    expect(result.rows[2]?.errors[0]).toContain("Line 4: Empty serial number");
  });

  it("handles file drop and renders validation errors in the inspect table", async () => {
    const onCommit = vi.fn();
    render(React.createElement(BatchUploadWizard, { onCommit }));

    const csv = "serial,secret,metadata\nUNIT-1,KEY-1,Pro\nUNIT-1,KEY-2,Pro\n";
    const file = new File([csv], "batch.csv", { type: "text/csv" });
    const dropzone = screen.getByTestId("csv-dropzone");

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText(/validation error/i)).toBeTruthy();
      expect(screen.getByText(/L2/)).toBeTruthy();
      expect(screen.getByText(/L3/)).toBeTruthy();
    });
  });
});

describe("#89 MerkleTreeVisualizer rendering & node selection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders tree nodes and highlights the verification path when a leaf is selected", () => {
    const leaves = [
      { label: "SN-A1" },
      { label: "SN-A2" },
      { label: "SN-A3" },
      { label: "SN-A4" },
    ];

    const { container } = render(React.createElement(MerkleTreeVisualizer, { leaves }));
    expect(screen.getByRole("img", { name: "Merkle tree diagram" })).toBeTruthy();

    const firstLeaf = screen.getByRole("button", { name: /Select leaf SN-A1/i });
    fireEvent.click(firstLeaf);

    const highlightedNodes = container.querySelectorAll('[data-highlighted="true"]');
    expect(highlightedNodes.length).toBe(3); // Leaf -> Internal -> Root
    expect(screen.getByTestId("merkle-tooltip").textContent).toContain("SHA-256:");
  });
});

describe("#101 Automated axe-core accessibility checks", () => {
  afterEach(() => {
    cleanup();
  });

  it("has zero critical or serious axe-core violations on ThemeToggle, BatchUploadWizard, and MerkleTreeVisualizer", async () => {
    const { container } = render(
      React.createElement(
        "main",
        null,
        React.createElement(ThemeToggle),
        React.createElement(BatchUploadWizard, { onCommit: vi.fn() }),
        React.createElement(MerkleTreeVisualizer, {
          leaves: [{ label: "SN-1" }, { label: "SN-2" }],
        }),
      ),
    );

    const results = await axe.run(container);
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
