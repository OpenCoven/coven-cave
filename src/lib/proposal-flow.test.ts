// Behavioral tests for the proposal approval view model (threads-986.17.6):
// list model ordering, decision availability (fail-closed on fixtures /
// stale / blocked / corrupt), decision outcomes from route responses, and
// the full-desired-contents edit previews.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decisionAvailability,
  decisionOutcomeFromResponse,
  editPreviews,
  fraySummary,
  proposalListModel,
} from "./proposal-flow.ts";
import { makeThreadsMeta, okEnvelope } from "./threads-read.ts";
import type { ProposalView, ThreadsMeta } from "./threads-read.ts";
import { surfaceStateFromPayload, type SurfaceState } from "./weave-rail.ts";

const FRESH = new Date("2026-07-15T09:00:00Z");

function meta(adapter: "fixtures" | "daemon"): ThreadsMeta {
  return makeThreadsMeta({ adapter, sourceCursor: "pending:abc", verified: true, observedAt: FRESH });
}

function proposal(id: string, stagedAt: string | null, parse: "ok" | "corrupt" = "ok"): ProposalView {
  if (parse === "corrupt") return { file: `${id}.json`, parse: "corrupt", payload: null };
  return {
    file: `fam-${id}.json`,
    parse: "ok",
    payload: {
      id,
      familiarId: "fam-uuid",
      writer: "familiar:echo",
      channel: "mutation",
      threadId: "t-1",
      fray: {
        state: "frayed",
        strand: "s-1",
        channel: "mutation",
        reason: { kind: "content-hash-mismatch" },
        detectedAt: null,
      },
      edits: [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "proposed" } }],
      stagedAt,
    },
  };
}

function readyState(adapter: "fixtures" | "daemon", proposals: ProposalView[]): SurfaceState<ProposalView[]> {
  return surfaceStateFromPayload<ProposalView[]>(okEnvelope(proposals, meta(adapter)), FRESH);
}

describe("proposalListModel", () => {
  it("splits ok from corrupt and orders ok oldest-staged-first", () => {
    const model = proposalListModel([
      proposal("b", "2026-07-15T09:30:00.000Z"),
      proposal("bad", null, "corrupt"),
      proposal("a", "2026-07-15T09:00:02.000Z"),
    ]);
    assert.deepEqual(
      model.ok.map((p) => p.payload?.id),
      ["a", "b"],
    );
    assert.equal(model.corrupt.length, 1);
  });
});

describe("decisionAvailability — decisions only on fresh verified daemon state", () => {
  it("allowed on a fresh daemon-adapter surface", () => {
    const state = readyState("daemon", []);
    assert.deepEqual(decisionAvailability(state, proposal("a", null)), { allowed: true });
  });

  it("R5: fixtures mode disables decisions with the no-daemon reason", () => {
    const state = readyState("fixtures", []);
    const availability = decisionAvailability(state, proposal("a", null));
    assert.equal(availability.allowed, false);
    assert.match(availability.allowed ? "" : availability.reason, /no daemon/i);
  });

  it("R9: a stale surface disables decisions", () => {
    const stale = surfaceStateFromPayload<ProposalView[]>(
      okEnvelope([], meta("daemon")),
      new Date("2026-07-15T09:01:00Z"),
    );
    const availability = decisionAvailability(stale, proposal("a", null));
    assert.equal(availability.allowed, false);
    assert.match(availability.allowed ? "" : availability.reason, /stale/i);
  });

  it("R6: a corrupt proposal is never actionable, whatever the surface", () => {
    const availability = decisionAvailability(readyState("daemon", []), proposal("x", null, "corrupt"));
    assert.equal(availability.allowed, false);
    assert.match(availability.allowed ? "" : availability.reason, /corrupt/i);
  });

  it("blocked and loading surfaces disable decisions", () => {
    const blocked: SurfaceState<ProposalView[]> = {
      kind: "blocked",
      why: "daemon-timeout",
      message: "x",
      meta: null,
    };
    assert.equal(decisionAvailability(blocked, proposal("a", null)).allowed, false);
    assert.equal(decisionAvailability({ kind: "loading" }, proposal("a", null)).allowed, false);
  });
});

describe("decisionOutcomeFromResponse — refusals are visible, never quiet", () => {
  it("200 unblocked = applied (the daemon carried and audited it)", () => {
    assert.deepEqual(decisionOutcomeFromResponse("approve", 200, { data: { applied: true }, blocked: false }), {
      kind: "applied",
      decision: "approve",
    });
  });

  it("503 daemon-unavailable = refused, proposal stays pending", () => {
    const outcome = decisionOutcomeFromResponse("approve", 503, { blocked: true, why: "daemon-unavailable" });
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.message : "", /stays pending/i);
  });

  it("409 proposal-corrupt = refused, daemon never asked", () => {
    const outcome = decisionOutcomeFromResponse("reject", 409, { blocked: true, why: "proposal-corrupt" });
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.message : "", /never asked/i);
  });

  it("an unrecognized failure still reads as a refusal with nothing applied", () => {
    const outcome = decisionOutcomeFromResponse("approve", 500, "garbage");
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.message : "", /nothing was applied/i);
  });
});

describe("editPreviews — full desired contents, never diffs", () => {
  it("utf8 contents render verbatim", () => {
    const previews = editPreviews(proposal("a", null));
    assert.deepEqual(previews, [
      { surface: "MEMORY.md", encoding: "utf8", preview: "proposed", truncated: false },
    ]);
  });

  it("base64 contents render as a labeled binary size, not decoded blindly", () => {
    const p = proposal("a", null);
    p.payload!.edits = [{ surface: "MEMORY.md", contents: { encoding: "base64", data: "AAECAwQFBgc=" } }];
    const previews = editPreviews(p);
    assert.equal(previews[0]?.encoding, "base64");
    assert.match(previews[0]?.preview ?? "", /binary contents/);
  });

  it("very long utf8 contents truncate visibly", () => {
    const p = proposal("a", null);
    p.payload!.edits = [{ surface: "MEMORY.md", contents: { encoding: "utf8", data: "x".repeat(3000) } }];
    const previews = editPreviews(p);
    assert.equal(previews[0]?.truncated, true);
    assert.equal(previews[0]?.preview.length, 2000);
  });
});

describe("fraySummary — referent-bound, calm", () => {
  it("frayed names the reason and the staging consequence", () => {
    assert.match(fraySummary(proposal("a", null)), /thread frayed \(content-hash-mismatch\)/);
    assert.match(fraySummary(proposal("a", null)), /staged instead of applied/);
  });

  it("an unverifiable fray warns without inventing detail", () => {
    const p = proposal("a", null);
    p.payload!.fray = { state: "unknown", why: "unparseable" };
    assert.match(fraySummary(p), /cannot fully verify/);
  });
});
