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
assert.match(source, /publishStatus: "unpublished" \| "published" \| "changed"/, "Toolbar should receive publish status");
assert.match(source, /publishBlockReason\?: string/, "Toolbar should receive the reason publishing is blocked");
assert.match(source, /onPublish: \(\) => void/, "Toolbar should expose a publish action");
assert.match(source, /onUnpublish: \(\) => void/, "Toolbar should expose an unpublish action");
assert.match(source, /flow-toolbar-publish/, "Toolbar should render publish controls");
assert.match(source, /Publish changes/, "Toolbar should label changed published drafts distinctly");
assert.match(source, /Published/, "Toolbar should show published state");
assert.match(source, /disabled=\{props\.saving \|\| Boolean\(props\.publishBlockReason\)\}/, "Toolbar should disable publish when production readiness is blocked");
assert.match(source, /props\.publishBlockReason \?\?/, "Toolbar publish tooltip should expose block reason");
assert.match(styles, /\.flow-toolbar-publish/, "Toolbar publish controls need styles");
assert.match(styles, /\.flow-toolbar-publish-status/, "Toolbar publish status needs styles");
assert.match(view, /setExecutionDataRedaction/, "FlowView should persist redaction policy edits through the flow draft");
assert.match(view, /publishFlow/, "FlowView should publish the current draft snapshot");
assert.match(view, /unpublishFlow/, "FlowView should clear the published production snapshot");
assert.match(view, /flowPublishStatus\(doc\)/, "FlowView should derive publish status from the current flow");
assert.match(view, /flowPublishBlockReason\(doc\)/, "FlowView should derive publish readiness from the current flow");
assert.match(view, /manualDataRedacted=\{flowRunRedactsData\(doc, "manual"\)\}/, "FlowView should pass manual redaction state into the toolbar");
assert.match(view, /productionDataRedacted=\{flowRunRedactsData\(doc, "production"\)\}/, "FlowView should pass production redaction state into the toolbar");
assert.match(view, /onToggleExecutionDataRedaction=\{\(mode\) => mutate\(\(d\) => setExecutionDataRedaction\(d, mode, !flowRunRedactsData\(d, mode\)\)\)\}/, "FlowView should toggle the selected redaction policy");
assert.match(view, /publishStatus=\{flowPublishStatus\(doc\)\}/, "FlowView should pass publish status to the toolbar");
assert.match(view, /publishBlockReason=\{publishBlock\.ok \? undefined : publishBlock\.reason\}/, "FlowView should pass blocked publish reason to the toolbar");
assert.match(view, /onPublish=\{publish\}/, "FlowView should wire toolbar publish action");
assert.match(view, /onUnpublish=\{unpublish\}/, "FlowView should wire toolbar unpublish action");

console.log("flow-toolbar.test.ts OK");
