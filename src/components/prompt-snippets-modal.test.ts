// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Prompt snippets picker + manager (cave-jg6k) and the Save-as-template form.
// The prefs helpers execute in prompt-prefs.test.ts and the API in
// prompts/route.test.ts — these pins hold the modal's UI contracts: tag
// chips, favorites, user-only edit/delete, duplicate for shipped rows, and
// the no-nested-focus-traps rule.

const modal = await readFile(new URL("./prompt-snippets-modal.tsx", import.meta.url), "utf8");
const saveModal = await readFile(new URL("./save-template-modal.tsx", import.meta.url), "utf8");
const optionsMenu = await readFile(new URL("./composer-options-menu.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── Ordering + tag chips ─────────────────────────────────────────────────────
assert.match(
  modal,
  /orderPrompts\(prompts, favorites, readPromptRecents\(\)\)/,
  "rows rank favorites > recents > scan order (shared prefs ranking)",
);
assert.match(
  modal,
  /role="group" aria-label="Filter by tag"/,
  "tag chips are a labelled group",
);
assert.match(modal, /aria-pressed=\{activeTag === tag\}/, "tag chips expose pressed state");
assert.match(
  modal,
  /rounded-full border border-\[var\(--border-hairline\)\]/,
  "chips are 999px pills with hairline borders",
);
assert.match(
  modal,
  /bg-\[var\(--bg-raised\)\] text-\[var\(--text-primary\)\]/,
  "the selected chip fills with raised-bg — accent stays presence-only",
);
assert.doesNotMatch(
  modal,
  /--accent/,
  "no accent in the picker chrome (design-language rule)",
);

// ── Favorites ────────────────────────────────────────────────────────────────
assert.match(modal, /togglePromptFavorite\(cur, p\.id\)/, "the bookmark toggles a favorite");
assert.match(
  modal,
  /aria-pressed=\{isFavorite\}/,
  "the favorite toggle exposes its state",
);
assert.match(
  modal,
  /isFavorite \? "ph:bookmark-simple-fill" : "ph:bookmark-simple"/,
  "favorite state swaps the bookmark glyph",
);

// ── Manage: user-only edit/delete, duplicate elsewhere ───────────────────────
assert.match(
  modal,
  /p\.source === "user" \?[\s\S]*?Edit \$\{p\.name\}[\s\S]*?Delete \$\{p\.name\}/,
  "edit and delete render for user templates only",
);
assert.match(
  modal,
  /Duplicate \$\{p\.name\} to my templates/,
  "builtin/pack rows offer Duplicate to my templates instead",
);
assert.match(modal, /originLabel/, "non-user rows carry a muted origin chip");
assert.match(
  modal,
  /const ok = await confirm\(\{[\s\S]*?danger: true/,
  "delete goes through the shared ConfirmDialog in destructive style",
);
assert.match(
  modal,
  /fetch\(`\/api\/prompts\?id=\$\{encodeURIComponent\(p\.id\)\}`, \{ method: "DELETE" \}\)/,
  "delete is id-based only (the server slug regex confines the path)",
);
assert.match(modal, /broadcastPromptsRefresh\(\)/, "a delete broadcasts the re-scan event");

// ── No nested focus traps ────────────────────────────────────────────────────
// Both Modal and ConfirmDialog trap focus on window keydown; stacking them
// would double-fire Escape. The list modal hides while a child dialog is up.
assert.match(
  modal,
  /const listOpen = open && editing === null && duplicating === null && !confirming;/,
  "the list modal yields to the save/confirm dialogs instead of stacking traps",
);

// ── Save-as-template form ────────────────────────────────────────────────────
assert.match(saveModal, /export const PROMPTS_REFRESH_EVENT = "cave:prompts-refresh"/, "the refresh event name is exported once");
assert.match(saveModal, /method: "POST"/, "saving POSTs to /api/prompts");
assert.match(
  saveModal,
  /\.\.\.\(editing \? \{ id: editing\.id, overwrite: true \} : \{\}\)/,
  "edits keep their id and overwrite",
);
assert.match(
  saveModal,
  /res\.status === 409[\s\S]{0,200}?setOverwriteArmed\(true\)/,
  "a create-collision 409 arms an explicit Overwrite confirm instead of silently replacing",
);
assert.match(saveModal, /broadcastPromptsRefresh\(\);/, "a save broadcasts the re-scan event");
assert.doesNotMatch(saveModal, /autoFocus/, "no autoFocus inside a focus-trapped Modal (breaks return-focus)");
assert.match(saveModal, /\{\{name\|default\}\}/, "the form teaches the placeholder + default grammar");

// ── Composer wiring ──────────────────────────────────────────────────────────
assert.match(optionsMenu, /Save draft as template…/, "the Options menu carries the save action");
assert.match(
  optionsMenu,
  /disabled=\{saveAsTemplateDisabled\}/,
  "the save action can be disabled (empty draft)",
);
for (const [name, src, draft] of [["home-composer", home, "text"], ["chat-view", chat, "input"]]) {
  assert.match(
    src,
    new RegExp(`onSaveAsTemplate=\\{\\(\\) => setSaveTemplateSeed\\(${draft}\\)\\}`),
    `${name} seeds the save modal with the current draft`,
  );
  assert.match(
    src,
    new RegExp(`saveAsTemplateDisabled=\\{!${draft}\\.trim\\(\\)\\}`),
    `${name} disables save-as-template while the draft is empty`,
  );
  assert.match(
    src,
    /<SaveTemplateModal[\s\S]{0,200}?initialBody=\{saveTemplateSeed \?\? ""\}/,
    `${name} mounts the save modal`,
  );
}

console.log("prompt-snippets-modal.test.ts: ok");
