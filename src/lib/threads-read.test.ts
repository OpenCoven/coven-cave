// Behavioral tests for the Phase 4 read models (spec: coven-threads
// specs/PHASE-4-CAVE-SURFACES.md). The fail-closed rendering rules R1/R2/R9/
// R10 live here at the pure-logic layer; adapter-level rules are covered in
// threads-adapters.test.ts.
import assert from "node:assert/strict";
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
  normalizeProposal,
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
    assert.equal(view.payload?.channel, "mutation");
    assert.equal(view.payload?.fray.state, "frayed");
    assert.deepEqual(view.payload?.edits, [
      { surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } },
    ]);
    assert.equal(view.payload?.stagedAt, "2026-07-15T09:00:02.000Z");
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
