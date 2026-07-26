// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const executor = await readFile(new URL("../../../../lib/server/flow-executor.ts", import.meta.url), "utf8");
const flows = await readFile(new URL("../../../../lib/flows.ts", import.meta.url), "utf8");

assert.match(route, /type RunBody = \{[^}]*targetNodeId\?: string \| null/s, "run route accepts a target node id");
assert.match(route, /flowSnapshot\?: FlowDoc \| null/, "run route accepts an original workflow snapshot for retry");
assert.match(route, /runFlowDoc = snapshotId === id && parsed\.body\.flowSnapshot \? parsed\.body\.flowSnapshot : flow/, "run route should use a snapshot only when it matches the requested flow id");
assert.match(route, /startFlowSession\(runFlowDoc, \{ projectRoot: rawRoot, targetNodeId, mode: "manual" \}/, "manual editor runs should execute in manual mode");
assert.match(executor, /flowRunBlockReason\(flow, options\.targetNodeId/, "run validation is scoped for partial execution");
assert.match(executor, /compileFlowPrompt\(flow, \{[\s\S]*targetNodeId: options\.targetNodeId/, "run prompt compiles partial target scope");
assert.match(executor, /flowPartialExecutionOrder\(flow, options\.targetNodeId/, "run records use partial execution order");
assert.match(executor, /options\.targetNodeId \? `Flow step:/, "partial runs get a step-specific session title");
assert.match(executor, /flowSnapshot: flow/, "run records should persist the workflow snapshot used for retrying original executions");
assert.match(executor, /mode: options\.mode \?\? "manual"/, "run records should persist whether execution used manual or production semantics");
assert.match(executor, /launchMode: "nonInteractive"/, "flow sessions should launch with plain non-interactive harness output");
assert.match(executor, /extractFlowCustomData/, "run records should persist saved custom execution data from Execution Data nodes");
assert.match(executor, /flowRunRedactsData\(flow, options\.mode \?\? "manual"\)/, "run records should resolve execution-data redaction from the flow policy");
assert.match(executor, /redacted: true/, "run records should mark redacted executions in history");

assert.match(flows, /export async function runFlow\(id: string, targetNodeId\?: string, flowSnapshot\?: FlowDoc\)/);
assert.match(flows, /flowSnapshot\?: FlowDoc/, "client run helper should accept an original workflow snapshot");
assert.match(flows, /body: JSON\.stringify\(\{ id, targetNodeId, flowSnapshot \}\)/, "client run helper should post snapshot retry data");
assert.match(flows, /flowSnapshot\?: FlowDoc/, "FlowRunRecord should store the original workflow snapshot");
assert.match(flows, /mode\?: FlowExecutionMode/, "FlowRunRecord should store the execution mode");
assert.match(flows, /customData\?: Record<string, string>/, "FlowRunRecord should store saved custom execution data");
assert.match(flows, /redacted\?: boolean/, "FlowRunRecord should mark executions whose node data was not saved");

// (FlowView/NDV client pins left with the retired components — cave-c3yt.
// The route/executor/flows-lib contracts above are the live surface: the
// flow engine still powers /api/flows + webhooks.)

console.log("flows run route.test.ts: ok");
