// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("../lib/chat-tab-events.ts", import.meta.url), "utf8");

assert.match(events, /CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects"/, "event constant defined");

assert.match(surface, /import \{ ProjectsView \} from "@\/components\/projects-view"/, "chat-surface imports ProjectsView");
assert.match(surface, /CHAT_OPEN_PROJECTS_EVENT/, "chat-surface references the reroute event");
assert.match(surface, /type FamiliarsScope = "conversation" \| "memory" \| "projects"/, "scope union includes projects");
assert.match(
  surface,
  /\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\}[\s\S]*?\{\s*id:\s*"memory",\s*label:\s*"Memory"\s*\}[\s\S]*?\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "shared Tabs items list all three scopes ending with the projects tab",
);
assert.match(surface, /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/, "projects tab is labeled");
assert.match(surface, /scope === "projects" && !isCodeSurface \? \(/, "projects scope renders its own panel (standalone chat only)");
assert.match(surface, /<ProjectsView[\s\S]*?sessions=\{sessions\}/, "projects panel renders ProjectsView with sessions");
assert.match(surface, /onNewChat=\{startProjectChat\}/, "projects panel wires onNewChat to startProjectChat");
assert.match(surface, /addEventListener\(CHAT_OPEN_PROJECTS_EVENT/, "listens for the reroute event");

// Code surface drops the duplicate Projects tab (the comux pane owns project /
// file navigation there) — the tab list is Sessions + Memory only when isCodeSurface.
assert.match(
  surface,
  /isCodeSurface\s*\?\s*\[\s*\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\},\s*\{\s*id:\s*"memory",\s*label:\s*"Memory"\s*\},?\s*\]\s*:\s*\[/,
  "Code surface tab list omits the Projects tab",
);

console.log("chat-surface-projects-tab.test.ts: ok");
