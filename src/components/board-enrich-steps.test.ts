// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  board,
  /\/api\/board\/enrich-steps|handleEnrichTasks|Enrich tasks/,
  "Board view should not own task enrichment; navigation away from Board must not abort the process",
);

assert.match(
  workspace,
  /const handleEnrichTasks = useCallback\(async \(\) => \{[\s\S]*if \(enrichingTasks\) return;[\s\S]*fetch\("\/api\/board\/enrich-steps", \{[\s\S]*body: JSON\.stringify\(\{ intent: "board-enrich-steps", scope: "all" \}\)/,
  "Workspace should own the long-running enrich request and sweep every open task (#5629)",
);

assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*onEnrichTasks=\{handleEnrichTasks\}[\s\S]*enrichingTasks=\{enrichingTasks\}[\s\S]*enrichProgress=\{enrichProgress\}/,
  "Desktop top bar should receive the enrich action and progress from Workspace",
);

assert.match(
  workspace,
  /<TopBar[\s\S]*onEnrichTasks=\{handleEnrichTasks\}[\s\S]*enrichingTasks=\{enrichingTasks\}[\s\S]*enrichProgress=\{enrichProgress\}/,
  "Mobile top bar should receive the enrich action and progress from Workspace",
);

assert.match(
  menuBar,
  /onEnrichTasks\?: \(\) => void[\s\S]*enrichingTasks\?: boolean[\s\S]*enrichProgress\?: \{ done: number; total: number \} \| null/,
  "Desktop menu bar should accept the enrich action and progress state",
);

// Enhance is conditional, wired to onEnrichTasks, and disabled only while a run
// is in flight. It no longer needs a selected familiar: every open task is
// reviewed by its own assigned familiar (#5629).
assert.match(
  menuBar,
  /onEnrichTasks \? \([\s\S]*onClick=\{onEnrichTasks\}[\s\S]*disabled=\{enrichingTasks\}[\s\S]*aria-label=\{enrichingTasks[\s\S]*\{enrichingTasks \? enrichLabel : "Enhance"\}/,
  "Desktop menu bar should render Enhance and disable it only while running",
);

assert.match(
  menuBar,
  /Enhance every open task: each assigned familiar reviews its tasks, then updates or closes them/,
  "Desktop enrich affordance should explain that each assigned familiar reviews, updates, or closes its tasks",
);

assert.match(
  topBar,
  /onEnrichTasks\?: \(\) => void[\s\S]*enrichingTasks\?: boolean[\s\S]*enrichProgress\?: \{ done: number; total: number \} \| null/,
  "Mobile top bar should accept the enrich action and progress state",
);

assert.match(
  topBar,
  /onEnrichTasks \? \(\s*<PopoverItem\s*icon="ph:sparkle"\s*disabled=\{enrichingTasks\}\s*onSelect=\{onEnrichTasks\}/,
  "Mobile top bar should surface Enrich as the first overflow-menu action, disabled while running",
);

assert.match(
  topBar,
  /Enhance every open task: each assigned familiar reviews its tasks, then updates or closes them/,
  "Mobile enrich affordance should expose the same full task enhancement tooltip",
);

assert.match(
  topBar,
  /: "Enhance tasks"/,
  "Mobile enrich affordance should expose Enhance task copy when idle",
);
