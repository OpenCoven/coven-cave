// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("./workflow-step-list.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("./workflow-studio.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/workflows.css", import.meta.url), "utf8");

// The mobile step list reads from the SAME graph source as the canvas, so the two
// views can't drift in what steps/labels/badges they show.
assert.match(list, /workflowToGraph\(workflow, dryRunFromAction\(action\), null, "vertical"\)\.nodes/,
  "step list derives nodes from workflowToGraph, like the canvas");
assert.match(list, /onSelectNode\(node\)/, "tapping a step selects it (opens the shared inspector)");
assert.match(list, /onRemoveStep\(node\.id\)/, "each step exposes a remove affordance");
assert.match(list, /aria-pressed=\{selected\}/, "selected step is exposed to assistive tech");
assert.match(list, /workflow-node-\$\{data\.tone\}/, "cards reuse the canvas tone classes for consistent color coding");
assert.match(list, /nodePhases\(playback\)/, "playback phases overlay the list like the canvas");

// The studio swaps canvas → list below the shell breakpoint (one or the other,
// never both — the canvas's React Flow instance is heavy).
assert.match(studio, /const isMobile = useIsMobile\(\)/, "studio observes the mobile breakpoint");
assert.match(studio, /isMobile \? \(\s*<WorkflowStepList/, "studio renders the step list on mobile");
assert.match(studio, /\) : \(\s*<WorkflowCanvas/, "studio renders the canvas on desktop");

// The list slots into the same grid area the canvas occupied and scrolls.
assert.match(styles, /\.workflow-step-list\s*\{[\s\S]*?grid-area:\s*canvas/,
  "step list occupies the canvas grid area");
assert.match(styles, /\.workflow-step-card\s*\{[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "step cards meet the shared touch target");

console.log("workflow-step-list.test.ts: ok");
