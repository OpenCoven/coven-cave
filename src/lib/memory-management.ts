// src/lib/memory-management.ts

/** Best-effort parse of Coven's human-relative timestamps ("5m ago") into
 *  epoch ms. Returns 0 for anything unrecognized so callers can sort it last. */
export function parseRelativeTime(label: string, now = Date.now()): number {
  const t = label.trim().toLowerCase();
  if (t === "just now" || t === "now") return now;
  const m = t.match(/^(\d+)\s*(s|m|h|d|w)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return now - n * unit[m[2]];
}
