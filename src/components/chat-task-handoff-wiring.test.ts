// @ts-nocheck
// Chat → board task handoff wiring (cave-px7). The pure payload logic is
// unit-tested in src/lib/chat-task-handoff.test.ts; this guards the UI wiring:
// the task-link picker offers "New task from this chat" when the chat surface
// hands it a handoff context, and chat-view actually supplies that context
// (turns + familiar + project) so the created card is linked and auditable.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const picker = await readFile(new URL("./task-link-picker.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── picker: create-from-chat row ─────────────────────────────────────────────
assert.match(
  picker,
  /import \{ createTaskFromChat, type ChatHandoffContext \} from "@\/lib\/chat-task-handoff"/,
  "picker should use the shared chat-task-handoff helper, not an inline fetch",
);
assert.match(
  picker,
  /handoff\?: ChatHandoffContext \| null/,
  "handoff context is an optional prop — the picker still works link-only",
);
assert.match(
  picker,
  /createTaskFromChat\(\{\s*sessionId,\s*context: handoff,\s*title: query\.trim\(\) \|\| undefined,?\s*\}\)/,
  "the typed search query doubles as the new task's title",
);
assert.match(
  picker,
  /\{handoff \? \(\s*<button[\s\S]*?New task from this chat/,
  "the create row only renders when a handoff context is supplied",
);
assert.match(
  picker,
  /aria-label=\{\s*query\.trim\(\)\s*\? `Create a new task "\$\{query\.trim\(\)\}" from this chat`\s*: "Create a new task from this chat"/,
  "the create row keeps an accessible name",
);
assert.match(
  picker,
  /if \(!result\.ok \|\| !result\.card\) throw new Error\(result\.error \?\? "Failed to create task"\);\s*onAssigned\(result\.card\);\s*onClose\(\);/,
  "a created card flows through the same onAssigned path as a linked one, so the header chip appears immediately",
);

// ── chat-view: supplies the handoff context ──────────────────────────────────
assert.match(
  chatView,
  /import type \{ ChatHandoffContext \} from "@\/lib\/chat-task-handoff"/,
  "chat-view imports the handoff context type",
);
assert.match(
  chatView,
  /handoff=\{\{ turns, familiarId: familiar\.id \?\? null, projectId: projectIdDraft \}\}/,
  "chat-view hands the picker its turns plus the chat's familiar and project",
);
assert.match(
  chatView,
  /<TaskLinkPicker[\s\S]*?handoff=\{handoff\}/,
  "LinkedContextRow forwards the handoff context to the picker",
);

console.log("chat-task-handoff-wiring.test.ts: ok");
