export type AutomationHistoryEntry = {
  id: string;
  sequence: number;
  recordedAt: string;
  label: string;
  detail: string;
};

export type AutomationHistoryResult = {
  kind: "available";
  entries: AutomationHistoryEntry[];
  withheld: number;
  checkpoint: string;
  hasEntries: boolean;
  readAt: string;
} | { kind: "invalid" | "expired" | "unsupported" | "unavailable" };

/** Validate the bounded browser projection separately from the daemon wire. */
export function parseAutomationHistory(value: unknown): AutomationHistoryResult {
  const unavailable = { kind: "unavailable" as const };
  if (!value || typeof value !== "object" || !("kind" in value)) return unavailable;
  if (value.kind === "invalid" || value.kind === "expired" || value.kind === "unsupported" || value.kind === "unavailable") return { kind: value.kind };
  if (value.kind !== "available") return unavailable;
  const page = value as Record<string, unknown>;
  const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 35 && Number.isFinite(Date.parse(value));
  if (!Array.isArray(page.entries) || page.entries.length > 100 ||
    typeof page.withheld !== "number" || !Number.isSafeInteger(page.withheld) || page.withheld < 0 || page.entries.length + page.withheld > 100 ||
    typeof page.checkpoint !== "string" || !page.checkpoint.isWellFormed() || page.checkpoint.length === 0 || new TextEncoder().encode(page.checkpoint).length > 512 ||
    typeof page.hasEntries !== "boolean" || page.hasEntries !== (page.entries.length + page.withheld > 0) || !timestamp(page.readAt)) return unavailable;
  const entries: AutomationHistoryEntry[] = [];
  const ids = new Set<string>();
  let sequence = -1;
  for (const entry of page.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[A-Za-z0-9]{20,64}$/.test(entry.id) || ids.has(entry.id) ||
      !Number.isSafeInteger(entry.sequence) || entry.sequence <= sequence || !timestamp(entry.recordedAt) ||
      typeof entry.label !== "string" || entry.label.length > 80 || typeof entry.detail !== "string" || entry.detail.length > 200) return unavailable;
    ids.add(entry.id);
    sequence = entry.sequence;
    entries.push({ id: entry.id, sequence: entry.sequence, recordedAt: entry.recordedAt, label: entry.label, detail: entry.detail });
  }
  return { kind: "available", entries, withheld: page.withheld, checkpoint: page.checkpoint, hasEntries: page.hasEntries, readAt: page.readAt };
}
