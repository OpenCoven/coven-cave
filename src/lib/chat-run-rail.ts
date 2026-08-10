// Pure model for the chat run rail — the right-hand instrument column from
// `Coven Cave - Chat Session.html` (cave-w716g).
//
// SCOPE IS DELIBERATELY NARROWER THAN THE FRAME. The frame draws eight panels;
// this builds the four the data actually supports, measured across the whole
// conversation store (1890 conversations, 7755 turns) rather than inferred from
// the types:
//
//   built    TIMELINE, TOOL MIX, DOING NOW, and the done/failed counts
//            — tools[].durationMs is present on 15383/15383 sampled calls.
//   omitted  PLAN and a LEFT counter. The obvious source, ChatTurn.progress[],
//            has the right shape but carries only status "notice" in practice
//            (35/35 entries) — it is a compatibility-diagnostics channel, not
//            an ordered plan. Nothing declares a step total either, so "how
//            many remain" is unknowable mid-run.
//   omitted  CONTEXT WINDOW and COST. Cave's pipeline for both is complete and
//            proven, but only 3 of 7755 turns carry usage/costUsd because the
//            harness adapters do not emit it (cave-0osmn). Rendering them would
//            be two permanently-blank boxes.
//
// The omissions are the point: the same ledger that landed this frame's session
// list refused its per-row step counts because "inventing them would be a row
// that lies". A LEFT counter with no denominator is that row.
//
// Dependency-free apart from the sibling instruments module (itself importless),
// so the derivation is unit-testable under bare node and can never disagree with
// the transcript it annotates.

import {
  THREAD_TOOL_CATEGORIES,
  toolCategory,
  type InstrumentTurn,
  type ThreadToolCategory,
} from "./chat-thread-instruments.ts";

/** One tool call placed on the timeline, in transcript order. */
export type RunRailSegment = {
  id: string;
  category: ThreadToolCategory;
  /** Share of the run's total tool time, 0..1. Zero-duration calls still get a
   *  floor share so a fast call is visible rather than invisible. */
  ratio: number;
  durationMs: number;
  status: "running" | "ok" | "error";
};

/** A legend row: one category that actually occurred. */
export type RunRailMixRow = {
  category: ThreadToolCategory;
  count: number;
  /** Share of total calls, 0..1 — drives the proportional bar. */
  ratio: number;
};

/** The live/last step. Heading mirrors the frame's own three states. */
export type RunRailNow = {
  heading: "Doing now" | "Stopped at" | "Last step";
  name: string;
  /** The command or argument line, when the call carried one. */
  command: string | null;
  durationMs?: number;
};

export type RunRailModel = {
  calls: number;
  done: number;
  failed: number;
  running: number;
  /** Total tool time across the run. */
  totalMs: number;
  segments: RunRailSegment[];
  mix: RunRailMixRow[];
  now: RunRailNow | null;
  /** Age of the conversation, or null when it cannot be computed. */
  openMs: number | null;
};

/** A zero-duration call would otherwise vanish; give it a hairline share so the
 *  timeline reports "this happened" rather than silently dropping it. */
const MIN_SEGMENT_RATIO = 0.01;

/** Commands arrive as raw tool input — often a JSON blob. Pull out the human
 *  line when it is one, and never render an object as "[object Object]". */
export function runRailCommand(input: string | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        // The keys a shell/read/edit call actually uses, in the order a reader
        // would want them. `path` last: a command beats a bare filename.
        for (const key of ["command", "cmd", "script", "query", "pattern", "path", "file_path"]) {
          const value = record[key];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
      }
      return null;
    } catch {
      // Truncated/streaming JSON is common mid-call — fall through and show the
      // raw text rather than nothing.
    }
  }
  return raw;
}

function elapsedMs(createdAt: string | undefined, nowMs: number): number | null {
  if (!createdAt) return null;
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return null;
  const delta = nowMs - started;
  return delta >= 0 ? delta : null;
}

/**
 * Derive the rail from the turns the transcript already renders.
 *
 * `nowMs` and `conversationCreatedAt` are injected rather than read from the
 * clock so the model stays pure and its tests are not time-dependent.
 */
export function runRailModel(
  turns: readonly InstrumentTurn[],
  options: { nowMs: number; conversationCreatedAt?: string },
): RunRailModel {
  const segments: RunRailSegment[] = [];
  const counts = new Map<ThreadToolCategory, number>();
  let done = 0;
  let failed = 0;
  let running = 0;
  let totalMs = 0;
  let liveCall: { name: string; input?: string; durationMs?: number } | null = null;
  let lastCall: { name: string; input?: string; durationMs?: number; error: boolean } | null = null;

  for (const turn of turns) {
    for (const tool of turn.tools ?? []) {
      const category = toolCategory(tool.name);
      const durationMs = Math.max(0, tool.durationMs ?? 0);
      totalMs += durationMs;
      counts.set(category, (counts.get(category) ?? 0) + 1);
      segments.push({ id: tool.id, category, ratio: 0, durationMs, status: tool.status });
      if (tool.status === "running") {
        running += 1;
        // Last running call wins: the newest is the one in flight.
        liveCall = { name: tool.name, input: tool.input, durationMs: tool.durationMs };
      } else if (tool.status === "error") {
        failed += 1;
      } else {
        done += 1;
      }
      lastCall = {
        name: tool.name,
        input: tool.input,
        durationMs: tool.durationMs,
        error: tool.status === "error",
      };
    }
  }

  // Proportional widths, computed once the total is known.
  for (const segment of segments) {
    const share = totalMs > 0 ? segment.durationMs / totalMs : 1 / Math.max(1, segments.length);
    segment.ratio = Math.max(MIN_SEGMENT_RATIO, share);
  }

  const calls = segments.length;
  const mix: RunRailMixRow[] = THREAD_TOOL_CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0).map(
    (category) => {
      const count = counts.get(category) ?? 0;
      return { category, count, ratio: calls > 0 ? count / calls : 0 };
    },
  );

  // Heading follows the frame: a live call is "Doing now"; otherwise the last
  // call is either where the run stopped or simply the last thing it did.
  let now: RunRailNow | null = null;
  if (liveCall) {
    now = {
      heading: "Doing now",
      name: liveCall.name,
      command: runRailCommand(liveCall.input),
      ...(liveCall.durationMs !== undefined ? { durationMs: liveCall.durationMs } : {}),
    };
  } else if (lastCall) {
    now = {
      heading: lastCall.error ? "Stopped at" : "Last step",
      name: lastCall.name,
      command: runRailCommand(lastCall.input),
      ...(lastCall.durationMs !== undefined ? { durationMs: lastCall.durationMs } : {}),
    };
  }

  return {
    calls,
    done,
    failed,
    running,
    totalMs,
    segments,
    mix,
    now,
    openMs: elapsedMs(options.conversationCreatedAt, options.nowMs),
  };
}

/** Compact duration for the rail's small mono readouts: 820ms, 3.4s, 4m 20s. */
export function runRailDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  // Round BEFORE the minute test, not after: 59.6s rounds to 60, and "60s" is
  // the same defect as the "1m 60s" the next branch guards against — a readout
  // showing a unit's worth of the unit below it.
  if (seconds < 60 && (seconds < 10 || Math.round(seconds) < 60)) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  if (rest === 60) return `${minutes + 1}m`;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes - hours * 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Axis ticks for the timeline — the frame shows five, evenly spaced. */
export function runRailTicks(totalMs: number, count = 5): number[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0 || count < 2) return [];
  return Array.from({ length: count }, (_, i) => Math.round((totalMs * i) / (count - 1)));
}
