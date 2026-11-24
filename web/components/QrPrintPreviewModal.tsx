"use client";

import { useEffect, useRef, useState } from "react";
import { QrCodeCard } from "@/components/QrCodeCard";

export interface PrintableTagRow {
  unitId: string;
  serial: string;
  scratchSecret: string;
  qrUrl: string;
  qrSvg?: string;
}

type SheetPreset = {
  id: string;
  label: string;
  cols: number;
  rows: number;
  /** null = continuous roll (no fixed row count) */
  totalRows: number | null;
};

const SHEET_PRESETS: SheetPreset[] = [
  { id: "3x8", label: "3 × 8 (24-up sheet)", cols: 3, rows: 8, totalRows: 8 },
  { id: "4x10", label: "4 × 10 (40-up sheet)", cols: 4, rows: 10, totalRows: 10 },
  { id: "2x6", label: "2 × 6 (12-up sheet)", cols: 2, rows: 6, totalRows: 6 },
  { id: "roll", label: "Continuous Roll", cols: 2, rows: 0, totalRows: null },
];

interface QrPrintPreviewModalProps {
  items: PrintableTagRow[];
  onClose: () => void;
}

export function QrPrintPreviewModal({ items, onClose }: QrPrintPreviewModalProps) {
  const [preset, setPreset] = useState<SheetPreset>(SHEET_PRESETS[0]!);
  const [labelPadding, setLabelPadding] = useState(8);
  const [fontSize, setFontSize] = useState(10);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handlePrint() {
    window.print();
  }

  const cols = preset.cols;

  return (
    <>
      {/* ── Print-only styles injected as a style tag so they work without a CSS module ── */}
      <style>{`
        @media print {
          body > *:not(#veritag-print-root) { display: none !important; }
          #veritag-print-root {
            display: block !important;
            position: static !important;
          }
          .print\\:hidden { display: none !important; }
          .print-sheet {
            display: grid;
            grid-template-columns: repeat(${cols}, 1fr);
            gap: 0;
            width: 100%;
            page-break-inside: avoid;
          }
          .print-label {
            padding: ${labelPadding}px !important;
            page-break-inside: avoid;
            break-inside: avoid;
            border: 0.5pt solid #cbd5e1;
          }
          header, footer, nav, .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Screen overlay ── */}
      <div
        ref={backdropRef}
        className="print:hidden fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10"
        onClick={(e) => {
          if (e.target === backdropRef.current) onClose();
        }}
      >
        <div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 print:hidden">
            <h2 className="text-base font-bold text-slate-900">
              QR Sticker Sheet Print Preview
            </h2>
            <button
              type="button"
              aria-label="Close modal"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              ✕
            </button>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 px-6 py-4 print:hidden">
            {/* Sheet preset selector */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Sheet Layout
              </label>
              <select
                aria-label="Sheet layout preset"
                value={preset.id}
                onChange={(e) =>
                  setPreset(SHEET_PRESETS.find((p) => p.id === e.target.value) ?? SHEET_PRESETS[0]!)
                }
                className="mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {SHEET_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Label padding */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Label Padding ({labelPadding}px)
              </label>
              <input
                type="range"
                min={4}
                max={24}
                step={2}
                value={labelPadding}
                onChange={(e) => setLabelPadding(Number(e.target.value))}
                className="mt-2 w-32"
              />
            </div>

            {/* Font size */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Font Size ({fontSize}pt)
              </label>
              <input
                type="range"
                min={8}
                max={14}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="mt-2 w-32"
              />
            </div>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Print Sheet
              </button>
            </div>
          </div>

          {/* Preview grid */}
          <div
            id="veritag-print-root"
            className="p-6"
            style={{ fontSize: `${fontSize}pt` }}
          >
            {items.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No labels to preview.</p>
            ) : (
              <div
                className="print-sheet"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap: "1px",
                }}
              >
                {items.map((item) => (
                  <div
                    key={item.unitId}
                    className="print-label"
                    style={{ padding: `${labelPadding}px` }}
                  >
                    <QrCodeCard
                      serial={item.serial}
                      scratchSecret={item.scratchSecret}
                      qrUrl={item.qrUrl}
                      qrSvg={item.qrSvg}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
