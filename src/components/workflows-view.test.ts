// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workflows-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");

assert.match(source, /export function WorkflowsView/, "Cave should expose a first-class Workflows view");
assert.match(source, /listWorkflows/, "Workflows view should load manifests through the Cave workflow client");
assert.match(client, /\/api\/workflows/, "Workflows view should stay behind Cave API proxy routes");
assert.match(source, /Validate/, "Workflows view should expose validation as a primary action");
assert.match(source, /Dry-run|Dry run/, "Workflows view should expose dry-run preview as a primary action");
assert.match(source, /WORKFLOW\.cave\.json/, "Workflows view should mention Cave sidecars for display state");

console.log("workflows-view.test.ts: ok");
