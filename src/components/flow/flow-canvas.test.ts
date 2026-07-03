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
assert.match(canvas, /orientation: layoutOrientation/, "FlowCanvas should pass the active orientation into node data so ports flip edges");
assert.match(node, /orientation === "vertical"/, "Flow nodes should flip port handles for vertical layouts");
assert.match(node, /inputPosition/, "Flow nodes should compute an orientation-aware input handle position");
assert.match(node, /outputPosition/, "Flow nodes should compute an orientation-aware output handle position");
assert.match(styles, /\.flow-out-vertical/, "Vertical-layout outputs need bottom-edge styling");
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

// ── 2026-07-03 world-class pass ──────────────────────────────────────────────
// Cards say what they'll DO, not just what they are: a one-line config summary
// (familiar, cron, URL…) renders under the type, yielding to a displayed note.
assert.match(node, /flowNodeSummary\(node\)/, "node cards derive a config summary from the shared pure helper");
assert.match(node, /displayedNote \? null : flowNodeSummary/, "a user-authored displayed note outranks the config summary");
assert.match(node, /flow-node-summary/, "the config summary renders on the card");
assert.match(node, /phase === "failed" && \(/, "a failed step is called out in words on the card, not just a red dot");
assert.match(node, /flow-node-failed-badge/, "the failed badge has a dedicated class");
assert.match(styles, /\.flow-node-summary/, "the summary line is styled");
assert.match(styles, /\.flow-node-failed-badge/, "the failed badge is styled");
// Empty-graph coaching: a canvas with nothing wired offers the next action
// instead of bare dots.
assert.match(view, /doc\.edges\.length === 0 && doc\.nodes\.filter\(\(n\) => n\.type !== "sticky"\)\.length <= 1/, "the coach shows only while nothing is wired yet");
assert.match(view, /flow-canvas-coach/, "FlowView renders the empty-canvas coach");
assert.match(styles, /\.flow-canvas-coach/, "the coach card is styled");
// Keyboard shortcuts: undo/redo/save/duplicate/add-node work from the keyboard,
// and never fire while typing or while a dialog owns focus.
assert.match(view, /dispatchDraft\(\{ type: event\.shiftKey \? "redo" : "undo" \}\)/, "Cmd+Z / Shift+Cmd+Z drive the draft history");
assert.match(view, /if \(dirty && !saving\) void save\(\)/, "Cmd+S saves only when there is something to save");
assert.match(view, /onDuplicateNode\(selectedNodeId\)/, "Cmd+D duplicates the selected node");
assert.match(view, /catalogOpen \|\| templateGalleryOpen \|\| requiredInputsPrompt/, "shortcuts stand down while any dialog owns focus");
assert.match(view, /target\.isContentEditable/, "shortcuts stand down while typing");
// Multi-select: React Flow's marquee/shift-click selection must survive the
// detail-panel selection — a plain override killed it.
assert.match(canvas, /node\.selected === true \|\| node\.id === selectedNodeId/, "canvas selection is a union of internal multi-select and the detail-panel node");
// Branch labels: fan-out edges (router/if/loop) name their branch on the wire.
const edge = readFileSync(new URL("./flow-edge.tsx", import.meta.url), "utf8");
assert.match(canvas, /sourceDef\.outputs\.length > 1/, "only true fan-outs get branch labels");
assert.match(edge, /branchLabel/, "the edge renders its branch name");
assert.match(styles, /\.flow-edge-branch-label/, "branch labels are styled");

console.log("flow-canvas.test.ts OK");
