import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./chat-follow-up-link-review.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /import \{ Button \} from "@\/components\/ui\/button"/);
assert.match(source, /import \{ Modal \} from "@\/components\/ui\/modal"/);
assert.match(source, /useAnnouncer/, "the modal announces save outcomes");
assert.match(source, /saveFollowUpLinks/, "saving routes through the shared link helper");
assert.match(source, /linksFromFollowUpSource\(links\.join\("\\n"\)\)/, "incoming links are filtered through the shared valid-link extractor");
assert.match(source, /breadcrumb=\{\["Chat", "Save links"\]\}/, "the modal keeps the Chat › Save links breadcrumb");
assert.match(source, /Research Resources/, "Research Resources is always available");
assert.match(source, /Current task/, "the current-task destination is rendered when present");
assert.match(source, /type="checkbox"/, "links are selectable via native checkboxes");
assert.match(source, /type="radio"/, "destinations are selectable via native radios");
assert.match(source, /setSelected\(new Set\(availableLinks\)\)/, "each open seeds every valid link as selected");
assert.match(source, /Save links/, "the resources action copy stays explicit");
assert.match(source, /Attach links/, "the task action copy stays explicit");
assert.match(source, /Cancel/, "saving remains explicitly confirm-or-cancel");
assert.match(source, /onClick=\{\(\) => void save\(\)\}/, "saving requires an explicit confirm click");
assert.match(
  source,
  /disabled=\{saving \|\| selectedUrls\.length === 0\}/,
  "confirmation is unavailable when no links are selected",
);
assert.match(source, /announce\(result\.message\)/, "successful saves are announced");
assert.match(source, /announce\(message, "assertive"\)/, "failures are announced assertively");
assert.match(source, /role="alert"/, "retryable failures stay visible");
assert.match(source, /dismissOnEscape=\{!saving\}/, "Escape dismissal is gated while saving");
assert.match(source, /dismissOnBackdrop=\{!saving\}/, "backdrop dismissal is gated while saving");
assert.match(source, /const close = \(\) => \{\s*if \(!saving\) onClose\(\);\s*\}/, "shared Modal owns focus return while close is gated during saves");
assert.match(source, /if \(destination === "task" && !taskId\)/, "stale current-task selections are guarded safely");
assert.doesNotMatch(source, /task!/ , "the modal never relies on a non-null assertion for the current task");
assert.doesNotMatch(
  source,
  /onChange=\{[\s\S]{0,120}saveFollowUpLinks/,
  "changing a checkbox or radio never auto-saves",
);

console.log("chat-follow-up-link-review.test.ts: ok");
