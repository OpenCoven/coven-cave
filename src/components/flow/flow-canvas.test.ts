// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canvas = readFileSync(new URL("./flow-canvas.tsx", import.meta.url), "utf8");
const node = readFileSync(new URL("./flow-node.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");
const templateGallery = readFileSync(new URL("./flow-template-gallery.tsx", import.meta.url), "utf8");
const nodeCatalog = readFileSync(new URL("./node-catalog-panel.tsx", import.meta.url), "utf8");
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
assert.match(
  canvas,
  /new Map\(docNodes\.map\(\(node\) => \[node\.id, node\.data\.def\]\)\)/,
  "edge source definitions are indexed once per node change",
);
assert.doesNotMatch(
  canvas,
  /docNodes\.find\(\(node\) => node\.id === edge\.source\)/,
  "edge rendering must not scan all nodes once per edge",
);
assert.match(canvas, /sourceDef\.outputs\.length > 1/, "only true fan-outs get branch labels");
assert.match(edge, /branchLabel/, "the edge renders its branch name");
assert.match(styles, /\.flow-edge-branch-label/, "branch labels are styled");
assert.match(canvas, /import \{ Button \}/, "FlowCanvas labelled canvas actions use the shared Button primitive");
assert.match(canvas, /import \{ IconButton \}/, "FlowCanvas icon-only actions use the shared IconButton primitive");
assert.match(edge, /import \{ IconButton \}/, "FlowEdge midpoint insert action uses the shared IconButton primitive");
assert.doesNotMatch(canvas, /<button\b/, "FlowCanvas should not hand-roll button controls");
assert.doesNotMatch(edge, /<button\b/, "FlowEdge should not hand-roll button controls");
assert.doesNotMatch(
  canvas,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "FlowCanvas should not hard-code rectangular radius classes",
);
assert.doesNotMatch(
  edge,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "FlowEdge should not hard-code rectangular radius classes",
);
assert.match(view, /import \{ Button \}/, "FlowView onboarding and coach actions use the shared Button primitive");
assert.doesNotMatch(view, /<button\b/, "FlowView should not hand-roll button controls");
assert.match(templateGallery, /import \{ Button \}/, "FlowTemplateGallery labelled actions use the shared Button primitive");
assert.match(templateGallery, /import \{ IconButton \}/, "FlowTemplateGallery close action uses the shared IconButton primitive");
assert.match(nodeCatalog, /import \{ Button \}/, "NodeCatalogPanel node rows use the shared Button primitive");
assert.match(nodeCatalog, /import \{ IconButton \}/, "NodeCatalogPanel close action uses the shared IconButton primitive");
assert.doesNotMatch(templateGallery, /<button\b/, "FlowTemplateGallery should not hand-roll button controls");
assert.doesNotMatch(templateGallery, /loading=\{busy === template\.id\}/, "template creation must not swap Button spinner DOM during the async handoff");
assert.match(templateGallery, /aria-busy=\{busy === template\.id \|\| undefined\}/, "template creation exposes busy state without remounting button children");
assert.match(templateGallery, /disabled=\{busy != null\}/, "template creation disables all template actions while one is in flight");
assert.match(view, /onUse=\{\(id\) => fromTemplate\(id\)\}/, "FlowTemplateGallery receives the template creation promise");
assert.doesNotMatch(nodeCatalog, /<button\b/, "NodeCatalogPanel should not hand-roll button controls");

// ── Reduced motion (cave-sky3): React Flow's own chrome must honour it too ──
// The Controls buttons and the viewport pan/zoom transition (fitView/zoomTo)
// ship no reduced-motion flag of their own, so flow.css must zero them.
const rmBlock = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.react-flow__viewport[\s\S]*?\}\s*\}/)?.[0] ?? "";
assert.match(rmBlock, /\.react-flow__controls-button/, "reduced-motion zeros the Flow controls-button transitions");
assert.match(rmBlock, /\.react-flow__viewport[\s\S]*?transition: none !important/, "reduced-motion zeros the viewport pan/zoom transition (beats React Flow's inline transition)");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.flow-run-step-spin \{ animation: none; \} \}/, "the existing run-step spinner guard stays");

// ── Keyboard path to open a node (cave-6pp8, WCAG 2.1.1) ──────────────────────
// Double-click is mouse-only; a keyboard user must be able to open the focused
// node with Enter/Space. Keyed off the focused node's data-id, skips stickies,
// announces the open (the NDV doesn't announce itself).
assert.match(canvas, /const handleCanvasKeyDown = useCallback\(/, "canvas has a keyboard handler for opening nodes");
assert.match(canvas, /event\.key !== "Enter" && event\.key !== " "/, "Enter or Space triggers the open");
assert.match(canvas, /closest\?\.\(".react-flow__node"\)[\s\S]*?getAttribute\("data-id"\)/, "the open targets the focused React Flow node by data-id");
assert.match(canvas, /catalogNode\(source\.type\)\?\.sticky === true\) return/, "sticky notes are skipped (they edit inline)");
assert.match(canvas, /onOpenNode\(nodeId\);\s*\n\s*announce\(/, "opening a node via keyboard announces it");
assert.match(canvas, /onKeyDown=\{handleCanvasKeyDown\}/, "the handler is wired on the canvas wrapper");

console.log("flow-canvas.test.ts OK");
