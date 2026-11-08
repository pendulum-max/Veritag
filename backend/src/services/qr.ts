import { buildVerifyUrl, generateQrDataUrl, generateQrSvg } from "@veritag/sdk";
import type { BatchUnitProvisionRecord } from "../db/repository.js";
import { decryptSecret } from "./merkle.js";

export interface PrintableUnitRow {
  unitId: string;
  serial: string;
  scratchSecret: string;
  qrUrl: string;
  qrSvg?: string;
  qrDataUrl?: string;
  serialHash: string;
  proof: string[];
}

export function formatPrintableExport(
  units: readonly BatchUnitProvisionRecord[],
  appBaseUrl: string,
  encryptionKeySecret: string,
  includeQrSvg = true,
): PrintableUnitRow[] {
  return units.map((u) => {
    if (!u.encryptedSecret) {
      throw new Error("SecretsAlreadyPurged");
    }
    const scratchSecret = decryptSecret(u.encryptedSecret, encryptionKeySecret);
    const qrUrl = `${buildVerifyUrl(appBaseUrl, u.brand, u.batchId, u.serial)}#s=${encodeURIComponent(scratchSecret)}`;
    return {
      unitId: u.unitId,
      serial: u.serial,
      scratchSecret,
      qrUrl,
      ...(includeQrSvg
        ? {
            qrSvg: generateQrSvg(qrUrl, { label: u.serial }),
            qrDataUrl: generateQrDataUrl(qrUrl, { label: u.serial }),
          }
        : {}),
      serialHash: u.serialHash,
      proof: u.proof,
    };
  });
}

export function toCsvExport(rows: readonly PrintableUnitRow[]): string {
  const header = "unit_id,serial,scratch_secret,qr_url,serial_hash";
  const escapeCsv = (val: string): string =>
    /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;

  const lines = rows.map((r) =>
    [r.unitId, r.serial, r.scratchSecret, r.qrUrl, r.serialHash].map(escapeCsv).join(","),
  );
  return [header, ...lines].join("\n");
}
