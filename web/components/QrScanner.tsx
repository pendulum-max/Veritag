"use client";

import { parseVerifyPath } from "@veritag/sdk";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function QrScanner() {
  const router = useRouter();
  const [pasteInput, setPasteInput] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanAnnouncement, setScanAnnouncement] = useState<string>("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function routeFromQrPayload(rawPayload: string): boolean {
    setScanError(null);
    const trimmed = rawPayload.trim();
    if (!trimmed) return false;

    try {
      const url = trimmed.startsWith("http")
        ? new URL(trimmed)
        : new URL(trimmed, "https://veritag.local");
      const parsed = parseVerifyPath(url.pathname);
      if (parsed) {
        const hashSuffix = url.hash ? url.hash : "";
        router.push(
          `/v/${encodeURIComponent(parsed.brand)}/${encodeURIComponent(parsed.batch)}/${encodeURIComponent(parsed.serial)}${hashSuffix}`,
        );
        return true;
      }
    } catch {
      // Fall through to error message
    }
    setScanError("QR payload does not match /v/:brand/:batch/:serial format");
    return false;
  }

  async function handleStartCamera() {
    setScanError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setScanError("Camera access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setScanAnnouncement("Camera QR scanner started.");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;

      if (BarcodeDetectorCtor && videoRef.current) {
        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
        const interval = setInterval(async () => {
          if (!videoRef.current || !streamRef.current) {
            clearInterval(interval);
            return;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            const firstVal = codes[0]?.rawValue;
            if (firstVal) {
              clearInterval(interval);
              handleStopCamera();
              routeFromQrPayload(firstVal);
            }
          } catch {
            // Continue scanning frames
          }
        }, 400);
      }
    } catch {
      setScanError("Camera permission denied or no camera found. Upload SVG/QR or paste URL below.");
    }
  }

  function handleStopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
    setScanAnnouncement("Camera QR scanner stopped.");
  }

  async function handleSvgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const match = text.match(/data-qr-payload="([^"]+)"/);
    if (match?.[1]) {
      const decoded = match[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      routeFromQrPayload(decoded);
      return;
    }
    setScanError("Uploaded file did not contain a recognizable Veritag QR payload.");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          QR Tag Scanner (Camera, File, or URL)
        </span>
        {!cameraActive ? (
          <button
            type="button"
            onClick={handleStartCamera}
            aria-label="Open camera QR scanner"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            Open Camera Scanner
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopCamera}
            aria-label="Stop camera QR scanner"
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Stop Camera
          </button>
        )}
      </div>

      {cameraActive && (
        <video
          ref={videoRef}
          aria-label="Live QR code camera preview"
          className="h-44 w-full rounded-lg bg-black object-cover"
          muted
          playsInline
        />
      )}

      <div className="flex gap-2">
        <input
          type="text"
          aria-label="QR payload URL"
          placeholder="Paste QR URL (/v/G.../batch/serial#s=...)"
          value={pasteInput}
          onChange={(e) => setPasteInput(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => routeFromQrPayload(pasteInput)}
          aria-label="Parse pasted QR URL"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Parse QR
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
        <span>Or inspect an exported Veritag SVG label:</span>
        <label className="cursor-pointer font-semibold text-blue-700 hover:underline dark:text-blue-400">
          Upload QR SVG
          <input
            type="file"
            accept=".svg,image/svg+xml"
            aria-label="Upload QR SVG label file"
            onChange={handleSvgUpload}
            className="sr-only"
          />
        </label>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {scanAnnouncement}
      </div>

      {scanError && (
        <p role="alert" aria-live="polite" className="text-xs font-medium text-red-700 dark:text-red-400">
          {scanError}
        </p>
      )}
    </div>
  );
}
