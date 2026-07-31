import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBipartiteWeaveMap, toneForTension, weaveMapRows } from "./weave-map.ts";
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

describe("buildBipartiteWeaveMap", () => {
  it("deduplicates the writer lane but keeps one surface row per thread", () => {
    const map = buildBipartiteWeaveMap({
      threads: [
        thread("t1", "SOUL.md", "familiar:sage"),
        thread("t2", "IDENTITY.md", "familiar:sage"),
        thread("t3", "ward.toml", "daemon:ward"),
      ],
      proposals: [],
    });
    assert.deepEqual(map.writers, ["familiar:sage", "daemon:ward"]);
    assert.equal(map.surfaces.length, 3, "one right-lane row per thread, never deduped");
    assert.deepEqual(
      map.links.map((l) => l.writerIndex),
      [0, 0, 1],
      "both sage threads point at the same writer node",
    );
    assert.deepEqual(map.links.map((l) => l.surfaceIndex), [0, 1, 2]);
  });

  it("marks only threads the queue actually staged a write for", () => {
    const map = buildBipartiteWeaveMap({
      threads: [thread("t1", "SOUL.md"), thread("t2", "IDENTITY.md")],
      proposals: [proposal("t1", ["SOUL.md"])],
    });
    assert.deepEqual(map.links.map((l) => l.pending), [true, false]);
  });

  it("ignores a corrupt staged file — it can never claim a pending edge", () => {
    const map = buildBipartiteWeaveMap({
      threads: [thread("t1", "SOUL.md")],
      proposals: [proposal("t1", ["SOUL.md"], "corrupt")],
    });
    assert.equal(map.links[0].pending, false);
  });

  it("carries the thread tension through to both the edge and its surface", () => {
    const map = buildBipartiteWeaveMap({
      threads: [thread("t1", "SOUL.md", "familiar:sage", "snapped")],
      proposals: [],
    });
    assert.equal(map.links[0].tone, "snapped");
    assert.equal(map.surfaces[0].tone, "snapped");
  });
});

describe("weaveMapRows", () => {
  it("claims audited only for a thread the audit rows attribute", () => {
    const rows = weaveMapRows({
      threads: [thread("t1", "SOUL.md"), thread("t2", "IDENTITY.md")],
      audit: [auditRow("t1", ["SOUL.md"])],
      proposals: [],
    });
    assert.match(rows[0].evidence, /audited/);
    assert.doesNotMatch(rows[1].evidence, /audited/);
  });

  it("does not attribute an audit row that carries no thread id", () => {
    const rows = weaveMapRows({
      threads: [thread("t1", "SOUL.md")],
      audit: [auditRow(null, ["SOUL.md"])],
      proposals: [],
    });
    assert.doesNotMatch(rows[0].evidence, /audited/, "unattributable rows are skipped, never guessed");
  });

  it("names the staged proposal and keeps the surface → writer referent", () => {
    const rows = weaveMapRows({
      threads: [thread("t1", "SOUL.md", "familiar:sage")],
      audit: [],
      proposals: [proposal("t1", ["SOUL.md"])],
    });
    assert.equal(rows[0].label, "SOUL.md → familiar:sage");
    assert.match(rows[0].evidence, /1 staged proposal/);
  });

  it("emits one row per thread so the List view is never a reduced set", () => {
    const threads = [thread("t1", "a"), thread("t2", "b"), thread("t3", "c")];
    assert.equal(weaveMapRows({ threads, audit: [], proposals: [] }).length, threads.length);
  });
});
