// The browser's view of each automation's canonical lifecycle (#5217).
//
// Coven owns the lifecycle. Cave reads it through the pinned SDK on the server
// (src/lib/server/automation-lifecycle.ts) and re-validates the bounded
// projection here before any surface renders it. Nothing in this module infers
// a lifecycle state: a value the daemon did not report reads as `unknown`, and
// a read that is too old, failed, or never happened says so instead of
// borrowing the legacy routine mirror's `status`.
//
// Client-safe: no node imports.

export type AutomationLifecycleState = "active" | "paused" | "disabled";

export type AutomationLifecycleRecord =
  | { id: string; kind: "present"; state: AutomationLifecycleState; revision: number; timezone: string }
  /** Coven has no definition with this id (deleted, or never created). */
  | { id: string; kind: "absent" }
  /** Coven answered for other ids, but this one could not be read or decoded. */
  | { id: string; kind: "unreadable" };

export type AutomationLifecycleFailure = { kind: "invalid" | "unsupported" | "unavailable" };

export type AutomationLifecycleOverview =
  | { kind: "available"; readAt: string; records: AutomationLifecycleRecord[] }
  | AutomationLifecycleFailure;

/** Health facts Coven reports for one automation. Free-text reasons stay in the daemon. */
export type AutomationHealthView = {
  /** Coven's next scheduled slot. Coven reports one for a paused routine too; it runs only once resumed. */
  nextDueAt: string | null;
  lastPlannedAt: string | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  quarantined: boolean;
};

export type AutomationLifecycleDetail =
  | { kind: "available"; readAt: string; record: AutomationLifecycleRecord; health: AutomationHealthView | null }
  | AutomationLifecycleFailure;

export type AutomationLifecycleCommand = "pause" | "activate";

export type AutomationLifecycleCommandResult =
  /** Coven committed the command now, or had already committed it under the same adoption key. */
  | { kind: "committed"; revision: number; replayed: boolean }
  /** The definition moved on; nothing was applied. */
  | { kind: "conflict"; currentRevision: number | null }
  /** Coven refused the command with a typed `coven.automations.v1` code. */
  | { kind: "rejected"; code: string }
  /** The command may have reached Coven, but no trustworthy answer came back. */
  | { kind: "unknown" }
  | AutomationLifecycleFailure;

/** The SDK's automation-id grammar: 1–96 characters of `[A-Za-z0-9._-]`, starting alphanumeric. */
export const AUTOMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
/** Cave's adoption keys: `cave-` plus a UUID, inside the SDK's 8–200 `[A-Za-z0-9._:-]` grammar. */
export const LIFECYCLE_ADOPTION_KEY_PATTERN = /^cave-[A-Za-z0-9-]{8,120}$/;
/** Ids one overview read covers. A larger list is refused rather than truncated. */
export const LIFECYCLE_MAX_IDS = 100;
/** A lifecycle read older than this is shown as stale and stops authorizing controls. */
export const LIFECYCLE_STALE_AFTER_MS = 60_000;

/** The `coven.automations.v1` error codes the SDK passes through. */
const COMMAND_ERROR_CODES = new Set([
  "SCHEMA_VERSION_UNSUPPORTED", "VALIDATION_FAILED", "ADOPTION_REPLAY_MISMATCH", "REVISION_CONFLICT",
  "NOT_FOUND", "GONE_TOMBSTONED", "CAPABILITY_UNSUPPORTED", "ILLEGAL_TRANSITION", "AUTHORITY_REQUIRED",
  "APPROVAL_REQUIRED", "CANCEL_PENDING", "OVERLAP_FORBIDDEN", "RETRY_DISPOSITION_INVALID",
  "AMBIGUOUS_RETRY_FORBIDDEN", "CURSOR_EXPIRED", "STREAM_OUT_OF_ORDER", "PAYLOAD_TOO_LARGE",
  "DEADLINE_EXCEEDED", "CONCURRENCY_LIMIT", "INTERNAL",
]);

export function newLifecycleAdoptionKey(): string {
  return `cave-${crypto.randomUUID()}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 35 && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function failure(value: Record<string, unknown>): AutomationLifecycleFailure | null {
  return value.kind === "invalid" || value.kind === "unsupported" || value.kind === "unavailable"
    ? { kind: value.kind }
    : null;
}

/** IANA zone names, `UTC`, or Coven's `utc`/`local` spellings; at most 64 characters. */
function zone(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value);
}

function parseRecord(value: unknown): AutomationLifecycleRecord | null {
  if (!record(value) || typeof value.id !== "string" || !AUTOMATION_ID_PATTERN.test(value.id)) return null;
  if (value.kind === "absent" || value.kind === "unreadable") return { id: value.id, kind: value.kind };
  if (value.kind !== "present" || (value.state !== "active" && value.state !== "paused" && value.state !== "disabled") ||
    !revision(value.revision) || !zone(value.timezone)) return null;
  return { id: value.id, kind: "present", state: value.state, revision: value.revision, timezone: value.timezone };
}

/** Validate the bounded browser projection separately from the daemon wire. */
export function parseLifecycleOverview(value: unknown): AutomationLifecycleOverview {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  const failed = failure(value);
  if (failed) return failed;
  if (value.kind !== "available" || !timestamp(value.readAt) || !Array.isArray(value.records) ||
    value.records.length > LIFECYCLE_MAX_IDS) return unavailable;
  const records: AutomationLifecycleRecord[] = [];
  const ids = new Set<string>();
  for (const entry of value.records) {
    const parsed = parseRecord(entry);
    if (!parsed || ids.has(parsed.id)) return unavailable;
    ids.add(parsed.id);
    records.push(parsed);
  }
  return { kind: "available", readAt: value.readAt, records };
}

function parseHealth(value: unknown): AutomationHealthView | null | undefined {
  if (value === null) return null;
  if (!record(value) || !nullableTimestamp(value.nextDueAt) || !nullableTimestamp(value.lastPlannedAt) ||
    !nullableTimestamp(value.lastStartedAt) || !nullableTimestamp(value.lastSuccessAt) ||
    typeof value.consecutiveFailures !== "number" || !Number.isSafeInteger(value.consecutiveFailures) ||
    value.consecutiveFailures < 0 || typeof value.quarantined !== "boolean") return undefined;
  return {
    nextDueAt: value.nextDueAt, lastPlannedAt: value.lastPlannedAt, lastStartedAt: value.lastStartedAt,
    lastSuccessAt: value.lastSuccessAt, consecutiveFailures: value.consecutiveFailures, quarantined: value.quarantined,
  };
}

export function parseLifecycleDetail(value: unknown): AutomationLifecycleDetail {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  const failed = failure(value);
  if (failed) return failed;
  const parsed = parseRecord(value.record);
  const health = parseHealth(value.health);
  if (value.kind !== "available" || !timestamp(value.readAt) || !parsed || health === undefined) return unavailable;
  return { kind: "available", readAt: value.readAt, record: parsed, health };
}

export function parseLifecycleCommandResult(value: unknown): AutomationLifecycleCommandResult {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  const failed = failure(value);
  if (failed) return failed;
  if (value.kind === "committed" && revision(value.revision) && typeof value.replayed === "boolean") {
    return { kind: "committed", revision: value.revision, replayed: value.replayed };
  }
  if (value.kind === "conflict" && (value.currentRevision === null || revision(value.currentRevision))) {
    return { kind: "conflict", currentRevision: value.currentRevision };
  }
  if (value.kind === "rejected" && typeof value.code === "string" && COMMAND_ERROR_CODES.has(value.code)) {
    return { kind: "rejected", code: value.code };
  }
  if (value.kind === "unknown") return { kind: "unknown" };
  return unavailable;
}

export function isLifecycleCommandErrorCode(code: string): boolean {
  return COMMAND_ERROR_CODES.has(code);
}

/**
 * How much the surface can trust what it shows for one automation.
 *
 * - `checking`: the first canonical read has not answered yet.
 * - `live`: read from Coven within {@link LIFECYCLE_STALE_AFTER_MS}.
 * - `stale`: the newest successful read is older than that, or the latest
 *   refresh failed. The last known state is shown with its read time.
 * - `unavailable` / `unsupported`: Coven could not be read, or does not serve
 *   canonical lifecycle reads, and there is no earlier read to fall back on.
 * - `unreadable` / `absent`: Coven answered, but not with a definition for this id.
 */
export type AutomationLifecycleFreshness = "checking" | "live" | "stale" | "unavailable" | "unsupported" | "unreadable" | "absent";

export type AutomationLifecycleView = {
  state: AutomationLifecycleState | "unknown";
  revision: number | null;
  timezone: string | null;
  freshness: AutomationLifecycleFreshness;
  /** When the shown state was read from Coven, if it ever was. */
  readAt: string | null;
};

/** What the browser holds: the newest successful read and the outcome of the latest attempt. */
export type AutomationLifecycleCache = {
  lastGood: Extract<AutomationLifecycleOverview, { kind: "available" }> | null;
  /** `null` until the first attempt settles. */
  latest: AutomationLifecycleOverview["kind"] | null;
};

export function lifecycleView(cache: AutomationLifecycleCache, id: string, nowMs: number): AutomationLifecycleView {
  const known = cache.lastGood?.records.find((entry) => entry.id === id);
  if (!cache.lastGood || !known) {
    const freshness = cache.latest === null ? "checking"
      : cache.latest === "unsupported" ? "unsupported"
      : cache.latest === "available" ? "checking"
      : "unavailable";
    return { state: "unknown", revision: null, timezone: null, freshness, readAt: null };
  }
  const readAt = cache.lastGood.readAt;
  if (known.kind !== "present") {
    return { state: "unknown", revision: null, timezone: null, freshness: known.kind, readAt };
  }
  const fresh = cache.latest === "available" && nowMs - Date.parse(readAt) <= LIFECYCLE_STALE_AFTER_MS;
  return { state: known.state, revision: known.revision, timezone: known.timezone, freshness: fresh ? "live" : "stale", readAt };
}

/** The pause/resume control one automation offers, and why it is withheld when it is. */
export type LifecycleControl =
  | { command: AutomationLifecycleCommand; label: "Pause" | "Resume"; expectedRevision: number; disabledReason: null }
  | { command: AutomationLifecycleCommand | null; label: "Pause" | "Resume"; expectedRevision: null; disabledReason: string };

export function lifecycleControl(view: AutomationLifecycleView): LifecycleControl {
  const label = view.state === "active" ? "Pause" : "Resume";
  const command = view.state === "active" ? "pause" : view.state === "paused" ? "activate" : null;
  if (view.freshness === "live" && command && view.revision !== null) {
    return { command, label, expectedRevision: view.revision, disabledReason: null };
  }
  const disabledReason =
    view.freshness === "checking" ? "Checking the current state with Coven."
    : view.freshness === "stale" ? "Coven's state is out of date here. Refresh before changing it."
    : view.freshness === "unavailable" ? "Coven can't be reached, so the current state can't be verified."
    : view.freshness === "unsupported" ? "This Coven daemon doesn't report automation lifecycle."
    : view.freshness === "absent" ? "Coven has no definition for this automation."
    : view.freshness === "unreadable" ? "Coven's definition for this automation couldn't be read."
    : view.state === "disabled" ? "Disabled automations can't be resumed directly."
    : "The current state can't be verified.";
  return { command, label, expectedRevision: null, disabledReason };
}

/** Short words for the row chip and detail badge. Never color alone. */
export function lifecycleStateLabel(view: AutomationLifecycleView): string {
  if (view.state === "active") return "Active";
  if (view.state === "paused") return "Paused";
  if (view.state === "disabled") return "Disabled";
  if (view.freshness === "checking") return "Checking";
  if (view.freshness === "absent") return "Not in Coven";
  return "Not verified";
}

/** The freshness note a surface shows beside a state, or null when it is live. */
export function lifecycleFreshnessNote(view: AutomationLifecycleView, formatTime: (iso: string) => string): string | null {
  switch (view.freshness) {
    case "live":
    case "checking":
      return null;
    case "stale":
      return view.readAt ? `Last read from Coven ${formatTime(view.readAt)}. It may have changed since.` : "Out of date.";
    case "unavailable":
      return "Coven can't be reached, so this automation's state isn't verified.";
    case "unsupported":
      return "This Coven daemon doesn't report automation lifecycle.";
    case "absent":
      return "Coven has no definition with this id.";
    case "unreadable":
      return "Coven's definition for this automation couldn't be read.";
  }
}

/** Plain-language outcome of a pause/resume command for the live region and error banner. */
export function lifecycleCommandMessage(
  result: AutomationLifecycleCommandResult,
  command: AutomationLifecycleCommand,
  name: string,
): { ok: boolean; message: string } {
  const verb = command === "pause" ? "Paused" : "Resumed";
  switch (result.kind) {
    case "committed":
      return { ok: true, message: `${verb} '${name}' (revision ${result.revision}).` };
    case "conflict":
      return {
        ok: false,
        message: `'${name}' changed in Coven${result.currentRevision ? ` (now revision ${result.currentRevision})` : ""}. Nothing was applied. Review its current state and try again.`,
      };
    case "rejected":
      return {
        ok: false,
        message: result.code === "ILLEGAL_TRANSITION"
          ? `Coven can't ${command === "pause" ? "pause" : "resume"} '${name}' from its current state.`
          : result.code === "NOT_FOUND" || result.code === "GONE_TOMBSTONED"
            ? `Coven has no definition for '${name}' any more.`
            : `Coven refused the change to '${name}' (${result.code}).`,
      };
    case "unknown":
      return { ok: false, message: `Cave couldn't confirm whether '${name}' changed. Its state was re-read from Coven.` };
    case "unsupported":
      return { ok: false, message: "This Coven daemon doesn't accept lifecycle commands." };
    case "invalid":
      return { ok: false, message: "Cave sent an invalid lifecycle command." };
    case "unavailable":
      return { ok: false, message: `Coven can't be reached, so '${name}' was not changed.` };
  }
}
