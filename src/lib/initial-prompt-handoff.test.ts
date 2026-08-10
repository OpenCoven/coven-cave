import assert from "node:assert/strict";
import {
  claimInitialPromptHandoff,
  initialPromptHandoffClaimed,
  releaseInitialPromptHandoff,
  resetInitialPromptHandoffs,
} from "./initial-prompt-handoff.ts";

resetInitialPromptHandoffs();

// The whole point: exactly one claim wins, and a second caller — which is what
// a remounted ChatView is — gets false and must not send.
assert.equal(claimInitialPromptHandoff("task-work", "s-bridge"), true);
assert.equal(claimInitialPromptHandoff("task-work", "s-bridge"), false);
assert.equal(claimInitialPromptHandoff("task-work", "s-bridge"), false);
assert.equal(initialPromptHandoffClaimed("task-work", "s-bridge"), true);

// Distinct handoffs are independent.
assert.equal(claimInitialPromptHandoff("task-work", "s-other"), true);
assert.equal(initialPromptHandoffClaimed("task-work", "s-other"), true);

// Scopes are namespaced, so two callers cannot collide on a bare session id.
assert.equal(initialPromptHandoffClaimed("home", "s-bridge"), false);
assert.equal(claimInitialPromptHandoff("home", "s-bridge"), true);

// Releasing re-arms it, so re-entering a task with a genuinely new prompt sends.
releaseInitialPromptHandoff("task-work", "s-bridge");
assert.equal(initialPromptHandoffClaimed("task-work", "s-bridge"), false);
assert.equal(claimInitialPromptHandoff("task-work", "s-bridge"), true);
// Releasing one scope leaves the other alone.
assert.equal(initialPromptHandoffClaimed("home", "s-bridge"), true);

// Releasing something never claimed is a no-op, not a throw.
releaseInitialPromptHandoff("task-work", "never-seen");

resetInitialPromptHandoffs();
assert.equal(initialPromptHandoffClaimed("task-work", "s-bridge"), false);
assert.equal(initialPromptHandoffClaimed("home", "s-bridge"), false);

console.log("initial-prompt-handoff.test.ts ok");
