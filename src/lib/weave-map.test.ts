import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeaveMap, surfaceNodeId, threadNodeId, toneForTension } from "./weave-map.ts";
import type { AuditEntryView, ProposalView, ThreadView } from "./threads-read.ts";

function thread(id: string, surface: string, writer = "familiar:sage", state: "holds" | "frayed" | "snapped" | "unknown" = "holds"): ThreadView {
  const tension =
    state === "holds"
      ? { state: "holds" as const }
      : state === "frayed"
        ? { state: "frayed" as const, strand: null, channel: null, reason: { kind: "other" as const }, detectedAt: null }
        : state === "snapped"
          ? { state: "snapped" as const, channel: null, reason: { kind: "other" as const }, at: null }
          : { state: "unknown" as const, why: "daemon-unreachable" as const };
  return {
    id,
    weaveId: "w1",
    surface,
    writer,
    tension,
    holdsUnder: [],
    requiredStrands: {},
    strandCount: 0,
    createdAt: null,
  };
}

function auditRow(threadId: string | null, filesTouched: string[], id = 1): AuditEntryView {
  return {
    id,
    eventType: "proposal_approved",
    proposalId: null,
    familiarId: "sage",
    wardVersion: null,
    wardHash: "00",
    tier: null,
    decision: "permit",
    approver: null,
    diffHash: null,
    filesTouched,
    channel: "mutation",
    threadId,
    submittedAt: "2026-07-15T08:00:00Z",
    decidedAt: "2026-07-15T08:00:01Z",
    recordedAt: "2026-07-15T08:00:02Z",
  };
}

function proposal(threadId: string, surfaces: string[], parse: "ok" | "corrupt" = "ok"): ProposalView {
  return {
    file: "p.json",
    parse,
    payload:
      parse === "ok"
        ? {
            id: "p1",
            familiarId: "sage",
            writer: "familiar:sage",
            channel: "mutation",
            threadId,
            fray: { state: "holds" },
            edits: surfaces.map((surface) => ({ surface, contents: { encoding: "utf8" as const, data: "x" } })),
            stagedAt: null,
          }
        : null,
  };
}

describe("toneForTension", () => {
  it("maps the three crate states and fails closed on the UI-only ones", () => {
    assert.equal(toneForTension({ state: "holds" }), "holds");
    assert.equal(toneForTension({ state: "unknown", why: "daemon-unreachable" }), "blocked");
    assert.equal(toneForTension({ state: "stale", lastKnown: null, observedAt: "2026-07-15T08:00:00Z" }), "blocked");
  });
});

describe("buildWeaveMap", () => {
  it("builds authority edges from the thread contract", () => {
    const map = buildWeaveMap({ threads: [thread("t1", "SOUL.md")], audit: [], proposals: [] });
    assert.equal(map.nodes.length, 2);
    const threadNode = map.nodes.find((n) => n.kind === "thread");
    assert.equal(threadNode?.label, "sage", "familiar: prefix stripped for display");
    assert.deepEqual(
      map.edges.map((e) => [e.from, e.to, e.style, e.count]),
      [[threadNodeId("t1"), surfaceNodeId("SOUL.md"), "authority", 1]],
    );
  });

  it("aggregates audited touches per (thread, file) with counts", () => {
    const map = buildWeaveMap({
      threads: [thread("t1", "SOUL.md")],
      audit: [auditRow("t1", ["MEMORY.md"], 1), auditRow("t1", ["MEMORY.md", "SOUL.md"], 2)],
      proposals: [],
    });
    const touched = map.edges.filter((e) => e.style === "touched");
    const memoryEdge = touched.find((e) => e.to === surfaceNodeId("MEMORY.md"));
    assert.equal(memoryEdge?.count, 2);
    assert.match(memoryEdge?.detail ?? "", /2 audited decisions/);
    assert.ok(map.nodes.some((n) => n.kind === "surface" && n.surface === "MEMORY.md"));
  });

  it("skips unattributable audit rows — no thread id, no edge", () => {
    const map = buildWeaveMap({
      threads: [thread("t1", "SOUL.md")],
      audit: [auditRow(null, ["MEMORY.md"]), auditRow("t-foreign", ["MEMORY.md"])],
      proposals: [],
    });
    assert.equal(map.edges.filter((e) => e.style === "touched").length, 0);
    assert.ok(!map.nodes.some((n) => n.kind === "surface" && n.surface === "MEMORY.md"));
  });

  it("staged proposals ride as pending edges; corrupt proposals are ignored", () => {
    const map = buildWeaveMap({
      threads: [thread("t1", "SOUL.md")],
      audit: [],
      proposals: [proposal("t1", ["IDENTITY.md", "IDENTITY.md"]), proposal("t1", ["x"], "corrupt")],
    });
    const pending = map.edges.filter((e) => e.style === "pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].count, 2);
    assert.match(pending[0].detail, /2 staged edits/);
  });

  it("thread tone follows tension, failing closed", () => {
    const map = buildWeaveMap({
      threads: [thread("t1", "a", "familiar:sage", "frayed"), thread("t2", "b", "familiar:echo", "unknown")],
      audit: [],
      proposals: [],
    });
    const tones = new Map(map.nodes.filter((n) => n.kind === "thread").map((n) => [n.threadId, n.tone]));
    assert.equal(tones.get("t1"), "frayed");
    assert.equal(tones.get("t2"), "blocked");
  });
});
