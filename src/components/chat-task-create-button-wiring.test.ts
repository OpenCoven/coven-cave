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

const linkedWork = await readFile(new URL("./composer-linked-work-actions.tsx", import.meta.url), "utf8");

assert.match(
  linkedWork,
  /import \{ createSmartTaskFromChat \} from "@\/lib\/chat-task-autofill"/,
  "composer-linked-work-actions uses the shared smart-autofill helper, not an inline fetch",
);
assert.match(
  linkedWork,
  /const createTaskFromConversation = async \(\) => \{\s*if \(!handoff \|\| !sessionId \|\| creatingTask\) return;/,
  "creation requires a handoff context and session, and is re-entry guarded",
);
assert.match(
  linkedWork,
  /createSmartTaskFromChat\(\{ sessionId, context: handoff \}\)/,
  "the button hands the full conversation context to the autofill helper",
);
assert.match(
  linkedWork,
  /if \(!result\.ok \|\| !result\.card\) throw new Error\(result\.error \?\? "Failed to create task"\);\s*onAssigned\(result\.card\);/,
  "the created card flows through the same onAssigned path as a linked one",
);
assert.match(
  linkedWork,
  /\{canLink && handoff \? \(\s*<PopoverItem[\s\S]*?title="Create a task from this conversation — auto-fills title, subtasks, priority, due date, and links"/,
  "the create action only renders when the chat can link tasks and has a handoff context, with its detailed affordance copy intact",
);
assert.match(
  linkedWork,
  /\{creatingTask \? "Creating…" : "Create task"\}/,
  "the button shows in-flight state",
);
assert.match(
  linkedWork,
  /createSmartTaskFromChat\(\{ sessionId, context: handoff \}\)[\s\S]{0,1500}catch \(err\) \{[\s\S]{0,400}err instanceof Error && err\.message[\s\S]{0,160}check your connection/,
  "creation failure surfaces the server's specific reason (err.message), with the connection hint only as fallback",
);
assert.match(
  linkedWork,
  /announce\(\s*`Task "\$\{result\.card\.title\}" created from this chat/,
  "success is announced to screen readers, naming what was auto-filled",
);

console.log("chat-task-create-button-wiring.test.ts: ok");
