// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const field = readFileSync(new URL("./reminder-link-field.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("./new-reminder-modal.tsx", import.meta.url), "utf8");

// ── Kind options: None / URL / Task card / Chat session, NO Memory ───────────
assert.match(field, /value: "none", label: "No link"/, "should offer a None option");
assert.match(field, /value: "url", label: "URL"/, "should offer a URL option");
assert.match(field, /value: "card", label: "Task card"/, "should offer a Task card option");
assert.match(field, /value: "session", label: "Chat session"/, "should offer a Chat session option");
assert.doesNotMatch(
  field,
  /label: "Memory"/,
  "Memory must NOT be offered as a selectable link kind",
);
assert.doesNotMatch(
  field,
  /value: "memory"/,
  "Memory kind must not be a selectable option value",
);

// ── Lazy fetches the right endpoints ─────────────────────────────────────────
assert.match(field, /fetch\("\/api\/board"/, "card kind should fetch /api/board");
assert.match(field, /fetch\("\/api\/sessions\/list"/, "session kind should fetch /api/sessions/list");
assert.match(field, /cardCache/, "should cache board cards across mounts");
assert.match(field, /sessionCache/, "should cache sessions across mounts");

// ── Emits LinkRef shapes ─────────────────────────────────────────────────────
assert.match(field, /onChange\(null\)/, "None must clear the link with onChange(null)");
assert.match(field, /\{ kind: "url", ref:/, "url selection emits a url LinkRef");
assert.match(field, /\{ kind: "card", ref:/, "card selection emits a card LinkRef");
assert.match(field, /\{ kind: "session", ref:/, "session selection emits a session LinkRef");

// ── Graceful loading / empty / error states ──────────────────────────────────
assert.match(field, /Loading task cards/, "should render a canonical loading hint for cards");
assert.match(field, /No task cards yet/, "should render a canonical empty hint for cards");
assert.match(field, /Couldn't load task cards/, "should render a canonical fetch-error hint for cards");
assert.match(field, /rounded-\[var\(--radius-control\)\]/, "link controls should use the shared control radius token");
assert.doesNotMatch(field, /rounded-md/, "link controls should not hard-code Tailwind's md radius");

// ── Wired into the modal ─────────────────────────────────────────────────────
assert.match(modal, /import \{ ReminderLinkField \}/, "modal should import the link field");
assert.match(
  modal,
  /<fieldset\b[\s\S]*?<legend\b[^>]*>\s*Link \(optional\)\s*<\/legend>[\s\S]*?<ReminderLinkField\b[^>]*value=\{link\}[^>]*onChange=\{setLink\}[^>]*\/>[\s\S]*?<\/fieldset>/,
  "modal should wrap the link field in a labeled fieldset and wire it to local state",
);
assert.match(modal, /link\?: LinkRef \| null;/, "NewReminderDraft should carry an optional link");

console.log("reminder-link-field.test.ts: ok");
