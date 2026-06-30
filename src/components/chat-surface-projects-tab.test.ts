// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("../lib/chat-tab-events.ts", import.meta.url), "utf8");

assert.match(events, /CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects"/, "event constant defined");

assert.match(surface, /import \{ ProjectsView \} from "@\/components\/projects-view"/, "chat-surface imports ProjectsView");
assert.match(surface, /CHAT_OPEN_PROJECTS_EVENT/, "chat-surface references the reroute event");
assert.match(surface, /type FamiliarsScope = "conversation" \| "memory" \| "projects"/, "scope union still includes memory (Code surface) + projects");
// The standalone chat keeps a narrow Sessions / Projects tab pair so project
// creation is discoverable without slash commands. Code keeps its own
// Sessions / Memory pair because the comux pane owns project/file navigation.
assert.doesNotMatch(surface, /\{\s*id:\s*"chat",\s*label:\s*"Chat"\s*\}/, "the Chat toggle segment is gone");
assert.doesNotMatch(surface, /\{\s*id:\s*"code",\s*label:\s*"Code"\s*\}/, "the Code toggle segment is gone");
assert.match(
  surface,
  /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "standalone Chat exposes Projects as a dedicated tab",
);
assert.match(
  surface,
  /!isCodeSurface\s*\?\s*\([\s\S]*?<Tabs<FamiliarsScope>[\s\S]*?\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\},\s*\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "standalone Chat tab list is Sessions + Projects",
);
assert.match(surface, /scope === "projects" && !isCodeSurface \? \(/, "projects browse still renders ProjectsView as a sub-state of Chat (standalone chat only)");
assert.match(surface, /<ProjectsView[\s\S]*?sessions=\{sessions\}/, "projects panel renders ProjectsView with sessions");
assert.match(surface, /onNewChat=\{startProjectChat\}/, "projects panel wires onNewChat to startProjectChat");
assert.match(surface, /addEventListener\(CHAT_OPEN_PROJECTS_EVENT/, "listens for the reroute event");
assert.match(surface, /onOpenProjectsTab=\{\(\) => setScope\("projects"\)\}/, "chat project rail can jump directly to the Projects tab");

// Code surface keeps its own Sessions + Memory underline tab pair (the comux
// pane owns project/file navigation there, so it has no Projects tab), gated
// behind isCodeSurface.
assert.match(
  surface,
  /isCodeSurface\s*\?\s*\([\s\S]*?<Tabs<FamiliarsScope>[\s\S]*?\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\},\s*\{\s*id:\s*"memory",\s*label:\s*"Memory"\s*\},?\s*\][\s\S]*?\)\s*:\s*null/,
  "Code surface tab list is Sessions + Memory only, gated on isCodeSurface",
);

console.log("chat-surface-projects-tab.test.ts: ok");
