// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail = readFileSync(new URL("./node-detail-view.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/flow.css", import.meta.url), "utf8");

assert.match(detail, /onPinData: \(data: string\) => void/, "NDV accepts pinned-data updates");
assert.match(detail, /Pinned data/, "NDV exposes a pinned-data section");
assert.match(detail, /Pin output/, "NDV can pin the latest run output");
assert.match(detail, /Unpin/, "NDV can clear pinned data");
assert.match(detail, /flow-ndv-pinned/, "Pinned data section has dedicated styles");
assert.match(detail, /Stale data/, "NDV flags run data captured before node edits");
assert.match(detail, /flow-ndv-data-stale/, "NDV exposes a stale run-data badge");
assert.match(detail, /WebhookUrlsSection/, "NDV renders a webhook URL section for webhook triggers");
assert.match(detail, /Webhook URLs/, "Webhook trigger settings expose URL controls");
assert.match(detail, /Production URL/, "Webhook URL controls include the production URL");
assert.match(detail, /Test URL/, "Webhook URL controls include the test URL");
assert.match(detail, /Listen for test event/, "Webhook URL controls can register a temporary test URL");
assert.match(detail, /Copy URL/, "Webhook URL controls include a copy affordance");
assert.match(detail, /webhookProductionPath/, "Webhook URL controls use the shared route path helper");
assert.match(detail, /onListenWebhookTest: \(\) => Promise/, "NDV exposes a listen-for-test-event callback");

assert.match(view, /setNodePinnedData/, "FlowView imports pinned-data mutation");
assert.match(view, /onPinData=\{\(data\) => onPinData\(selectedNode\.id, data\)\}/, "FlowView wires selected node pinning");
assert.match(view, /listenWebhookTest/, "FlowView wires webhook test listener registration");
assert.match(view, /nodeExecutionChangedSinceSnapshot/, "FlowView marks inspected run data stale when the node changed since its run snapshot");

assert.match(styles, /\.flow-ndv-pinned/, "Pinned data controls are styled");
assert.match(styles, /\.flow-ndv-data-stale/, "Stale run-data badge is styled");
assert.match(styles, /\.flow-ndv-webhook/, "Webhook URL controls are styled");

console.log("node-detail-view.test.ts OK");
