export interface WarrantyCertificateData {
  unitId: string;
  model: string;
  serial: string;
  brandDomain: string;
  ownerAddress: string;
  txHash?: string;
  contractId?: string;
  issuedAt?: string;
  expiresAt: string;
  warrantyDaysRemaining: number;
  claimsUsed: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Generates parametric Guilloche rosette and border wave SVG paths.
 */
function buildGuillocheSvgPaths(width: number, height: number): string {
  const paths: string[] = [];
  const margin = 28;
  const innerW = width - margin * 2;
  const innerH = height - margin * 2;

  // Top and bottom sinusoidal Guilloche ribbons
  for (const offset of [0, 6]) {
    let topPts = "";
    let botPts = "";
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = margin + t * innerW;
      const wave = Math.sin(t * Math.PI * 24 + offset) * 5 + Math.cos(t * Math.PI * 12) * 2.5;
      const yTop = margin + 12 + wave;
      const yBot = height - margin - 12 - wave;
      topPts += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yTop.toFixed(1)} `;
      botPts += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yBot.toFixed(1)} `;
    }
    const color = offset === 0 ? "#b45309" : "#d97706";
    paths.push(`<path d="${topPts.trim()}" fill="none" stroke="${color}" stroke-width="1" opacity="0.65" />`);
    paths.push(`<path d="${botPts.trim()}" fill="none" stroke="${color}" stroke-width="1" opacity="0.65" />`);
  }

  // Left and right sinusoidal Guilloche ribbons
  for (const offset of [0, 6]) {
    let leftPts = "";
    let rightPts = "";
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = margin + t * innerH;
      const wave = Math.sin(t * Math.PI * 16 + offset) * 5 + Math.cos(t * Math.PI * 8) * 2.5;
      const xLeft = margin + 12 + wave;
      const xRight = width - margin - 12 - wave;
      leftPts += `${i === 0 ? "M" : "L"}${xLeft.toFixed(1)},${y.toFixed(1)} `;
      rightPts += `${i === 0 ? "M" : "L"}${xRight.toFixed(1)},${y.toFixed(1)} `;
    }
    const color = offset === 0 ? "#b45309" : "#d97706";
    paths.push(`<path d="${leftPts.trim()}" fill="none" stroke="${color}" stroke-width="1" opacity="0.65" />`);
    paths.push(`<path d="${rightPts.trim()}" fill="none" stroke="${color}" stroke-width="1" opacity="0.65" />`);
  }

  // Corner spirograph rosettes
  const corners: Array<[number, number]> = [
    [margin + 24, margin + 24],
    [width - margin - 24, margin + 24],
    [margin + 24, height - margin - 24],
    [width - margin - 24, height - margin - 24],
  ];
  for (const [cx, cy] of corners) {
    let d = "";
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const r = 13 + 5 * Math.cos(8 * a);
      const px = cx + r * Math.cos(a);
      const py = cy + r * Math.sin(a);
      d += `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)} `;
    }
    paths.push(`<path d="${d.trim()} Z" fill="none" stroke="#92400e" stroke-width="1" opacity="0.75" />`);
  }

  return paths.join("\n    ");
}

/**
 * Renders a high-resolution SVG warranty certificate with Guilloche border patterns.
 */
export function buildCertificateSvg(data: WarrantyCertificateData): string {
  const width = 1200;
  const height = 850;
  const issuedDate = data.issuedAt ?? new Date().toISOString().slice(0, 10);
  const txDisplay = data.txHash ?? "Anchored on Stellar Soroban Mainnet/Testnet";
  const contractDisplay = data.contractId ?? "VeritagRegistry (Soroban)";
  const guilloche = buildGuillocheSvgPaths(width, height);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fdfbf7" />
      <stop offset="100%" stop-color="#f8f4ea" />
    </linearGradient>
    <pattern id="microGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2d9c5" stroke-width="0.6" opacity="0.45" />
    </pattern>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="url(#microGrid)" />

  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#0f172a" stroke-width="3" />
  <rect x="52" y="52" width="${width - 104}" height="${height - 104}" fill="none" stroke="#94a3b8" stroke-width="1.2" />
  ${guilloche}

  <text x="${width / 2}" y="118" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" letter-spacing="5" fill="#92400e">
    VERITAG ON-CHAIN PROVENANCE REGISTRY
  </text>
  <text x="${width / 2}" y="168" text-anchor="middle" font-family="Georgia, serif" font-size="38" font-weight="bold" fill="#0f172a">
    Certificate of Authenticity &amp; Warranty
  </text>
  <line x1="260" y1="190" x2="${width - 260}" y2="190" stroke="#b45309" stroke-width="1.5" />

  <text x="${width / 2}" y="232" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="15" fill="#475569">
    This document certifies cryptographic ownership and active manufacturer warranty coverage for:
  </text>

  <text x="${width / 2}" y="282" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="bold" fill="#0f172a">
    ${escapeXml(data.model)}
  </text>
  <text x="${width / 2}" y="314" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="#1d4ed8">
    Issued by ${escapeXml(data.brandDomain)} · Serial: ${escapeXml(data.serial)}
  </text>

  <rect x="100" y="350" width="${width - 200}" height="285" rx="12" fill="#ffffff" fill-opacity="0.88" stroke="#cbd5e1" stroke-width="1.5" />

  <text x="132" y="390" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" letter-spacing="1.5" fill="#64748b">
    CURRENT OWNER ADDRESS (STELLAR)
  </text>
  <text x="132" y="416" font-family="monospace" font-size="15" font-weight="bold" fill="#0f172a">
    ${escapeXml(data.ownerAddress)}
  </text>

  <text x="132" y="460" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" letter-spacing="1.5" fill="#64748b">
    ON-CHAIN UNIT ID
  </text>
  <text x="132" y="486" font-family="monospace" font-size="14" fill="#0f172a">
    ${escapeXml(data.unitId)}
  </text>

  <text x="132" y="530" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" letter-spacing="1.5" fill="#64748b">
    STELLAR TRANSACTION HASH
  </text>
  <text x="132" y="556" font-family="monospace" font-size="14" fill="#0f172a">
    ${escapeXml(txDisplay)}
  </text>

  <text x="132" y="600" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" letter-spacing="1.5" fill="#64748b">
    WARRANTY EXPIRATION DATE
  </text>
  <text x="132" y="622" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#047857">
    ${escapeXml(data.expiresAt)} (${data.warrantyDaysRemaining} days remaining · ${data.claimsUsed} claims used)
  </text>

  <text x="100" y="700" font-family="system-ui, sans-serif" font-size="12" fill="#64748b">
    Registry Contract: ${escapeXml(contractDisplay)}
  </text>
  <text x="100" y="722" font-family="system-ui, sans-serif" font-size="12" fill="#64748b">
    Certificate Generated: ${escapeXml(issuedDate)}
  </text>

  <circle cx="${width - 175}" cy="705" r="46" fill="none" stroke="#92400e" stroke-width="2" />
  <circle cx="${width - 175}" cy="705" r="39" fill="none" stroke="#b45309" stroke-width="1" stroke-dasharray="4 3" />
  <text x="${width - 175}" y="701" text-anchor="middle" font-family="Georgia, serif" font-size="12" font-weight="bold" fill="#92400e">
    VERIFIED
  </text>
  <text x="${width - 175}" y="718" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-weight="bold" fill="#0f172a">
    SOROBAN
  </text>
</svg>`;
}

/**
 * Generates a pure vector PDF (PDF 1.4, landscape A4) with Guilloche vector borders.
 */
export function buildCertificatePdfBytes(data: WarrantyCertificateData): Uint8Array {
  const pageW = 841.89;
  const pageH = 595.28;
  const issuedDate = data.issuedAt ?? new Date().toISOString().slice(0, 10);
  const txDisplay = data.txHash ?? "Anchored on Stellar Soroban";
  const contractDisplay = data.contractId ?? "VeritagRegistry";

  const commands: string[] = [];

  // Cream background
  commands.push("0.992 0.984 0.969 rg");
  commands.push(`0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)} re f`);

  // Outer navy border & inner slate border
  commands.push("0.059 0.090 0.165 RG 2.2 w");
  commands.push(`20 20 ${(pageW - 40).toFixed(2)} ${(pageH - 40).toFixed(2)} re S`);
  commands.push("0.580 0.639 0.722 RG 0.9 w");
  commands.push(`42 42 ${(pageW - 84).toFixed(2)} ${(pageH - 84).toFixed(2)} re S`);

  // Vector Guilloche border waves (top/bottom & left/right)
  commands.push("0.706 0.325 0.035 RG 0.75 w");
  const margin = 26;
  const steps = 140;
  for (const phase of [0, 2.2]) {
    let topCmd = "";
    let botCmd = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = margin + t * (pageW - margin * 2);
      const wave = Math.sin(t * Math.PI * 22 + phase) * 4 + Math.cos(t * Math.PI * 11) * 1.8;
      const yTop = pageH - margin - 7 + wave;
      const yBot = margin + 7 - wave;
      topCmd += `${x.toFixed(2)} ${yTop.toFixed(2)} ${i === 0 ? "m" : "l"} `;
      botCmd += `${x.toFixed(2)} ${yBot.toFixed(2)} ${i === 0 ? "m" : "l"} `;
    }
    commands.push(`${topCmd}S`);
    commands.push(`${botCmd}S`);
  }

  // Details card border
  commands.push("1 1 1 rg 0.796 0.835 0.882 RG 1 w");
  commands.push("72 145 697.89 205 re B");

  // Typography
  commands.push("BT");
  commands.push("/F2 11 Tf 0.573 0.251 0.055 rg 245 520 Td (VERITAG ON-CHAIN PROVENANCE REGISTRY) Tj");
  commands.push("ET");

  commands.push("BT");
  commands.push("/F2 26 Tf 0.059 0.090 0.165 rg 175 480 Td (Certificate of Authenticity & Warranty) Tj");
  commands.push("ET");

  commands.push("BT");
  commands.push(`/F2 19 Tf 0.059 0.090 0.165 rg 120 422 Td (${escapePdfText(data.model)}) Tj`);
  commands.push("ET");

  commands.push("BT");
  commands.push(
    `/F1 12 Tf 0.114 0.306 0.847 rg 120 398 Td (${escapePdfText(
      `Brand: ${data.brandDomain}   |   Serial: ${data.serial}`,
    )}) Tj`,
  );
  commands.push("ET");

  const fields: Array<[string, string, number]> = [
    ["OWNER ADDRESS (STELLAR):", data.ownerAddress, 322],
    ["ON-CHAIN UNIT ID:", data.unitId, 278],
    ["STELLAR TRANSACTION HASH:", txDisplay, 234],
    [
      "WARRANTY EXPIRATION:",
      `${data.expiresAt} (${data.warrantyDaysRemaining} days remaining, ${data.claimsUsed} claims used)`,
      190,
    ],
  ];

  for (const [label, val, y] of fields) {
    commands.push("BT");
    commands.push(`/F2 9 Tf 0.392 0.455 0.545 rg 92 ${y} Td (${escapePdfText(label)}) Tj`);
    commands.push("ET");
    commands.push("BT");
    commands.push(`/F3 10.5 Tf 0.059 0.090 0.165 rg 92 ${y - 16} Td (${escapePdfText(val)}) Tj`);
    commands.push("ET");
  }

  commands.push("BT");
  commands.push(
    `/F1 9.5 Tf 0.392 0.455 0.545 rg 72 95 Td (${escapePdfText(
      `Contract: ${contractDisplay}   |   Issued: ${issuedDate}`,
    )}) Tj`,
  );
  commands.push("ET");

  const streamBody = commands.join("\n");
  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n",
    "7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/**
 * Exports the warranty certificate as a high-resolution PNG Blob in browser environments.
 */
export async function exportCertificatePng(data: WarrantyCertificateData): Promise<Blob> {
  const svg = buildCertificateSvg(data);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to render certificate SVG for PNG export"));
      el.src = url;
    });

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = 1200 * scale;
    canvas.height = 850 * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context is unavailable");
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, 1200, 850);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas PNG encoding failed"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportCertificatePdf(data: WarrantyCertificateData): Blob {
  const bytes = buildCertificatePdfBytes(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: "application/pdf" });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadCertificatePng(
  data: WarrantyCertificateData,
  filename?: string,
): Promise<void> {
  const blob = await exportCertificatePng(data);
  triggerBlobDownload(blob, filename ?? `veritag-warranty-${data.serial}.png`);
}

export function downloadCertificatePdf(
  data: WarrantyCertificateData,
  filename?: string,
): void {
  const blob = exportCertificatePdf(data);
  triggerBlobDownload(blob, filename ?? `veritag-warranty-${data.serial}.pdf`);
}
