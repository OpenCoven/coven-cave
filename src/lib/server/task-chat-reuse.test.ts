import assert from "node:assert/strict";
import {
  claimFirstPromptHandoff,
  FIRST_PROMPT_CLAIM_MS,
  reservedFirstPromptPending,
  resetFirstPromptClaimsForTest,
  validReuseModelOverride,
  type FirstPromptProbeDeps,
} from "@/lib/server/task-chat-reuse";

function deps(overrides: Partial<FirstPromptProbeDeps> = {}): FirstPromptProbeDeps {
  return {
    hasActiveChatRun: () => false,
    loadTranscript: async () => undefined,
    claim: () => true,
    ...overrides,
  };
}

const reserved = { sessionId: "s1", nativeSessionId: "s1" };

// Pending only when the route reserved it natively and nothing could have been sent.
assert.equal(await reservedFirstPromptPending(reserved, deps()), true, "an empty native reservation is pending");
assert.equal(await reservedFirstPromptPending({ sessionId: null, nativeSessionId: "s1" }, deps()), false);
assert.equal(
  await reservedFirstPromptPending({ sessionId: "s1" }, deps()),
  false,
  "a daemon session (no native marker) never gets a prompt back, even once the daemon prunes it",
);
assert.equal(
  await reservedFirstPromptPending({ sessionId: "s2", nativeSessionId: "s1" }, deps()),
  false,
  "a marker for an earlier session doesn't cover a later one",
);
assert.equal(
  await reservedFirstPromptPending(reserved, deps({ hasActiveChatRun: () => true })),
  false,
  "a run in flight owns the first prompt",
);
assert.equal(
  await reservedFirstPromptPending(reserved, deps({ loadTranscript: async () => ({ turns: [{ role: "user" }] }) })),
  false,
  "a sent first prompt is never resent",
);
assert.equal(
  await reservedFirstPromptPending(reserved, deps({ loadTranscript: async () => ({ turns: [] }) })),
  false,
  "any transcript means a send started",
);
assert.equal(
  await reservedFirstPromptPending(reserved, deps({ loadTranscript: async () => null })),
  false,
  "an unreadable transcript fails closed",
);
assert.equal(
  await reservedFirstPromptPending(reserved, deps({ claim: () => false })),
  false,
  "a prompt another view was just handed is not handed out again",
);
{
  let claimed = 0;
  await reservedFirstPromptPending({ sessionId: "s1" }, deps({ claim: () => { claimed += 1; return true; } }));
  await reservedFirstPromptPending(reserved, deps({ loadTranscript: async () => ({ turns: [] }), claim: () => { claimed += 1; return true; } }));
  assert.equal(claimed, 0, "only a pending prompt takes a claim");
}

// The claim: one hand-out per window, per session.
resetFirstPromptClaimsForTest();
const t0 = Date.parse("2026-11-25T12:00:00.000Z");
assert.equal(claimFirstPromptHandoff("a", t0), true);
assert.equal(claimFirstPromptHandoff("a", t0 + 1_000), false, "a second view inside the window gets no prompt");
assert.equal(claimFirstPromptHandoff("b", t0 + 1_000), true, "other sessions are independent");
assert.equal(claimFirstPromptHandoff("a", t0 + FIRST_PROMPT_CLAIM_MS), true, "after the window, a still-unsent prompt can be handed out again");
resetFirstPromptClaimsForTest();

// Model override: the fresh-launch rule, dropped rather than refused.
assert.equal(validReuseModelOverride({}, "claude"), null);
assert.equal(validReuseModelOverride({ modelOverride: "opus", modelOverrideHarness: null }, "claude"), null, "an override without its runtime is stale");
assert.equal(validReuseModelOverride({ modelOverride: "gpt-5", modelOverrideHarness: "codex" }, "claude"), null, "another runtime's id never applies");
assert.equal(validReuseModelOverride({ modelOverride: "bad id; rm -rf", modelOverrideHarness: "claude" }, "claude"), null, "an unsafe id is dropped");

console.log("task-chat-reuse: ok");
