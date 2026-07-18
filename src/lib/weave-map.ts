// The weave map — coven-threads memory made visible (cave-kgts).
//
// Pure builder: authority threads + their memory surfaces as a small graph,
// every edge a VERIFIED fact. Three edge styles, three provenances:
//
//   authority — the thread's own contract (ThreadView.surface): this writer
//               may propose writes to this surface. Always present.
//   touched   — ward_audit rows: files a decision actually touched, keyed by
//               thread_id. Aggregated per (thread, file) with a count.
//   pending   — staged proposals awaiting decision: dashed, the invitation.
//
// Fail-closed (Phase-4 §4): audit rows without a thread_id can't be
// attributed and are skipped, never guessed; unknown/stale tension renders
// as the blocked tone. Memory READS are not audited yet (Phase 5) — this map
// deliberately shows no "recalled" edges, because none can be verified.

import type {
  AuditEntryView,
  ProposalView,
  TensionView,
  ThreadView,
} from "./threads-read.ts";

export type WeaveMapTone = "holds" | "frayed" | "snapped" | "blocked";

export type WeaveMapNode =
  | {
      id: string;
      kind: "thread";
      threadId: string;
      /** Writer identity with the `familiar:` prefix stripped for display. */
      label: string;
      tone: WeaveMapTone;
    }
  | {
      id: string;
      kind: "surface";
      surface: string;
      label: string;
    };

export type WeaveMapEdgeStyle = "authority" | "touched" | "pending";

export type WeaveMapEdge = {
  from: string;
  to: string;
  style: WeaveMapEdgeStyle;
  /** Aggregated evidence count (audit rows / staged edits behind the edge). */
  count: number;
  /** One-line evidence copy for the hover/selection detail. */
  detail: string;
};

export type WeaveMap = {
  nodes: WeaveMapNode[];
  edges: WeaveMapEdge[];
};

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

export function threadNodeId(threadId: string): string {
  return `thread:${threadId}`;
}

export function surfaceNodeId(surface: string): string {
  return `surface:${surface}`;
}

function writerLabel(writer: string): string {
  return writer.startsWith("familiar:") ? writer.slice("familiar:".length) : writer;
}

export function buildWeaveMap(args: {
  threads: ThreadView[];
  audit: AuditEntryView[];
  proposals: ProposalView[];
}): WeaveMap {
  const threadIds = new Set(args.threads.map((t) => t.id));
  const nodes = new Map<string, WeaveMapNode>();
  const edgeAgg = new Map<string, WeaveMapEdge>();

  const ensureSurface = (surface: string) => {
    const id = surfaceNodeId(surface);
    if (!nodes.has(id)) nodes.set(id, { id, kind: "surface", surface, label: surface });
    return id;
  };
  const addEdge = (from: string, to: string, style: WeaveMapEdgeStyle) => {
    const key = `${style}|${from}|${to}`;
    const existing = edgeAgg.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeAgg.set(key, { from, to, style, count: 1, detail: "" });
    }
  };

  for (const thread of args.threads) {
    const id = threadNodeId(thread.id);
    nodes.set(id, {
      id,
      kind: "thread",
      threadId: thread.id,
      label: writerLabel(thread.writer),
      tone: toneForTension(thread.tension),
    });
    addEdge(id, ensureSurface(thread.surface), "authority");
  }

  for (const entry of args.audit) {
    // No thread id → no attribution; skipping is the honest treatment.
    if (!entry.threadId || !threadIds.has(entry.threadId)) continue;
    for (const file of entry.filesTouched) {
      addEdge(threadNodeId(entry.threadId), ensureSurface(file), "touched");
    }
  }

  for (const proposal of args.proposals) {
    const payload = proposal.payload;
    if (proposal.parse !== "ok" || !payload) continue;
    if (!threadIds.has(payload.threadId)) continue;
    for (const edit of payload.edits) {
      addEdge(threadNodeId(payload.threadId), ensureSurface(edit.surface), "pending");
    }
  }

  const edges = [...edgeAgg.values()].map((edge) => ({
    ...edge,
    detail:
      edge.style === "authority"
        ? "authority contract — this writer may propose writes here"
        : edge.style === "touched"
          ? `${edge.count} audited decision${edge.count === 1 ? "" : "s"} touched this file`
          : `${edge.count} staged edit${edge.count === 1 ? "" : "s"} awaiting decision`,
  }));

  return { nodes: [...nodes.values()], edges };
}
