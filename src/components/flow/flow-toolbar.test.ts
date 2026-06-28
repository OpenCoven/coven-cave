// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./flow-toolbar.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/flow.css", import.meta.url), "utf8");

assert.doesNotMatch(source, /flow-active-toggle/, "Toolbar should not render the old labelled Active/Inactive pill");
assert.match(source, /className=\{`flow-status-toggle/, "Flow active state should be a labelled status toggle by the title");
assert.match(source, /props\.active \? "Active" : "Inactive"/, "Status toggle should read out the active state as a word, not a bare dot");
assert.doesNotMatch(source, /flow-toolbar-dirty/, "The cosmetic unsaved-changes dot should be gone (Save already reflects dirty state)");
assert.match(source, /aria-label=\{props\.active \? "Deactivate flow triggers" : "Activate flow triggers"\}/);
assert.match(source, /size=\{Math\.max\(8, Math\.min\(28, draft\.length \+ 1\)\)\}/, "Name input should not push the status toggle away from the title");
assert.match(styles, /\.flow-status-toggle/, "Labelled status toggle needs flow styles");
assert.doesNotMatch(styles, /\.flow-active-toggle/, "Old labelled Active/Inactive pill styles should be removed");
assert.doesNotMatch(source, /flow-toolbar-redaction/, "Execution-data redaction toggles should no longer clutter the toolbar");
assert.doesNotMatch(source, /onToggleExecutionDataRedaction/, "Toolbar should not expose the removed redaction handler");
assert.doesNotMatch(styles, /\.flow-toolbar-redaction/, "Removed redaction control styles should be cleaned up");
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
assert.doesNotMatch(view, /onToggleExecutionDataRedaction/, "FlowView should no longer wire the removed toolbar redaction toggle");
assert.match(view, /publishFlow/, "FlowView should publish the current draft snapshot");
assert.match(view, /unpublishFlow/, "FlowView should clear the published production snapshot");
assert.match(view, /flowPublishStatus\(doc\)/, "FlowView should derive publish status from the current flow");
assert.match(view, /flowPublishBlockReason\(doc\)/, "FlowView should derive publish readiness from the current flow");
assert.match(view, /publishStatus=\{flowPublishStatus\(doc\)\}/, "FlowView should pass publish status to the toolbar");
assert.match(view, /publishBlockReason=\{publishBlock\.ok \? undefined : publishBlock\.reason\}/, "FlowView should pass blocked publish reason to the toolbar");
assert.match(view, /onPublish=\{publish\}/, "FlowView should wire toolbar publish action");
assert.match(view, /onUnpublish=\{unpublish\}/, "FlowView should wire toolbar unpublish action");

console.log("flow-toolbar.test.ts OK");
