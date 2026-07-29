import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-follow-up-task-review.tsx", import.meta.url), "utf8");
const transcriptStyles = await readFile(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");

assert.match(source, /import \{ Modal \} from "@\/components\/ui\/modal"/, "review uses the shared focus-trapped Modal");
assert.match(source, /useAnnouncer/, "review announces task creation outcomes");
assert.match(source, /buildTaskDraftFromChat\(/, "review builds the existing chat-linked draft");
assert.match(source, /createTaskFromDraft\(draft\)/, "review submits only the prepared draft");
assert.match(
  source,
  /\[sessionId, context\.turns, context\.familiarId, context\.projectId, suggestion\.prompt\]/,
  "draft derivation depends on stable context fields, not the caller's object identity",
);
assert.match(source, /aria-label="Task title"/, "the task title is explicitly editable before creating");
assert.match(source, /Create task/, "creation is an explicit review action");
assert.match(source, /Cancel/, "review can be cancelled without creating a task");
assert.match(source, /dismissOnEscape=\{!creating\}/, "escape dismissal is gated while creation is in flight");
assert.match(source, /dismissOnBackdrop=\{!creating\}/, "backdrop dismissal is gated while creation is in flight");
assert.match(source, /error=\{error \?\? undefined\}/, "creation failures use the shared Field alert treatment");
assert.match(source, /announce\(`Task "\$\{result\.card\.title\}" created from this chat\.`\)/, "successful creation is announced with its task title");
assert.match(
  transcriptStyles,
  /\.cave-followup-card \{[\s\S]*?background-color: var\(--bg-raised\);/,
  "follow-up cards retain a token-backed raised surface",
);

console.log("chat-follow-up-task-review.test.ts: ok");
