"use client";

import { useMemo, useState } from "react";
import {
  buildCertificateSvg,
  downloadCertificatePdf,
  downloadCertificatePng,
  type WarrantyCertificateData,
} from "@/lib/certificate-generator";

interface WarrantyCertificateProps {
  data: WarrantyCertificateData;
  onClose?: () => void;
}

export function WarrantyCertificate({ data, onClose }: WarrantyCertificateProps) {
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const svgMarkup = useMemo(() => buildCertificateSvg(data), [data]);

  async function handlePngDownload() {
    setExporting("png");
    setError(null);
    try {
      await downloadCertificatePng(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PNG export failed");
    } finally {
      setExporting(null);
    }
  }

  function handlePdfDownload() {
    setExporting("pdf");
    setError(null);
    try {
      downloadCertificatePdf(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            Certificate of Authenticity &amp; Warranty
          </h3>
          <p className="text-xs text-slate-500">
            Formal insurance &amp; appraisal export with Guilloché security border and Stellar proof.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handlePngDownload()}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === "png" ? "Rendering PNG..." : "Download PNG"}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handlePdfDownload}
            className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {exporting === "pdf" ? "Generating PDF..." : "Download Vector PDF"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      <div
        className="overflow-hidden rounded-xl border border-amber-200 bg-[#fdfbf7] shadow-inner"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </div>
  );
}
