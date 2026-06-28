// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("../lib/chat-tab-events.ts", import.meta.url), "utf8");

assert.match(events, /CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects"/, "event constant defined");

assert.match(surface, /import \{ ProjectsView \} from "@\/components\/projects-view"/, "chat-surface imports ProjectsView");
assert.match(surface, /CHAT_OPEN_PROJECTS_EVENT/, "chat-surface references the reroute event");
assert.match(surface, /type FamiliarsScope = "conversation" \| "memory" \| "projects"/, "scope union still includes memory (Code surface) + projects");
// The standalone chat's toggle is two-way (Chat / Code). Projects is merged
// INTO Chat — it is NOT a peer segment, but the full ProjectsView browser still
// renders as a sub-state of Chat (scope === "projects") reached via ⌘9 / board /
// the /projects slash, keeping the toggle on "Chat".
assert.match(surface, /\{\s*id:\s*"chat",\s*label:\s*"Chat"\s*\}/, "Chat is one of the two toggle modes");
assert.match(surface, /\{\s*id:\s*"code",\s*label:\s*"Code"\s*\}/, "Code is the inline chat↔code split mode");
assert.doesNotMatch(
  surface,
  /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "Projects is no longer a peer mode-switch segment (merged into Chat)",
);
assert.match(surface, /scope === "projects" && !isCodeSurface \? \(/, "projects browse still renders ProjectsView as a sub-state of Chat (standalone chat only)");
assert.match(surface, /<ProjectsView[\s\S]*?sessions=\{sessions\}/, "projects panel renders ProjectsView with sessions");
assert.match(surface, /onNewChat=\{startProjectChat\}/, "projects panel wires onNewChat to startProjectChat");
assert.match(surface, /addEventListener\(CHAT_OPEN_PROJECTS_EVENT/, "listens for the reroute event");

// Code surface keeps its own Sessions + Memory underline tab pair (the comux
// pane owns project/file navigation there, so it has no Projects tab) and is
// gated behind isCodeSurface — the standalone chat shows the mode switch instead.
assert.match(
  surface,
  /isCodeSurface\s*\?\s*\(\s*<Tabs<FamiliarsScope>[\s\S]*?\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\},\s*\{\s*id:\s*"memory",\s*label:\s*"Memory"\s*\},?\s*\][\s\S]*?\)\s*:\s*null/,
  "Code surface tab list is Sessions + Memory only, gated on isCodeSurface",
);

console.log("chat-surface-projects-tab.test.ts: ok");
