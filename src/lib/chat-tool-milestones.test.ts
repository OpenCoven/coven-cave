import assert from "node:assert/strict";
import { createToolMilestoneTracker } from "./chat-tool-milestones.ts";
import type { ToolEvent } from "./chat-turn-state.ts";

const track = createToolMilestoneTracker();
const tool = (id: string, status: ToolEvent["status"]): ToolEvent => ({ id, name: "Read", status, input: "secret input", output: "secret output" });
assert.deepEqual(track({ id: "history", tools: [tool("old", "ok")] }), []);
assert.deepEqual(track({ id: "live", pending: true }), []);
assert.deepEqual(track({ id: "live", pending: true, tools: [tool("a", "requested"), tool("b", "running")] }), ["Tool 1: requested.", "Tool 2: running."]);
assert.deepEqual(track({ id: "live", pending: true, tools: [tool("a", "requested"), { ...tool("b", "running"), output: "more tokens" }] }), []);
assert.deepEqual(track({ id: "live", pending: true, tools: [tool("a", "error"), tool("b", "ok"), tool("retry-a", "running")] }), ["Tool 1: failed.", "Tool 2: succeeded.", "Tool 3: running."]);
assert.deepEqual(track({ id: "live", pending: false, tools: [tool("a", "error"), tool("b", "ok"), tool("retry-a", "unknown")] }), ["Tool 3: outcome unknown."]);
assert.deepEqual(track({ id: "other-history", tools: [tool("x", "ok")] }), []);
assert.deepEqual(track({ id: "next", pending: true, tools: [tool("a", "approval-requested")] }), ["Tool 1: approval requested."]);
assert.deepEqual(track({ id: "next", pending: true, tools: [tool("a", "user-rejected")] }), ["Tool 1: rejected by user."]);
assert.deepEqual(createToolMilestoneTracker()({ id: "live", tools: [tool("retry-a", "ok")] }), []);
console.log("tool milestones: transitions, parallel identity, retries, history silence and payload exclusion passed");
