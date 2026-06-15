// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
const card = await read("./salem-pathfinder-card.tsx");
const widget = await read("./salem-widget.tsx");
const sidebar = await read("../sidebar-minimal.tsx");
const projects = await read("../projects-view.tsx");
const boardRoute = await read("../../app/api/board/route.ts");

// Card: Save-to-Board is an explicit two-click confirm with save/saved/error feedback.
assert.match(card, /onSave\?: \(card: SalemPathfinderCard\) => Promise<boolean> \| void/, "onSave reports success");
assert.match(card, /"idle" \| "confirm" \| "saving" \| "saved" \| "error"/, "tracks save lifecycle");
assert.match(card, /if \(saveState === "idle"\)[\s\S]{0,80}setSaveState\("confirm"\)/, "first click arms confirm");
assert.match(card, /Confirm — save to Board/, "second click confirms the save");
assert.match(card, /salem-pf__action--save/, "renders a dedicated save button");

// Salem panel: home card is wired to save to the Board with labels + steps.
assert.match(widget, /onSave=\{saveCardToBoard\}/, "panel passes the save handler");
assert.match(widget, /\/api\/board/, "save posts to the board API");
assert.match(widget, /labels: \["salem", "happy-path", card\.recommendedPathId\]/, "tags the board card");
assert.match(widget, /steps: card\.steps\.map/, "copies path steps into the checklist");
assert.match(widget, /Salem path: \$\{card\.title\}/, "titles the board card by the path");

// Sidebar: Ask Salem entry opens the Salem rail.
assert.match(sidebar, /label="Ask Salem"/, "sidebar exposes an Ask Salem entry");
assert.match(sidebar, /cave:salem-open/, "Ask Salem opens the Salem rail");

// Projects empty state offers Ask Salem.
assert.match(projects, /Ask Salem/, "projects empty state offers Ask Salem");
assert.match(projects, /cave:salem-open/, "projects Ask Salem opens the Salem rail");

// Board route accepts steps for the checklist.
assert.match(boardRoute, /steps\?: \{ text: string \}\[\]/, "board POST accepts steps");
assert.match(boardRoute, /steps: body\.steps/, "board POST forwards steps to createCard");

console.log("salem-home-entry.test.ts OK");
