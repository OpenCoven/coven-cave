// Behavioral tests for the strand inspection view model (threads-986.17.5):
// per-strand detail rows for all five kinds, the Frayed current-vs-expected
// diff (null observation renders blocked, never healthy), and lineage
// annotation where unresolved proposal refs are marked, never dropped (R7).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  annotateLineage,
  blamedStrandId,
  lineageLine,
  strandDetailRows,
  strandDiff,
} from "./strand-inspect.ts";
import type { AuditEntryView, StrandView, TensionView } from "./threads-read.ts";

const CONTENT_HASH: StrandView = {
  id: "s-1",
  kind: "ContentHash",
  algorithm: "blake3",
  value: "bebe",
};

describe("strandDetailRows — every strand kind renders honest detail", () => {
  it("covers all five kinds with their committed material", () => {
    const rows = (s: StrandView) => strandDetailRows(s).map((r) => `${r.label}=${r.value}`);

    assert.match(rows(CONTENT_HASH).join("|"), /algorithm=blake3/);
    assert.match(rows(CONTENT_HASH).join("|"), /committed hash=bebe/);

    assert.match(
      rows({ id: "s", kind: "Signature", keyId: "principal:val", sigKind: "principal-attestation", value: "4d4e" }).join("|"),
      /key=principal:val/,
    );
    assert.match(
      rows({ id: "s", kind: "ManifestEntry", manifestId: "man-1", entryHash: "2122" }).join("|"),
      /entry hash=2122/,
    );
    assert.match(
      rows({ id: "s", kind: "AuditTrail", firstSeen: "2026-07-14T12:00:00.000Z", eventLogRef: "3" }).join("|"),
      /event ref=3/,
    );
    assert.match(
      rows({ id: "s", kind: "SerializationMarker", formatVersion: "0.1.0", contractHash: "090a" }).join("|"),
      /format version=0\.1\.0/,
    );
  });

  it("says (empty)/(unknown) rather than hiding absent material", () => {
    const rows = strandDetailRows({ id: "s", kind: "ContentHash", algorithm: "unknown", value: "" });
    assert.match(rows.map((r) => r.value).join("|"), /\(empty\)/);
    const audit = strandDetailRows({ id: "s", kind: "AuditTrail", firstSeen: null, eventLogRef: "" });
    assert.match(audit.map((r) => r.value).join("|"), /\(unknown\)/);
  });
});

describe("strandDiff — current-vs-expected on the blamed strand", () => {
  it("no fray block means no diff", () => {
    assert.equal(strandDiff(CONTENT_HASH), null);
  });

  it("mismatched observation renders with matches=false", () => {
    const diff = strandDiff({
      ...CONTENT_HASH,
      fray: { expected: "bebe", observed: "caca", observedAt: "2026-07-15T09:00:00.000Z" },
    });
    assert.deepEqual(diff, {
      strandId: "s-1",
      expected: "bebe",
      observed: "caca",
      observedAt: "2026-07-15T09:00:00.000Z",
      matches: false,
    });
  });

  it("a null observation is matches=null — blocked, never healthy (fail-closed)", () => {
    const diff = strandDiff({
      ...CONTENT_HASH,
      fray: { expected: "bebe", observed: null, observedAt: null },
    });
    assert.equal(diff?.observed, null);
    assert.equal(diff?.matches, null);
  });
});

describe("blamedStrandId", () => {
  it("only a frayed tension blames a strand", () => {
    const frayed: TensionView = {
      state: "frayed",
      strand: "s-1",
      channel: "mutation",
      reason: { kind: "content-hash-mismatch" },
      detectedAt: null,
    };
    assert.equal(blamedStrandId(frayed), "s-1");
    assert.equal(blamedStrandId({ state: "holds" }), null);
    assert.equal(blamedStrandId({ state: "unknown", why: "unparseable" }), null);
  });
});

describe("lineage (R7: unresolved refs marked, never dropped)", () => {
  const entry = (id: number, proposalId: string | null): AuditEntryView => ({
    id,
    eventType: "proposal_submitted",
    proposalId,
    familiarId: "echo",
    wardVersion: null,
    wardHash: "2222",
    tier: null,
    decision: "degrade_to_proposal",
    approver: null,
    diffHash: null,
    filesTouched: ["MEMORY.md"],
    channel: "mutation",
    threadId: "t-1",
    submittedAt: "2026-07-15T09:00:00Z",
    decidedAt: "2026-07-15T09:00:01Z",
    recordedAt: "2026-07-15T09:00:01.200Z",
  });

  it("marks entries whose proposal no longer resolves — and keeps them listed", () => {
    const known = new Set(["cccccccc-0001-4001-8001-000000000001"]);
    const annotated = annotateLineage(
      [entry(2, "cccccccc-0001-4001-8001-000000000001"), entry(4, "ffffffff-9999-4999-8999-999999999999"), entry(1, null)],
      known,
    );
    assert.equal(annotated.length, 3, "nothing dropped");
    assert.equal(annotated[0]?.unresolvedProposalRef, false);
    assert.equal(annotated[1]?.unresolvedProposalRef, true);
    assert.equal(annotated[2]?.unresolvedProposalRef, false, "no ref = nothing unresolved");
  });

  it("lineageLine is audit-legible: id, event, decision, channel, files", () => {
    assert.equal(
      lineageLine(entry(2, null)),
      "#2 proposal_submitted → degrade_to_proposal on mutation · MEMORY.md",
    );
  });
});
