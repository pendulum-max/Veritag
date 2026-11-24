"use client";

import {
  type BatchUnitInput,
  computeLeaf,
  computeSecretHash,
  computeSerialHash,
  MerkleTree,
  parseBatchIngestion,
} from "@veritag/sdk";
import { useId, useMemo, useState } from "react";

export type WizardStep = "upload" | "inspect" | "commit";

export interface ValidatedBatchRow {
  lineNumber: number;
  serial: string;
  secret: string;
  metadata?: string;
  errors: string[];
  isDuplicateSerial: boolean;
}

export interface BatchCommitPayload {
  batchCode: string;
  warrantyMonths: number;
  merkleRoot: string;
  units: BatchUnitInput[];
}

interface BatchUploadWizardProps {
  onCommit: (payload: BatchCommitPayload) => Promise<void> | void;
}

const VALID_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;

function computeLineNumbers(rawInput: string, parsedCount: number): number[] {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return Array.from({ length: parsedCount }, (_, idx) => idx + 1);
  }

  const rawLines = trimmed.split(/\r?\n/);
  const nonEmptyLines: Array<{ lineNumber: number; text: string }> = [];
  rawLines.forEach((line, index) => {
    if (line.trim().length > 0) {
      nonEmptyLines.push({ lineNumber: index + 1, text: line });
    }
  });

  if (nonEmptyLines.length === 0) return [];
  const firstLineLower = nonEmptyLines[0]!.text.toLowerCase();
  const hasHeader = firstLineLower.includes("serial") && firstLineLower.includes("secret");
  const dataLines = hasHeader ? nonEmptyLines.slice(1) : nonEmptyLines;

  return Array.from(
    { length: parsedCount },
    (_, idx) => dataLines[idx]?.lineNumber ?? idx + (hasHeader ? 2 : 1),
  );
}

export function validateBatchCsv(rawInput: string): {
  rows: ValidatedBatchRow[];
  merkleRoot: string | null;
  errorCount: number;
} {
  let parsed: BatchUnitInput[] = [];
  try {
    parsed = parseBatchIngestion(rawInput);
  } catch {
    return { rows: [], merkleRoot: null, errorCount: 1 };
  }

  const lineNumbers = computeLineNumbers(rawInput, parsed.length);
  const serialLines = new Map<string, number[]>();

  parsed.forEach((item, idx) => {
    const key = item.serial.trim();
    if (!key) return;
    const lineNo = lineNumbers[idx] ?? idx + 1;
    const existing = serialLines.get(key) ?? [];
    existing.push(lineNo);
    serialLines.set(key, existing);
  });

  let errorCount = 0;
  const rows: ValidatedBatchRow[] = parsed.map((item, idx) => {
    const lineNumber = lineNumbers[idx] ?? idx + 1;
    const errors: string[] = [];
    const serial = item.serial.trim();
    const secret = item.secret.trim();

    if (!serial) {
      errors.push(`Line ${lineNumber}: Empty serial number`);
    } else if (!VALID_TOKEN_PATTERN.test(serial)) {
      errors.push(`Line ${lineNumber}: Invalid characters in serial "${serial}"`);
    }

    if (!secret) {
      errors.push(`Line ${lineNumber}: Empty scratch secret`);
    } else if (!VALID_TOKEN_PATTERN.test(secret)) {
      errors.push(`Line ${lineNumber}: Invalid characters in secret`);
    }

    const occurrences = serial ? (serialLines.get(serial) ?? []) : [];
    const isDuplicateSerial = occurrences.length > 1;
    if (isDuplicateSerial) {
      const otherLines = occurrences.filter((l) => l !== lineNumber);
      errors.push(
        `Line ${lineNumber}: Duplicate serial "${serial}" (conflicts with line${otherLines.length > 1 ? "s" : ""} ${otherLines.join(", ")})`,
      );
    }

    if (errors.length > 0) {
      errorCount += 1;
    }

    return {
      lineNumber,
      serial,
      secret,
      metadata: item.metadata,
      errors,
      isDuplicateSerial,
    };
  });

  let merkleRoot: string | null = null;
  if (rows.length > 0 && errorCount === 0) {
    const leaves = rows.map((r) =>
      computeLeaf(computeSerialHash(r.serial), computeSecretHash(r.secret)),
    );
    merkleRoot = new MerkleTree(leaves).root.toString("hex");
  }

  return { rows, merkleRoot, errorCount };
}

const STEPS: Array<{ id: WizardStep; label: string; number: number }> = [
  { id: "upload", label: "Upload", number: 1 },
  { id: "inspect", label: "Inspect", number: 2 },
  { id: "commit", label: "Commit", number: 3 },
];

export function BatchUploadWizard({ onCommit }: BatchUploadWizardProps) {
  const [step, setStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [batchCode, setBatchCode] = useState("CH-2026-CSV1");
  const [warrantyMonths, setWarrantyMonths] = useState(24);
  const [dragging, setDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitStatus, setCommitStatus] = useState<string | null>(null);

  const fileInputId = useId();
  const batchCodeId = useId();
  const warrantyId = useId();

  const validation = useMemo(() => {
    if (!rawText.trim()) {
      return { rows: [] as ValidatedBatchRow[], merkleRoot: null, errorCount: 0 };
    }
    return validateBatchCsv(rawText);
  }, [rawText]);

  async function loadFile(file: File) {
    setParseError(null);
    setCommitStatus(null);
    try {
      const content =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ""));
              reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
              reader.readAsText(file);
            });
      if (!content.trim()) {
        setParseError("Uploaded file is empty.");
        return;
      }
      setFileName(file.name);
      setRawText(content);
      setStep("inspect");
    } catch {
      setParseError("Could not read the selected file.");
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void loadFile(file);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void loadFile(file);
    }
  }

  async function handleCommitClick() {
    if (!validation.merkleRoot || validation.errorCount > 0 || validation.rows.length === 0) {
      return;
    }
    setCommitting(true);
    setCommitStatus(null);
    try {
      await onCommit({
        batchCode: batchCode.trim() || "CH-2026-CSV1",
        warrantyMonths,
        merkleRoot: validation.merkleRoot,
        units: validation.rows.map((r) => ({
          serial: r.serial,
          secret: r.secret,
          metadata: r.metadata,
        })),
      });
      setCommitStatus(
        `Committed batch ${batchCode} (${validation.rows.length} units, root ${validation.merkleRoot.slice(0, 12)}...).`,
      );
    } catch {
      setCommitStatus("Failed to commit CSV batch.");
    } finally {
      setCommitting(false);
    }
  }

  const previewRows = validation.rows.slice(0, 10);
  const canProceedToCommit =
    validation.rows.length > 0 && validation.errorCount === 0 && Boolean(validation.merkleRoot);

  return (
    <section
      aria-labelledby="csv-wizard-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="csv-wizard-heading"
            className="text-base font-bold text-slate-900 dark:text-slate-100"
          >
            CSV Batch Upload Wizard
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Pre-flight schema validation, duplicate serial detection, and client-side Merkle root
            calculation.
          </p>
        </div>

        <ol aria-label="Wizard steps" className="flex items-center gap-2 text-xs font-semibold">
          {STEPS.map((s, idx) => {
            const isCurrent = step === s.id;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                    isCurrent
                      ? "bg-slate-900 text-white dark:bg-blue-600"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  <span>{s.number}.</span>
                  <span>{s.label}</span>
                </span>
                {idx < STEPS.length - 1 && (
                  <span aria-hidden="true" className="text-slate-400">
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {step === "upload" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={batchCodeId}
                className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300"
              >
                Batch Lot Code
              </label>
              <input
                id={batchCodeId}
                type="text"
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor={warrantyId}
                className="block text-xs font-semibold uppercase text-slate-700 dark:text-slate-300"
              >
                Warranty Duration (Months)
              </label>
              <input
                id={warrantyId}
                type="number"
                min={0}
                max={240}
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div
            data-testid="csv-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
              dragging
                ? "border-blue-600 bg-blue-50 dark:bg-blue-950/30"
                : "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60"
            }`}
          >
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Drag and drop your batch CSV/TSV file here
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Expected columns: <code className="font-mono">serial,secret,metadata</code>
            </p>
            <label
              htmlFor={fileInputId}
              className="mt-4 cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              Choose CSV File
            </label>
            <input
              id={fileInputId}
              type="file"
              accept=".csv,.tsv,.txt,.json"
              aria-label="Upload CSV batch file"
              onChange={handleFileChange}
              className="sr-only"
            />
          </div>

          {parseError && (
            <p
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
            >
              {parseError}
            </p>
          )}
        </div>
      )}

      {step === "inspect" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/70">
              <div className="text-xs text-slate-600 dark:text-slate-400">Total Units</div>
              <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                {validation.rows.length}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/70">
              <div className="text-xs text-slate-600 dark:text-slate-400">Warranty Duration</div>
              <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                {warrantyMonths} months
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/70">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                Calculated Merkle Root
              </div>
              <div className="mt-1 truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                {validation.merkleRoot ?? "Resolve errors to compute"}
              </div>
            </div>
          </div>

          {validation.errorCount > 0 && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
            >
              <strong>
                {validation.errorCount} validation error{validation.errorCount > 1 ? "s" : ""}{" "}
                detected
              </strong>{" "}
              {fileName ? `in ${fileName}` : ""}. Conflicting or invalid rows are highlighted in red
              below.
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
              <thead className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Line #
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Serial
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Secret
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Metadata
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Validation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {previewRows.map((row) => {
                  const hasErr = row.errors.length > 0;
                  return (
                    <tr
                      key={`${row.lineNumber}-${row.serial}`}
                      className={
                        hasErr
                          ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                          : "bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200"
                      }
                    >
                      <td className="px-3 py-2 font-mono font-semibold">L{row.lineNumber}</td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        {row.serial || <span className="italic">(empty)</span>}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.secret || <span className="italic">(empty)</span>}
                      </td>
                      <td className="px-3 py-2">{row.metadata ?? "—"}</td>
                      <td className="px-3 py-2">
                        {hasErr ? (
                          <span className="font-semibold text-red-700 dark:text-red-300">
                            {row.errors.join("; ")}
                          </span>
                        ) : (
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            Valid
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {validation.rows.length > 10 && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Showing first 10 of {validation.rows.length} parsed rows.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Back to Upload
            </button>
            <button
              type="button"
              disabled={!canProceedToCommit}
              onClick={() => setStep("commit")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              Continue to Commit
            </button>
          </div>
        </div>
      )}

      {step === "commit" && (
        <div className="space-y-4">
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
              <dt className="text-slate-600 dark:text-slate-400">Batch Lot Code</dt>
              <dd className="mt-1 font-mono font-bold text-slate-900 dark:text-slate-100">
                {batchCode}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
              <dt className="text-slate-600 dark:text-slate-400">Total Units / Warranty</dt>
              <dd className="mt-1 font-bold text-slate-900 dark:text-slate-100">
                {validation.rows.length} units · {warrantyMonths} months
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2 dark:bg-slate-800/70">
              <dt className="text-slate-600 dark:text-slate-400">Calculated Merkle Root</dt>
              <dd className="mt-1 break-all font-mono font-semibold text-slate-900 dark:text-slate-100">
                {validation.merkleRoot}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep("inspect")}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Back to Inspect
            </button>
            <button
              type="button"
              disabled={committing || !canProceedToCommit}
              onClick={() => void handleCommitClick()}
              className="rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {committing ? "Committing Merkle Root..." : "Commit Merkle Batch On-Chain"}
            </button>
          </div>

          <div role="status" aria-live="polite" className="min-h-[1.25rem]">
            {commitStatus && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                {commitStatus}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
