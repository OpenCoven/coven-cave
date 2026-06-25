// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const executor = await readFile(new URL("../../../../lib/server/flow-executor.ts", import.meta.url), "utf8");
const flows = await readFile(new URL("../../../../lib/flows.ts", import.meta.url), "utf8");
const view = await readFile(new URL("../../../../components/flow/flow-view.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../../../../components/flow/node-detail-view.tsx", import.meta.url), "utf8");

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

assert.match(view, /const executeNode = useCallback/, "FlowView wires selected-node execution");
assert.match(view, /runFlow\(runDoc\.id, nodeId, flowSnapshot\)/, "selected-node execution posts the target node id and optional retry snapshot");
assert.match(view, /mode: "manual"/, "local preview records should preserve manual execution mode");
assert.match(view, /redacted: flowRunRedactsData\(runDoc, "manual"\) \|\| undefined/, "local preview records should preserve manual redaction policy");
assert.match(view, /finalizeFlowSteps\(activeRun\.steps, progress\.steps, \{ redactDetails: activeRun\.redacted \}\)/, "completed runs should omit stored step details when redacted");
assert.match(view, /onExecuteNode=\{\(\) => void executeNode\(selectedNode\.id\)\}/, "NDV receives execute-node action");

assert.match(detail, /onExecuteNode: \(\) => void/, "NDV exposes execute-step callback");
assert.match(detail, /Execute step/, "NDV renders n8n-style Execute step action");

console.log("flows run route.test.ts: ok");
