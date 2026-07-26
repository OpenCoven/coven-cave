// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
const card = await read("./salem-pathfinder-card.tsx");
const widget = await read("./salem-widget.tsx");
const sidebar = await read("../sidebar-minimal.tsx");
const projects = await read("../projects-view.tsx");
const boardRoute = await read("../../app/api/board/route.ts");

// Card: Save-to-Tasks is an explicit two-click confirm with save/saved/error feedback.
assert.match(card, /onSave\?: \(card: SalemPathfinderCard\) => Promise<boolean> \| void/, "onSave reports success");
assert.match(card, /"idle" \| "confirm" \| "saving" \| "saved" \| "error"/, "tracks save lifecycle");
assert.match(card, /if \(saveState === "idle"\)[\s\S]{0,80}setSaveState\("confirm"\)/, "first click arms confirm");
assert.match(card, /Confirm — save to Tasks/, "second click confirms the save");
assert.match(card, /salem-pf__action--save/, "renders a dedicated save button");

// The rail chat has no Pathfinder trigger. Keep the old save implementation
// out instead of carrying an unreachable second entry path.
assert.doesNotMatch(widget, /saveCardToBoard|\/api\/board|SalemPathfinderCard/, "rail chat omits dormant Pathfinder save plumbing");

// Sidebar: the Ask Salem entry was removed from the left side panel. The mode
// exists as a FOLDER_MODES row (object literal, not JSX) but must stay
// navHidden so it never renders as a sidebar entry — it's summoned via Home,
// the ⌘K palette, deep links, or the widget's expand button.
assert.doesNotMatch(sidebar, /label="Ask Salem"/, "sidebar no longer exposes an Ask Salem entry");
assert.match(
  sidebar,
  /id: "salem", label: "Ask Salem",[^\n]*navHidden: true/,
  "salem FOLDER_MODES row stays navHidden (palette/deep-link only, no sidebar row)",
);

// Projects empty state offers Ask Salem.
assert.match(projects, /Ask Salem/, "projects empty state offers Ask Salem");
assert.match(projects, /cave:salem-open/, "projects Ask Salem opens the Salem rail");

// Board route accepts steps for the checklist.
assert.match(boardRoute, /steps\?: \{ text: string \}\[\]/, "board POST accepts steps");
assert.match(boardRoute, /steps: body\.steps/, "board POST forwards steps to createCard");

console.log("salem-home-entry.test.ts OK");
