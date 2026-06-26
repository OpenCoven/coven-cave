// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canvas = readFileSync(new URL("./flow-canvas.tsx", import.meta.url), "utf8");
const node = readFileSync(new URL("./flow-node.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/flow.css", import.meta.url), "utf8");

assert.match(canvas, /onTidy: \(\) => void/, "FlowCanvas should accept a tidy-workflow action");
assert.match(canvas, /title="Tidy up workflow"/, "Canvas toolbar should expose n8n-style tidy action");
assert.match(canvas, /props\.onTidy/, "Canvas tidy button should call the provided action");
assert.match(canvas, /layoutOrientation: FlowLayoutOrientation/, "FlowCanvas should receive the active layout orientation");
assert.match(canvas, /onLayoutOrientation: \(orientation: FlowLayoutOrientation\) => void/, "FlowCanvas should expose an orientation switch action");
assert.match(canvas, /aria-label="Use horizontal layout"/, "Canvas toolbar should expose a horizontal layout switch");
assert.match(canvas, /aria-label="Use vertical layout"/, "Canvas toolbar should expose a vertical layout switch");
assert.match(view, /tidyFlowLayout/, "FlowView should import the pure tidy layout mutation");
assert.match(view, /useState<FlowLayoutOrientation>\("horizontal"\)/, "FlowView should default Flow layout to horizontal");
assert.match(view, /tidyFlowLayout\(d, layoutOrientation\)/, "Tidy should use the active Flow layout orientation");
assert.match(view, /tidyFlowLayout\(d, orientation\)/, "Switching orientation should retidy the canvas immediately");
assert.match(view, /setViewResetKey/, "FlowView should be able to force React Flow to consume tidied positions");
assert.match(view, /setViewResetKey\(\(key\) => key \+ 1\)/, "Tidy should reset the canvas local position cache");
assert.match(view, /onTidy=\{tidy\}/, "FlowView should wire tidy into the canvas toolbar");
assert.match(view, /onLayoutOrientation=\{setAndApplyLayoutOrientation\}/, "FlowView should wire orientation switching into the canvas toolbar");
assert.match(canvas, /staleNodeIds\?: Record<string, boolean>/, "FlowCanvas should accept stale-node markers");
assert.match(view, /staleNodeIds/, "FlowView should compute canvas stale-node markers from the active run snapshot");
assert.match(node, /node\.displayNote/, "Flow nodes should honor the display-note flag");
assert.match(node, /flow-node-note/, "Flow nodes should render visible note text on the canvas");
assert.match(node, /aria-label="Disabled"/, "Disabled Flow nodes should expose an accessible canvas badge");
assert.match(node, /aria-label="Stale data"/, "Stale Flow nodes should expose an accessible dirty-data marker");
assert.match(styles, /\.flow-node-note/, "Displayed node notes should be styled");
assert.match(styles, /\.flow-node\.is-disabled[^}]*filter:/, "Disabled Flow nodes should have a distinct muted canvas treatment");
assert.match(styles, /\.flow-node\.is-stale[^}]*border-color:/, "Stale Flow nodes should have a distinct dirty canvas treatment");
assert.match(styles, /\.flow-node-stale-badge/, "Stale Flow nodes should render a dedicated dirty marker");

console.log("flow-canvas.test.ts OK");
