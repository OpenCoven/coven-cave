// @ts-nocheck
// Project selection used to be four unrelated widgets (chat overflow popover,
// chat empty-state <select>, home-composer <select>, comux rail), and the only
// way to register a new root was to fail a send and click the 403 recovery.
// ProjectPicker is the one shared picker, and useAddProjectFlow the one shared
// add flow — folder dialog → addChatProject, which registers AND grants, so a
// freshly added project is immediately usable instead of 403ing in chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./project-picker.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── One shared add flow: register + grant in a single human-initiated step ──
assert.match(src, /export function useAddProjectFlow\(/, "shared flow exported");
assert.match(src, /addChatProject\(\{/, "register+grant goes through the tested helper");
assert.match(src, /shell_pick_directory/, "native folder dialog on desktop builds");
assert.match(src, /DirectoryPickerModal/, "web fallback directory browser");

// ── One shared picker: No project, project list, proactive Add project ──────
assert.match(src, /export function ProjectPicker\(/, "picker exported");
assert.match(src, /onChange\(NO_PROJECT_ID\);/, "explicit No-project row");
assert.match(src, /Add project…/, "proactive add affordance (not 403-recovery-only)");
assert.match(src, /aria-label="Filter projects"/, "filter input for long lists");
assert.match(src, /aria-haspopup="dialog"/, "trigger announces the popover");
assert.match(src, /role="alert"/, "add-flow failures surface inline, not silently");

// ── Sentinel for native selects that embed the same flow (home composer) ────
assert.match(src, /export const ADD_PROJECT_ID = "__add-project__";/, "select sentinel exported");

// ── Styled ──────────────────────────────────────────────────────────────────
assert.match(css, /\.cave-project-picker__trigger/, "trigger styled");
assert.match(css, /\.cave-project-picker__option-root/, "root subtitle styled");
assert.match(
  css,
  /\.ui-popover\.cave-project-picker__popover \.ui-popover-item > span:not\(\.project-avatar\)/,
  "project picker grows the text column without stretching avatar badges",
);

console.log("project-picker.test.ts OK");
