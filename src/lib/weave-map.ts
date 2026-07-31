// The weave map — coven-threads memory made visible (cave-kgts).
//
// Pure builders for the surface's two readings of the same verified edges:
// a bipartite diagram (writers ⇄ protected surfaces, one edge per thread) and
// the List view that carries the identical rows as text.
//
// Fail-closed (Phase-4 §4): audit rows without a thread_id can't be attributed
// and are skipped, never guessed; unknown/stale tension renders as the blocked
// tone. Memory READS are not audited yet (Phase 5), so no "recalled" edge is
// drawn — none can be verified.
//
// The original force-directed graph builder (buildWeaveMap + its node/edge
// model) was retired in cave-3lklx: the redesign replaced the force layout,
// which left it with no caller outside its own test.

import type {
  AuditEntryView,
  ProposalView,
  TensionView,
  ThreadView,
} from "./threads-read.ts";

export type WeaveMapTone = "holds" | "frayed" | "snapped" | "blocked";

/** §2.1 tension → node tone; the two UI-only states fail closed to blocked. */
export function toneForTension(tension: TensionView): WeaveMapTone {
  switch (tension.state) {
    case "holds":
      return "holds";
    case "frayed":
      return "frayed";
    case "snapped":
      return "snapped";
    default:
      return "blocked";
  }
}

// ---------------------------------------------------------------------------
// Bipartite presentation (cave-f8rdi): writers on the left, protected surfaces
// on the right, one edge per thread. A force layout made every weave look like
// a different shape; two fixed lanes make "who may write where" readable at a
// glance and comparable between familiars. Paired with a text List view
// that carries the identical rows for anyone the diagram does not serve.

export type WeaveMapLink = {
  threadId: string;
  writer: string;
  surface: string;
  /** Index into `writers`; the left lane is deduplicated by writer identity. */
  writerIndex: number;
  /** Index into `surfaces`; one row per thread, worst-first from the caller. */
  surfaceIndex: number;
  tone: WeaveMapTone;
  strandCount: number;
  /** A staged write is waiting on a decision — drawn dashed, not solid. */
  pending: boolean;
};

export type BipartiteWeaveMap = {
  writers: string[];
  surfaces: { surface: string; tone: WeaveMapTone }[];
  links: WeaveMapLink[];
};

function pendingThreadIds(proposals: ProposalView[]): Set<string> {
  const ids = new Set<string>();
  for (const proposal of proposals) {
    if (proposal.parse !== "ok" || !proposal.payload) continue;
    ids.add(proposal.payload.threadId);
  }
  return ids;
}

export function buildBipartiteWeaveMap(args: {
  threads: ThreadView[];
  proposals: ProposalView[];
}): BipartiteWeaveMap {
  const staged = pendingThreadIds(args.proposals);
  const writers = [...new Set(args.threads.map((t) => t.writer))];
  // Index once: an indexOf per thread would rescan the writer lane on every
  // link, making the whole build quadratic in thread count.
  const writerIndex = new Map(writers.map((writer, index) => [writer, index]));
  const surfaces = args.threads.map((t) => ({ surface: t.surface, tone: toneForTension(t.tension) }));
  const links = args.threads.map((thread, index) => ({
    threadId: thread.id,
    writer: thread.writer,
    surface: thread.surface,
    writerIndex: writerIndex.get(thread.writer) ?? 0,
    surfaceIndex: index,
    tone: toneForTension(thread.tension),
    strandCount: thread.strandCount,
    pending: staged.has(thread.id),
  }));
  return { writers, surfaces, links };
}

export type WeaveMapRow = {
  threadId: string;
  tone: WeaveMapTone;
  label: string;
  /** What backs this edge, in the order the operator cares about. */
  evidence: string;
};

/** The List view of the map — the same edges as text, never a reduced set. */
export function weaveMapRows(args: {
  threads: ThreadView[];
  audit: AuditEntryView[];
  proposals: ProposalView[];
}): WeaveMapRow[] {
  const staged = pendingThreadIds(args.proposals);
  const auditedThreads = new Set(
    args.audit.map((entry) => entry.threadId).filter((id): id is string => id !== null),
  );
  return args.threads.map((thread) => {
    const parts = [`${thread.strandCount} strand${thread.strandCount === 1 ? "" : "s"}`, "authority"];
    if (auditedThreads.has(thread.id)) parts.push("audited");
    if (staged.has(thread.id)) parts.push("1 staged proposal");
    return {
      threadId: thread.id,
      tone: toneForTension(thread.tension),
      label: `${thread.surface} → ${thread.writer}`,
      evidence: parts.join(" · "),
    };
  });
}
