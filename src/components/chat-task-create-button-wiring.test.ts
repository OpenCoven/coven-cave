// @ts-nocheck
// Chat "Create task" button wiring. The pure autofill derivation (links,
// GitHub links, priority, due dates, subtasks) is unit-tested in
// src/lib/chat-task-autofill.test.ts; this guards the UI side: chat-view's
// LinkedContextRow renders a one-click "Create task" button when it has a
// handoff context, posts through the shared createSmartTaskFromChat helper,
// and routes the created card through the same onAssigned path as the picker
// so the header chip appears immediately.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /import \{ createSmartTaskFromChat \} from "@\/lib\/chat-task-autofill"/,
  "chat-view uses the shared smart-autofill helper, not an inline fetch",
);
assert.match(
  chatView,
  /const createTaskFromConversation = async \(\) => \{\s*if \(!handoff \|\| !sessionId \|\| creatingTask\) return;/,
  "creation requires a handoff context and session, and is re-entry guarded",
);
assert.match(
  chatView,
  /createSmartTaskFromChat\(\{ sessionId, context: handoff \}\)/,
  "the button hands the full conversation context to the autofill helper",
);
assert.match(
  chatView,
  /if \(!result\.ok \|\| !result\.card\) throw new Error\(result\.error \?\? "Failed to create task"\);\s*onAssigned\(result\.card\);/,
  "the created card flows through the same onAssigned path as a linked one",
);
assert.match(
  chatView,
  /\{canLink && handoff \? \(\s*<button[\s\S]*?aria-label="Create a task from this conversation"/,
  "the button only renders when the chat can link tasks and has a handoff context, with an accessible name",
);
assert.match(
  chatView,
  /\{creatingTask \? "Creating…" : "Create task"\}/,
  "the button shows in-flight state",
);
assert.match(
  chatView,
  /announce\(\s*`Task "\$\{result\.card\.title\}" created from this chat/,
  "success is announced to screen readers, naming what was auto-filled",
);

console.log("chat-task-create-button-wiring.test.ts: ok");
