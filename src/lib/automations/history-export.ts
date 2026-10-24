import { parseAutomationHistory } from "./history.ts";

export const AUTOMATION_HISTORY_METADATA_FILENAME = "coven-automation-history-metadata.json";
export const AUTOMATION_HISTORY_METADATA_MAX_BYTES = 65_536;

const eventTypes = new Map([
  ["Definition created", "definition.created"], ["Definition revised", "definition.revised"],
  ["Definition activated", "definition.activated"], ["Definition paused", "definition.paused"],
  ["Definition disabled", "definition.disabled"], ["Definition invalidated", "definition.invalidated"],
  ["Definition removed", "definition.tombstoned"], ["Definition imported", "definition.imported"],
  ["Occurrence changed", "occurrence.transitioned"], ["Run changed", "run.transitioned"],
  ["Attempt changed", "attempt.transitioned"], ["Missed occurrence recorded", "occurrence.misfire_recorded"],
  ["Receipt recorded", "receipt.recorded"], ["History snapshot", "feed.snapshot"],
]);

function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") throw new Error();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error();
  return descriptor.value;
}

/** Copy only data properties so validation and export observe the same values. */
function snapshotPage(value: unknown): unknown {
  const kind = ownValue(value, "kind");
  if (kind !== "available") throw new Error();
  const source = ownValue(value, "entries");
  if (!Array.isArray(source)) throw new Error();
  const length = ownValue(source, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 100) throw new Error();
  const entries = [];
  for (let index = 0; index < length; index++) {
    const entry = ownValue(source, String(index));
    entries.push({ id: ownValue(entry, "id"), sequence: ownValue(entry, "sequence"),
      recordedAt: ownValue(entry, "recordedAt"), label: ownValue(entry, "label"), detail: ownValue(entry, "detail") });
  }
  return { kind, entries, withheld: ownValue(value, "withheld"), checkpoint: ownValue(value, "checkpoint"),
    hasEntries: ownValue(value, "hasEntries"), readAt: ownValue(value, "readAt") };
}

/** Export one validated page of diagnostic metadata without private text or authority claims. */
export function serializeAutomationHistoryMetadata(value: unknown, freshness: "read" | "stale"): string {
  try {
    const page = parseAutomationHistory(snapshotPage(value));
    if (page.kind !== "available" || (freshness !== "read" && freshness !== "stale")) throw new Error();
    const text = JSON.stringify({
      schemaVersion: "cave.automation-history-metadata.v1", source: "cave-history-projection",
      scope: "single-page", completeHistory: false, freshness,
      readAt: new Date(page.readAt).toISOString(), withheld: page.withheld,
      entries: page.entries.map(entry => ({
        id: entry.id, sequence: entry.sequence, recordedAt: new Date(entry.recordedAt).toISOString(),
        type: eventTypes.get(entry.label) ?? "unrecognized",
      })),
    });
    if (new TextEncoder().encode(text).length > AUTOMATION_HISTORY_METADATA_MAX_BYTES) throw new Error();
    return text;
  } catch {
    throw new Error("History metadata is unavailable.");
  }
}
