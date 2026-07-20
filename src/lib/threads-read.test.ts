// Behavioral tests for the Phase 4 read models (spec: coven-threads
// specs/PHASE-4-CAVE-SURFACES.md). The fail-closed rendering rules R1/R2/R9/
// R10 live here at the pure-logic layer; adapter-level rules are covered in
// threads-adapters.test.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  bytesToHex,
  blockedEnvelope,
  isSafeThreadsId,
  isStale,
  makeThreadsMeta,
  normalizeAuditRow,
  normalizeChannel,
  normalizeCoherence,
  normalizeFrayReason,
  normalizeStrand,
  normalizeTension,
  normalizeThread,
  normalizeWeaveDetail,
  normalizeWeaveSummary,
  normalizeDegradedFamiliar,
  tensionRollup,
  timeArrayToIso,
  THREADS_STALE_TTL_MS,
  type TensionView,
} from "./threads-read.ts";
import { canonicalProposalRevision, normalizeProposalAuthority } from "./proposal-authority.ts";
import { normalizeProposal } from "./proposal-normalize.ts";

function daemonContractFixture() {
  const familiarUuid = "eeeeeeee-0000-4000-8000-000000000098";
  const pending = {
    id: "cccccccc-0001-4001-8001-000000000098",
    familiar_id: familiarUuid,
    writer: "familiar:echo",
    channel: "Mutation",
    thread_id: "aaaaaaa2-0002-4002-8002-000000000098",
    fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
    edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
    staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
  };
  const staged = {
    schema: "phase5_v1",
    pending,
    classification: {
      proposal_id: pending.id,
      familiar_id: familiarUuid,
      channel: "Mutation",
      affected_surfaces: ["MEMORY.md"],
      affected_regions: ["memory_conventions"],
      path_tier_floor: 1,
      approval_path: { kind: "human_approval" },
      evidence_replay_hash: Array(32).fill(17),
      classified_at: pending.staged_at,
    },
    materialized_diff: {
      surfaces: [
        {
          surface: "MEMORY.md",
          before: Array.from(Buffer.from("before")),
          after: Array.from(Buffer.from("proposed")),
        },
      ],
    },
    region_evidence: [
      {
        region_id: "memory_conventions",
        affected_surfaces: ["MEMORY.md"],
        min_path_tier: 1,
        replay_bytes: [109, 101, 109, 111, 114, 121],
        rationale: "Touches durable memory conventions",
      },
    ],
    lifecycle: { state: "awaiting_human_approval" },
    staged_at: pending.staged_at,
    veto_deadline: null,
    earliest_close: null,
  };
  const daemon = {
    proposalId: pending.id,
    familiarId: "echo",
    familiarUuid,
    writer: pending.writer,
    stagedAt: "2026-07-15T09:00:02Z",
    targets: ["MEMORY.md"],
    proposalRevision: canonicalProposalRevision(staged),
    approvalPath: {
      variant: "human_approval",
      label: "human_review",
      veto_deadline: null,
      affected_surfaces: ["MEMORY.md"],
    },
    lifecycle: "awaiting_human_approval",
    blockedReason: null,
    earliestClose: null,
    affectedRegions: ["memory_conventions"],
  };
  return { staged, daemon };
}

function vetoContractFixture() {
  const { staged, daemon } = daemonContractFixture();
  const vetoStaged = {
    ...staged,
    classification: {
      ...staged.classification,
      approval_path: {
        kind: "familiar_coherence",
        veto: {
          duration: { secs: 1800, nanos: 0 },
          min_visible: { secs: 300, nanos: 0 },
        },
      },
    },
    lifecycle: { state: "veto_window_open" },
    veto_deadline: [2026, 196, 9, 30, 2, 0, 0, 0, 0],
    earliest_close: [2026, 196, 9, 5, 2, 0, 0, 0, 0],
  };
  const vetoDaemon = {
    ...daemon,
    proposalRevision: canonicalProposalRevision(vetoStaged),
    approvalPath: {
      variant: "familiar_coherence",
      label: "familiar_review",
      veto_deadline: "2026-07-15T09:30:02Z",
      affected_surfaces: ["MEMORY.md"],
    },
    lifecycle: "veto_window_open",
    earliestClose: "2026-07-15T09:05:02Z",
  };
  return { staged: vetoStaged, daemon: vetoDaemon };
}

function omitEnvelopeField<T>(value: T, path: readonly (string | number)[]): T {
  const copy = structuredClone(value);
  let cursor: unknown = copy;
  for (const segment of path.slice(0, -1)) {
    cursor = Array.isArray(cursor)
      ? cursor[Number(segment)]
      : (cursor as Record<string, unknown>)[String(segment)];
  }
  delete (cursor as Record<string, unknown>)[String(path.at(-1))];
  return copy;
}

function addEnvelopeField<T>(
  value: T,
  path: readonly (string | number)[],
  field: string,
  fieldValue: unknown,
): T {
  const copy = structuredClone(value);
  let cursor: unknown = copy;
  for (const segment of path) {
    cursor = Array.isArray(cursor)
      ? cursor[Number(segment)]
      : (cursor as Record<string, unknown>)[String(segment)];
  }
  (cursor as Record<string, unknown>)[field] = fieldValue;
  return copy;
}

describe("timeArrayToIso", () => {
  it("converts the time crate's 9-element array (2026 day 196 = July 15)", () => {
    assert.equal(timeArrayToIso([2026, 196, 9, 0, 0, 0, 0, 0, 0]), "2026-07-15T09:00:00.000Z");
  });

  it("applies UTC offsets", () => {
    assert.equal(timeArrayToIso([2026, 196, 9, 0, 0, 0, 2, 0, 0]), "2026-07-15T07:00:00.000Z");
  });

  it("passes through RFC 3339 strings", () => {
    assert.equal(timeArrayToIso("2026-07-15T09:00:00Z"), "2026-07-15T09:00:00.000Z");
  });

  it("returns null for garbage instead of inventing a timestamp", () => {
    assert.equal(timeArrayToIso({ year: 2026 }), null);
    assert.equal(timeArrayToIso([2026]), null);
    assert.equal(timeArrayToIso("not a date"), null);
  });
});

describe("normalizeTension (R1: unrecognized fails closed)", () => {
  it("normalizes Holds", () => {
    assert.deepEqual(normalizeTension("Holds"), { state: "holds" });
  });

  it("normalizes Frayed with blamed strand, channel, reason, timestamp", () => {
    const view = normalizeTension({
      Frayed: {
        strand: "bbbbbbb2-0002-4002-8002-000000000001",
        channel: "Mutation",
        reason: "ContentHashMismatch",
        detected_at: [2026, 196, 9, 0, 0, 0, 0, 0, 0],
      },
    });
    assert.deepEqual(view, {
      state: "frayed",
      strand: "bbbbbbb2-0002-4002-8002-000000000001",
      channel: "mutation",
      reason: { kind: "content-hash-mismatch" },
      detectedAt: "2026-07-15T09:00:00.000Z",
    });
  });

  it("normalizes Frayed with a missing required strand (strand: null)", () => {
    const view = normalizeTension({
      Frayed: {
        strand: null,
        channel: "Serialization",
        reason: { RequiredStrandMissing: { kind: "SerializationMarker" } },
        detected_at: [2026, 196, 9, 0, 0, 0, 0, 0, 0],
      },
    });
    assert.equal(view.state, "frayed");
    assert.equal((view as Extract<TensionView, { state: "frayed" }>).strand, null);
    assert.deepEqual((view as Extract<TensionView, { state: "frayed" }>).reason, {
      kind: "required-strand-missing",
      missingKind: "SerializationMarker",
    });
  });

  it("normalizes Snapped", () => {
    const view = normalizeTension({
      Snapped: { channel: "Mutation", reason: "Revoked", at: [2026, 196, 8, 30, 0, 0, 0, 0, 0] },
    });
    assert.deepEqual(view, {
      state: "snapped",
      channel: "mutation",
      reason: { kind: "revoked" },
      at: "2026-07-15T08:30:00.000Z",
    });
  });

  it("normalizes an unrecognized variant to unknown — never healthy", () => {
    assert.deepEqual(normalizeTension({ Wobbling: { confidence: "vibes" } }), {
      state: "unknown",
      why: "unparseable",
    });
    assert.deepEqual(normalizeTension(undefined), { state: "unknown", why: "unparseable" });
    assert.deepEqual(normalizeTension("holds"), { state: "unknown", why: "unparseable" });
  });

  it("preserves an unrecognized fray reason verbatim instead of guessing", () => {
    const view = normalizeTension({
      Frayed: { strand: null, channel: "Mutation", reason: { QuantumDrift: {} }, detected_at: null },
    });
    assert.equal(view.state, "frayed");
    const reason = (view as Extract<TensionView, { state: "frayed" }>).reason;
    assert.equal(reason.kind, "other");
    assert.match(reason.detail ?? "", /QuantumDrift/);
  });
});

describe("normalizeFrayReason", () => {
  it("maps every named crate reason", () => {
    assert.deepEqual(normalizeFrayReason("SignatureInvalid"), { kind: "signature-invalid" });
    assert.deepEqual(normalizeFrayReason("ManifestEntryMismatch"), { kind: "manifest-entry-mismatch" });
    assert.deepEqual(normalizeFrayReason("AuditTrailUnverifiable"), { kind: "audit-trail-unverifiable" });
    assert.deepEqual(normalizeFrayReason("SerializationMarkerMismatch"), {
      kind: "serialization-marker-mismatch",
    });
    assert.deepEqual(normalizeFrayReason({ Other: "diagnostic" }), { kind: "other", detail: "diagnostic" });
  });
});

describe("tensionRollup (R1 arithmetic: snapped > frayed > unknown > stale > holds)", () => {
  const holds: TensionView = { state: "holds" };
  const unknown: TensionView = { state: "unknown", why: "unparseable" };
  const frayed: TensionView = {
    state: "frayed",
    strand: null,
    channel: "mutation",
    reason: { kind: "content-hash-mismatch" },
    detectedAt: null,
  };
  const snapped: TensionView = { state: "snapped", channel: "mutation", reason: { kind: "revoked" }, at: null };
  const stale: TensionView = { state: "stale", lastKnown: holds, observedAt: "2026-07-15T09:00:00Z" };

  it("an unknown thread out-ranks healthy ones — unknown is worse than holds", () => {
    assert.equal(tensionRollup([holds, unknown, holds]).state, "unknown");
  });

  it("snapped beats everything", () => {
    assert.equal(tensionRollup([holds, unknown, frayed, snapped, stale]).state, "snapped");
  });

  it("frayed beats unknown and stale", () => {
    assert.equal(tensionRollup([stale, unknown, frayed]).state, "frayed");
  });

  it("stale beats holds", () => {
    assert.equal(tensionRollup([holds, stale]).state, "stale");
  });

  it("an empty weave rolls up unknown, not healthy", () => {
    assert.equal(tensionRollup([]).state, "unknown");
  });
});

describe("normalizeCoherence (predicate result, never the descriptor)", () => {
  it("maps the three crate variants", () => {
    assert.deepEqual(normalizeCoherence("Coherent"), { coherence: "coherent", degradedSurfaces: [] });
    assert.deepEqual(
      normalizeCoherence({ Degraded: { degraded_surfaces: ["MEMORY.md"], reason: "drift" } }),
      { coherence: "degraded", degradedSurfaces: ["MEMORY.md"] },
    );
    assert.deepEqual(normalizeCoherence({ Broken: { reason: "gone" } }), {
      coherence: "broken",
      degradedSurfaces: [],
    });
  });

  it("fails closed on anything unrecognized", () => {
    assert.equal(normalizeCoherence({ Shimmering: { aura: "?" } }).coherence, "unknown");
    assert.equal(normalizeCoherence(undefined).coherence, "unknown");
    assert.equal(normalizeCoherence("coherent").coherence, "unknown");
  });
});

describe("normalizeStrand", () => {
  it("normalizes all five kinds with hex-encoded committed material", () => {
    const contentHash = normalizeStrand({
      ContentHash: { id: "bbbbbbb1-0001-4001-8001-000000000001", algorithm: "Blake3", value: [171, 205] },
    });
    assert.deepEqual(contentHash, {
      id: "bbbbbbb1-0001-4001-8001-000000000001",
      kind: "ContentHash",
      algorithm: "blake3",
      value: "abcd",
    });

    const sig = normalizeStrand({
      Signature: { id: "b", key_id: "principal:val", kind: "PrincipalAttestation", value: [1, 2] },
    });
    assert.equal(sig?.kind, "Signature");
    assert.equal(sig?.kind === "Signature" ? sig.sigKind : "", "principal-attestation");

    const manifest = normalizeStrand({
      ManifestEntry: { id: "m", manifest_id: "man-1", entry_hash: [255] },
    });
    assert.equal(manifest?.kind === "ManifestEntry" ? manifest.entryHash : "", "ff");

    const audit = normalizeStrand({
      AuditTrail: { id: "a", first_seen: [2026, 195, 12, 0, 0, 0, 0, 0, 0], event_log_ref: "3" },
    });
    assert.equal(audit?.kind === "AuditTrail" ? audit.eventLogRef : "", "3");

    const marker = normalizeStrand({
      SerializationMarker: { id: "s", format_version: "0.1.0", contract_hash: [0] },
    });
    assert.equal(marker?.kind === "SerializationMarker" ? marker.formatVersion : "", "0.1.0");
  });

  it("returns null (not a fake strand) for unrecognized kinds", () => {
    assert.equal(normalizeStrand({ QuantumTether: { id: "q" } }), null);
    assert.equal(normalizeStrand("ContentHash"), null);
  });

  it("attaches the current-vs-expected fray block from verifier observations", () => {
    const strand = normalizeStrand(
      { ContentHash: { id: "s-1", algorithm: "Blake3", value: [190, 190] } },
      { "s-1": { value: [202, 202], at: [2026, 196, 9, 0, 0, 0, 0, 0, 0] } },
    );
    assert.deepEqual(strand?.fray, {
      expected: "bebe",
      observed: "caca",
      observedAt: "2026-07-15T09:00:00.000Z",
    });
  });

  it("renders a null observation as unobserved (blocked), never healthy", () => {
    const strand = normalizeStrand(
      { ContentHash: { id: "s-1", algorithm: "Blake3", value: [190] } },
      { "s-1": { value: null, at: null } },
    );
    assert.equal(strand?.fray?.observed, null);
  });
});

describe("normalizeWeaveSummary / normalizeWeaveDetail", () => {
  const rawWeave = {
    id: "11111111-1111-4111-8111-111111111111",
    familiar_id: "sage",
    threads: [
      {
        id: "aaaaaaa1-0001-4001-8001-000000000001",
        surface: "SOUL.md",
        writer: "familiar:sage",
        strands: [{ ContentHash: { id: "b-1", algorithm: "Blake3", value: [1] } }],
        holds_under: ["Mutation", "Forced"],
        created_at: [2026, 195, 12, 0, 0, 0, 0, 0, 0],
        tension: "Holds",
      },
    ],
    weave_hash: [17, 34],
    coven_ref: null,
    pattern_descriptor: {
      name: "identity-surface",
      protected_surfaces: ["SOUL.md"],
      channels_required: ["Mutation"],
      strand_requirements: [{ kind: "ContentHash", required_on_channels: ["Mutation"] }],
    },
  };

  it("builds the rail row with rollup, predicate coherence, and hash", () => {
    const summary = normalizeWeaveSummary({ weave: rawWeave, coherence: "Coherent" });
    assert.deepEqual(summary, {
      id: "11111111-1111-4111-8111-111111111111",
      familiarId: "sage",
      threadCount: 1,
      tensionRollup: { state: "holds" },
      coherence: "coherent",
      degradedSurfaces: [],
      weaveHash: "1122",
    });
  });

  it("marks the descriptor derived — it can never masquerade as enforcement (R2)", () => {
    const detail = normalizeWeaveDetail({ weave: rawWeave, coherence: "Coherent" });
    assert.equal(detail?.patternDescriptor?.derived, true);
    assert.equal(detail?.patternDescriptor?.name, "identity-surface");
  });

  it("mirrors Channel::required_strand_kinds onto covered channels", () => {
    const detail = normalizeWeaveDetail({ weave: rawWeave, coherence: "Coherent" });
    assert.deepEqual(detail?.threads[0]?.requiredStrands, {
      mutation: ["ContentHash"],
      forced: ["ContentHash", "ManifestEntry"],
    });
  });

  it("returns null for a shapeless weave instead of fabricating one", () => {
    assert.equal(normalizeWeaveSummary({ weave: { no: "id" }, coherence: "Coherent" }), null);
  });

  it("normalizes a degraded familiar entry with its sanitized daemon error (R12)", () => {
    assert.deepEqual(
      normalizeDegradedFamiliar({
        degraded: {
          familiarId: "nova",
          reason: "ward-config-unparseable",
          error: "missing field `principal_key_fingerprint`",
        },
      }),
      {
        kind: "degraded-familiar",
        familiarId: "nova",
        reason: "ward-config-unparseable",
        error: "missing field `principal_key_fingerprint`",
      },
    );
  });

  it("returns null for degraded entries without a familiar id", () => {
    assert.equal(
      normalizeDegradedFamiliar({ degraded: { reason: "ward-config-unparseable", error: "missing" } }),
      null,
    );
  });

  it("surfaces unknown degraded reason strings for forward compatibility", () => {
    const degraded = normalizeDegradedFamiliar({
      degraded: { familiarId: "echo", reason: "future-daemon-reason", error: "future parse failure" },
    });
    assert.equal(degraded?.reason, "future-daemon-reason");
    assert.equal(degraded?.error, "future parse failure");
  });

  it("lets a valid weave win when an impossible entry carries both weave and degraded", () => {
    const entry = {
      weave: rawWeave,
      coherence: "Coherent",
      degraded: { familiarId: "nova", reason: "ward-config-unparseable", error: "ignored" },
    };
    assert.equal(normalizeWeaveSummary(entry)?.id, rawWeave.id);
    assert.equal(normalizeDegradedFamiliar(entry), null);
  });
});

describe("normalizeThread", () => {
  it("drops unrecognized channels rather than widening coverage", () => {
    const thread = normalizeThread(
      {
        id: "t-1",
        surface: "SOUL.md",
        writer: "familiar:sage",
        strands: [],
        holds_under: ["Mutation", "Telepathy"],
        created_at: null,
        tension: "Holds",
      },
      "w-1",
    );
    assert.deepEqual(thread?.holdsUnder, ["mutation"]);
  });
});

describe("normalizeProposal (§2.6)", () => {
  it("canonicalizes proposal authority envelopes with recursive key sorting and top-level-only stripping", () => {
    const raw = {
      "\u{10000}": "later-code-point",
      "\uE000": "earlier-code-point",
      z: 1,
      nested: {
        b: 2,
        a: 1,
        keep: [{ z: 2, a: 1 }, { x: 1 }],
      },
      proposalRevision: "committed-staged-value",
      decisionRequest: { ignored: true },
      decisionState: { ignored: true },
      inner: {
        decisionRequest: { still: true },
        decisionState: { still: true },
      },
    };

    const expectedJson = JSON.stringify({
      inner: {
        decisionRequest: { still: true },
        decisionState: { still: true },
      },
      nested: {
        a: 1,
        b: 2,
        keep: [{ a: 1, z: 2 }, { x: 1 }],
      },
      proposalRevision: "committed-staged-value",
      z: 1,
      "\uE000": "earlier-code-point",
      "\u{10000}": "later-code-point",
    });
    const expected = createHash("sha256").update(expectedJson, "utf8").digest("hex");
    assert.equal(canonicalProposalRevision(raw), expected);
  });

  it("canonicalizes integer-like object keys in Unicode code-point order", () => {
    const raw = {
      2: "two",
      10: "ten",
      nested: {
        2: "nested-two",
        10: "nested-ten",
      },
    };
    const expectedJson = '{"10":"ten","2":"two","nested":{"10":"nested-ten","2":"nested-two"}}';
    const expected = createHash("sha256").update(expectedJson, "utf8").digest("hex");

    assert.equal(canonicalProposalRevision(raw), expected);
  });

  it("verifies the raw accepted envelope while omitting top-level procedural fields from its revision", () => {
    const { staged, daemon } = daemonContractFixture();
    const stagedWithDecision = {
      ...staged,
      decisionRequest: { decision: "approve" },
      decisionState: { status: "claimed" },
    };
    const summary = {
      ...daemon,
      proposalRevision: canonicalProposalRevision(stagedWithDecision),
    };

    assert.equal(normalizeProposalAuthority(stagedWithDecision, summary).state, "verified");
  });

  it("rejects incomplete Phase 5 scheduled authority envelopes", () => {
    const { staged, daemon } = daemonContractFixture();
    const missingFields = [
      ["schema"],
      ["pending", "channel"],
      ["pending", "fray", "Frayed", "reason"],
      ["pending", "edits", 0, "contents", "data"],
      ["classification", "approval_path", "kind"],
      ["materialized_diff", "surfaces", 0, "before"],
      ["region_evidence", 0, "rationale"],
      ["lifecycle", "state"],
      ["veto_deadline"],
      ["earliest_close"],
    ] as const;

    for (const path of missingFields) {
      const incomplete = omitEnvelopeField(staged, path);
      const summary = {
        ...daemon,
        proposalRevision: canonicalProposalRevision(incomplete),
      };
      assert.deepEqual(
        normalizeProposalAuthority(incomplete, summary),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted envelope missing ${path.join(".")}`,
      );
    }
  });

  it("rejects unknown fields at every Phase 5 scheduled-envelope object boundary", () => {
    const { staged, daemon } = daemonContractFixture();
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const unknownFields = [
      ["root", staged, daemon, [], "client_policy", "auto"],
      ["pending", staged, daemon, ["pending"], "client_policy", "auto"],
      ["pending fray payload", staged, daemon, ["pending", "fray", "Frayed"], "client_policy", "auto"],
      ["pending edit", staged, daemon, ["pending", "edits", 0], "client_policy", "auto"],
      ["staged contents", staged, daemon, ["pending", "edits", 0, "contents"], "client_policy", "auto"],
      ["classification", staged, daemon, ["classification"], "client_policy", "auto"],
      ["approval path", staged, daemon, ["classification", "approval_path"], "veto", null],
      ["veto window", vetoStaged, vetoDaemon, ["classification", "approval_path", "veto"], "client_policy", "auto"],
      [
        "veto duration",
        vetoStaged,
        vetoDaemon,
        ["classification", "approval_path", "veto", "duration"],
        "client_policy",
        "auto",
      ],
      [
        "veto minimum visibility",
        vetoStaged,
        vetoDaemon,
        ["classification", "approval_path", "veto", "min_visible"],
        "client_policy",
        "auto",
      ],
      ["materialized diff", staged, daemon, ["materialized_diff"], "client_policy", "auto"],
      ["materialized surface", staged, daemon, ["materialized_diff", "surfaces", 0], "client_policy", "auto"],
      ["region evidence", staged, daemon, ["region_evidence", 0], "client_policy", "auto"],
      ["lifecycle", staged, daemon, ["lifecycle"], "reason", "forged"],
    ] as const;

    for (const [label, baseEnvelope, baseDaemon, path, field, fieldValue] of unknownFields) {
      const invalid = addEnvelopeField(baseEnvelope, path, field, fieldValue);
      const summary = {
        ...baseDaemon,
        proposalRevision: canonicalProposalRevision(invalid),
      };
      assert.deepEqual(
        normalizeProposalAuthority(invalid, summary),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted unknown ${label} field`,
      );
    }
  });

  it("rejects invalid structural values in a Phase 5 scheduled envelope", () => {
    const { staged, daemon } = daemonContractFixture();
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const invalidEnvelopes = [
      [
        "blank blocked lifecycle reason",
        { ...staged, lifecycle: { state: "blocked", reason: " " } },
        { ...daemon, lifecycle: "blocked", blockedReason: "daemon-reported-block", earliestClose: null },
      ],
      [
        "minimum visibility longer than the veto duration",
        {
          ...vetoStaged,
          classification: {
            ...vetoStaged.classification,
            approval_path: {
              ...vetoStaged.classification.approval_path,
              veto: {
                duration: { secs: 300, nanos: 0 },
                min_visible: { secs: 301, nanos: 0 },
              },
            },
          },
        },
        vetoDaemon,
      ],
    ] as const;

    for (const [label, invalid, baseDaemon] of invalidEnvelopes) {
      const summary = {
        ...baseDaemon,
        proposalRevision: canonicalProposalRevision(invalid),
      };
      assert.deepEqual(
        normalizeProposalAuthority(invalid, summary),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted ${label}`,
      );
    }
  });

  it("accepts only the closed serde FrayReason and SnapReason variants", () => {
    const { staged, daemon } = daemonContractFixture();
    const cases = [
      ["Frayed", "ContentHashMismatch", true],
      ["Frayed", "SignatureInvalid", true],
      ["Frayed", "ManifestEntryMismatch", true],
      ["Frayed", "AuditTrailUnverifiable", true],
      ["Frayed", "SerializationMarkerMismatch", true],
      ["Frayed", { Other: "custom-fray" }, true],
      ["Frayed", { RequiredStrandMissing: { kind: "ContentHash" } }, true],
      ["Frayed", { RequiredStrandMissing: { kind: "FutureStrand" } }, false],
      ["Frayed", "FutureFrayReason", false],
      ["Frayed", "", false],
      ["Frayed", { Other: " " }, true],
      ["Snapped", "Revoked", true],
      ["Snapped", "MultipleStrandFray", true],
      ["Snapped", "PatternBroken", true],
      ["Snapped", { Other: "custom-snap" }, true],
      ["Snapped", "FutureSnapReason", false],
      ["Snapped", "", false],
      ["Snapped", { Other: " " }, true],
    ] as const;

    for (const [variant, reason, accepted] of cases) {
      const fray =
        variant === "Frayed"
          ? { Frayed: { strand: null, channel: "Mutation", reason } }
          : { Snapped: { channel: "Mutation", reason } };
      const candidate = {
        ...staged,
        pending: { ...staged.pending, fray },
      };
      const summary = {
        ...daemon,
        proposalRevision: canonicalProposalRevision(candidate),
      };
      assert.equal(
        normalizeProposalAuthority(candidate, summary).state,
        accepted ? "verified" : "blocked",
        `${variant} reason ${JSON.stringify(reason)}`,
      );
    }
  });

  it("requires every nested pending fray channel to equal pending.channel", () => {
    const { staged, daemon } = daemonContractFixture();
    const mismatchedFrays = [
      { NotCovered: { channel: "Serialization" } },
      { Frayed: { strand: null, channel: "Serialization", reason: "ContentHashMismatch" } },
      { Snapped: { channel: "Serialization", reason: "Revoked" } },
    ];

    for (const fray of mismatchedFrays) {
      const candidate = {
        ...staged,
        pending: { ...staged.pending, fray },
      };
      assert.deepEqual(
        normalizeProposalAuthority(candidate, {
          ...daemon,
          proposalRevision: canonicalProposalRevision(candidate),
        }),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted nested channel mismatch for ${Object.keys(fray)[0]}`,
      );
    }
  });

  it("requires UUID newtypes and the four exact Channel variants in staged envelopes", () => {
    const { staged, daemon } = daemonContractFixture();
    const invalid = [
      {
        label: "proposal id",
        envelope: {
          ...staged,
          pending: { ...staged.pending, id: "not-a-uuid" },
          classification: { ...staged.classification, proposal_id: "not-a-uuid" },
        },
        summary: { ...daemon, proposalId: "not-a-uuid" },
      },
      {
        label: "thread id",
        envelope: {
          ...staged,
          pending: { ...staged.pending, thread_id: "not-a-uuid" },
        },
        summary: daemon,
      },
      {
        label: "strand id",
        envelope: {
          ...staged,
          pending: {
            ...staged.pending,
            fray: {
              Frayed: {
                ...staged.pending.fray.Frayed,
                strand: "not-a-uuid",
              },
            },
          },
        },
        summary: daemon,
      },
      {
        label: "channel",
        envelope: {
          ...staged,
          pending: {
            ...staged.pending,
            channel: "Telepathy",
            fray: { Frayed: { ...staged.pending.fray.Frayed, channel: "Telepathy" } },
          },
          classification: { ...staged.classification, channel: "Telepathy" },
        },
        summary: daemon,
      },
    ];

    for (const { label, envelope, summary } of invalid) {
      assert.deepEqual(
        normalizeProposalAuthority(envelope, {
          ...summary,
          proposalRevision: canonicalProposalRevision(envelope),
        }),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted invalid ${label}`,
      );
    }
  });

  it("accepts opaque staged string newtypes and freeform diagnostic strings", () => {
    const { staged, daemon } = daemonContractFixture();
    const blankSurface = {
      ...staged,
      pending: {
        ...staged.pending,
        edits: [{ ...staged.pending.edits[0], surface: "" }],
      },
      classification: { ...staged.classification, affected_surfaces: [""] },
      materialized_diff: {
        surfaces: [{ ...staged.materialized_diff.surfaces[0], surface: "" }],
      },
      region_evidence: [{ ...staged.region_evidence[0], affected_surfaces: [""] }],
    };
    const blankRegion = {
      ...staged,
      classification: { ...staged.classification, affected_regions: [""] },
      region_evidence: [{ ...staged.region_evidence[0], region_id: "" }],
    };
    const blankRationale = {
      ...staged,
      region_evidence: [{ ...staged.region_evidence[0], rationale: " " }],
    };

    const cases = [
      {
        label: "surface id",
        envelope: blankSurface,
        summary: {
          ...daemon,
          targets: [""],
          approvalPath: { ...daemon.approvalPath, affected_surfaces: [""] },
        },
      },
      { label: "region id", envelope: blankRegion, summary: daemon },
      { label: "region rationale", envelope: blankRationale, summary: daemon },
    ];
    for (const { label, envelope, summary } of cases) {
      assert.equal(
        normalizeProposalAuthority(envelope, {
          ...summary,
          proposalRevision: canonicalProposalRevision(envelope),
        }).state,
        "verified",
        `rejected serde-valid ${label}`,
      );
    }
  });

  it("rejects Phase 5 classification identity fields that disagree with the staged proposal", () => {
    const { staged, daemon } = daemonContractFixture();
    const inconsistentClassifications = [
      ["proposal_id", "cccccccc-0001-4001-8001-000000000099"],
      ["familiar_id", "eeeeeeee-0000-4000-8000-000000000099"],
      ["channel", "Serialization"],
      ["classified_at", [2026, 196, 9, 0, 3, 0, 0, 0, 0]],
    ] as const;

    for (const [field, value] of inconsistentClassifications) {
      const inconsistent = {
        ...staged,
        classification: { ...staged.classification, [field]: value },
      };
      const summary = {
        ...daemon,
        proposalRevision: canonicalProposalRevision(inconsistent),
      };

      assert.deepEqual(
        normalizeProposalAuthority(inconsistent, summary),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted classification.${field} inconsistent with the staged proposal`,
      );
    }
  });

  it("requires pending edits, classification, materialized diff, and region evidence to agree", () => {
    const { staged, daemon } = daemonContractFixture();
    const inconsistent = [
      {
        label: "pending edit surface differs",
        envelope: {
          ...staged,
          pending: {
            ...staged.pending,
            edits: [{ surface: "EDIT-SURFACE.md", contents: { encoding: "utf8", data: "proposed" } }],
          },
        },
        daemonSurfaces: ["EDIT-SURFACE.md"],
      },
      {
        label: "pending edit contents differ",
        envelope: {
          ...staged,
          pending: {
            ...staged.pending,
            edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "different" } }],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "pending edits contain a duplicate surface",
        envelope: {
          ...staged,
          pending: {
            ...staged.pending,
            edits: [...staged.pending.edits, structuredClone(staged.pending.edits[0])],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "classification surface differs",
        envelope: {
          ...staged,
          classification: { ...staged.classification, affected_surfaces: ["CLASSIFIED.md"] },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "classification contains duplicate surfaces",
        envelope: {
          ...staged,
          classification: { ...staged.classification, affected_surfaces: ["MEMORY.md", "MEMORY.md"] },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "materialized surface differs",
        envelope: {
          ...staged,
          materialized_diff: {
            surfaces: [{ ...staged.materialized_diff.surfaces[0], surface: "MATERIALIZED.md" }],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "materialized after-image differs",
        envelope: {
          ...staged,
          materialized_diff: {
            surfaces: [
              {
                ...staged.materialized_diff.surfaces[0],
                after: Array.from(Buffer.from("different")),
              },
            ],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "materialized diff contains a duplicate surface",
        envelope: {
          ...staged,
          materialized_diff: {
            surfaces: [
              ...staged.materialized_diff.surfaces,
              structuredClone(staged.materialized_diff.surfaces[0]),
            ],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "classification region differs",
        envelope: {
          ...staged,
          classification: { ...staged.classification, affected_regions: ["other_region"] },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "classification contains duplicate regions",
        envelope: {
          ...staged,
          classification: {
            ...staged.classification,
            affected_regions: ["memory_conventions", "memory_conventions"],
          },
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "region evidence id differs",
        envelope: {
          ...staged,
          region_evidence: [{ ...staged.region_evidence[0], region_id: "other_region" }],
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "region evidence references a surface outside the diff",
        envelope: {
          ...staged,
          region_evidence: [{ ...staged.region_evidence[0], affected_surfaces: ["OUTSIDE.md"] }],
        },
        daemonSurfaces: ["MEMORY.md"],
      },
      {
        label: "region evidence contains a duplicate region",
        envelope: {
          ...staged,
          region_evidence: [...staged.region_evidence, structuredClone(staged.region_evidence[0])],
        },
        daemonSurfaces: ["MEMORY.md"],
      },
    ];

    for (const { label, envelope, daemonSurfaces } of inconsistent) {
      const summary = {
        ...daemon,
        targets: daemonSurfaces,
        approvalPath: { ...daemon.approvalPath, affected_surfaces: daemonSurfaces },
        proposalRevision: canonicalProposalRevision(envelope),
      };
      assert.deepEqual(
        normalizeProposalAuthority(envelope, summary),
        { state: "blocked", why: "daemon-mismatch" },
        `accepted ${label}`,
      );
    }
  });

  it("does not infer scheduler policy from path_tier_floor or region evidence", () => {
    const { staged, daemon } = daemonContractFixture();
    const daemonAccepted = {
      ...staged,
      classification: { ...staged.classification, path_tier_floor: 2 },
    };
    assert.equal(
      normalizeProposalAuthority(daemonAccepted, {
        ...daemon,
        proposalRevision: canonicalProposalRevision(daemonAccepted),
      }).state,
      "verified",
    );
  });

  it("binds both daemon surface sets to the pending edit target set", () => {
    const { staged, daemon } = daemonContractFixture();
    const surface = "EDIT-SURFACE.md";
    const retargeted = {
      ...staged,
      pending: {
        ...staged.pending,
        edits: [{ surface, contents: { encoding: "utf8", data: "proposed" } }],
      },
      classification: { ...staged.classification, affected_surfaces: [surface] },
      materialized_diff: {
        surfaces: [{ ...staged.materialized_diff.surfaces[0], surface }],
      },
      region_evidence: [{ ...staged.region_evidence[0], affected_surfaces: [surface] }],
    };
    const summary = {
      ...daemon,
      targets: [surface],
      approvalPath: { ...daemon.approvalPath, affected_surfaces: [surface] },
      proposalRevision: canonicalProposalRevision(retargeted),
    };

    const authority = normalizeProposalAuthority(retargeted, summary);
    assert.equal(authority.state, "verified");
    if (authority.state !== "verified") return;
    assert.deepEqual(authority.approvalPath.affectedSurfaces, [surface]);

    assert.deepEqual(normalizeProposalAuthority(retargeted, { ...summary, targets: ["MEMORY.md"] }), {
      state: "blocked",
      why: "daemon-mismatch",
    });
    assert.deepEqual(
      normalizeProposalAuthority(retargeted, {
        ...summary,
        approvalPath: { ...summary.approvalPath, affected_surfaces: ["MEMORY.md"] },
      }),
      { state: "blocked", why: "daemon-mismatch" },
    );
  });

  it("compares base64 staged contents to materialized after-image bytes", () => {
    const { staged, daemon } = daemonContractFixture();
    const binary = [0, 255, 16, 32];
    const encoded = Buffer.from(binary).toString("base64");
    const binaryEnvelope = {
      ...staged,
      pending: {
        ...staged.pending,
        edits: [{ surface: "MEMORY.md", contents: { encoding: "base64", data: encoded } }],
      },
      materialized_diff: {
        surfaces: [{ ...staged.materialized_diff.surfaces[0], after: binary }],
      },
    };
    const summary = {
      ...daemon,
      proposalRevision: canonicalProposalRevision(binaryEnvelope),
    };

    assert.equal(normalizeProposalAuthority(binaryEnvelope, summary).state, "verified");
    const noncanonical = {
      ...binaryEnvelope,
      pending: {
        ...binaryEnvelope.pending,
        edits: [{ surface: "MEMORY.md", contents: { encoding: "base64", data: `${encoded}\n=` } }],
      },
    };
    assert.deepEqual(
      normalizeProposalAuthority(noncanonical, {
        ...summary,
        proposalRevision: canonicalProposalRevision(noncanonical),
      }),
      { state: "blocked", why: "daemon-mismatch" },
    );
  });

  it("matches daemon stagedAt independently to the scheduled envelope timestamp", () => {
    const { staged, daemon } = daemonContractFixture();
    const mismatchedEnvelope = {
      ...staged,
      staged_at: [2026, 196, 9, 0, 3, 0, 0, 0, 0],
    };
    const summary = {
      ...daemon,
      proposalRevision: canonicalProposalRevision(mismatchedEnvelope),
    };

    assert.deepEqual(normalizeProposalAuthority(mismatchedEnvelope, summary), {
      state: "blocked",
      why: "daemon-mismatch",
    });
  });

  it("binds stagedAt at nanosecond precision without Date truncation", () => {
    const { staged: fixture, daemon } = daemonContractFixture();
    const stagedAt = [2026, 196, 9, 0, 2, 123_456_789, 0, 0, 0];
    const staged = {
      ...fixture,
      pending: { ...fixture.pending, staged_at: stagedAt },
      classification: { ...fixture.classification, classified_at: stagedAt },
      staged_at: stagedAt,
    };
    const exact = {
      ...daemon,
      stagedAt: "2026-07-15T09:00:02.123456789Z",
      proposalRevision: canonicalProposalRevision(staged),
    };

    assert.equal(normalizeProposalAuthority(staged, exact).state, "verified");
    assert.deepEqual(
      normalizeProposalAuthority(staged, {
        ...exact,
        stagedAt: "2026-07-15T09:00:02.123456788Z",
      }),
      { state: "blocked", why: "daemon-mismatch" },
    );
  });

  it("binds the daemon to the staged timestamp's canonical textual representation", () => {
    const { staged: fixture, daemon } = daemonContractFixture();
    const stagedAt = [2026, 196, 9, 0, 2, 0, 2, 0, 0];
    const staged = {
      ...fixture,
      pending: { ...fixture.pending, staged_at: stagedAt },
      classification: { ...fixture.classification, classified_at: stagedAt },
      staged_at: stagedAt,
    };
    const exact = {
      ...daemon,
      stagedAt: "2026-07-15T09:00:02+02:00",
      proposalRevision: canonicalProposalRevision(staged),
    };

    assert.equal(normalizeProposalAuthority(staged, exact).state, "verified");
    assert.deepEqual(
      normalizeProposalAuthority(staged, {
        ...exact,
        stagedAt: "2026-07-15T07:00:02Z",
      }),
      { state: "blocked", why: "daemon-mismatch" },
    );
  });

  it("canonicalizes strict string-form staged timestamps before binding", () => {
    const { staged: fixture, daemon } = daemonContractFixture();
    const stagedAt = "2026-07-15T09:00:02.1200+00:00";
    const staged = {
      ...fixture,
      pending: { ...fixture.pending, staged_at: stagedAt },
      classification: { ...fixture.classification, classified_at: stagedAt },
      staged_at: stagedAt,
    };
    const summary = {
      ...daemon,
      stagedAt: "2026-07-15T09:00:02.12Z",
      proposalRevision: canonicalProposalRevision(staged),
    };

    assert.equal(normalizeProposalAuthority(staged, summary).state, "verified");
    assert.deepEqual(
      normalizeProposalAuthority(staged, {
        ...summary,
        stagedAt,
      }),
      { state: "blocked", why: "daemon-mismatch" },
    );
  });

  it("rejects Date-parseable timestamps that are not strict RFC3339", () => {
    const { staged, daemon } = daemonContractFixture();
    for (const malformed of ["2026-07-15 09:00:02Z", "2026-02-30T09:00:02Z"]) {
      assert.equal(Number.isFinite(Date.parse(malformed)), true);
      assert.deepEqual(normalizeProposalAuthority(staged, { ...daemon, stagedAt: malformed }), {
        state: "blocked",
        why: "daemon-unparseable",
      });
    }
    assert.deepEqual(
      normalizeProposalAuthority(staged, {
        ...daemon,
        approvalPath: {
          ...daemon.approvalPath,
          variant: "familiar_coherence",
          label: "familiar_review",
          veto_deadline: "2026-07-15 09:30:00Z",
        },
        lifecycle: "veto_window_open",
        earliestClose: "2026-07-15T09:05:00Z",
      }),
      { state: "blocked", why: "daemon-unparseable" },
    );
    assert.deepEqual(
      normalizeProposalAuthority(staged, {
        ...daemon,
        approvalPath: {
          ...daemon.approvalPath,
          variant: "familiar_coherence",
          label: "familiar_review",
          veto_deadline: "2026-07-15T09:30:00Z",
        },
        lifecycle: "veto_window_open",
        earliestClose: "July 15, 2026 09:05:00 UTC",
      }),
      { state: "blocked", why: "daemon-unparseable" },
    );
  });

  it("rejects off-wire daemon summary aliases", () => {
    const { staged, daemon } = daemonContractFixture();
    assert.equal(normalizeProposalAuthority(staged, daemon).state, "verified");
    const aliasSummaries = [
      {
        ...daemon,
        approvalPath: {
          variant: daemon.approvalPath.variant,
          label: daemon.approvalPath.label,
          vetoDeadline: null,
          affected_surfaces: daemon.approvalPath.affected_surfaces,
        },
      },
      {
        ...daemon,
        approvalPath: {
          variant: daemon.approvalPath.variant,
          label: daemon.approvalPath.label,
          veto_deadline: null,
          affectedSurfaces: daemon.approvalPath.affected_surfaces,
        },
      },
      Object.assign(
        Object.fromEntries(Object.entries(daemon).filter(([key]) => key !== "stagedAt")),
        { staged_at: daemon.stagedAt },
      ),
      Object.assign(
        Object.fromEntries(Object.entries(daemon).filter(([key]) => key !== "earliestClose")),
        { earliest_close: daemon.earliestClose },
      ),
      Object.assign(
        Object.fromEntries(Object.entries(daemon).filter(([key]) => key !== "affectedRegions")),
        { affected_regions: daemon.affectedRegions },
      ),
    ];

    for (const summary of aliasSummaries) {
      assert.equal(normalizeProposalAuthority(staged, summary).state, "blocked");
    }
  });

  it("normalizes a staged PendingProposal", () => {
    const view = normalizeProposal("fam-prop.json", {
      id: "cccccccc-0001-4001-8001-000000000001",
      familiar_id: "eeeeeeee-0000-4000-8000-000000000001",
      writer: "familiar:echo",
      channel: "Mutation",
      thread_id: "aaaaaaa2-0002-4002-8002-000000000001",
      fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
      edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
      staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
    });
    assert.equal(view.parse, "ok");
    assert.equal(view.authority.state, "legacy");
    assert.equal(view.payload?.channel, "mutation");
    assert.equal(view.payload?.fray.state, "frayed");
    assert.deepEqual(view.payload?.edits, [
      { surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } },
    ]);
    assert.equal(view.payload?.stagedAt, "2026-07-15T09:00:02.000Z");
  });

  it("keeps a pre-Phase-5 staged file legacy when a modern daemon adds identity and revision fields", () => {
    const familiarUuid = "eeeeeeee-0000-4000-8000-000000000001";
    const proposalId = "cccccccc-0001-4001-8001-000000000001";
    const writer = "familiar:echo";
    const staged = {
      id: proposalId,
      familiar_id: familiarUuid,
      writer,
      channel: "Mutation",
      thread_id: "aaaaaaa2-0002-4002-8002-000000000001",
      fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
      edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
      staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
    };
    const legacySummary = {
      proposalId,
      familiarId: "echo",
      writer,
      stagedAt: "2026-07-15T09:00:02Z",
      targets: ["MEMORY.md"],
      reviewKind: "authority",
      familiarUuid,
      proposalRevision: "a".repeat(64),
    };

    assert.deepEqual(normalizeProposalAuthority(staged, legacySummary), {
      state: "legacy",
      reviewKind: "authority",
    });
  });

  it("blocks a legacy-shaped staged file carrying a partial Phase 5 envelope marker", () => {
    const staged = {
      id: "cccccccc-0001-4001-8001-000000000001",
      familiar_id: "eeeeeeee-0000-4000-8000-000000000001",
      writer: "familiar:echo",
      channel: "Mutation",
      thread_id: "aaaaaaa2-0002-4002-8002-000000000001",
      fray: { Frayed: { strand: null, channel: "Mutation", reason: "ContentHashMismatch" } },
      edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
      staged_at: [2026, 196, 9, 0, 2, 0, 0, 0, 0],
      schema: "phase5_v1",
    };

    assert.deepEqual(normalizeProposalAuthority(staged), {
      state: "blocked",
      why: "daemon-mismatch",
    });
  });

  it("classifies a Phase 5 summary missing approvalPath as daemon-unparseable", () => {
    const { staged, daemon } = daemonContractFixture();
    const { approvalPath: _approvalPath, ...missingApprovalPath } = daemon;

    assert.deepEqual(normalizeProposalAuthority(staged, missingApprovalPath), {
      state: "blocked",
      why: "daemon-unparseable",
    });
  });

  it("reserves unknown-lifecycle for otherwise parseable lifecycle and path values", () => {
    const { staged, daemon } = daemonContractFixture();
    const { approvalPath: _approvalPath, ...missingApprovalPath } = daemon;
    const malformed = [
      { ...missingApprovalPath, lifecycle: "future_lifecycle" },
      {
        ...daemon,
        approvalPath: { ...daemon.approvalPath, variant: "future_path" },
        affectedRegions: "not-an-array",
      },
    ];

    for (const summary of malformed) {
      assert.deepEqual(normalizeProposalAuthority(staged, summary), {
        state: "blocked",
        why: "daemon-unparseable",
      });
    }
  });

  it("accepts explicit null nullable deadlines but rejects malformed values", () => {
    const { staged, daemon } = daemonContractFixture();
    const nullable = normalizeProposal("phase5-nullable.json", staged, daemon);
    assert.equal(nullable.authority.state, "verified");
    if (nullable.authority.state !== "verified") return;
    assert.equal(nullable.authority.approvalPath.vetoDeadline, null);
    assert.equal(nullable.authority.earliestClose, null);

    const malformedVeto = normalizeProposal(
      "phase5-malformed-veto.json",
      staged,
      { ...daemon, approvalPath: { ...daemon.approvalPath, veto_deadline: "not-a-timestamp" } },
    );
    assert.equal(malformedVeto.authority.state, "blocked");

    const malformedClose = normalizeProposal(
      "phase5-malformed-close.json",
      staged,
      { ...daemon, earliestClose: "not-a-timestamp" },
    );
    assert.equal(malformedClose.authority.state, "blocked");
  });

  it("uses staged familiar_id as the canonical familiar UUID", () => {
    const { staged, daemon } = daemonContractFixture();
    const view = normalizeProposal("phase5-snake-familiar.json", staged, daemon);
    assert.equal(view.payload?.familiarId, "eeeeeeee-0000-4000-8000-000000000098");
    assert.equal(view.authority.state, "verified");
  });

  it("keeps affectedRegions as daemon display metadata", () => {
    const { staged, daemon } = daemonContractFixture();
    const view = normalizeProposal("phase5-regions.json", staged, {
      ...daemon,
      affectedRegions: ["display-only-region"],
    });
    assert.equal(view.authority.state, "verified");
    if (view.authority.state !== "verified") return;
    assert.deepEqual(view.authority.affectedRegions, ["display-only-region"]);
  });

  it("treats daemon approval labels and deadline metadata as authoritative", () => {
    const { staged, daemon } = daemonContractFixture();
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const accepted = [
      {
        staged,
        summary: {
          ...daemon,
          approvalPath: { ...daemon.approvalPath, label: "Review with your own words" },
        },
        label: "Review with your own words",
      },
      {
        staged,
        summary: {
          ...daemon,
          approvalPath: { ...daemon.approvalPath, label: "human_required" },
        },
        label: "human_required",
      },
      {
        staged,
        summary: {
          ...daemon,
          approvalPath: {
            ...daemon.approvalPath,
            veto_deadline: "2026-07-15T09:30:02Z",
          },
        },
        label: "human_review",
      },
      {
        staged: vetoStaged,
        summary: {
          ...vetoDaemon,
          approvalPath: { ...vetoDaemon.approvalPath, veto_deadline: null },
          lifecycle: "ready_for_replay",
        },
        label: "familiar_review",
      },
    ];

    for (const [index, { staged: candidate, summary, label }] of accepted.entries()) {
      const authority = normalizeProposal(`phase5-authoritative-${index}.json`, candidate, summary).authority;
      assert.equal(authority.state, "verified");
      if (authority.state !== "verified") continue;
      assert.equal(authority.approvalPath.label, label);
    }
  });

  it("classifies unknown path and lifecycle enum values as unknown-lifecycle", () => {
    const { staged, daemon } = daemonContractFixture();
    const unknown = [
      {
        ...daemon,
        approvalPath: { ...daemon.approvalPath, variant: "future_path" },
      },
      {
        ...daemon,
        lifecycle: "future_lifecycle",
      },
      {
        ...daemon,
        approvalPath: { ...daemon.approvalPath, variant: "toString" },
      },
      {
        ...daemon,
        lifecycle: "toString",
      },
    ];

    for (const summary of unknown) {
      assert.deepEqual(normalizeProposalAuthority(staged, summary), {
        state: "blocked",
        why: "unknown-lifecycle",
      });
    }
  });

  it("preserves arbitrary daemon approval labels verbatim", () => {
    const { staged, daemon } = daemonContractFixture();
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const autoStaged = {
      ...staged,
      classification: {
        ...staged.classification,
        approval_path: { kind: "auto_regression", veto: null },
      },
      lifecycle: { state: "ready_for_replay" },
    };
    const rationaleStaged = {
      ...staged,
      classification: {
        ...staged.classification,
        approval_path: { kind: "human_approval_with_rationale" },
      },
    };
    const cases = [
      {
        staged: autoStaged,
        summary: {
          ...daemon,
          proposalRevision: canonicalProposalRevision(autoStaged),
          approvalPath: {
            ...daemon.approvalPath,
            variant: "auto_regression",
            label: "Automatic after checks",
          },
          lifecycle: "ready_for_replay",
        },
        label: "Automatic after checks",
      },
      {
        staged: vetoStaged,
        summary: {
          ...vetoDaemon,
          approvalPath: { ...vetoDaemon.approvalPath, label: "Sage may veto" },
        },
        label: "Sage may veto",
      },
      {
        staged,
        summary: {
          ...daemon,
          approvalPath: { ...daemon.approvalPath, label: "Principal review" },
        },
        label: "Principal review",
      },
      {
        staged: rationaleStaged,
        summary: {
          ...daemon,
          proposalRevision: canonicalProposalRevision(rationaleStaged),
          approvalPath: {
            ...daemon.approvalPath,
            variant: "human_approval_with_rationale",
            label: "Review with your own words",
          },
        },
        label: "Review with your own words",
      },
    ];

    for (const testCase of cases) {
      const authority = normalizeProposalAuthority(testCase.staged, testCase.summary);
      assert.equal(authority.state, "verified", testCase.label);
      if (authority.state !== "verified") continue;
      assert.equal(authority.approvalPath.label, testCase.label);
    }
  });

  it("does not derive daemon approval or lifecycle metadata from the staged envelope", () => {
    const { staged, daemon } = daemonContractFixture();
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const authoritative = [
      {
        staged,
        summary: {
          ...daemon,
          approvalPath: {
            ...daemon.approvalPath,
            variant: "human_approval_with_rationale",
            label: "Review with your own words",
          },
        },
        decisions: ["approve", "reject"],
      },
      {
        staged: vetoStaged,
        summary: {
          ...vetoDaemon,
          approvalPath: {
            ...vetoDaemon.approvalPath,
            variant: "auto_regression",
            label: "Automatic after veto",
            veto_deadline: "2026-07-15T09:30:03Z",
          },
        },
        decisions: ["reject"],
      },
      {
        staged,
        summary: {
          ...daemon,
          lifecycle: "ready_for_replay",
        },
        decisions: [],
      },
    ];

    for (const { staged: candidate, summary, decisions } of authoritative) {
      const authority = normalizeProposalAuthority(candidate, summary);
      assert.equal(authority.state, "verified");
      if (authority.state !== "verified") continue;
      assert.deepEqual(authority.availableDecisions, decisions);
    }
  });

  it("accepts a nullable blocked reason and exposes no blocked actions", () => {
    const { staged, daemon } = daemonContractFixture();
    const authority = normalizeProposalAuthority(staged, {
      ...daemon,
      lifecycle: "blocked",
      blockedReason: null,
    });

    assert.equal(authority.state, "verified");
    if (authority.state !== "verified") return;
    assert.equal(authority.blockedReason, null);
    assert.deepEqual(authority.availableDecisions, []);
  });

  it("requires daemon summaries to contain an explicit blockedReason key", () => {
    const { staged, daemon } = daemonContractFixture();
    const { blockedReason: _blockedReason, ...missingBlockedReason } = daemon;

    assert.deepEqual(normalizeProposalAuthority(staged, missingBlockedReason), {
      state: "blocked",
      why: "daemon-unparseable",
    });
  });

  it("rejects blank or non-string daemon blockedReason and preserves unknown nonblank strings", () => {
    const { staged, daemon } = daemonContractFixture();
    for (const blockedReason of ["", " ", 42, { reason: "nested" }]) {
      assert.deepEqual(
        normalizeProposalAuthority(staged, {
          ...daemon,
          lifecycle: "blocked",
          blockedReason,
        }),
        { state: "blocked", why: "daemon-unparseable" },
      );
    }

    const authority = normalizeProposalAuthority(staged, {
      ...daemon,
      lifecycle: "blocked",
      blockedReason: "future-daemon-block",
    });
    assert.equal(authority.state, "verified");
    if (authority.state !== "verified") return;
    assert.equal(authority.blockedReason, "future-daemon-block");
  });

  it("accepts ready-for-replay after a veto-bearing path", () => {
    const { staged, daemon } = vetoContractFixture();
    const authority = normalizeProposalAuthority(staged, {
      ...daemon,
      lifecycle: "ready_for_replay",
    });

    assert.equal(authority.state, "verified");
    if (authority.state !== "verified") return;
    assert.deepEqual(authority.availableDecisions, []);
  });

  it("treats earliestClose as independent display data", () => {
    const { staged, daemon } = daemonContractFixture();
    const summaries = [
      {
        ...daemon,
        earliestClose: "2026-07-15T09:05:00Z",
      },
      {
        ...daemon,
        earliestClose: null,
      },
    ];

    for (const [index, summary] of summaries.entries()) {
      assert.equal(
        normalizeProposal(`phase5-independent-close-${index}.json`, staged, summary).authority.state,
        "verified",
        `independent earliestClose case ${index}`,
      );
    }
  });

  it("maps veto-bearing auto and familiar paths to reject only", () => {
    const { staged: vetoStaged, daemon: vetoDaemon } = vetoContractFixture();
    const autoStaged = {
      ...vetoStaged,
      classification: {
        ...vetoStaged.classification,
        approval_path: {
          kind: "auto_regression",
          veto: vetoStaged.classification.approval_path.veto,
        },
      },
    };
    const cases = [
      { staged: vetoStaged, summary: vetoDaemon, variant: "familiar_coherence" },
      {
        staged: autoStaged,
        summary: {
          ...vetoDaemon,
          proposalRevision: canonicalProposalRevision(autoStaged),
          approvalPath: {
            ...vetoDaemon.approvalPath,
            variant: "auto_regression",
            label: "auto",
          },
        },
        variant: "auto_regression",
      },
    ];

    for (const testCase of cases) {
      const authority = normalizeProposalAuthority(testCase.staged, testCase.summary);
      assert.equal(authority.state, "verified", testCase.variant);
      if (authority.state !== "verified") continue;
      assert.deepEqual(authority.availableDecisions, ["reject"], testCase.variant);
    }
  });

  it("normalizes a Phase 5 raw envelope into verified authority with exact lifecycle mapping", () => {
    const { staged: baseStaged, daemon } = daemonContractFixture();
    const staged = {
      ...baseStaged,
      classification: {
        ...baseStaged.classification,
        approval_path: { kind: "human_approval_with_rationale" },
      },
    };
    const summary = {
      ...daemon,
      proposalRevision: canonicalProposalRevision(staged),
      approvalPath: {
        variant: "human_approval_with_rationale",
        label: "human_required",
        veto_deadline: null,
        affected_surfaces: ["MEMORY.md"],
      },
    };

    const authority = normalizeProposalAuthority(staged, summary);
    assert.deepEqual(authority, {
      state: "verified",
      proposalRevision: summary.proposalRevision,
      familiarUuid: daemon.familiarUuid,
      approvalPath: {
        variant: "human-approval-with-rationale",
        label: "human_required",
        vetoDeadline: null,
        affectedSurfaces: ["MEMORY.md"],
      },
      lifecycle: "awaiting-human-approval",
      blockedReason: null,
      earliestClose: null,
      affectedRegions: ["memory_conventions"],
      availableDecisions: ["approve", "reject"],
    });

    const view = normalizeProposal("phase5.json", staged, summary);
    assert.equal(view.parse, "ok");
    assert.equal(view.authority.state, "verified");
    assert.equal(view.authority.approvalPath.label, "human_required");
    assert.deepEqual(view.authority.availableDecisions, ["approve", "reject"]);
  });

  it("maps veto-window-open proposals to reject only", () => {
    const { staged, daemon } = vetoContractFixture();
    const view = normalizeProposal("phase5-veto.json", staged, daemon);
    assert.equal(view.authority.state, "verified");
    assert.deepEqual(view.authority.availableDecisions, ["reject"]);
    assert.equal(view.authority.approvalPath.label, "familiar_review");
  });

  it("blocks mismatched phase 5 authority instead of falling back to legacy", () => {
    const { staged, daemon } = daemonContractFixture();
    const summary = {
      ...daemon,
      proposalRevision: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    };

    const view = normalizeProposal("phase5-mismatch.json", staged, summary);
    assert.equal(view.authority.state, "blocked");
    assert.notEqual(view.authority.state, "legacy");
  });

  it("marks structurally invalid payloads corrupt (R6) — no partial salvage", () => {
    assert.equal(normalizeProposal("f.json", { id: "x" }).parse, "corrupt");
    assert.equal(
      normalizeProposal("f.json", {
        id: "x",
        edits: [{ surface: "MEMORY.md", contents: { encoding: "hex", data: "??" } }],
      }).parse,
      "corrupt",
    );
    assert.equal(normalizeProposal("f.json", "nope").parse, "corrupt");
  });
});

describe("normalizeAuditRow (§2.5)", () => {
  it("maps a sqlite-shaped row (JSON-string files_touched, hex ward_hash)", () => {
    const row = normalizeAuditRow({
      id: 2,
      event_type: "proposal_submitted",
      proposal_id: "cccccccc-0001-4001-8001-000000000001",
      familiar_id: "echo",
      ward_version: null,
      ward_hash: "2222444466668888",
      tier: null,
      decision: "degrade_to_proposal",
      approver: null,
      diff_hash: "0102",
      files_touched: '["MEMORY.md"]',
      channel: "mutation",
      thread_id: "aaaaaaa2-0002-4002-8002-000000000001",
      submitted_at: "2026-07-15T09:00:00Z",
      decided_at: "2026-07-15T09:00:01Z",
      recorded_at: "2026-07-15T09:00:01.200Z",
    });
    assert.equal(row?.eventType, "proposal_submitted");
    assert.equal(row?.wardHash, "2222444466668888");
    assert.deepEqual(row?.filesTouched, ["MEMORY.md"]);
    assert.equal(row?.diffHash, "0102");
  });

  it("maps BLOB ward_hash from the sqlite driver (Uint8Array)", () => {
    const row = normalizeAuditRow({
      id: 1,
      event_type: "validation_verdict",
      familiar_id: "sage",
      ward_hash: new Uint8Array([0xab, 0xcd]),
      decision: "permit",
      files_touched: "[]",
      submitted_at: "2026-07-15T09:00:00Z",
      decided_at: "2026-07-15T09:00:00Z",
      recorded_at: "2026-07-15T09:00:00Z",
    });
    assert.equal(row?.wardHash, "abcd");
  });

  it("rejects rows without a numeric id", () => {
    assert.equal(normalizeAuditRow({ id: "not-a-number", familiar_id: "x" }), null);
  });
});

describe("envelope + staleness (§3.8, §3.9)", () => {
  it("stamps observedAt/staleAfter with the TTL", () => {
    const observed = new Date("2026-07-15T09:00:00Z");
    const meta = makeThreadsMeta({
      adapter: "fixtures",
      sourceCursor: "weave:abc",
      verified: true,
      observedAt: observed,
    });
    assert.equal(meta.observedAt, "2026-07-15T09:00:00.000Z");
    assert.equal(Date.parse(meta.staleAfter) - Date.parse(meta.observedAt), THREADS_STALE_TTL_MS);
  });

  it("isStale flips after staleAfter and fails closed on unparseable metadata (R9/R8)", () => {
    const meta = makeThreadsMeta({
      adapter: "fixtures",
      sourceCursor: "c",
      verified: true,
      observedAt: new Date("2026-07-15T09:00:00Z"),
    });
    assert.equal(isStale(meta, new Date("2026-07-15T09:00:10Z")), false);
    assert.equal(isStale(meta, new Date("2026-07-15T09:01:00Z")), true);
    assert.equal(isStale({ ...meta, staleAfter: "garbage" }, new Date("2026-07-15T09:00:00Z")), true);
  });

  it("blockedEnvelope forces verified: false — a blocked answer is never verified", () => {
    const meta = makeThreadsMeta({ adapter: "daemon", sourceCursor: "none", verified: true });
    const envelope = blockedEnvelope("daemon-unreachable", meta);
    assert.equal(envelope.blocked, true);
    assert.equal(envelope.meta.verified, false);
    assert.equal(envelope.data, null);
  });
});

describe("helpers", () => {
  it("bytesToHex handles arrays, hex strings, and rejects the rest", () => {
    assert.equal(bytesToHex([0, 255]), "00ff");
    assert.equal(bytesToHex("ABCD"), "abcd");
    assert.equal(bytesToHex("not hex!"), null);
    assert.equal(bytesToHex([256]), null);
  });

  it("normalizeChannel accepts crate casing and rejects unknowns", () => {
    assert.equal(normalizeChannel("Mutation"), "mutation");
    assert.equal(normalizeChannel("deliberate"), "deliberate");
    assert.equal(normalizeChannel("Telepathy"), null);
  });

  it("isSafeThreadsId only passes UUIDs — ids interpolate into paths", () => {
    assert.equal(isSafeThreadsId("cccccccc-0001-4001-8001-000000000001"), true);
    assert.equal(isSafeThreadsId("../../../etc/passwd"), false);
    assert.equal(isSafeThreadsId("cccccccc-0001-4001-8001-000000000001.json"), false);
    assert.equal(isSafeThreadsId(""), false);
  });
});
