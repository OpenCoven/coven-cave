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
import type { ProposalAuthorityVerifiedView } from "./proposal-authority.ts";
import {
  responseEnvelopeStateAt,
  scheduleResponseEnvelopeStaleness,
} from "./response-envelope-freshness.ts";
import { makeThreadsMeta, okEnvelope } from "./threads-read.ts";
import type { ProposalView, ThreadsMeta } from "./threads-read.ts";
import { surfaceStateFromPayload, type SurfaceState } from "./weave-rail.ts";

const FRESH = new Date("2026-07-15T09:00:00Z");
const PROPOSAL_REVISION = "a".repeat(64);

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
    authority: { state: "legacy", reviewKind: "authority" },
  };
}

function phase5Proposal(overrides: Partial<ProposalAuthorityVerifiedView> = {}): ProposalView {
  const result = proposal("phase5", "2026-07-15T09:00:00Z");
  result.authority = {
    state: "verified",
    proposalRevision: PROPOSAL_REVISION,
    familiarUuid: "eeeeeeee-0000-4000-8000-000000000501",
    approvalPath: {
      variant: "human-approval",
      label: "Review exactly as the daemon wrote this",
      vetoDeadline: null,
      affectedSurfaces: ["MEMORY.md"],
    },
    lifecycle: "awaiting-human-approval",
    blockedReason: null,
    earliestClose: null,
    affectedRegions: ["memory_conventions"],
    availableDecisions: ["approve", "reject"],
    ...overrides,
  };
  return result;
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

describe("decisionAvailability — authority-driven, decision-specific actions", () => {
  it("preserves generic Phase 4 approve/reject actions without a revision", () => {
    const state = readyState("daemon", []);
    assert.deepEqual(decisionAvailability(state, proposal("a", null)), {
      allowed: true,
      actions: [
        { decision: "approve", label: "Approve", enabled: true },
        { decision: "reject", label: "Reject", enabled: true },
      ],
    });
  });

  it("offers approve/reject for verified awaiting-human-approval authority", () => {
    assert.deepEqual(decisionAvailability(readyState("daemon", []), phase5Proposal()), {
      allowed: true,
      expectedRevision: PROPOSAL_REVISION,
      actions: [
        { decision: "approve", label: "Approve", enabled: true },
        { decision: "reject", label: "Reject", enabled: true },
      ],
    });
  });

  it("keeps rationale approval disabled until the trimmed note is nonempty while reject remains enabled", () => {
    const proposal = phase5Proposal({
      approvalPath: {
        variant: "human-approval-with-rationale",
        label: "Explain approval",
        vetoDeadline: null,
        affectedSurfaces: ["MEMORY.md"],
      },
    });

    assert.deepEqual(decisionAvailability(readyState("daemon", []), proposal, "   "), {
      allowed: true,
      expectedRevision: PROPOSAL_REVISION,
      actions: [
        {
          decision: "approve",
          label: "Approve",
          enabled: false,
          disabledReason:
            "Approval is disabled until you add a rationale. Reject remains available without a note.",
        },
        { decision: "reject", label: "Reject", enabled: true },
      ],
    });
    assert.deepEqual(decisionAvailability(readyState("daemon", []), proposal, "because it is correct").actions, [
      { decision: "approve", label: "Approve", enabled: true },
      { decision: "reject", label: "Reject", enabled: true },
    ]);
  });

  it("renders verified reject-only veto authority as one Veto action", () => {
    const proposal = phase5Proposal({
      approvalPath: {
        variant: "familiar-coherence",
        label: "Sage may veto",
        vetoDeadline: "2026-07-15T09:42:00Z",
        affectedSurfaces: ["MEMORY.md"],
      },
      lifecycle: "veto-window-open",
      earliestClose: "2026-07-15T09:17:00Z",
      availableDecisions: ["reject"],
    });

    assert.deepEqual(decisionAvailability(readyState("daemon", []), proposal), {
      allowed: true,
      expectedRevision: PROPOSAL_REVISION,
      actions: [{ decision: "reject", label: "Veto", enabled: true }],
    });
  });

  it("offers no actions for verified ready-for-replay or blocked lifecycle", () => {
    for (const lifecycle of ["ready-for-replay", "blocked"] as const) {
      const availability = decisionAvailability(
        readyState("daemon", []),
        phase5Proposal({
          lifecycle,
          blockedReason: lifecycle === "blocked" ? "daemon-reported-block" : null,
          availableDecisions: [],
        }),
      );
      assert.equal(availability.allowed, false);
      assert.deepEqual(availability.actions, []);
    }
  });

  it("offers no actions for blocked or missing authority", () => {
    const blockedAuthority = proposal("blocked-authority", null);
    blockedAuthority.authority = { state: "blocked", why: "daemon-mismatch" };
    assert.equal(decisionAvailability(readyState("daemon", []), blockedAuthority).allowed, false);

    const unverified = proposal("unverified", null);
    delete unverified.authority;
    assert.equal(decisionAvailability(readyState("daemon", []), unverified).allowed, false);
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

  it("§3.9: a held fresh response expires without a refetch and disables every action", () => {
    const start = FRESH.getTime();
    let nextTimerId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const clock = {
      nowMs: start,
      now() {
        return this.nowMs;
      },
      setTimeout(callback: () => void, delay: number) {
        const id = nextTimerId++;
        timers.set(id, { at: this.nowMs + delay, callback });
        return id;
      },
      clearTimeout(id: number) {
        timers.delete(id);
      },
      advanceBy(ms: number) {
        this.nowMs += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= this.nowMs) {
            timers.delete(id);
            timer.callback();
          }
        }
      },
    };
    const heldProposal = phase5Proposal({
      approvalPath: {
        variant: "familiar-coherence",
        label: "Sage may veto",
        vetoDeadline: "1900-01-01T00:00:00Z",
        affectedSurfaces: ["MEMORY.md"],
      },
      lifecycle: "veto-window-open",
      earliestClose: "2999-01-01T00:00:00Z",
      availableDecisions: ["reject"],
    });
    const initialHeldState = readyState("daemon", [heldProposal]);
    if (initialHeldState.kind !== "ready") assert.fail("expected ready state");
    let heldState = initialHeldState;

    assert.deepEqual(decisionAvailability(heldState, heldProposal).actions, [
      { decision: "reject", label: "Veto", enabled: true },
    ]);

    const cancel = scheduleResponseEnvelopeStaleness(
      heldState.meta.staleAfter,
      () => {
        const expired = responseEnvelopeStateAt(heldState, new Date(clock.now()));
        if (expired.kind !== "ready") assert.fail("ready held state must remain renderable when stale");
        heldState = expired;
      },
      clock,
    );
    const expectedFreshnessDelay = Date.parse(heldState.meta.staleAfter) - clock.now() + 1;

    assert.deepEqual(
      [...timers.values()].map((timer) => timer.at - clock.now()),
      [expectedFreshnessDelay],
      "only the response envelope staleAfter schedules a transition",
    );
    clock.advanceBy(expectedFreshnessDelay);

    assert.equal(heldState.kind, "ready");
    assert.ok(heldState.kind === "ready" && heldState.banners.some((banner) => banner.kind === "stale"));
    assert.deepEqual(decisionAvailability(heldState, heldProposal), {
      allowed: false,
      actions: [],
      reason: "This view is stale — refresh before deciding.",
    });
    cancel();
  });

  it("§3.9: render-before-expiry followed by effect-after-expiry requests one immediate update", () => {
    const state = readyState("daemon", []);
    if (state.kind !== "ready") assert.fail("expected ready state");
    const staleAt = Date.parse(state.meta.staleAfter);
    const rendered = responseEnvelopeStateAt(state, new Date(staleAt - 1));
    assert.ok(
      rendered.kind === "ready" && !rendered.banners.some((banner) => banner.kind === "stale"),
      "render immediately before expiry is still fresh",
    );

    let updates = 0;
    let scheduled = 0;
    const clock = {
      now: () => staleAt + 1,
      setTimeout: () => {
        scheduled += 1;
        return 1;
      },
      clearTimeout: () => undefined,
    };

    const cancel = scheduleResponseEnvelopeStaleness(
      state.meta.staleAfter,
      () => {
        updates += 1;
      },
      clock,
    );

    assert.equal(updates, 1, "effect arming after expiry requests a render immediately");
    assert.equal(scheduled, 0, "an expired effect does not arm a timer");
    cancel();
    assert.equal(updates, 1, "cleanup cannot duplicate the immediate callback");
  });

  it("§3.9: invalid staleAfter fails closed without scheduling a lifecycle deadline", () => {
    const state = readyState("daemon", []);
    if (state.kind !== "ready") assert.fail("expected ready state");
    const invalid = {
      ...state,
      meta: { ...state.meta, staleAfter: "not-a-timestamp" },
    };
    let scheduled = 0;
    const clock = {
      now: () => FRESH.getTime(),
      setTimeout: () => {
        scheduled += 1;
        return 1;
      },
      clearTimeout: () => undefined,
    };

    const expired = responseEnvelopeStateAt(invalid, FRESH);
    scheduleResponseEnvelopeStaleness(invalid.meta.staleAfter, () => undefined, clock);

    assert.equal(expired.kind, "ready");
    assert.ok(expired.kind === "ready" && expired.banners.some((banner) => banner.kind === "stale"));
    assert.equal(scheduled, 0);
  });

  it("§3.9: cleanup cancels a held-response timer before replacement or unmount", () => {
    let elapsed = false;
    const timer: { callback?: () => void } = {};
    let cleared = false;
    const clock = {
      now: () => FRESH.getTime(),
      setTimeout: (next: () => void) => {
        timer.callback = next;
        return 7;
      },
      clearTimeout: (id: number) => {
        assert.equal(id, 7);
        cleared = true;
        delete timer.callback;
      },
    };

    const cancel = scheduleResponseEnvelopeStaleness(
      new Date(FRESH.getTime() + 1_000).toISOString(),
      () => {
        elapsed = true;
      },
      clock,
    );
    cancel();

    assert.equal(cleared, true);
    assert.equal(timer.callback, undefined);
    assert.equal(elapsed, false);
  });

  it("R6: a corrupt proposal is never actionable, whatever the surface", () => {
    const availability = decisionAvailability(readyState("daemon", []), proposal("x", null, "corrupt"));
    assert.equal(availability.allowed, false);
    assert.deepEqual(availability.actions, []);
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

  it("409 proposal-corrupt = refused without assuming where corruption was detected", () => {
    const outcome = decisionOutcomeFromResponse("reject", 409, { blocked: true, why: "proposal-corrupt" });
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.message : "", /decision was not applied/i);
    assert.doesNotMatch(outcome.kind === "refused" ? outcome.message : "", /never asked/i);
  });

  it("409 proposal-refused warns that daemon revalidation may consume the pending proposal", () => {
    const outcome = decisionOutcomeFromResponse("approve", 409, { blocked: true, why: "proposal-refused" });
    assert.equal(outcome.kind, "refused");
    assert.match(outcome.kind === "refused" ? outcome.message : "", /may no longer be pending/i);
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
