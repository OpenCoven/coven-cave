// View-model logic for the Phase 4 weave rail + thread pane (spec:
// coven-threads specs/PHASE-4-CAVE-SURFACES.md §4 rendering rules).
//
// Everything here is pure so the fail-closed rules are testable without a
// DOM: envelopes in, render states out. Components render exactly what this
// module derives — they never re-interpret raw source data.

import {
  isStale,
  type TensionView,
  type ThreadsEnvelope,
  type ThreadsMeta,
  type WeaveDetail,
  type WeaveSummary,
} from "./threads-read.ts";
import type { IconName } from "./icon";

// ---------------------------------------------------------------------------
// Status pills. Every pill traces to a predicate result (evidence-first);
// "blocked" is the fail-closed treatment for anything unverifiable.

export type PillTone = "holds" | "frayed" | "snapped" | "blocked" | "stale";

export type TensionPill = {
  tone: PillTone;
  label: string;
  /** One-line, referent-bound explanation (§5 glossary). */
  detail: string;
  /** Icon token (phosphor name), decorative only. */
  icon: IconName;
};

export function pillForTension(tension: TensionView): TensionPill {
  switch (tension.state) {
    case "holds":
      return {
        tone: "holds",
        label: "Holds",
        detail: "All strands intact — the thread carries its full authority contract.",
        icon: "ph:check-circle",
      };
    case "frayed":
      return {
        tone: "frayed",
        label: "Frayed",
        detail: `One strand failed (${tension.reason.kind}) — repairable; surfaced for your review.`,
        icon: "ph:warning",
      };
    case "snapped":
      return {
        tone: "snapped",
        label: "Snapped",
        detail: `Terminal severance (${tension.reason.kind}) — a fresh authority ceremony is required.`,
        icon: "ph:x-circle",
      };
    case "stale":
      return {
        tone: "stale",
        label: "Stale",
        detail: "This observation is past its freshness window — showing last-known state.",
        icon: "ph:clock-countdown",
      };
    case "unknown":
    default:
      // R1: unknown renders blocked, never healthy-by-default.
      return {
        tone: "blocked",
        label: "Blocked",
        detail: "Cannot verify this thread's tension — treated as blocked until evidence arrives.",
        icon: "ph:shield-slash",
      };
  }
}

export function pillForCoherence(coherence: WeaveSummary["coherence"]): TensionPill {
  switch (coherence) {
    case "coherent":
      return {
        tone: "holds",
        label: "Coherent",
        detail: "The weave's pattern predicate holds across its threads.",
        icon: "ph:check-circle",
      };
    case "degraded":
      return {
        tone: "frayed",
        label: "Degraded",
        detail: "Named surfaces are read-only until repair; the familiar continues elsewhere.",
        icon: "ph:warning",
      };
    case "broken":
      return {
        tone: "snapped",
        label: "Broken",
        detail: "The pattern fundamentally does not hold — no authority can be exercised through it.",
        icon: "ph:x-circle",
      };
    case "unknown":
    default:
      return {
        tone: "blocked",
        label: "Blocked",
        detail: "Cannot verify the predicate's answer — treated as blocked, never healthy.",
        icon: "ph:shield-slash",
      };
  }
}

// ---------------------------------------------------------------------------
// Surface state from an envelope (§3.8/§3.9 + rules R3, R4, R8, R9).

export type SurfaceBanner = {
  kind: "fixture-data" | "stale" | "blocked";
  message: string;
};

export type SurfaceState<T> =
  | { kind: "loading" }
  | { kind: "blocked"; why: string; message: string; meta: ThreadsMeta | null }
  | { kind: "ready"; data: T; meta: ThreadsMeta; banners: SurfaceBanner[] };

const BLOCKED_MESSAGES: Record<string, string> = {
  "daemon-unreachable": "The coven daemon did not answer. Nothing here can be verified right now.",
  "daemon-unavailable": "No daemon is available to verify against.",
  "daemon-endpoint-missing": "The daemon answered but does not expose weave state yet.",
  "daemon-timeout": "The daemon timed out. Showing nothing rather than guessing.",
  "no-fixture": "No fixture data found — cannot verify anything in daemon-absent mode.",
  "no-audit-store": "The audit store is missing or unreadable.",
  unparseable: "The source answered with something this surface cannot verify.",
  "meta-missing": "The response carried no freshness metadata — treated as unverifiable.",
  "not-found": "Nothing by that id — rendered as blocked, not as empty.",
};

export function blockedMessage(why: string | undefined): string {
  return (why && BLOCKED_MESSAGES[why]) ?? "Cannot verify this state — treated as blocked.";
}

function isEnvelopeShaped(value: unknown): value is ThreadsEnvelope<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return "data" in v && "blocked" in v && typeof v.meta === "object" && v.meta !== null;
}

/**
 * Derive the render state for a surface from a raw fetch payload.
 * Fail-closed at every step:
 * - not envelope-shaped or meta missing -> blocked (R8, contract violation)
 * - envelope.blocked -> blocked with its named why
 * - past staleAfter -> ready with a stale banner (R9); the caller re-fetches
 * - fixtures adapter -> honest "fixture data" banner (§1)
 */
export function surfaceStateFromPayload<T>(payload: unknown, now: Date = new Date()): SurfaceState<T> {
  if (!isEnvelopeShaped(payload)) {
    return { kind: "blocked", why: "meta-missing", message: blockedMessage("meta-missing"), meta: null };
  }
  const envelope = payload as ThreadsEnvelope<T>;
  const meta = envelope.meta;
  if (
    typeof meta.observedAt !== "string" ||
    typeof meta.staleAfter !== "string" ||
    typeof meta.sourceCursor !== "string" ||
    typeof meta.verified !== "boolean" ||
    (meta.adapter !== "daemon" && meta.adapter !== "fixtures")
  ) {
    return { kind: "blocked", why: "meta-missing", message: blockedMessage("meta-missing"), meta: null };
  }
  if (envelope.blocked || envelope.data === null) {
    const why = envelope.why ?? "unparseable";
    return { kind: "blocked", why, message: blockedMessage(why), meta };
  }
  if (meta.verified !== true) {
    // R8: an unverified success is a contract violation — blocked.
    return { kind: "blocked", why: "meta-missing", message: blockedMessage("meta-missing"), meta };
  }
  const banners: SurfaceBanner[] = [];
  if (meta.adapter === "fixtures") {
    banners.push({
      kind: "fixture-data",
      message: "Fixture data — the daemon is not wired in yet. Approvals are disabled.",
    });
  }
  if (isStale(meta, now)) {
    banners.push({
      kind: "stale",
      message: "This view is past its freshness window — showing last-known state.",
    });
  }
  return { kind: "ready", data: envelope.data, meta, banners };
}

/** Approvals and other decisions are disabled whenever the surface cannot verify freshly (R3/R5/R9). */
export function decisionsEnabled(state: SurfaceState<unknown>): boolean {
  return state.kind === "ready" && state.banners.length === 0;
}

// ---------------------------------------------------------------------------
// Trace-to-source (OpenTrust trace-detail shape): every status pill opens the
// evidence that produced it — predicate result, commitment hash, cursor,
// observation time. Descriptor content never appears here (it is derived).

export type StatusTrace = {
  /** What the predicate/tension evidence was. */
  evidence: string[];
  /** Where it came from. */
  source: { cursor: string; observedAt: string; adapter: string };
};

export function traceForWeave(weave: WeaveSummary, meta: ThreadsMeta): StatusTrace {
  const rollup = weave.tensionRollup;
  const evidence = [
    `coherence: ${weave.coherence} (predicate result)`,
    `tension rollup: ${rollup.state} (worst of ${weave.threadCount} thread${weave.threadCount === 1 ? "" : "s"})`,
    `weave_hash: ${weave.weaveHash || "(unavailable)"}`,
  ];
  if (weave.degradedSurfaces.length > 0) {
    evidence.push(`degraded surfaces: ${weave.degradedSurfaces.join(", ")}`);
  }
  return {
    evidence,
    source: { cursor: meta.sourceCursor, observedAt: meta.observedAt, adapter: meta.adapter },
  };
}

export function traceForTension(tension: TensionView, meta: ThreadsMeta): StatusTrace {
  const evidence: string[] = [`tension: ${tension.state}`];
  if (tension.state === "frayed") {
    evidence.push(
      `reason: ${tension.reason.kind}${tension.reason.missingKind ? ` (${tension.reason.missingKind})` : ""}`,
      `blamed strand: ${tension.strand ?? "(missing required strand)"}`,
      `channel: ${tension.channel ?? "(unrecognized)"}`,
      `detected: ${tension.detectedAt ?? "(unknown time)"}`,
    );
  } else if (tension.state === "snapped") {
    evidence.push(
      `reason: ${tension.reason.kind}`,
      `channel: ${tension.channel ?? "(unrecognized)"}`,
      `at: ${tension.at ?? "(unknown time)"}`,
    );
  } else if (tension.state === "unknown") {
    evidence.push(`why: ${tension.why} — fail-closed`);
  }
  return {
    evidence,
    source: { cursor: meta.sourceCursor, observedAt: meta.observedAt, adapter: meta.adapter },
  };
}

// ---------------------------------------------------------------------------
// Small formatting helpers shared by rail + pane.

export function shortHash(hex: string, length = 12): string {
  if (!hex) return "(unavailable)";
  return hex.length <= length ? hex : `${hex.slice(0, length)}…`;
}

export function channelLabel(channel: string): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

export type WeaveRailModel = {
  weaves: WeaveSummary[];
  familiars: string[];
};

export function railModel(weaves: WeaveSummary[]): WeaveRailModel {
  const familiars = [...new Set(weaves.map((w) => w.familiarId).filter((f) => f.length > 0))].sort();
  return { weaves, familiars };
}

export type ThreadPaneModel = {
  weave: WeaveDetail;
  /** Threads sorted worst-first so the operator sees trouble at the top. */
  threads: WeaveDetail["threads"];
};

const PANE_SEVERITY: Record<TensionView["state"], number> = {
  snapped: 4,
  frayed: 3,
  unknown: 2,
  stale: 1,
  holds: 0,
};

export function paneModel(weave: WeaveDetail): ThreadPaneModel {
  const threads = [...weave.threads].sort(
    (a, b) => PANE_SEVERITY[b.tension.state] - PANE_SEVERITY[a.tension.state],
  );
  return { weave, threads };
}
