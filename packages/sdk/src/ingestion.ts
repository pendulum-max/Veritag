export interface BatchUnitInput {
  serial: string;
  secret: string;
  metadata?: string;
}

export function detectDelimiter(headerLine: string): "," | "\t" {
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

export function parseBatchIngestion(rawInput: string): BatchUnitInput[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : (parsed.units ?? []);
    return items.map((item: Record<string, unknown>) => ({
      serial: String(item.serial ?? "").trim(),
      secret: String(item.secret ?? "").trim(),
      metadata: item.metadata !== undefined ? String(item.metadata) : undefined,
    }));
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const headers = lines[0]!.split(delimiter).map((h) => h.trim().toLowerCase());
  const serialIdx = headers.indexOf("serial");
  const secretIdx = headers.indexOf("secret");
  const metaIdx = headers.indexOf("metadata");

  const startRow = serialIdx !== -1 && secretIdx !== -1 ? 1 : 0;
  return lines.slice(startRow).map((line) => {
    const cols = line.split(delimiter).map((c) => c.trim());
    return {
      serial: cols[serialIdx !== -1 ? serialIdx : 0] ?? "",
      secret: cols[secretIdx !== -1 ? secretIdx : 1] ?? "",
      metadata: metaIdx !== -1 ? cols[metaIdx] : cols[2],
    };
  });
}
