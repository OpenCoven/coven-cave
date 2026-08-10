/**
 * Coven runs — the model behind the redesigned group-chat surface.
 *
 * One human message starts a **run**, and everything that message causes is
 * grouped under it. Before this, orchestration state lived in prose scattered
 * around the page ("Waiting for Cody…", "3 familiars · Echo leads next") and a
 * queued familiar rendered as a pseudo-message indistinguishable from one that
 * was actually generating — three "replying" rows could mean one active agent.
 *
 * Two rules carry the whole redesign, and both live here rather than in the
 * view so they can be tested without a DOM:
 *
 * 1. **A familiar enters the transcript only once it produces output.** Queued
 *    familiars exist in the run header's stepper, never as an empty section.
 * 2. **Status is one vocabulary**, reused by the stepper, the section chips and
 *    the rail. Every state pairs an icon and a label with its tone, so colour
 *    is never the only channel (WCAG 1.4.1).
 */

import type { IconName } from "./icon.tsx";
import type {
  CovenResponseMode,
  GroupReply,
  GroupUserTurn,
} from "./group-chat.ts";
import { groupChatTranscriptThreads, type GroupChatThread } from "./group-chat-transcript.ts";
import type { GroupTurn } from "./group-chat.ts";

/**
 * The run-level state of one familiar's turn.
 *
 * Wider than {@link GroupReply.status}, which collapses several distinct
 * readings into `"streaming"` (thinking / running a tool / actually emitting
 * prose) and into `"error"` (the model failed / you stopped it / it never ran).
 */
export type CovenAgentRunStatus =
  | "queued"
  | "thinking"
  | "tool"
  | "streaming"
  | "complete"
  | "failed"
  | "stopped"
  | "skipped";

/** Semantic tone. Maps to one solid token; tints derive via `color-mix`. */
export type CovenStatusTone = "muted" | "accent" | "success" | "warning" | "danger";

export type CovenStatusMeta = {
  label: string;
  icon: IconName;
  tone: CovenStatusTone;
  /** True while the familiar is genuinely working — the only states that animate. */
  live: boolean;
};

/**
 * The single status vocabulary (design proposal §3). Motion is limited to the
 * genuinely-live states, and every entry carries a label so a screen reader and
 * a greyscale display read the same thing the colour does.
 */
export const COVEN_RUN_STATUS: Record<CovenAgentRunStatus, CovenStatusMeta> = {
  queued: { label: "Queued", icon: "ph:clock", tone: "muted", live: false },
  thinking: { label: "Thinking", icon: "ph:dots-three", tone: "accent", live: true },
  tool: { label: "Using tool", icon: "ph:wrench", tone: "accent", live: true },
  streaming: { label: "Streaming", icon: "ph:waveform", tone: "accent", live: true },
  complete: { label: "Complete", icon: "ph:check", tone: "success", live: false },
  failed: { label: "Failed", icon: "ph:warning", tone: "danger", live: false },
  stopped: { label: "Stopped", icon: "ph:stop-fill", tone: "muted", live: false },
  skipped: { label: "Skipped", icon: "ph:skip-forward-fill", tone: "muted", live: false },
};

/** Statuses that mean the familiar is working right now. */
export function isCovenAgentLive(status: CovenAgentRunStatus): boolean {
  return COVEN_RUN_STATUS[status].live;
}

/** Widen a persisted reply into the run vocabulary above. */
export function covenAgentRunStatus(reply: GroupReply): CovenAgentRunStatus {
  if (reply.status === "queued") return "queued";
  if (reply.status === "done") return reply.outcome === "stopped" ? "stopped" : "complete";
  if (reply.status === "error") {
    // An operator-ended turn is not a failure. `outcome` records which; a
    // cancelled turn from before that field existed is read by whether any text
    // survived — text means it was interrupted, silence means it never ran.
    if (reply.outcome) return reply.outcome;
    if (reply.error === "cancelled") return reply.text.trim() ? "stopped" : "skipped";
    return "failed";
  }
  // Streaming: prose wins over any stale activity label, because visible text
  // is the least ambiguous evidence of what the familiar is doing.
  if (reply.text.trim()) return "streaming";
  if (reply.activityKind === "tool") return "tool";
  return "thinking";
}

/** Whether this familiar has produced anything worth a transcript section. */
export function hasCovenAgentStarted(reply: GroupReply): boolean {
  const status = covenAgentRunStatus(reply);
  if (status === "queued") return false;
  // A skipped familiar never ran; showing an empty section for it would be the
  // pseudo-message this redesign exists to remove. It stays in the stepper.
  if (status === "skipped") return false;
  return true;
}

export type CovenRunCounts = {
  total: number;
  complete: number;
  failed: number;
  stopped: number;
  skipped: number;
  /** Thinking + using a tool + streaming. */
  active: number;
  queued: number;
};

export type CovenRunSummary = {
  title: string;
  meta: string;
  tone: CovenStatusTone;
  icon: IconName;
};

export type CovenRunAgent = {
  reply: GroupReply;
  familiarId: string;
  status: CovenAgentRunStatus;
  /** Position in the rotation, 1-based. Round robin only. */
  position: number;
  started: boolean;
};

export type CovenRun = {
  id: string;
  user: GroupUserTurn;
  mode: CovenResponseMode;
  agents: CovenRunAgent[];
  /** Only the agents that have produced output — the transcript's sections. */
  started: CovenRunAgent[];
  counts: CovenRunCounts;
  /** A run is active while any familiar is queued or working. */
  active: boolean;
  /** Set once every familiar has settled and at least one had a turn. */
  summary: CovenRunSummary | null;
};

const LIVE_STATUSES: readonly CovenAgentRunStatus[] = ["thinking", "tool", "streaming"];

function countAgents(agents: readonly CovenRunAgent[]): CovenRunCounts {
  const counts: CovenRunCounts = {
    total: agents.length,
    complete: 0,
    failed: 0,
    stopped: 0,
    skipped: 0,
    active: 0,
    queued: 0,
  };
  for (const agent of agents) {
    if (LIVE_STATUSES.includes(agent.status)) counts.active += 1;
    else if (agent.status === "queued") counts.queued += 1;
    else if (agent.status === "complete") counts.complete += 1;
    else if (agent.status === "failed") counts.failed += 1;
    else if (agent.status === "stopped") counts.stopped += 1;
    else if (agent.status === "skipped") counts.skipped += 1;
  }
  return counts;
}

/** `2m 14s` / `58s` — a settled run's wall time, never a live ticker. */
export function formatCovenDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function covenModeLabel(mode: CovenResponseMode): string {
  return mode === "broadcast" ? "Broadcast" : "Round robin";
}

export function covenModeIcon(mode: CovenResponseMode): IconName {
  return mode === "broadcast" ? "ph:broadcast" : "ph:arrows-clockwise";
}

/**
 * Wall time from the first reply created to the last one that settled.
 *
 * Derived from the persisted timestamps rather than a wall clock, so a reload
 * reports the same duration the run reported when it finished.
 */
export function covenRunElapsedMs(replies: readonly GroupReply[]): number {
  if (replies.length === 0) return 0;
  const starts = replies.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite);
  if (starts.length === 0) return 0;
  const start = Math.min(...starts);
  // `durationMs` is per-reply model time; in a rotation the turns are
  // sequential, so the run's span is the last turn's end, not their sum.
  const ends = replies.map((r) => {
    const created = Date.parse(r.createdAt);
    if (!Number.isFinite(created)) return start;
    return created + (r.durationMs ?? 0);
  });
  return Math.max(0, Math.max(...ends) - start);
}

function buildSummary(
  mode: CovenResponseMode,
  counts: CovenRunCounts,
  elapsedMs: number,
): CovenRunSummary {
  const bits = [`${counts.complete} of ${counts.total} complete`];
  if (counts.failed) bits.push(`${counts.failed} failed`);
  if (counts.stopped) bits.push(`${counts.stopped} stopped`);
  if (counts.skipped) bits.push(`${counts.skipped} skipped`);
  const ended = counts.stopped > 0 || counts.skipped > 0;
  const title = counts.failed
    ? "Run complete — with failures"
    : ended
      ? "Run stopped"
      : "Run complete";
  const tone: CovenStatusTone = counts.failed ? "warning" : ended ? "muted" : "success";
  return {
    title,
    tone,
    icon: counts.failed ? "ph:warning" : ended ? "ph:stop-fill" : "ph:check",
    meta: [covenModeLabel(mode), ...bits, formatCovenDuration(elapsedMs)].join(" · "),
  };
}

/**
 * Group a coven transcript into runs.
 *
 * `mode` falls back to the coven's current setting for turns persisted before
 * the per-turn snapshot existed — reporting a historical run under today's mode
 * would relabel history every time the toggle moves.
 */
export function buildCovenRuns(
  turns: readonly GroupTurn[],
  opts: { fallbackMode: CovenResponseMode },
): CovenRun[] {
  return groupChatTranscriptThreads(turns).map((thread) =>
    buildCovenRunFromThread(thread, opts),
  );
}

export function buildCovenRunFromThread(
  thread: GroupChatThread,
  opts: { fallbackMode: CovenResponseMode },
): CovenRun {
  const mode = thread.user.responseMode ?? opts.fallbackMode;
  const agents: CovenRunAgent[] = thread.replies.map((reply, index) => {
    const status = covenAgentRunStatus(reply);
    return {
      reply,
      familiarId: reply.familiarId,
      status,
      position: index + 1,
      started: hasCovenAgentStarted(reply),
    };
  });
  const counts = countAgents(agents);
  const active = counts.active > 0 || counts.queued > 0;
  // A run with no replies at all is a user turn whose targets all left the
  // coven; it gets no summary rather than a "0 of 0 complete" epitaph.
  const settled = !active && agents.length > 0;
  return {
    id: thread.user.id,
    user: thread.user,
    mode,
    agents,
    started: agents.filter((agent) => agent.started),
    counts,
    active,
    summary: settled ? buildSummary(mode, counts, covenRunElapsedMs(thread.replies)) : null,
  };
}

/**
 * The run header's progress line — "Round 1 · 1 of 3 complete".
 *
 * Round robin counts completion against the rotation because the reader is
 * waiting on a queue; broadcast counts what is active because nobody is
 * waiting on anybody.
 */
export function covenRunProgressLabel(run: CovenRun, opts?: { paused?: boolean }): string {
  if (!run.active) return "";
  const { counts } = run;
  if (run.mode === "round-robin") {
    const paused = opts?.paused ? " · paused" : "";
    return `Round 1 · ${counts.complete} of ${counts.total} complete${paused}`;
  }
  const failed = counts.failed ? ` · ${counts.failed} failed` : "";
  return `${counts.active} active${failed} · ${counts.complete} of ${counts.total} done`;
}

/**
 * The rail's one status line per coven (design proposal §11). One line, an icon
 * and a label — never a dashboard.
 */
export type CovenRailStatus = {
  text: string;
  icon: IconName | null;
  tone: CovenStatusTone;
  live: boolean;
};

export function covenRailStatus(args: {
  memberCount: number;
  run: CovenRun | null;
  paused?: boolean;
}): CovenRailStatus {
  const { run } = args;
  const members = `${args.memberCount} familiar${args.memberCount === 1 ? "" : "s"}`;
  if (!run || !run.active) {
    return { text: `${members} · idle`, icon: null, tone: "muted", live: false };
  }
  const { counts } = run;
  if (counts.failed > 0) {
    return {
      text: `${counts.active} active · ${counts.failed} failed`,
      icon: "ph:warning",
      tone: "danger",
      live: false,
    };
  }
  if (args.paused) {
    return {
      text: `Paused · ${counts.complete} of ${counts.total}`,
      icon: "ph:pause-fill",
      tone: "warning",
      live: false,
    };
  }
  return {
    text:
      run.mode === "round-robin"
        ? `Round robin · ${counts.complete} of ${counts.total}`
        : `Broadcast · ${counts.active} active`,
    icon: covenModeIcon(run.mode),
    tone: "accent",
    live: true,
  };
}

/**
 * The status-bar run pill (design proposal §11, second half).
 *
 * Run state has to survive scrolling deep into history, so the status bar
 * carries a compact echo of the run header. It reports only what the run model
 * already derives — no second source of truth, and no state the header does not
 * also show.
 *
 * The elapsed clock is deliberately NOT baked into `label`: a live run's clock
 * ticks, and re-deriving the whole pill once a second would repaint every
 * subscriber. The renderer appends it from `startedAtMs` instead, the same way
 * the run header does, so a reload reports the same number.
 */
export type CovenRunPill = {
  label: string;
  tone: CovenStatusTone;
  icon: IconName;
  /** True only while a familiar is genuinely working — drives the dot's pulse. */
  live: boolean;
  /** Epoch ms of the run's first reply; null once the run has settled. */
  startedAtMs: number | null;
  /** A settled run's final wall time, so the pill can report it without a clock. */
  elapsedMs: number;
};

export function covenRunPill(args: {
  run: CovenRun | null;
  paused?: boolean;
}): CovenRunPill | null {
  const { run } = args;
  if (!run) return null;
  const starts = run.agents
    .map((agent) => Date.parse(agent.reply.createdAt))
    .filter((value) => Number.isFinite(value));
  const startedAtMs = starts.length > 0 ? Math.min(...starts) : null;

  if (!run.active) {
    // A settled run keeps its last word in the bar, matching the summary strip
    // the reader would find if they scrolled back to it.
    if (!run.summary) return null;
    return {
      label: run.summary.title,
      tone: run.summary.tone,
      icon: run.summary.icon,
      live: false,
      startedAtMs: null,
      elapsedMs: covenRunElapsedMs(run.agents.map((agent) => agent.reply)),
    };
  }

  if (run.counts.failed > 0) {
    return {
      label: `${covenModeLabel(run.mode)} — ${run.counts.failed} failed`,
      tone: "danger",
      icon: "ph:warning",
      live: false,
      startedAtMs,
      elapsedMs: 0,
    };
  }
  if (args.paused) {
    return {
      label: "Paused",
      tone: "warning",
      icon: "ph:pause-fill",
      // A paused run is not working, so the dot must not pulse as if it were.
      live: false,
      startedAtMs,
      elapsedMs: 0,
    };
  }
  return {
    label: covenModeLabel(run.mode),
    tone: "accent",
    icon: covenModeIcon(run.mode),
    live: true,
    startedAtMs,
    elapsedMs: 0,
  };
}
