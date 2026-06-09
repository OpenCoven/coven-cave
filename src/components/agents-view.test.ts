// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./agents-view.tsx", import.meta.url), "utf8");

assert.match(source, /export function AgentsView/, "AgentsView must be exported");

assert.match(
  source,
  /const LAST_SELECTED_KEY = "cave:agents\.lastSelected"/,
  "Selection persistence uses cave:agents.lastSelected localStorage key",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\)/,
  "Initial selectedFamiliarId reads from localStorage",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\) \? "detail" : "roster"/,
  "Initial viewMode boots into detail when a selection is persisted, else roster",
);

assert.match(
  source,
  /fetch\("\/api\/coven-memory"[\s\S]*fetch\("\/api\/memory"/,
  "Memory data is fetched from /api/coven-memory and /api/memory",
);

assert.match(
  source,
  /setInterval\(loadMemory, 30_000\)/,
  "Memory data refreshes on 30s interval",
);

assert.match(
  source,
  /buildAgentCardStats\(\{[\s\S]*familiars,[\s\S]*sessions,[\s\S]*covenEntries[\s\S]*\}\)/,
  "Per-card stats are derived from buildAgentCardStats",
);

assert.match(
  source,
  /viewMode === "detail" && selectedFamiliar/,
  "Detail layout renders when viewMode is detail and a familiar is selected",
);

assert.match(
  source,
  /<AgentDetailRail[\s\S]*<AgentDetailPanel/,
  "Detail layout mounts the rail + panel",
);

assert.match(
  source,
  /const memoryFamiliar = selectedFamiliar \?\? activeFamiliar \?\? null/,
  "Familiar memory scope falls back to the workspace-selected familiar",
);

assert.match(
  source,
  /<AgentMemoryOverlay[\s\S]*familiar=\{memoryFamiliar\}/,
  "Familiar memory overlay is scoped to the selected familiar",
);

assert.match(
  source,
  /setViewMode\("agent-memory"\)/,
  "Header button switches to agent-memory mode",
);

assert.doesNotMatch(
  source,
  /Memory across all agents/,
  "Familiars view should not expose global all-agents memory copy",
);

assert.match(
  source,
  /<h1[^>]*>Familiars<\/h1>/,
  "Page heading uses Familiars instead of Agents",
);

assert.match(
  source,
  /Familiar memory/,
  "Memory action uses singular Familiar copy",
);

assert.match(
  source,
  /activeFamiliar=\{familiar\}[\s\S]*lockToFamiliar/,
  "Familiar memory overlay passes the selected familiar and locks the memory filter",
);

assert.match(
  source,
  /onClose=\{\(\) => setViewMode\(selectedFamiliarId \? "detail" : "roster"\)\}/,
  "Closing the overlay restores the previous viewMode based on selection",
);

assert.match(
  source,
  /AgentsEmptyState[\s\S]*onOpenOnboarding/,
  "Empty state CTA wires to onOpenOnboarding",
);

assert.match(
  source,
  /lockToFamiliar/,
  "Memory tab inside detail passes lockToFamiliar to AgentsMemoryView",
);

assert.match(
  source,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Overlay exposes modal dialog semantics",
);

console.log("agents-view: all assertions passed");
