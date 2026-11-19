export interface ParsedVerifyParams {
  brand: string;
  batch: string;
  serial: string;
}

export function buildVerifyUrl(
  appBaseUrl: string,
  brand: string,
  batch: string,
  serial: string,
): string {
  const trimmedBase = appBaseUrl.replace(/\/+$/, "");
  return `${trimmedBase}/v/${encodeURIComponent(brand)}/${encodeURIComponent(batch)}/${encodeURIComponent(serial)}`;
}

export function parseVerifyPath(pathname: string): ParsedVerifyParams | null {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? "";
  const match = /^\/v\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(clean);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    brand: decodeURIComponent(match[1]),
    batch: decodeURIComponent(match[2]),
    serial: decodeURIComponent(match[3]),
  };
}

export interface QrPayload {
  brand: string;
  batch: string;
  serial: string;
  secret?: string;
}

const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function encodeBase45(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = (bytes[i]! << 8) + bytes[i + 1]!;
      const c = n % 45;
      const d = Math.floor(n / 45) % 45;
      const e = Math.floor(n / (45 * 45));
      out += BASE45_CHARSET[c]! + BASE45_CHARSET[d]! + BASE45_CHARSET[e]!;
    } else {
      const n = bytes[i]!;
      const c = n % 45;
      const d = Math.floor(n / 45);
      out += BASE45_CHARSET[c]! + BASE45_CHARSET[d]!;
    }
  }
  return out;
}

function encodeCborText(str: string): number[] {
  const utf8 = new TextEncoder().encode(str);
  const len = utf8.length;
  const header = len < 24 ? [0x60 | len] : [0x78, len];
  return [...header, ...utf8];
}

export function encodeCompactQrPayload(payload: QrPayload): string {
  const entries: Array<[string, string]> = [
    ["b", payload.brand],
    ["t", payload.batch],
    ["s", payload.serial],
  ];
  if (payload.secret !== undefined) {
    entries.push(["k", payload.secret]);
  }
  const cborBytes: number[] = [0xa0 | entries.length];
  for (const [k, v] of entries) {
    cborBytes.push(...encodeCborText(k), ...encodeCborText(v));
  }
  return encodeBase45(Uint8Array.from(cborBytes));
}
