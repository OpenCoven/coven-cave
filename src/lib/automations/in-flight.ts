// What each automation is doing right now, for the overview rows (#5217).
//
// Coven's scheduler answers four inspection views across every automation:
// occurrences that need recovery, that are running, that are claimed, and that
// are due. Cave reads each view once per refresh (four reads, whatever the
// number of rows) and keeps, per automation, only the most urgent state, how
// many occurrences are in it, and the oldest slot. Free-text reasons, leases
// and digests stay in the daemon.
//
// Each state keeps its own label: "Recovery required", "Running", "Claimed"
// and "Due" are different facts, and a row never folds them into one spinner.
// An automation absent from every view has nothing in flight. That holds only
// while the read is live and complete, so stale, truncated and failed reads
// say so.
//
// Client-safe: no node imports.

import { AUTOMATION_ID_PATTERN, LIFECYCLE_STALE_AFTER_MS } from "./lifecycle.ts";

/** Most urgent first: a row shows the first state it has an occurrence in. */
export const IN_FLIGHT_VIEWS = ["recovery_required", "running", "claimed", "due"] as const;
export type InFlightState = typeof IN_FLIGHT_VIEWS[number];

/** Coven bounds each inspection view at 100 occurrences. */
export const IN_FLIGHT_VIEW_LIMIT = 100;
const MAX_AUTOMATIONS = IN_FLIGHT_VIEWS.length * IN_FLIGHT_VIEW_LIMIT;

export type InFlightEntry = {
  state: InFlightState;
  /** Occurrences of this automation in that state. */
  count: number;
  /** The oldest scheduled slot among them. */
  since: string;
  /** Every one of them was started by Run now rather than the schedule. */
  manual: boolean;
};

export type InFlightOverview =
  | {
    kind: "available";
    readAt: string;
    byAutomation: Record<string, InFlightEntry>;
    /** Views that returned Coven's full bound, so more may exist than shown. */
    truncated: InFlightState[];
  }
  | { kind: "unsupported" | "unavailable" };

export type InFlightCache = {
  lastGood: Extract<InFlightOverview, { kind: "available" }> | null;
  latest: InFlightOverview["kind"] | null;
};

export type InFlightView = {
  entry: InFlightEntry | null;
  freshness: "live" | "stale" | "checking" | "unavailable" | "unsupported";
};

const LABEL: Record<InFlightState, string> = {
  recovery_required: "Recovery required",
  running: "Running",
  claimed: "Claimed",
  due: "Due",
};

export function inFlightLabel(entry: InFlightEntry): string {
  return entry.count > 1 ? `${LABEL[entry.state]} · ${entry.count}` : LABEL[entry.state];
}

/** A row's state with its freshness folded in, as plain text. Null when there is nothing to show. */
export function inFlightRowText(view: InFlightView): string | null {
  if (!view.entry) return null;
  return view.freshness === "live" ? inFlightLabel(view.entry) : `${inFlightLabel(view.entry)} · stale`;
}

/** The longer explanation, for a tooltip or a screen reader. */
export function inFlightDescription(entry: InFlightEntry, formatTime: (iso: string) => string): string {
  const what = entry.count > 1 ? `${entry.count} occurrences` : entry.manual ? "A Run now occurrence" : "An occurrence";
  const verb = entry.count > 1 ? "are" : "is";
  const state = LABEL[entry.state].toLowerCase();
  return `${what} ${verb} ${state} in Coven, the oldest for ${formatTime(entry.since)}.`;
}

/**
 * One sentence for the list when the read cannot be trusted to say what is
 * running. Null while it is live and complete.
 */
export function inFlightNote(cache: InFlightCache, nowMs: number, formatTime: (iso: string) => string): string | null {
  if (cache.latest === "unsupported") return "This daemon doesn't report occurrences, so rows don't show what is running.";
  if (cache.latest === "unavailable") {
    return cache.lastGood
      ? `Couldn't re-read what is running. Row states are from ${formatTime(cache.lastGood.readAt)} and may be out of date.`
      : "Couldn't read what is running from Coven, so rows don't show it.";
  }
  if (!cache.lastGood) return null;
  if (nowMs - Date.parse(cache.lastGood.readAt) > LIFECYCLE_STALE_AFTER_MS) {
    return `Row states were read at ${formatTime(cache.lastGood.readAt)} and may be out of date.`;
  }
  if (cache.lastGood.truncated.length > 0) {
    return `Coven reported its limit of ${IN_FLIGHT_VIEW_LIMIT} for ${cache.lastGood.truncated.map((state) => LABEL[state].toLowerCase()).join(", ")} occurrences; some rows may not show theirs.`;
  }
  return null;
}

export function inFlightView(cache: InFlightCache, id: string, nowMs: number): InFlightView {
  if (!cache.lastGood) {
    const freshness = cache.latest === "unsupported" ? "unsupported" : cache.latest === "unavailable" ? "unavailable" : "checking";
    return { entry: null, freshness };
  }
  const stale = cache.latest !== "available" || nowMs - Date.parse(cache.lastGood.readAt) > LIFECYCLE_STALE_AFTER_MS;
  return { entry: cache.lastGood.byAutomation[id] ?? null, freshness: stale ? "stale" : "live" };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function instant(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * Fold the four views into one entry per automation. `views` maps each state
 * to the occurrences Coven listed for it. Undefined when an occurrence lacks
 * the fields the overview relies on: the read fails rather than misreporting a
 * row.
 */
export function foldInFlight(views: Record<InFlightState, readonly unknown[]>): { byAutomation: Record<string, InFlightEntry>; truncated: InFlightState[] } | undefined {
  const byAutomation: Record<string, InFlightEntry> = {};
  const truncated: InFlightState[] = [];
  for (const state of IN_FLIGHT_VIEWS) {
    const occurrences = views[state];
    if (occurrences.length >= IN_FLIGHT_VIEW_LIMIT) truncated.push(state);
    for (const occurrence of occurrences) {
      if (!record(occurrence) || typeof occurrence.automationId !== "string" || !AUTOMATION_ID_PATTERN.test(occurrence.automationId)) return undefined;
      const since = instant(occurrence.scheduledFor);
      if (!since) return undefined;
      const id = occurrence.automationId;
      const manual = occurrence.kind === "manual";
      const existing = byAutomation[id];
      // A more urgent view was folded first; a later one never replaces it.
      if (existing && existing.state !== state) continue;
      byAutomation[id] = existing
        ? { state, count: existing.count + 1, since: since < existing.since ? since : existing.since, manual: existing.manual && manual }
        : { state, count: 1, since, manual };
    }
  }
  return { byAutomation, truncated };
}

/** Validate Cave's overview answer before rendering; anything unexpected reads as unavailable. */
export function parseInFlightOverview(value: unknown): InFlightOverview {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  if (value.kind === "unsupported" || value.kind === "unavailable") return { kind: value.kind };
  if (value.kind !== "available" || !instant(value.readAt) || !record(value.byAutomation) || !Array.isArray(value.truncated)) return unavailable;
  const entries = Object.entries(value.byAutomation);
  if (entries.length > MAX_AUTOMATIONS) return unavailable;
  const byAutomation: Record<string, InFlightEntry> = {};
  for (const [id, entry] of entries) {
    if (!AUTOMATION_ID_PATTERN.test(id) || !record(entry) || !(IN_FLIGHT_VIEWS as readonly unknown[]).includes(entry.state) ||
      typeof entry.count !== "number" || !Number.isSafeInteger(entry.count) || entry.count < 1 || entry.count > IN_FLIGHT_VIEW_LIMIT ||
      !instant(entry.since) || typeof entry.manual !== "boolean") return unavailable;
    byAutomation[id] = { state: entry.state as InFlightState, count: entry.count, since: instant(entry.since)!, manual: entry.manual };
  }
  const truncated = value.truncated.filter((state): state is InFlightState => (IN_FLIGHT_VIEWS as readonly unknown[]).includes(state));
  if (truncated.length !== value.truncated.length) return unavailable;
  return { kind: "available", readAt: value.readAt as string, byAutomation, truncated };
}
