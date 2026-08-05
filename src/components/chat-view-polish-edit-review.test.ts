// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachmentsLib,
  attachStagingHook,
  emptyStateSource,
  menusHookSource,
  source,
  splitReasoning,
  styles,
  turnRow,
} from "./chat-view-polish-fixtures.ts";

const editCardStyles = readFileSync(
  new URL("../styles/globals/shell-cards-and-controls.css", import.meta.url),
  "utf8",
);
const editCardActions = readFileSync(
  new URL("./chat-edit-card-actions.tsx", import.meta.url),
  "utf8",
);

// Follow-ups are ephemeral intent cards beside the composer, never transcript
// history. Their visual grammar belongs to the shared component rather than
// the legacy send-on-click chip row.
assert.match(
  source,
  /import \{ FollowUpCards \} from "@\/components\/chat-follow-up-cards"/,
  "ChatView imports the shared typed follow-up cards",
);
assert.equal(
  [...source.matchAll(/<FollowUpCards/g)].length,
  1,
  "historical transcript turns never render follow-up cards",
);
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
assert.match(styles, /\.cave-edit-card/, "edit card styling exists");

// Review routes only a clearly single-file mutation through its immutable
// execution root. Multi-file and unrouteable cards keep the full card diff in
// the read-only modal rather than opening one file while implying full review.
assert.match(
  editCardActions,
  /const singleProjectPath = allMutationPathsResolved && resolvedMutationPaths\.length === 1/,
  "only a complete single-file mutation is project-routable",
);
assert.match(
  editCardActions,
  /if \(singleProjectPath && projectRoot\) \{[\s\S]{0,280}detail: \{ path: singleProjectPath\.absolutePath, projectRoot, sourceSessionId, turnId \}[\s\S]{0,160}setReviewOpen\(true\)/,
  "Review routes one file by captured root and falls back to the full inline diff otherwise",
);
assert.match(
  editCardActions,
  /<Modal[\s\S]{0,200}open=\{reviewOpen\}[\s\S]{0,600}<SyntaxBlock text=\{diff\} lang="diff" \/>/,
  "the review modal renders this edit's structured diff",
);
assert.match(
  editCardActions,
  /title=\{\s*singleProjectPath\s*\? "Review this file's pending diff in the Changes panel"\s*: "Review this edit's full diff"\s*\}/,
  "the Review tooltip truthfully distinguishes routed single-file and full-card review",
);
assert.match(
  source,
  /<EditCardActions[\s\S]{0,300}projectRoot=\{railRoot\}[\s\S]{0,200}mutationPaths=\{mutation\.paths\}[\s\S]{0,200}diff=\{inputDiff \?\? ""\}/,
  "edit-card actions render unconditionally (Review works without an absolute target path)",
);
assert.match(
  source,
  /const isEditTool = inputDiff != null;[\s\S]*if \(isEditTool\) \{[\s\S]*<EditCardActions[\s\S]*\n  \}\n  return \(/,
  "Review actions mount only after the streamed payload yields a structured diff",
);
assert.match(styles, /\.cave-review-modal/, "review modal styling exists");
assert.match(
  source,
  /if \(isEditTool\) \{[\s\S]*<details className="cave-tool-block cave-edit-card"[\s\S]*Edited \{base\}[\s\S]*<DurationText durationMs=\{tool\.durationMs\} \/>[\s\S]*Code changes[\s\S]*<SyntaxBlock text=\{inputDiff\} lang="diff" \/>[\s\S]*<\/details>/,
  "edit cards should use the same expandable tool details pattern and include the code diff in chat",
);

// Inline "Undo" reverts the edited file to its last committed state via the
// changes revert API, resolving the repo-relative path through a context, and
// pings the Changes panel to refresh.
assert.match(editCardActions, /cave-edit-card__undo/, "edit card has an Undo action");
assert.match(
  editCardActions,
  /\{canUndo \? \([\s\S]*cave-edit-card__undo[\s\S]*\) : null\}/,
  "Undo is only available after exactly one affected path resolves inside the project",
);
assert.match(source, /ToolProjectRootContext/, "edit card resolves project root via context for revert");
assert.match(
  source,
  /new CustomEvent\(isEditTool \? "cave:open-file-diff" : "cave:open-project-file", \{\s*detail: \{ path: targetFile, projectRoot: railRoot, sourceSessionId, turnId \},\s*\}\)/,
  "historical tool files carry their captured root, source chat, and turn",
);
assert.match(
  editCardActions,
  /detail: \{ path: singleProjectPath\.absolutePath, projectRoot, sourceSessionId, turnId \}/,
  "individual diff review carries complete transcript provenance",
);
assert.match(
  editCardActions,
  /body: JSON\.stringify\(\{ projectRoot, path: singleProjectPath\.absolutePath, confirmUntracked: true \}\)/,
  "Undo sends the project-validated absolute target for server-side git-relative derivation",
);
assert.match(
  source,
  /if \(!targetFile \|\| !railRoot\) return;[\s\S]*targetFile && railRoot \? \([\s\S]*onClick=\{openTargetFile\}[\s\S]*\) : \(/,
  "file-tool links remain read-only when immutable root provenance is absent",
);
assert.match(
  editCardActions,
  /mutationPaths\s*\.map\(\(path\) =>\s*resolvePathWithinProjectRoot\(projectRoot, path\)\)/,
  "individual review and undo actions use boundary-safe project path resolution",
);
assert.match(
  editCardActions,
  /resolvedMutationPaths\.length === mutationPaths\.length[\s\S]*resolvedMutationPaths\.length === 1/,
  "multi-file mutations never offer a partial one-file undo",
);
assert.ok(
  source.includes("const actionIdentity = tool.id;") &&
    /<EditCardActions\s+key=\{actionIdentity\}/.test(source),
  "edit actions use the stable tool slot identity instead of mutable root or path metadata",
);
assert.match(
  editCardActions,
  /const undoTargetIdentity = JSON\.stringify\(\[projectRoot, \.\.\.mutationPaths\]\);[\s\S]*const undoTargetIsCurrent = undo\.targetIdentity === undoTargetIdentity;[\s\S]*useEffect\(\(\) => \{[\s\S]*idleUndoState\(undoTargetIdentity\)[\s\S]*\}, \[undoTargetIdentity\]\);/,
  "root or path changes reset the armed Undo state with an effect instead of remounting Review",
);
assert.match(
  editCardActions,
  /state !== "armed" \|\|[\s\S]*undo\.targetIdentity !== undoTargetIdentity[\s\S]*current\.targetIdentity === requestIdentity[\s\S]*current\.targetIdentity === requestIdentity/,
  "Undo confirmation and async completion are guarded against stale target identities",
);
assert.match(editCardActions, /"\/api\/changes"/, "Undo posts to the changes revert API");
assert.match(editCardActions, /cave:changes-refresh/, "Undo notifies the Changes panel to refresh");
assert.match(editCardStyles, /\.cave-edit-card__undo/, "Undo button styling exists");

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
