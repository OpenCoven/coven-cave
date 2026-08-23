export function parseMemorySourceContext(text: string): string | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const found = line.match(/^source_context:\s*(.+?)\s*$/);
    if (!found) continue;

    const value = normalizeSourceContext(found[1]);
    if (value) return value;
  }

  return undefined;
}

export function normalizeSourceContext(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}
