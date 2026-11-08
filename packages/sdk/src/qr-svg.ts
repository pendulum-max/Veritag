import { Buffer } from "buffer";

export interface QrSvgOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  label?: string;
}

interface VersionSpec {
  version: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocksGroup1: number;
  dataCodewordsGroup1: number;
  numBlocksGroup2: number;
  dataCodewordsGroup2: number;
  alignmentCenters: number[];
}

// ISO/IEC 18004 ECC Level L specifications for Versions 1..14 (up to 458 bytes in Byte Mode)
const VERSION_SPECS_L: VersionSpec[] = [
  { version: 1, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocksGroup1: 1, dataCodewordsGroup1: 19, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [] },
  { version: 2, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocksGroup1: 1, dataCodewordsGroup1: 34, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 18] },
  { version: 3, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocksGroup1: 1, dataCodewordsGroup1: 55, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 22] },
  { version: 4, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocksGroup1: 1, dataCodewordsGroup1: 80, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 26] },
  { version: 5, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocksGroup1: 1, dataCodewordsGroup1: 108, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 30] },
  { version: 6, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 68, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 34] },
  { version: 7, totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocksGroup1: 2, dataCodewordsGroup1: 78, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocksGroup1: 2, dataCodewordsGroup1: 97, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 24, 42] },
  { version: 9, totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocksGroup1: 2, dataCodewordsGroup1: 116, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 26, 46] },
  { version: 10, totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 68, numBlocksGroup2: 2, dataCodewordsGroup2: 69, alignmentCenters: [6, 28, 50] },
  { version: 11, totalCodewords: 404, ecCodewordsPerBlock: 20, numBlocksGroup1: 4, dataCodewordsGroup1: 81, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 30, 54] },
  { version: 12, totalCodewords: 466, ecCodewordsPerBlock: 24, numBlocksGroup1: 2, dataCodewordsGroup1: 92, numBlocksGroup2: 2, dataCodewordsGroup2: 93, alignmentCenters: [6, 32, 58] },
  { version: 13, totalCodewords: 532, ecCodewordsPerBlock: 26, numBlocksGroup1: 4, dataCodewordsGroup1: 107, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 34, 62] },
  { version: 14, totalCodewords: 581, ecCodewordsPerBlock: 30, numBlocksGroup1: 3, dataCodewordsGroup1: 115, numBlocksGroup2: 1, dataCodewordsGroup2: 116, alignmentCenters: [6, 26, 46, 66] },
];

// GF(256) tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255] ?? 0;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i] ?? 1;
    for (let j = 0; j < poly.length; j++) {
      const pj = poly[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ pj;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(pj, root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = (data[i] ?? 0) ^ (rem[0] ?? 0);
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] = (rem[j] ?? 0) ^ gfMul(gen[j + 1] ?? 0, factor);
      }
    }
  }
  return rem;
}

function selectVersion(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS_L) {
    const totalDataCodewords =
      spec.numBlocksGroup1 * spec.dataCodewordsGroup1 +
      spec.numBlocksGroup2 * spec.dataCodewordsGroup2;
    const headerBits = spec.version <= 9 ? 4 + 8 : 4 + 16;
    const maxBytes = Math.floor((totalDataCodewords * 8 - headerBits) / 8);
    if (byteLength <= maxBytes) {
      return spec;
    }
  }
  throw new Error(`QR payload too large (${byteLength} bytes; max supported is 458 bytes)`);
}

function buildDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalDataCodewords =
    spec.numBlocksGroup1 * spec.dataCodewordsGroup1 +
    spec.numBlocksGroup2 * spec.dataCodewordsGroup2;
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const capacityBits = totalDataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(totalDataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | (bits[i + b] ?? 0);
    }
    codewords[byteIdx++] = val;
  }

  const padBytes = [0xec, 0x11] as const;
  let padIdx = 0;
  while (byteIdx < totalDataCodewords) {
    codewords[byteIdx++] = padBytes[padIdx % 2] ?? 0xec;
    padIdx++;
  }
  return codewords;
}

function interleaveCodewords(dataCodewords: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.numBlocksGroup1; i++) {
    const block = dataCodewords.subarray(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.numBlocksGroup2; i++) {
    const block = dataCodewords.subarray(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecCodewordsPerBlock));
  }

  const result = new Uint8Array(spec.totalCodewords);
  let outIdx = 0;
  const maxDataLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  for (let col = 0; col < maxDataLen; col++) {
    for (const block of dataBlocks) {
      if (col < block.length) {
        result[outIdx++] = block[col] ?? 0;
      }
    }
  }
  for (let col = 0; col < spec.ecCodewordsPerBlock; col++) {
    for (const block of ecBlocks) {
      result[outIdx++] = block[col] ?? 0;
    }
  }
  return result;
}

/**
 * Generates a boolean 2D QR matrix (true = dark module) for the given string payload.
 */
export function encodeQrMatrix(payload: string): boolean[][] {
  const bytes = Buffer.from(payload, "utf8");
  const spec = selectVersion(bytes.length);
  const size = spec.version * 4 + 17;

  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    const modRow = modules[r];
    const fnRow = isFunction[r];
    if (modRow && fnRow && c >= 0 && c < size) {
      modRow[c] = dark;
      fnRow[c] = true;
    }
  };

  // Finder patterns + separators
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) {
        continue;
      }
      const cr = centers[i] ?? 0;
      const cc = centers[j] ?? 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // Reserve format info areas & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(8, size - 1 - i, false);
    setFunctionModule(size - 1 - i, 8, false);
  }
  setFunctionModule(size - 8, 8, true);

  // Reserve version info areas for version >= 7
  if (spec.version >= 7) {
    let rem = spec.version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const vBits = (spec.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }

  // Place interleaved data + EC bits in zigzag columns
  const codewords = interleaveCodewords(buildDataCodewords(bytes, spec), spec);
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      const fnRow = isFunction[r];
      const modRow = modules[r];
      if (!fnRow || !modRow) continue;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!fnRow[c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const cw = codewords[bitIdx >>> 3] ?? 0;
            dark = ((cw >>> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) {
            dark = !dark;
          }
          modRow[c] = dark;
        }
      }
    }
  }

  // Write Format Information for ECC Level L (01) + Mask 0 (000) -> data = 0b01000
  const formatData = 0b01000;
  let fRem = formatData;
  for (let i = 0; i < 10; i++) {
    fRem = (fRem << 1) ^ ((fRem >>> 9) * 0x537);
  }
  const formatBits = ((formatData << 10) | fRem) ^ 0x5412;
  const getFormatBit = (idx: number) => ((formatBits >>> idx) & 1) !== 0;

  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getFormatBit(i));
  setFunctionModule(8, 7, getFormatBit(6));
  setFunctionModule(8, 8, getFormatBit(7));
  setFunctionModule(7, 8, getFormatBit(8));
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getFormatBit(i));

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getFormatBit(i));
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getFormatBit(i));
  setFunctionModule(size - 8, 8, true);

  return modules;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Generates a self-contained SVG string for a QR code encoding `payload`.
 */
export function generateQrSvg(payload: string, options: QrSvgOptions = {}): string {
  const matrix = encodeQrMatrix(payload);
  const moduleCount = matrix.length;
  const margin = options.margin ?? 2;
  const size = options.size ?? 256;
  const darkColor = options.darkColor ?? "#0f172a";
  const lightColor = options.lightColor ?? "#ffffff";
  const viewBoxSize = moduleCount + margin * 2;

  let pathData = "";
  for (let r = 0; r < moduleCount; r++) {
    const row = matrix[r];
    if (!row) continue;
    for (let c = 0; c < moduleCount; c++) {
      if (row[c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }

  const escapedPayload = escapeXml(payload);
  const titleTag = options.label ? `<title>${escapeXml(options.label)}</title>` : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" data-qr-payload="${escapedPayload}">`,
    titleTag,
    `<rect width="100%" height="100%" fill="${lightColor}"/>`,
    `<path d="${pathData}" fill="${darkColor}"/>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("");
}

/**
 * Generates a `data:image/svg+xml;base64,...` data URI for embedding in `<img>` or printable sheets.
 */
export function generateQrDataUrl(payload: string, options: QrSvgOptions = {}): string {
  const svg = generateQrSvg(payload, options);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
