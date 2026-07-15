// @ts-nocheck
// Source pins for the Obsidian-style Grimoire graph canvas (cave-hand): the
// behaviors below are deliberate — if an edit trips one, the graph lost part
// of its contract, not just a style.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./grimoire-graph-view.tsx", import.meta.url), "utf8");

// ── Rendering: hand-rolled canvas + the shared force sim ─────────────────────
assert.match(view, /from "@\/lib\/grimoire-force"/, "layout comes from the shared force simulation lib");
assert.match(view, /<canvas\b/, "the graph renders to a canvas (no diagram dep)");
assert.match(view, /window\.devicePixelRatio/, "the canvas is DPR-aware");
assert.match(view, /new ResizeObserver\(/, "the canvas resizes with its container");
assert.match(view, /new MutationObserver\(/, "theme changes re-read the palette (canvas can't use CSS vars live)");
assert.match(view, /requestAnimationFrame/, "frames render on demand via rAF");
assert.match(
  view,
  /!reducedMotionRef\.current && sim\.alpha > ALPHA_MIN/,
  "the rAF loop stops once the sim settles — no idle-frame burn",
);

// ── Obsidian behaviors ───────────────────────────────────────────────────────
assert.match(view, /pinForceSimNode\(sim, drag\.nodeIndex/, "dragging a node pins it while the sim reheats around it");
assert.match(view, /unpinForceSimNode\(sim, drag\.nodeIndex\)/, "releasing a drag frees the node back to the sim");
assert.match(view, /Keep the world point under the cursor stationary/, "zoom anchors at the cursor");
assert.match(view, /const DIM_ALPHA = /, "hover/search spotlight dims the rest of the graph");
assert.match(view, /adjacency/, "the spotlight covers the node's neighborhood, not just the node");
assert.match(view, /nodeRadius\(/, "node size scales with connection count");
assert.match(view, /baseLabelAlpha/, "labels fade in with zoom");
assert.match(view, /positionCache/, "layout survives close/reopen (module-level position cache)");
assert.match(view, /if \(node\.ref\) \{[\s\S]{0,120}onOpen\(node\.ref\)/, "clicking a doc node opens the doc");
assert.match(view, /setStickyId\(\(prev\) => \(prev === node\.id \? null : node\.id\)\)/, "clicking a tag toggles a sticky spotlight");

// ── Filters + forces card ────────────────────────────────────────────────────
assert.match(view, /"cave:grimoire:graph-prefs"/, "graph prefs persist to localStorage");
assert.match(view, /aria-label="Graph filters"/, "the filter card is a labelled section");
assert.match(view, /groups: \{ knowledge: true, memory: true, journal: true, tag: true \}/, "every group defaults on");
assert.match(view, /edgeTypes: \{ link: true, mention: true, tag: true \}/, "every edge generator defaults on");
assert.match(view, /prefs\.orphans \? nodesByKind : nodesByKind\.filter/, "orphans are a toggle, not a silent drop");
// cave-jf2v: orphans default OFF — a mostly-unlinked corpus (e.g. ~400 nodes /
// ~30 edges) otherwise renders a structureless dot cloud that buries the
// relationships the graph exists to show.
assert.match(view, /orphans: false,/, "orphans are hidden by default (connections-first, not a dot cloud)");
assert.match(view, /aria-label="Repel force"/, "the repel force is a labelled live slider");
assert.match(view, /aria-label="Link distance"/, "the link distance is a labelled live slider");
assert.match(view, /aria-label="Highlight graph nodes"/, "graph search is labelled");
assert.match(
  view,
  /Scanned the \{meta\.memory\.scanned\} most recent of \{meta\.memory\.total\} memory files/,
  "scan bounds are reported, never silently applied",
);

// ── Accessibility + reduced motion ───────────────────────────────────────────
assert.match(view, /role="img"/, "the canvas exposes an accessible role");
assert.match(view, /aria-label=\{`Document graph: \$\{summary\}/, "the canvas label carries a live summary");
assert.match(view, /tabIndex=\{0\}/, "the canvas is keyboard-focusable");
assert.match(view, /e\.key === "ArrowLeft"/, "arrow keys pan");
assert.match(view, /e\.key === "0"/, "0 fits the view");
assert.match(view, /usePrefersReducedMotion\(\)/, "reduced motion is honored");
assert.match(view, /settleForceSim\(sim, paramsRef\.current\)/, "reduced motion settles synchronously and renders still");
assert.match(view, /announcer\.announce\(`Opening \$\{node\.title\}`/, "opening a node is announced to AT");

// ── Keyboard node traversal (cave-2cx8) ──────────────────────────────────────
// Tab/Shift+Tab cycle the most-connected visible nodes, announce + centre each,
// Enter opens; the cursor releases at the ends so Tab still leaves the graph.
assert.match(view, /const keyboardNodes = useMemo\([\s\S]{0,220}visible\.degree\.get\(b\.id\)[\s\S]{0,60}\.slice\(0, 40\)/, "the keyboard list is the top-N most-connected visible nodes");
assert.match(view, /const kbdIdxRef = useRef\(-1\)/, "a keyboard cursor index is tracked");
assert.match(view, /if \(e\.key === "Tab"\) \{/, "Tab drives keyboard node traversal");
assert.match(view, /if \(next < 0 \|\| next >= list\.length\) \{[\s\S]{0,120}return; \/\/ release focus out of the canvas/, "the cursor releases at the ends (no focus trap)");
assert.match(view, /centerOnNode\(node\.id\)/, "the focused node is centred in view");
assert.match(view, /if \(e\.key === "Enter" && kbdIdxRef\.current >= 0\)/, "Enter opens the keyboard-focused node");
assert.match(view, /const centerOnNode = useCallback\(\(id: string\) => \{[\s\S]{0,260}panX = -sim\.x\[i\] \* view\.k/, "centerOnNode pans so the node sits at the viewport centre");
assert.match(view, /Tab and Shift\+Tab step through the most-connected documents, Enter opens/, "the canvas label advertises the keyboard node controls");

// ── Wheel zoom must be non-passive (preventDefault) ─────────────────────────
assert.match(
  view,
  /addEventListener\("wheel", onWheel, \{ passive: false \}\)/,
  "wheel zoom registers non-passive so the page doesn't scroll",
);

console.log("grimoire-graph-view.test.ts: ok");
