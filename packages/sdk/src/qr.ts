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

export function parseVerifyUri(uriOrUrl: string): ParsedVerifyParams | null {
  const raw = uriOrUrl.trim();
  if (!raw) return null;

  if (raw.startsWith("veritag://")) {
    const rest = raw.slice("veritag://".length).split("?")[0]?.split("#")[0] ?? "";
    const normalizedPath = rest.startsWith("v/") ? `/${rest}` : `/v/${rest}`;
    return parseVerifyPath(normalizedPath);
  }

  if (raw.startsWith("https://") || raw.startsWith("http://")) {
    try {
      const parsed = new URL(raw);
      return parseVerifyPath(parsed.pathname);
    } catch {
      return null;
    }
  }

  return parseVerifyPath(raw);
}
