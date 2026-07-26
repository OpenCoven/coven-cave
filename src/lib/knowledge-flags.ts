export function knowledgeEntryFlags(entry: { extra?: Record<string, unknown> | null }): string[] {
  const flags = entry.extra?.flags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      if (typeof flag === "string") return flag.trim();
      if (typeof flag === "number" || typeof flag === "boolean" || typeof flag === "bigint") return String(flag);
      return "";
    })
    .filter(Boolean);
}
