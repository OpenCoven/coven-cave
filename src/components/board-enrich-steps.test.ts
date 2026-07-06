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
  /const handleEnrichTasks = useCallback\(async \(\) => \{[\s\S]*if \(!activeId \|\| enrichingTasks\) return;[\s\S]*fetch\("\/api\/board\/enrich-steps", \{[\s\S]*body: JSON\.stringify\(\{ intent: "board-enrich-steps", familiarId: activeId \}\)/,
  "Workspace should own the long-running enrich request and scope it to the selected familiar",
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

assert.match(
  menuBar,
  /onEnrichTasks \? \([\s\S]*onClick=\{onEnrichTasks\}[\s\S]*disabled=\{enrichingTasks \|\| !activeFamiliarId\}[\s\S]*aria-label=\{enrichingTasks[\s\S]*<span>\{enrichingTasks \? enrichLabel : "Enhance"\}<\/span>[\s\S]*onClick=\{onViewTasks\}/,
  "Desktop menu bar should place Enhance next to Tasks and disable it without a selected familiar",
);

assert.match(
  menuBar,
  /Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats/,
  "Desktop enrich affordance should explain that the assigned familiar performs full task enhancement",
);

assert.match(
  topBar,
  /onEnrichTasks\?: \(\) => void[\s\S]*enrichingTasks\?: boolean[\s\S]*enrichProgress\?: \{ done: number; total: number \} \| null/,
  "Mobile top bar should accept the enrich action and progress state",
);

assert.match(
  topBar,
  /onEnrichTasks \? \(\s*<PopoverItem\s*icon="ph:sparkle"\s*disabled=\{enrichingTasks \|\| !activeFamiliar\}\s*onSelect=\{onEnrichTasks\}/,
  "Mobile top bar should surface Enrich as the first overflow-menu action, disabled while running or unscoped",
);

assert.match(
  topBar,
  /Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats/,
  "Mobile enrich affordance should expose the same full task enhancement tooltip",
);

assert.match(
  topBar,
  /: "Enhance tasks"/,
  "Mobile enrich affordance should expose Enhance task copy when idle",
);
