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

// Follow-ups are compact intent cards above the composer. Historical transcript
// rows strip the control block without retaining stale actions.
assert.match(
  source,
  /import \{ FollowUpCards \} from "@\/components\/chat-follow-up-cards"/,
  "ChatView imports the shared typed follow-up cards",
);
assert.equal([...source.matchAll(/<FollowUpCards/g)].length, 1, "only the current composer renders follow-up cards");
assert.match(
  styles,
  /\.cave-followup-cards__grid \{[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-auto-columns: minmax\(0, 1fr\)/,
  "cards use equal shares in one row",
);
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-followup-cards__grid \{[\s\S]*?grid-auto-flow: row;[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  "cards stack in a single column in narrow panes",
);
assert.match(
  styles,
  /\.cave-followup-card__recommended/,
  "recommended cards retain a visible non-color marker",
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
