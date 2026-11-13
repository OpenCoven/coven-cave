import { normalizeProjectRoot } from "./cave-projects-types.ts";
import { chatProjectRuntimeHost } from "./chat-projects.ts";
import { CHAT_SESSION_STATUS_ORDER, CHAT_SESSION_STATUS } from "./chat-session-status.ts";
import { needsYouItems } from "./needs-you-inbox.ts";
import { SESSION_LIFECYCLE, sessionLifecycle } from "./session-lifecycle.ts";
import type { SessionRow } from "./types.ts";
import type { DaemonStatusPollResult } from "./daemon-status-classification.ts";

export type HomeConnectionObservation = {
  result: Exclude<DaemonStatusPollResult, { kind: "unavailable" }> | { kind: "unavailable" };
  checkedAt: string;
};

/** Home retains classified state and time only, never raw diagnostic text. */
export function homeOverviewConnection(result: DaemonStatusPollResult, checkedAt: string): HomeConnectionObservation {
  switch (result.kind) {
    case "running": return { result: { kind: "running", targetMode: result.targetMode }, checkedAt };
    case "offline": return { result: { kind: "offline", targetMode: "local" }, checkedAt };
    case "transitioning": return { result: { kind: "transitioning", targetMode: "local", state: result.state }, checkedAt };
    case "auth-expired": return { result: { kind: "auth-expired" }, checkedAt };
    case "unavailable": return { result: { kind: "unavailable" }, checkedAt };
  }
}

/** Client observation of the existing scoped list, not execution authority. */
export type HomeOverviewObservation = {
  loaded: boolean;
  error: boolean;
  complete: boolean;
  scopeFamiliarId: string | null | undefined;
  checkedAt: string | null;
  accessDenied?: boolean;
};

export const HOME_OVERVIEW_STALE_MS = 60_000;

export function homeOverviewFreshness(observation: HomeOverviewObservation, scopeFamiliarId: string | null, now: number) {
  if (observation.scopeFamiliarId !== scopeFamiliarId) return "loading";
  if (observation.accessDenied) return "unavailable";
  const checked = observation.checkedAt ? Date.parse(observation.checkedAt) : NaN;
  if (observation.error) return Number.isFinite(checked) ? "stale" : "unavailable";
  if (!observation.loaded) return "loading";
  if (!Number.isFinite(checked)) return "unavailable";
  if (now - checked >= HOME_OVERVIEW_STALE_MS || checked - now > HOME_OVERVIEW_STALE_MS) return "stale";
  return observation.complete ? "current" : "partial";
}

/** The legacy list fallback treats unknown strings as completed. That is not
 * evidence of a completed outcome; this surface explicitly withholds it. */
export function homeOverviewSessionState(row: SessionRow) {
  const reported = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (!(CHAT_SESSION_STATUS_ORDER as readonly string[]).includes(reported)) {
    const attention = needsYouItems([row])[0];
    return { key: "unknown", label: attention ? `${SESSION_LIFECYCLE[attention.lifecycle].label} · execution state unavailable` : "State unavailable", icon: "ph:question" as const };
  }
  if (reported === "queued") return { key: "running", label: CHAT_SESSION_STATUS.queued.label, icon: "ph:clock" as const };
  const lifecycle = sessionLifecycle({ status: row.status, attention: row.attention, archived: Boolean(row.archived_at) });
  const icon = lifecycle === "running" ? "ph:circle-dashed" as const
    : lifecycle === "failed" ? "ph:x-circle" as const
      : lifecycle === "blocked" ? "ph:warning" as const
        : lifecycle === "awaiting" ? "ph:hourglass" as const : "ph:circle" as const;
  return { key: lifecycle, label: SESSION_LIFECYCLE[lifecycle].label, icon };
}

/** Reuses the authorized shell list and canonical attention reducer. No
 * independent ledger, polling, identity inference or committed-effect state. */
export function homeOverviewRows(input: {
  sessions: readonly SessionRow[];
  observation: HomeOverviewObservation;
  dataScopeFamiliarId: string | null | undefined;
  scopeFamiliarId: string | null;
  familiarIds: readonly string[];
  projectRoot: string | null;
}) {
  const empty = { attention: [] as SessionRow[], running: [] as SessionRow[], outcomes: [] as SessionRow[], elsewhere: [] as SessionRow[], unbound: 0 };
  if (input.observation.scopeFamiliarId !== input.scopeFamiliarId || input.dataScopeFamiliarId !== input.scopeFamiliarId || !input.observation.loaded || !input.observation.checkedAt || input.observation.accessDenied) return empty;
  const reachable = input.sessions.filter((row) => !row.archived_at && (!row.generated || row.hasLocalConversation === true));
  const unbound = reachable.filter((row) => !row.familiarId || (input.projectRoot !== null && !row.project_root?.trim())).length;
  const selected = reachable.filter((row) => input.familiarIds.length === 0 || Boolean(row.familiarId && input.familiarIds.includes(row.familiarId)));
  const attention = needsYouItems(selected);
  const byId = new Map(selected.map((row) => [row.id, row]));
  const inProject = (row: SessionRow) => input.projectRoot === null || Boolean(row.project_root?.trim() && chatProjectRuntimeHost(row) === null && normalizeProjectRoot(row.project_root) === normalizeProjectRoot(input.projectRoot));
  const ordered = [...selected].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.id.localeCompare(b.id));
  const attentionIds = new Set(attention.map((row) => row.sessionId));
  return {
    attention: attention.map((item) => byId.get(item.sessionId)!).filter(inProject),
    running: ordered.filter((row) => inProject(row) && !attentionIds.has(row.id) && homeOverviewSessionState(row).key === "running"),
    outcomes: ordered.filter((row) => inProject(row) && !attentionIds.has(row.id) && homeOverviewSessionState(row).key !== "running"),
    elsewhere: attention.map((item) => byId.get(item.sessionId)!).filter((row) => !inProject(row)),
    unbound,
  };
}
