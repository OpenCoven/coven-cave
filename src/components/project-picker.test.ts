// @ts-nocheck
// Project selection used to be four unrelated widgets (chat overflow popover,
// chat empty-state picker, home-composer picker, comux rail), and the only
// way to register a new root was to fail a send and click the 403 recovery.
// ProjectPicker is the one shared picker, and useAddProjectFlow the one shared
// add flow — folder dialog → addChatProject, which registers AND grants, so a
// freshly added project is immediately usable instead of 403ing in chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./project-picker.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/globals/surface-marketplace.css", import.meta.url), "utf8");
const homeComposer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");

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
assert.match(src, /sortProjectsAlphabetically\(projects\)/, "picker renders projects alphabetically");
assert.doesNotMatch(src, /if \(!q\) return projects;/, "unfiltered picker must not expose raw API order");
assert.match(src, /import \{ Button \}/, "picker trigger uses the shared Button primitive");
assert.doesNotMatch(src, /<button\b/, "picker should not hand-roll button controls");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")/,
  "picker should use shared CSS/tokenized radii instead of hard-coded rounded classes",
);

// ── Home composer: project picker reached from the context pill ─────────────
// The selector lets the user choose which project a new chat runs in (mirrors
// the chat composer). The pill chains to the shared ProjectPickerPopover, so
// selection reads the same everywhere (chat revamp 1d).
assert.match(homeComposer, /<ComposerContextChips[\s\S]*?projectValue=\{displayProjectId\}/, "home composer's context chips host the shared project picker");
const contextPill = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
assert.match(contextPill, /export type ComposerContextProps = \{/, "context props are reusable");
assert.match(
  contextPill,
  /export function useComposerContextActions\(/,
  "context derivation is reusable outside the Home pill wrapper",
);
assert.match(contextPill, /export function ComposerContextPickers\(/, "picker siblings are reusable");
assert.match(contextPill, /const context = useComposerContextActions\(props\);/, "the pill wrapper still builds one shared context controller");
assert.match(
  contextPill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?<ProjectPickerPopover/,
  "the project chip is a labelled control that opens the shared ProjectPickerPopover",
);
const actionsMenu = readFileSync(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");
assert.match(
  actionsMenu,
  /<ComposerContextPickers[\s\S]*?context=\{context\}/,
  "the actions menu still threads the shared context into the extracted pickers",
);
assert.match(contextPill, /<ProjectPickerPopover/, "the context pill opens the shared ProjectPickerPopover");
assert.match(contextPill, /useAddProjectFlow\(\{/, "the context pill folds in the shared add-project flow");

// ── Styled ──────────────────────────────────────────────────────────────────
assert.match(css, /\.cave-project-picker__trigger/, "trigger styled");
assert.match(css, /\.cave-project-picker__option-root/, "root subtitle styled");
assert.match(
  css,
  /\.ui-popover\.cave-project-picker__popover \.ui-popover-item > span:not\(\.project-avatar\)/,
  "project picker grows the text column without stretching avatar badges",
);

// ── In-place registration row (spec 2026-07-24) ─────────────────────────────
// A chat running in an ad-hoc unregistered folder offers to register THAT
// folder — no directory re-browse — above the generic Add-project row.
assert.match(src, /registerCurrentRoot\?: string;/, "picker takes the candidate root");
assert.match(src, /onRegisterCurrentRoot\?: \(\) => void;/, "and the setup-open callback");
assert.match(src, /Register this folder as a project…/, "in-place registration row");
assert.match(src, /ph:folder-plus/, "register row carries the folder-plus icon");

console.log("project-picker.test.ts OK");
