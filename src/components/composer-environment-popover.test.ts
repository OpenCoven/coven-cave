import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ComposerEnvironmentPopover (#5958) — the chat's Environment card, anchored
// to the composer's branch chip at every width. It replaced the floating HUD
// that sat at the transcript's top-right on panes ≥1536px (cave-68vv). React
// wiring is pinned by source shape; the labelling / PR-row / diff-total logic
// is behavioral in src/lib/chat-environment-panel-model.test.ts.

const popover = readFileSync(
  new URL("./composer-environment-popover.tsx", import.meta.url),
  "utf8",
);
const pill = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/composer-environment-popover.css", import.meta.url),
  "utf8",
);

// ── The popover itself ───────────────────────────────────────────────────────
// A controlled, labelled Popover on the shared scaffold — rows keep native
// button semantics (a composite dialog, not a menu).
assert.match(popover, /<Popover\b[\s\S]*?ariaLabel="Environment"/, "labelled dialog on the shared Popover scaffold");
assert.match(popover, /minWidth=\{240\}/, "keeps the HUD's 240px card width");
assert.match(popover, /<PopoverLabel>Environment<\/PopoverLabel>/, "visible Environment eyebrow");
assert.ok(
  (popover.match(/semantic="button"/g)?.length ?? 0) >= 4,
  "rows are PopoverItem semantic=\"button\" (Changes · Branch · Commit or push · PR)",
);
assert.doesNotMatch(popover, /fetch\(/, "no fetch in the popover — the chip's hooks own the network");
assert.doesNotMatch(popover, /useChangesSummary\(|useBranchPr\(/, "data arrives as props from useComposerContextActions, never a second poll");

// Rows LAUNCH existing surfaces instead of duplicating them.
assert.match(popover, /closeThen\(onOpenChanges\)/, "Changes and Commit-or-push rows open the code rail's Changes tab");
assert.match(popover, /prRowAction\(pr\)/, "PR row resolved by the pure model (view when OPEN with a URL, else create)");
assert.match(
  popover,
  /if \(prRow\.kind === "view"\) onOpenPr\(prRow\.url\);\s*\n\s*else onOpenChanges\(\);/,
  "an open PR is viewed through the host URL handler; otherwise the Changes panel creates one",
);
assert.match(popover, /closeThen\(onOpenBranchMenu\)/, "the Branch row chains into the branch list");
assert.match(
  popover,
  /const closeThen = \(act: \(\) => void\) => \{\s*\n\s*onOpenChange\(false\);\s*\n\s*act\(\);/,
  "every outbound row closes the popover first, then acts",
);
assert.match(popover, /environmentLabel\(executionRuntime\)/, "Local / ssh host row from the EXECUTION runtime");

// Keyboard: keyboard-opened popovers focus the first row; arrows rove.
assert.match(
  popover,
  /usePopoverInitialFocus\(open && openedWithKeyboard, `\.\$\{COMPOSER_ENVIRONMENT_PANEL_CLASS\}`\)/,
  "keyboard opening moves focus to the first row (select.tsx pattern); pointer opening leaves it on the chip",
);
assert.match(popover, /COMPOSER_ENVIRONMENT_PANEL_CLASS = "composer-environment__panel"/, "panel class is the focus selector");
assert.match(popover, /\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(event\.key\)/, "ArrowUp/ArrowDown/Home/End rove between rows");
assert.match(popover, /onKeyDown=\{moveRowFocus\}/, "roving handler is on the popover body");

// Copy: sentence case, terse, and the failure state ends with a next step.
assert.match(popover, /Couldn't load changes/, "failed summary copy");
assert.match(popover, /onSelect=\{\(\) => onReload\?\.\(\)\}/, "Retry re-reads the summary");
assert.match(popover, /Not a git repository/, "non-repo roots get a static row");
assert.match(popover, />\s*Commit or push\s*</, "commit row copy");

// Diffstat: sign in text, color from semantic tokens (never color alone).
assert.match(popover, /composer-environment__additions[\s\S]*?\+\{totals\.additions\.toLocaleString\(\)\}/, "+N additions");
assert.match(popover, /composer-environment__deletions[\s\S]*?−\{totals\.deletions\.toLocaleString\(\)\}/, "−N deletions");
assert.match(css, /\.composer-environment__additions \{\s*color: var\(--color-success\);/, "additions in --color-success");
assert.match(css, /\.composer-environment__deletions \{\s*color: var\(--color-danger\);/, "deletions in --color-danger");
assert.match(css, /\.composer-environment__branch \{[\s\S]*?font-family: var\(--font-mono\);/, "branch name is mono");
assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?min-height: var\(--touch-target\);/, "phone rows are 44px touch targets");
assert.match(popover, /import "@\/styles\/composer-environment-popover\.css";/, "the popover imports its own sheet (not globals.css)");

// ── The branch chip ──────────────────────────────────────────────────────────
assert.match(
  pill,
  /aria-haspopup="dialog"\s*\n\s*aria-expanded=\{menu === "branch"\}\s*\n\s*aria-label=\{`Branch: \$\{context\.branch\} — open environment`\}/,
  "the branch chip announces a dialog and names the environment",
);
assert.match(pill, /setBranchOpenedWithKeyboard\(event\.detail === 0\)/, "keyboard vs pointer opening recorded from click.detail");
assert.match(
  pill,
  /<ComposerEnvironmentPopover\s*\n\s*open=\{menu === "branch"\}[\s\S]*?anchorRef=\{branchRef\}[\s\S]*?openedWithKeyboard=\{branchOpenedWithKeyboard\}[\s\S]*?executionRuntime=\{context\.config\.executionRuntime\}/,
  "the branch chip mounts the Environment popover on its own anchor",
);
assert.match(
  pill,
  /onOpenBranchMenu=\{\(\) => setMenu\("branch-list"\)\}/,
  "the Branch row chains into the branch-list view",
);
assert.match(
  pill,
  /<GitBranchMenuPopover\s*\n\s*open=\{menu === "branch-list"\}[\s\S]*?anchorRef=\{branchRef\}/,
  "the branch list mounts on the SAME anchor as a sibling view, never nested",
);
assert.match(pill, /\| "branch-list"/, "ComposerContextView carries the chained view");
assert.match(pill, /executionRuntime\?: string \| null;/, "executionRuntime is its own prop (runtime is the model harness)");
assert.match(pill, /const \{ loaded, notARepo, branch, count, totals, worktree, reload \} = useChangesSummary\(/, "totals ride the chip's existing summary poll");

// ── ChatView wiring ──────────────────────────────────────────────────────────
for (const gone of ["ChatEnvironmentPanel", "ENV_PANEL_", "resolveEnvPanelVisible", "chat-environment-panel\""]) {
  assert.ok(!chatView.includes(gone), `chat-view no longer references ${gone} — the HUD is retired`);
}
assert.match(
  chatView,
  /<ComposerContextChips[\s\S]*?ariaLabel=\{inlineComposer \? "New chat context" : "Session context"\}\s*\n\s*executionRuntime=\{runtimeHost && runtimeHost !== LOCAL_HOST_ID\s*\n\s*\? `ssh:\$\{runtimeHost\}`\s*\n\s*: modelState\?\.runtime \?\? session\?\.runtime \?\? \(modelState \? "local" : null\)\}\s*\n\s*\/>/,
  "the chips receive the execution runtime as the last prop: a remote host first, then the model state's runtime, then the session's (#6098)",
);
// Phone engagement (#5546): focus moving into the body-portaled popover must
// not disengage the composer, or the rest state hides the chip it hangs from.
assert.match(
  chatView,
  /if \(next instanceof Element && next\.closest\("\.ui-popover-portal"\)\) return;\s*\n\s*if \(!dock\.contains\(next\)\) restComposerAfterPress\(dock\);/,
  "a blur into .ui-popover-portal keeps the composer engaged",
);

console.log("composer-environment-popover.test.ts: ok");
