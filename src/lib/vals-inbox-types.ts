/**
 * Val's Inbox — humans-only escalation surface. Distinct from the per-familiar
 * reminder inbox in `cave-inbox.ts`. The reminder inbox is "things the familiar
 * scheduled for itself"; this one is "things that need Val's eyes, right now."
 *
 * v1 lives in a JSON file; v2 moves to SQLite + WebSocket fanout per spec.
 * These types are kept in their own file so client components can import them
 * without dragging server-only `node:fs` deps into the browser bundle.
 */

export type EscalationOrigin =
  | "chat"
  | "mention"
  | "board"
  | "cron"
  | "heartbeat"
  | "call"
  | "gateway"
  | "task";

export type EscalationSeverity = "info" | "warn" | "critical";

export type EscalationState =
  | "new"
  | "acknowledged"
  | "snoozed"
  | "resolved"
  | "dismissed";

export type EscalationAction = {
  id: string;
  label: string;
  /** `link` opens `target` in a new tab; `rpc` POSTs to `target`. */
  kind: "link" | "rpc";
  target: string;
};

export type Escalation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  origin: EscalationOrigin;
  sourceSessionKey?: string;
  sourceUrl?: string;
  fromFamiliar?: string;
  aboutFamiliar?: string;
  title: string;
  excerpt?: string;
  severity: EscalationSeverity;
  /** Required when a familiar self-tags `critical`. */
  severityReason?: string;
  state: EscalationState;
  snoozeUntil?: string;
  decisionRequired: boolean;
  resolvedAt?: string;
  actions?: EscalationAction[];
  metadata?: Record<string, unknown>;
};

export const SEVERITIES: EscalationSeverity[] = ["critical", "warn", "info"];
export const ESCALATION_STATES: EscalationState[] = [
  "new",
  "acknowledged",
  "snoozed",
  "resolved",
  "dismissed",
];

/** 30-day rolling expiry for resolved items per spec section 3.4. */
export const RESOLVED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export type SnoozePresetId = "1h" | "4h" | "tomorrow" | "thisWeek";

export const SNOOZE_PRESETS: { id: SnoozePresetId; label: string }[] = [
  { id: "1h", label: "1 hour" },
  { id: "4h", label: "4 hours" },
  { id: "tomorrow", label: "Tomorrow 9am" },
  { id: "thisWeek", label: "This week (Mon 9am)" },
];

/** Pure helper — no Date.now() dependency on import so tests can pass `now`. */
export function snoozePresetToTimestamp(
  preset: SnoozePresetId,
  now: Date = new Date(),
): string {
  const d = new Date(now);
  switch (preset) {
    case "1h":
      d.setHours(d.getHours() + 1);
      return d.toISOString();
    case "4h":
      d.setHours(d.getHours() + 4);
      return d.toISOString();
    case "tomorrow": {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    case "thisWeek": {
      // Move to next Monday 9am. If today is Mon, jump 7d forward.
      const day = d.getDay(); // 0 Sun .. 6 Sat
      const daysUntilMon = day === 1 ? 7 : (8 - day) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMon);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

const SEVERITY_RANK: Record<EscalationSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/**
 * Spec section 6: unresolved + critical first, then warn, info; newest within
 * severity. Snoozed are not in the list at all (filtered upstream).
 */
export function sortEscalations(items: Escalation[]): Escalation[] {
  return [...items].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
