// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./flow-toolbar.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/flow.css", import.meta.url), "utf8");

assert.doesNotMatch(source, /flow-active-toggle/, "Toolbar should not render the old labelled Active/Inactive pill");
assert.match(source, /className=\{`flow-status-button/, "Flow active state should be a compact status control by the title");
assert.match(source, /aria-label=\{props\.active \? "Deactivate flow triggers" : "Activate flow triggers"\}/);
assert.match(source, /size=\{Math\.max\(8, Math\.min\(28, draft\.length \+ 1\)\)\}/, "Name input should not push the status dot away from the title");
assert.match(styles, /\.flow-status-button/, "Compact status control needs flow styles");
assert.doesNotMatch(styles, /\.flow-active-toggle/, "Old labelled Active/Inactive pill styles should be removed");
assert.match(source, /manualDataRedacted: boolean/, "Toolbar should receive manual execution-data redaction state");
assert.match(source, /productionDataRedacted: boolean/, "Toolbar should receive production execution-data redaction state");
assert.match(source, /onToggleExecutionDataRedaction: \(mode: "manual" \| "production"\) => void/, "Toolbar should expose redaction toggles by run mode");
assert.match(source, /aria-label=\{props\.manualDataRedacted \? "Store manual execution data" : "Redact manual execution data"\}/, "Manual data toggle should expose the next action");
assert.match(source, /aria-label=\{props\.productionDataRedacted \? "Store production execution data" : "Redact production execution data"\}/, "Production data toggle should expose the next action");
assert.match(source, /onClick=\{\(\) => props\.onToggleExecutionDataRedaction\("manual"\)\}/, "Manual data toggle should call the toolbar redaction handler");
assert.match(source, /onClick=\{\(\) => props\.onToggleExecutionDataRedaction\("production"\)\}/, "Production data toggle should call the toolbar redaction handler");
assert.match(source, /flow-toolbar-redaction/, "Redaction controls should use compact toolbar styles");
assert.match(styles, /\.flow-toolbar-redaction/, "Redaction controls need toolbar styles");
assert.match(view, /setExecutionDataRedaction/, "FlowView should persist redaction policy edits through the flow draft");
assert.match(view, /manualDataRedacted=\{flowRunRedactsData\(doc, "manual"\)\}/, "FlowView should pass manual redaction state into the toolbar");
assert.match(view, /productionDataRedacted=\{flowRunRedactsData\(doc, "production"\)\}/, "FlowView should pass production redaction state into the toolbar");
assert.match(view, /onToggleExecutionDataRedaction=\{\(mode\) => mutate\(\(d\) => setExecutionDataRedaction\(d, mode, !flowRunRedactsData\(d, mode\)\)\)\}/, "FlowView should toggle the selected redaction policy");

console.log("flow-toolbar.test.ts OK");
