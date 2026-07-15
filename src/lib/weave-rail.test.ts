// Behavioral tests for the weave rail / thread pane view models — the
// fail-closed rendering rules (spec §4) at the layer components consume:
// R1 (unknown -> blocked pill), R3 (timeout -> blocked surface / stale
// banner), R8 (meta missing -> blocked), R9 (stale banner), R11 (not-found
// blocked). Components render exactly these derivations (pinned in
// src/components/weave-rail.test.ts / thread-pane.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blockedMessage,
  decisionsEnabled,
  paneModel,
  pillForCoherence,
  pillForTension,
  railModel,
  shortHash,
  surfaceStateFromPayload,
  traceForTension,
  traceForWeave,
} from "./weave-rail.ts";
import { makeThreadsMeta, okEnvelope, blockedEnvelope } from "./threads-read.ts";
import type { TensionView, ThreadsMeta, WeaveDetail, WeaveSummary } from "./threads-read.ts";

const FRESH = new Date("2026-07-15T09:00:00Z");

function meta(overrides: Partial<ThreadsMeta> = {}): ThreadsMeta {
  return {
    ...makeThreadsMeta({
      adapter: "fixtures",
      sourceCursor: "weave:abc",
      verified: true,
      observedAt: FRESH,
    }),
    ...overrides,
  };
}

const HOLDS: TensionView = { state: "holds" };
const FRAYED: TensionView = {
  state: "frayed",
  strand: "s-1",
  channel: "mutation",
  reason: { kind: "content-hash-mismatch" },
  detectedAt: "2026-07-15T09:00:00.000Z",
};
const SNAPPED: TensionView = {
  state: "snapped",
  channel: "mutation",
  reason: { kind: "revoked" },
  at: "2026-07-15T08:30:00.000Z",
};
const UNKNOWN: TensionView = { state: "unknown", why: "unparseable" };

describe("pillForTension — every tension state maps to an honest pill", () => {
  it("holds / frayed / snapped map to their own tones", () => {
    assert.equal(pillForTension(HOLDS).tone, "holds");
    assert.equal(pillForTension(FRAYED).tone, "frayed");
    assert.equal(pillForTension(SNAPPED).tone, "snapped");
  });

  it("R1: unknown renders the blocked pill, never a healthy one", () => {
    const pill = pillForTension(UNKNOWN);
    assert.equal(pill.tone, "blocked");
    assert.equal(pill.label, "Blocked");
    assert.match(pill.detail, /cannot verify/i);
  });

  it("stale renders its own tone with last-known framing", () => {
    const pill = pillForTension({ state: "stale", lastKnown: HOLDS, observedAt: "2026-07-15T09:00:00Z" });
    assert.equal(pill.tone, "stale");
    assert.match(pill.detail, /last-known/i);
  });

  it("frayed detail names the reason without dramatizing", () => {
    assert.match(pillForTension(FRAYED).detail, /content-hash-mismatch/);
    assert.match(pillForTension(FRAYED).detail, /repairable/i);
  });
});

describe("pillForCoherence — predicate result, blocked when unknown", () => {
  it("coherent/degraded/broken map to their tones", () => {
    assert.equal(pillForCoherence("coherent").tone, "holds");
    assert.equal(pillForCoherence("degraded").tone, "frayed");
    assert.equal(pillForCoherence("broken").tone, "snapped");
  });

  it("unknown coherence is blocked (R1)", () => {
    assert.equal(pillForCoherence("unknown").tone, "blocked");
  });
});

describe("surfaceStateFromPayload — envelope to render state", () => {
  const weaves: WeaveSummary[] = [];

  it("a fresh verified envelope is ready with no banners", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(
      okEnvelope(weaves, { ...meta(), adapter: "daemon" }),
      FRESH,
    );
    assert.equal(state.kind, "ready");
    assert.deepEqual(state.kind === "ready" ? state.banners : null, []);
  });

  it("fixtures adapter always carries the honest fixture-data banner", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(okEnvelope(weaves, meta()), FRESH);
    assert.equal(state.kind, "ready");
    const banners = state.kind === "ready" ? state.banners : [];
    assert.equal(banners[0]?.kind, "fixture-data");
  });

  it("R9: past staleAfter the surface carries a stale banner", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(
      okEnvelope(weaves, meta()),
      new Date("2026-07-15T09:01:00Z"),
    );
    assert.equal(state.kind, "ready");
    const kinds = state.kind === "ready" ? state.banners.map((b) => b.kind) : [];
    assert.ok(kinds.includes("stale"), `stale banner present, got ${kinds.join(",")}`);
  });

  it("R3: a blocked envelope renders the blocked surface with its named why", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(
      blockedEnvelope("daemon-timeout", meta()),
      FRESH,
    );
    assert.equal(state.kind, "blocked");
    assert.equal(state.kind === "blocked" ? state.why : "", "daemon-timeout");
    assert.match(state.kind === "blocked" ? state.message : "", /timed out/i);
  });

  it("R8: a payload without envelope shape or meta is blocked as meta-missing", () => {
    for (const payload of [null, "nope", {}, { data: [], blocked: false }, { data: [], blocked: false, meta: { adapter: "daemon" } }]) {
      const state = surfaceStateFromPayload(payload, FRESH);
      assert.equal(state.kind, "blocked", `payload ${JSON.stringify(payload)} must block`);
      assert.equal(state.kind === "blocked" ? state.why : "", "meta-missing");
    }
  });

  it("R8: verified:false on a non-blocked envelope is a contract violation — blocked", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(
      { data: weaves, meta: meta({ verified: false }), blocked: false },
      FRESH,
    );
    assert.equal(state.kind, "blocked");
  });

  it("R8: a meta with an unknown adapter is a contract violation — blocked, decisions stay off", () => {
    const forged = { ...meta(), adapter: "mystery" } as unknown as ThreadsMeta;
    const state = surfaceStateFromPayload<WeaveSummary[]>(
      { data: weaves, meta: forged, blocked: false },
      FRESH,
    );
    assert.equal(state.kind, "blocked");
    assert.equal(state.kind === "blocked" ? state.why : "", "meta-missing");
    assert.equal(decisionsEnabled(state), false);
  });

  it("R11: not-found blocks with its own message, never an empty-healthy list", () => {
    const state = surfaceStateFromPayload<WeaveSummary[]>(blockedEnvelope("not-found", meta()), FRESH);
    assert.equal(state.kind, "blocked");
    assert.match(state.kind === "blocked" ? state.message : "", /blocked, not as empty/i);
  });

  it("every blocked why has copy and the fallback is honest", () => {
    for (const why of [
      "daemon-unreachable",
      "daemon-unavailable",
      "daemon-endpoint-missing",
      "daemon-timeout",
      "no-fixture",
      "no-audit-store",
      "unparseable",
      "meta-missing",
      "not-found",
    ]) {
      assert.ok(blockedMessage(why).length > 10, `copy for ${why}`);
    }
    assert.match(blockedMessage("something-new"), /treated as blocked/i);
  });
});

describe("decisionsEnabled — approvals disabled on anything but fresh verified state", () => {
  it("enabled only for ready with zero banners", () => {
    const ready = surfaceStateFromPayload<WeaveSummary[]>(
      okEnvelope([], { ...meta(), adapter: "daemon" }),
      FRESH,
    );
    assert.equal(decisionsEnabled(ready), true);
  });

  it("disabled for fixtures (no daemon), stale, blocked, loading", () => {
    const fixture = surfaceStateFromPayload<WeaveSummary[]>(okEnvelope([], meta()), FRESH);
    const stale = surfaceStateFromPayload<WeaveSummary[]>(
      okEnvelope([], { ...meta(), adapter: "daemon" }),
      new Date("2026-07-15T09:01:00Z"),
    );
    const blocked = surfaceStateFromPayload<WeaveSummary[]>(blockedEnvelope("daemon-timeout", meta()), FRESH);
    assert.equal(decisionsEnabled(fixture), false);
    assert.equal(decisionsEnabled(stale), false);
    assert.equal(decisionsEnabled(blocked), false);
    assert.equal(decisionsEnabled({ kind: "loading" }), false);
  });
});

describe("trace-to-source — pills open predicate evidence, never descriptor content", () => {
  const weave: WeaveSummary = {
    id: "w-1",
    familiarId: "echo",
    threadCount: 2,
    tensionRollup: FRAYED,
    coherence: "degraded",
    degradedSurfaces: ["MEMORY.md"],
    weaveHash: "22224444",
  };

  it("weave trace carries coherence, rollup, hash, degraded surfaces, and source", () => {
    const trace = traceForWeave(weave, meta());
    assert.match(trace.evidence.join("\n"), /coherence: degraded \(predicate result\)/);
    assert.match(trace.evidence.join("\n"), /tension rollup: frayed/);
    assert.match(trace.evidence.join("\n"), /weave_hash: 22224444/);
    assert.match(trace.evidence.join("\n"), /degraded surfaces: MEMORY\.md/);
    assert.equal(trace.source.cursor, "weave:abc");
    assert.equal(trace.source.adapter, "fixtures");
  });

  it("frayed tension trace names strand, channel, reason, and detection time", () => {
    const trace = traceForTension(FRAYED, meta());
    const text = trace.evidence.join("\n");
    assert.match(text, /reason: content-hash-mismatch/);
    assert.match(text, /blamed strand: s-1/);
    assert.match(text, /channel: mutation/);
  });

  it("unknown tension trace says fail-closed explicitly", () => {
    assert.match(traceForTension(UNKNOWN, meta()).evidence.join("\n"), /fail-closed/);
  });
});

describe("rail + pane models", () => {
  it("railModel collects sorted unique familiars for the filter", () => {
    const summaries = ["nova", "echo", "echo", ""].map(
      (familiarId, i): WeaveSummary => ({
        id: `w-${i}`,
        familiarId,
        threadCount: 0,
        tensionRollup: UNKNOWN,
        coherence: "unknown",
        degradedSurfaces: [],
        weaveHash: "",
      }),
    );
    assert.deepEqual(railModel(summaries).familiars, ["echo", "nova"]);
  });

  it("paneModel sorts threads worst-first: snapped > frayed > unknown > holds", () => {
    const detail: WeaveDetail = {
      id: "w-1",
      familiarId: "echo",
      threadCount: 4,
      tensionRollup: SNAPPED,
      coherence: "degraded",
      degradedSurfaces: [],
      weaveHash: "ff",
      threads: [HOLDS, UNKNOWN, SNAPPED, FRAYED].map((tension, i) => ({
        id: `t-${i}`,
        weaveId: "w-1",
        surface: "SOUL.md",
        writer: "familiar:echo",
        tension,
        holdsUnder: [],
        requiredStrands: {},
        strandCount: 0,
        createdAt: null,
      })),
      patternDescriptor: null,
      covenRef: null,
    };
    assert.deepEqual(
      paneModel(detail).threads.map((t) => t.tension.state),
      ["snapped", "frayed", "unknown", "holds"],
    );
  });

  it("shortHash truncates with an ellipsis and is honest about absence", () => {
    assert.equal(shortHash("aabbccddeeff00112233"), "aabbccddeeff…");
    assert.equal(shortHash("aabb"), "aabb");
    assert.equal(shortHash(""), "(unavailable)");
  });
});
