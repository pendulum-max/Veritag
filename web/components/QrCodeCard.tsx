"use client";

import { generateQrDataUrl, generateQrSvg } from "@veritag/sdk";
import { useMemo } from "react";

interface QrCodeCardProps {
  serial: string;
  scratchSecret: string;
  qrUrl: string;
  qrSvg?: string;
}

export function QrCodeCard({ serial, scratchSecret, qrUrl, qrSvg }: QrCodeCardProps) {
  const dataUrl = useMemo(() => {
    if (qrSvg) {
      return `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
    }
    return generateQrDataUrl(qrUrl, { label: serial });
  }, [qrSvg, qrUrl, serial]);

  function handleDownloadSvg() {
    const svgText = qrSvg ?? generateQrSvg(qrUrl, { label: serial });
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veritag-${serial}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={`QR code for ${serial}`}
          className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 bg-white p-1"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-mono font-bold text-slate-900">{serial}</div>
          <div className="text-[11px] text-slate-500">Scratch Secret:</div>
          <div className="rounded bg-white px-2 py-1 font-mono text-[11px] font-semibold text-emerald-700 border border-slate-200 break-all">
            {scratchSecret}
          </div>
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="mt-1 inline-block text-[11px] font-semibold text-blue-600 hover:underline"
          >
            Download Print SVG
          </button>
        </div>
      </div>
    </div>
  );
}
