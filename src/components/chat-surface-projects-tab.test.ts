// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("../lib/chat-tab-events.ts", import.meta.url), "utf8");

assert.match(events, /CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects"/, "event constant defined");

assert.match(surface, /import \{[\s\S]*ProjectsView[\s\S]*\} from "@\/components\/lazy-surfaces"/, "chat-surface lazy-loads ProjectsView");
assert.match(surface, /CHAT_OPEN_PROJECTS_EVENT/, "chat-surface references the reroute event");
assert.match(surface, /type FamiliarsScope = "conversation" \| "projects" \| "coven"/, "scope union is conversation + projects + coven (memory retired, cave-liut)");
// Chat keeps a narrow Sessions / Projects tab pair so project creation is
// discoverable without slash commands. The retired Code surface no longer owns
// a special Sessions / Memory tab pair.
assert.doesNotMatch(surface, /\{\s*id:\s*"chat",\s*label:\s*"Chat"\s*\}/, "the Chat toggle segment is gone");
assert.doesNotMatch(surface, /\{\s*id:\s*"code",\s*label:\s*"Code"\s*\}/, "the Code toggle segment is gone");
assert.match(
  surface,
  /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "standalone Chat exposes Projects as a dedicated tab",
);
assert.match(
  surface,
  /<Tabs<FamiliarsScope>[\s\S]*?\{\s*id:\s*"conversation",\s*label:\s*"Sessions"\s*\},\s*\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/,
  "Chat tab list is Sessions + Projects",
);
assert.match(surface, /scope === "projects" \? \(/, "projects browse still renders ProjectsView as a sub-state of Chat");
assert.match(surface, /<ProjectsView[\s\S]*?sessions=\{sessions\}/, "projects panel renders ProjectsView with sessions");
assert.match(
  surface,
  /<ProjectsView[\s\S]*?familiars=\{familiars\}/,
  "projects panel threads the familiar roster (Grants section chips)",
);
assert.match(surface, /onNewChat=\{startProjectChat\}/, "projects panel wires onNewChat to startProjectChat");
assert.match(surface, /addEventListener\(CHAT_OPEN_PROJECTS_EVENT/, "listens for the reroute event");
assert.match(surface, /onOpenProjectsTab=\{\(\) => setScope\("projects"\)\}/, "chat project rail can jump directly to the Projects tab");

assert.doesNotMatch(surface, /isCodeSurface|CodeInlineToolbar/, "retired Code surface should not gate alternate chat tabs");

console.log("chat-surface-projects-tab.test.ts: ok");
