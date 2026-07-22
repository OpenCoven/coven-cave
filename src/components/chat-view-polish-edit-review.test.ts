// @ts-nocheck
import assert from "node:assert/strict";
import {
  attachmentsLib,
  attachStagingHook,
  emptyStateSource,
  globalsSrc,
  menusHookSource,
  source,
  splitReasoning,
  styles,
  turnRow,
} from "./chat-view-polish-fixtures.ts";

// Suggestion pills lay out as ONE scrollable row: chips keep their intrinsic
// width and overflow horizontally behind a hidden scrollbar, so any count
// reads as a single quiet line instead of a growing grid (formerly the
// data-count-keyed uniform-rows grid — cave-wrso, cave-98bs).
assert.match(
  source,
  /className="cave-next-paths" data-count=\{nextPaths\.length\}/,
  "the chip row still stamps its count (tooling/e2e hooks key off it)",
);
assert.match(
  globalsSrc,
  /\.cave-next-paths \{\s*\n\s*display: flex; flex-wrap: nowrap;[^}]*overflow-x: auto;\s*\n\s*scrollbar-width: none;/,
  "the chip row is a no-wrap flex line that scrolls horizontally, scrollbar hidden",
);
assert.match(
  globalsSrc,
  /\.cave-next-paths::-webkit-scrollbar \{\s*\n\s*display: none;/,
  "webkit scrollbar is hidden too (same grammar as .cave-chat-linked-context)",
);
assert.match(
  globalsSrc,
  /\.cave-next-path \{\s*\n\s*display: inline-flex; align-items: center; flex: 0 0 auto;[^}]*white-space: nowrap;/,
  "chips keep intrinsic width (no flex-grow) and never wrap internally",
);
assert.ok(
  !/\.cave-next-paths[^{]*\{[^}]*grid-template-columns/.test(globalsSrc) && !/\.cave-next-paths[^{]*\{[^}]*grid-template-columns/.test(styles),
  "no grid column rules survive anywhere — the row never re-grows into 2×2",
);

// File picker resets its value synchronously so re-selecting the same file (or
// re-attaching after the CSV / 10-cap early returns) still fires onChange.
assert.ok(
  source.includes("const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : null;"),
  "file input snapshots files before reset",
);
assert.ok(
  source.includes('e.currentTarget.value = "";') && !source.includes('fileInputRef.current.value = ""'),
  "file input resets value synchronously in onChange, not after the async attach",
);

// Codex inline file-edit card: Edit/Write/MultiEdit/NotebookEdit tool calls
// render as a visible details card in the transcript. The collapsed summary
// shows when/status + what file changed; expanding the same card shows the
// actual diff, matching the Bash/tool-use disclosure pattern.
assert.match(source, /cave-edit-card/, "mutation tools render as an inline Codex edit card");
assert.match(source, /diffStat/, "edit card derives a +/- stat");
assert.match(source, /Review/, "edit card has a Review action");
assert.match(globalsSrc, /\.cave-edit-card/, "edit card styling exists");

// Review adapts to where the edit can actually be reviewed: a file under the
// session's project root jumps to the code rail's Changes diff; anything else
// (familiar-workspace docs, repo-less sessions, relative paths) opens an
// in-chat modal with this edit's diff instead of dispatching an event nothing
// can service. The actions row renders on every edit card — not only when an
// absolute target path exists — so Review is always available.
assert.match(
  source,
  /if \(relPath && targetFile\) \{[\s\S]{0,200}cave:open-file-diff[\s\S]{0,200}setReviewOpen\(true\)/,
  "Review falls back to the in-chat diff modal when the Changes panel can't show the file",
);
assert.match(
  source,
  /<Modal[\s\S]{0,200}open=\{reviewOpen\}[\s\S]{0,600}<SyntaxBlock text=\{diff\} lang="diff" \/>/,
  "the review modal renders this edit's structured diff",
);
assert.match(
  source,
  /<EditCardActions targetFile=\{targetFile\} diff=\{inputDiff \?\? ""\} displayPath=\{displayPath\} \/>/,
  "edit-card actions render unconditionally (Review works without an absolute target path)",
);
assert.match(globalsSrc, /\.cave-review-modal/, "review modal styling exists");
assert.match(
  source,
  /if \(isEditTool\) \{[\s\S]*<details className="cave-tool-block cave-edit-card"[\s\S]*Edited \{base\}[\s\S]*<DurationText durationMs=\{tool\.durationMs\} \/>[\s\S]*Code changes[\s\S]*<SyntaxBlock text=\{inputDiff\} lang="diff" \/>[\s\S]*<\/details>/,
  "edit cards should use the same expandable tool details pattern and include the code diff in chat",
);

// Inline "Undo" reverts the edited file to its last committed state via the
// changes revert API, resolving the repo-relative path through a context, and
// pings the Changes panel to refresh.
assert.match(source, /cave-edit-card__undo/, "edit card has an Undo action");
assert.match(source, /ToolProjectRootContext/, "edit card resolves project root via context for revert");
assert.match(source, /"\/api\/changes"/, "Undo posts to the changes revert API");
assert.match(source, /cave:changes-refresh/, "Undo notifies the changes panel to refresh");
assert.match(globalsSrc, /\.cave-edit-card__undo/, "Undo button styling exists");

// cave-zvr: composer send hygiene + picker Escape.
// (3) send() clears the persisted draft synchronously — the 250ms debounced
//     writer is cancelled if ChatView unmounts right after send, else the
//     pre-send text reappears as a draft on return.
assert.match(source, /setInput\(""\);\s*\n\s*\/\/[\s\S]*?clearDraft\(\);/, "send clears the persisted composer draft synchronously");
// (2) send() resets the enhance strip so it doesn't linger over an empty
//     composer and let Revert repopulate the already-sent message.
assert.match(source, /clearDraft\(\);[\s\S]{0,400}?promptEnhance\.reset\(\);/, "send resets the enhance strip state");
// (1) the slash, /model, /skill and /prompt pickers all dismiss on Escape
//     (their footers advertise "esc cancel"); previously Esc fell through and
//     cancelled a live stream. The shared hook guards ONE Escape branch on
//     menuOpen — the union of all four pickers — so none can leak Esc through.
assert.match(
  menusHookSource,
  /if \(e\.key === "Escape" && menuOpen\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*setSlashDismissed\(true\);\s*\n\s*return true;\s*\n\s*\}/,
  "the slash, model, skill and prompt pickers all dismiss on Escape (setSlashDismissed behind menuOpen)",
);
