// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);
const boardView = readFileSync(
  new URL("./board-view.tsx", import.meta.url),
  "utf8",
);

// Input is labelled.
assert.match(
  source,
  /<input[\s\S]*?(aria-label|aria-labelledby)=/,
  "command palette input has an accessible name",
);

// Results container is a listbox.
assert.match(source, /role="listbox"/, "results container has role=listbox");

// Items have role=option.
assert.match(source, /role="option"/, "each result item has role=option");
assert.match(source, /command-palette-row/, "command palette rows expose a mobile hit-area hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.command-palette-row,[\s\S]*min-height:\s*var\(--touch-target\)/,
  "command palette mobile rows should meet the shared touch target",
);

// Input is linked to listbox via aria-controls.
assert.match(source, /aria-controls=/, "input is linked to results via aria-controls");

// Active item announced via aria-activedescendant on input.
assert.match(source, /aria-activedescendant=/, "input uses aria-activedescendant for selection");

assert.match(
  source,
  /initialQuery\?: string/,
  "CommandPalette accepts an initial query from the top-bar search",
);

assert.match(
  source,
  /onQueryChange\?: \(query: string\) => void/,
  "CommandPalette reports query edits back to the top-bar search",
);

assert.match(
  source,
  /kind:\s*"salem-answer"/,
  "Command palette includes a Salem AI answer row",
);

// (cave-42r5) Ask-Salem trails the local matches: Enter on a typed query opens
// the best local hit; the AI row is the fallback (rows[0] only when nothing
// matches locally).
assert.match(
  source,
  /return \[\.\.\.localRows, \.\.\.salemRows\];/,
  "local matches come before the Ask-Salem fallback row",
);

assert.match(
  source,
  /fetch\("\/api\/salem"[\s\S]*body: JSON\.stringify\(\{[\s\S]*message:\s*query\.trim\(\)[\s\S]*context:/,
  "Salem answer row posts the query plus local search context to /api/salem",
);

assert.match(
  source,
  /buildSalemSearchContext\(rows,\s*query\.trim\(\)\)/,
  "Salem answer payload should be grounded in the current local search rows",
);

assert.match(
  source,
  /salem\.opencoven\.ai/,
  "Salem answer row should make the remote Salem brain explicit to the user",
);

// The non-standard aria-current="true" pattern on result items is gone.
const optionBlocks = source.match(/role="option"[\s\S]{0,300}/g) ?? [];
for (const block of optionBlocks) {
  assert.doesNotMatch(
    block,
    /aria-current="true"/,
    "result items no longer use aria-current=true (use aria-selected via activedescendant)",
  );
}

// Cmd+K can create a board task from the current query.
assert.match(
  source,
  /kind:\s*"create-task";\s*title:\s*string/,
  "PaletteIntent includes a `create-task` variant",
);
assert.match(
  source,
  /kind:\s*"create-task"[\s\S]{0,200}title:\s*trimmedTitle/,
  "a create-task row is appended when the query has a non-empty trimmed title",
);
assert.match(
  source,
  /onIntent\(\{\s*kind:\s*"create-task"[\s\S]{0,80}title:\s*row\.title/,
  "selecting the create-task row dispatches the create-task intent",
);

// A leading "/task" slash command is stripped from the created card's title.
const stripMatch = source.match(/trimmedTitle = .*\.replace\((\/.*?\/[a-z]*),/);
assert.ok(stripMatch, "create-task title strips a leading /task prefix via replace()");
{
  const re = new Function(`return ${stripMatch[1]}`)();
  const strip = (s) => s.trim().replace(re, "").trim();
  assert.equal(strip("/task fix login"), "fix login", "strips '/task ' prefix");
  assert.equal(strip("/TASK fix login"), "fix login", "strip is case-insensitive");
  assert.equal(strip("/task"), "", "bare '/task' yields empty title (no create row)");
  assert.equal(strip("fix /task login"), "fix /task login", "mid-string '/task' untouched");
  assert.equal(strip("/taskforce roster"), "/taskforce roster", "'/taskforce' is not stripped");
}

// ── Surface navigation ("Go to <surface>") makes ⌘K a launcher ──
assert.match(
  source,
  /kind:\s*"go-to-surface";\s*mode:\s*FolderMode/,
  "palette exposes a go-to-surface intent",
);
assert.match(
  source,
  /import \{ FOLDER_MODES[\s\S]*?from "@\/components\/sidebar-minimal"/,
  "surface rows are built from the shared FOLDER_MODES list (single source of truth)",
);
assert.match(
  source,
  /name:\s*`Go to \$\{fm\.label\}`/,
  "each navigable surface renders a 'Go to <label>' row",
);
assert.doesNotMatch(
  source,
  /addons\?\.github|addons\?\.browser|addons\?\.flow|addons\?\.journal|addons\?: AddonsConfig/,
  "surface rows are no longer hidden behind add-on config",
);
assert.match(
  source,
  /\(scoped \|\| slashToken\)\s*\n?\s*\?\s*\[\]/,
  "surface rows are hidden while typing a familiar scope or a slash command",
);
// Consumer: workspace switches surfaces on the intent.
assert.match(
  workspace,
  /intent\.kind === "go-to-surface"[\s\S]{0,80}?setMode\(intent\.mode as WorkspaceMode\)/,
  "workspace navigates to the chosen surface on a go-to-surface intent",
);

// ── "Open project" navigation ──
assert.match(
  source,
  /kind:\s*"open-project";\s*root:\s*string/,
  "palette exposes an open-project intent",
);
assert.match(
  source,
  /const \{ projects \} = useProjects\(\{ familiarId: activeFamiliarId \}\)/,
  "palette scopes project navigation to the active familiar's granted projects",
);
assert.match(
  source,
  /name:\s*`Open project \$\{p\.name\}`/,
  "each project renders an 'Open project <name>' row",
);
assert.match(
  source,
  /intent:\s*\{ kind: "open-project", root: p\.root \}/,
  "an open-project row carries the project root",
);
// Consumer: workspace latches the Projects tab (fresh-mount race, cave-c2zf),
// opens it, then focuses the chosen project.
assert.match(
  workspace,
  /intent\.kind === "open-project"[\s\S]{0,200}?markProjectsTabPending\(\)[\s\S]{0,320}?CHAT_OPEN_PROJECTS_EVENT[\s\S]{0,200}?CHAT_FOCUS_PROJECT_EVENT, \{ detail: \{ root \} \}/,
  "workspace latches then opens the Projects tab and focuses the chosen project",
);

// Board view-switch: the palette offers "Board: Kanban/Table/Gantt" rows that
// jump to the board and set its view; the board honors the live switch.
assert.match(source, /kind: "set-board-view"; view: "kanban" \| "table" \| "gantt"/, "a set-board-view intent exists");
assert.match(source, /label: "Board: Gantt timeline"/, "a Gantt board-view row is offered");
assert.match(source, /intent: \{ kind: "set-board-view", view: v\.view \}/, "board-view rows carry the set-board-view intent");
assert.match(source, /\.\.\.boardViewRows/, "board-view rows are included in the result list");
assert.match(
  workspace,
  /intent\.kind === "set-board-view"[\s\S]{0,500}cave:board:set-view/,
  "workspace handles set-board-view by dispatching the live switch event",
);
assert.match(boardView, /addEventListener\("cave:board:set-view"/, "board-view listens for the set-view event");
assert.match(boardView, /=== "gantt"\) setViewMode\(v\)/, "the set-view handler applies the requested view");
// Recent tasks: empty-query task rows lead with the most-recently-updated.
assert.match(
  source,
  /q \? 0 : new Date\(b\.updatedAt \?\? 0\)\.getTime\(\) - new Date\(a\.updatedAt \?\? 0\)\.getTime\(\)/,
  "task rows sort by recency when the query is empty",
);

console.log("command-palette.test.ts OK");
