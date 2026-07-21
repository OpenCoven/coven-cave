// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolArgDetail, toolArgSummary } from "../lib/tool-arg-summary.ts";
import { toolInputAsDiff } from "../lib/tool-input-diff.ts";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const sessionHeader = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");
const styles = ["cave-md", "cave-md/code", "cave-composer", "chat-list", "calendar", "cave-chat", "cave-chat/activity", "cave-chat/transcript"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
const bubbleSource = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const codeFenceSource = readFileSync(new URL("../lib/message-code-fences.ts", import.meta.url), "utf8");

// After the streamline refactor the header is MetaLine (title + status meta);
// linked-work actions are extracted, but ChatView does not mount them directly
// in the footer band yet.
assert.doesNotMatch(
  source,
  /<ChatContextStrip\b/,
  "ChatContextStrip is replaced by MetaLine + LinkedContextRow",
);

assert.doesNotMatch(
  source,
  /<ChatHeadlineTitle\b/,
  "Headline title row is folded into MetaLine (title + meta on one row)",
);

assert.match(
  source,
  /<MetaLine\b/,
  "ChatView renders MetaLine for the title + status banner",
);

// The in-chat "back to chats" chevron was removed — the chat header stays
// minimal and navigation back to the list is via the sidebar/list. (onBack is
// still used to navigate away after a delete.)
assert.doesNotMatch(
  source,
  /ChatBackButton/,
  "the ChatBackButton component and its renders are removed",
);
assert.doesNotMatch(
  source,
  /aria-label="Back to chats"/,
  "the back-to-chats control is gone from the chat header",
);

assert.doesNotMatch(
  source,
  /import \{[\s\S]*ComposerLinkedWorkActions[\s\S]*\} from "@\/components\/composer-linked-work-actions"/,
  "ChatView no longer imports the linked-work footer component",
);

assert.doesNotMatch(
  source,
  /<ComposerLinkedWorkActions\b/,
  "ChatView does not mount linked-work actions directly",
);

// The 2026-07-21 "both" reconciliation: the footer band came back (context
// pill + linked-work chip strip) alongside the grouped composer menu.
assert.match(
  source,
  /className="cave-composer-footer-band">\s*\n\s*<ComposerContextPill[\s\S]*?\{linkedContextRow\}/,
  "the footer band carries the context pill and the linked-context strip",
);

assert.match(
  styles,
  /\.cave-chat-meta-line\s*\{/,
  "cave-chat-meta-line CSS rule is defined",
);

assert.match(
  styles,
  /\.cave-chat-meta-line--streaming[\s\S]*\.cave-chat-meta-line--failed/,
  "Meta line has streaming/failed state modifiers",
);

assert.match(
  styles,
  /\.cave-chat-meta-line__meta\s*\{[\s\S]*?text-overflow\s*:\s*ellipsis/,
  "Meta string should truncate instead of wrapping the header taller",
);

assert.match(
  styles,
  /\.cave-chat-meta-line__meta\s*\{[\s\S]*?font-size:\s*11\.5px/,
  "Header meta is the demoted context line — a notch under the title, not fine print",
);
assert.doesNotMatch(
  styles,
  /\.cave-chat-meta-line__meta\s*\{[^}]*font-family/,
  "Header meta reads in the chrome font (Codex/ChatGPT vocabulary), not monospace",
);

assert.doesNotMatch(
  styles,
  /\.cave-chat-cwd-inline\b/,
  "The inline project-chip picker is folded into the session overflow menu",
);

// The side-panel toggle moved up into the top menu bar, so it no longer overlays
// the chat header's top-right corner — the panel-closed right gutter that used
// to clear it is gone, and the header runs flush to the edge.
assert.doesNotMatch(
  styles,
  /:root:not\(\[data-right-panel-open\]\)\s*\.cave-chat-linear-header\s*\{[^}]*padding-right:\s*44px/,
  "Chat header no longer reserves a right gutter for the retired floating panel toggle",
);

assert.doesNotMatch(
  styles,
  /\.cave-chat-lifecycle-status/,
  "Standalone lifecycle status bar CSS is removed (folded into meta line)",
);

// In-chat delete is a DIRECT header action (cave-zolo): a trash icon button in
// the session-actions cluster whose confirm popover (Delete this chat
// permanently? / Cancel / Delete chat) guards the irreversible commit. The
// explicit Delete commits via deleteChat, and success reports the confirmed id
// to Workspace and navigates back.
assert.match(
  source,
  /const deleteChat = async[\s\S]*?fetch\(`\/api\/chat\/conversation\/\$\{encodeURIComponent\(sessionId\)\}`, \{ method: "DELETE" \}\)/,
  "Confirmed delete calls DELETE /api/chat/conversation/:id",
);
assert.match(
  source,
  /onSessionsDeleted\(\[sessionId\]\);\s*\n\s*onBack\?\.\(\);/,
  "Successful delete reaches the shared boundary and navigates back to the list",
);

// The delete is a two-step guard: the trash button arms a confirm popover
// anchored to itself; only the popover's danger item commits.
assert.match(
  sessionHeader,
  /function DeleteChatButton[\s\S]*?aria-expanded=\{confirming\}[\s\S]*?Delete this chat permanently\?[\s\S]*?disabled=\{deleting\} onSelect=\{\(\) => onDelete\(\)\}/,
  "DeleteChatButton guards delete behind an anchored confirm popover",
);
assert.match(
  source,
  /<DeleteChatButton deleting=\{deleting\} onDelete=\{\(\) => void deleteChat\(\)\} \/>/,
  "the header cluster renders the direct delete button",
);
// The kebab no longer carries delete at all — the menu model owns its items
// and none of them are the destructive verb. (Scoped to the menu function so
// DeleteChatButton's own strings don't satisfy the check.)
const overflowMenuSection = sessionHeader.slice(
  sessionHeader.indexOf("function SessionOverflowMenu"),
  sessionHeader.indexOf("function DeleteChatButton"),
);
assert.ok(
  !overflowMenuSection.includes("Delete chat") && !overflowMenuSection.includes("ph:trash"),
  "SessionOverflowMenu contains no delete item (direct button owns it)",
);
// The standalone header debug buttons stay gone — quick actions are Voice/
// Archive/Find/Delete plus the kebab.
assert.doesNotMatch(
  source,
  /function HeaderDebugButton|function HeaderDeleteButton|function HeaderThinkingToggle|function HeaderReflectButton/,
  "the retired standalone header icon buttons stay removed",
);
assert.doesNotMatch(
  source,
  /onConfirmDeleteChange/,
  "the old overflow two-step delete wiring stays removed",
);

// Project selection is one compact row in the kebab that opens the shared
// searchable ProjectPickerPopover — not an inline list of every project. The
// row's label comes from the pure menu model.
assert.match(
  sessionHeader,
  /function SessionOverflowMenu[\s\S]*?sessionMenuSections\(\{[\s\S]*?projectName: activeProject\?\.name \?\? null[\s\S]*?<ProjectPickerPopover/,
  "the kebab derives its Project row from the menu model and opens the shared picker popover",
);
assert.doesNotMatch(
  source,
  /projects\.map\(\(entry\) => \(\s*<PopoverItem/,
  "the kebab no longer inlines the full project list",
);

// ── Collapsed tool rows show a one-line arg summary (CHAT-D4-02) ─────────────
// The summary is derived by the pure helper in src/lib/tool-arg-summary.ts so
// a run can be audited (`Read(src/foo.ts)`-style) without expanding blocks.

// JSON input with a well-known key picks that key's value.
assert.equal(
  toolArgSummary("Read", JSON.stringify({ file_path: "src/foo.ts" }, null, 2)),
  "src/foo.ts",
  "JSON input with file_path summarizes to the path",
);

// Bash commands arrive as plain (non-JSON) strings — used directly.
assert.equal(
  toolArgSummary("Bash", "pnpm test"),
  "pnpm test",
  "plain-string Bash input is used as the summary",
);

// Bash JSON payloads prefer the command key.
assert.equal(
  toolArgSummary("Bash", JSON.stringify({ description: "Run tests", command: "pnpm test" })),
  "pnpm test",
  "Bash JSON input prefers command over other keys",
);

// Unknown JSON falls back to the first string value.
assert.equal(
  toolArgSummary("Mystery", JSON.stringify({ widget: "left-panel", count: 3 })),
  "left-panel",
  "unknown JSON keys fall back to the first string value",
);

// Oversize values are flattened to one line and ellipsized (~48 chars).
const oversize = toolArgSummary("Bash", `pnpm run a-very-long-command ${"x".repeat(80)}\nsecond line`);
assert.ok(oversize.length <= 48, "summary is capped at 48 chars");
assert.ok(oversize.endsWith("…"), "oversize summary ends with an ellipsis");
assert.ok(!oversize.includes("\n"), "summary is never multi-line");

const longSearchQuery = "multi-agent LLM workflow architectures orchestrator worker patterns 2025";
assert.equal(
  toolArgDetail("Web Search", JSON.stringify({ query: longSearchQuery })),
  longSearchQuery,
  "detail keeps the full web-search query for readable live activity context",
);

// Absent input yields an empty string.
assert.equal(toolArgSummary("Read", undefined), "", "absent input gives empty summary");
assert.equal(toolArgSummary("Read", "   "), "", "whitespace-only input gives empty summary");

// Truncated object-ish blobs surface the first path-looking token.
assert.equal(
  toolArgSummary("Edit", "{ file_path: src/components/chat-view.tsx, old_string: ... }"),
  "src/components/chat-view.tsx",
  "non-JSON object blobs surface the first path-looking token",
);

// ToolBlock renders the helper output in its collapsed summary row, and the
// progress detail uses the Claude Code `Name(arg)` shape.
assert.match(
  source,
  /function ToolBlock[\s\S]*?const argSummary = toolArgSummary\(tool\.name, tool\.input\)[\s\S]*?<summary[\s\S]*?\{tool\.name\}[\s\S]*?\{argSummary \?[\s\S]*?truncate[\s\S]*?\{argSummary\}/,
  "ToolBlock collapsed summary renders the one-line arg summary next to the name",
);
assert.match(
  source,
  /detail: argSummary \? `\$\{incoming\.name\}\(\$\{argSummary\}\)` : incoming\.name/,
  "Tool progress detail carries Name(arg) instead of the bare tool name",
);

assert.match(
  source,
  /const runningToolDetail = live && runningTool \? toolArgDetail\(runningTool\.name, runningTool\.input\) : ""/,
  "RunActivityStrip computes a full running-tool detail, separate from the capped summary",
);
assert.match(
  source,
  /cave-run-activity-context[\s\S]*?\{runningTool\.name\}\([\s\S]*?\{runningToolDetail\}[\s\S]*?\)/,
  "RunActivityStrip renders full running-tool context where it can wrap instead of truncating",
);
assert.match(
  styles,
  /\.cave-run-activity-context[\s\S]*?white-space:\s*pre-wrap[\s\S]*?overflow-wrap:\s*anywhere/,
  "RunActivityStrip context wraps long search/tool input instead of clipping it",
);

// ── Edit/Write tool inputs render as structured diffs (CHAT-D8-02) ──────────
// toolInputAsDiff converts file-mutation tool JSON payloads into unified-diff
// text; ToolBlock routes the Input section through it with lang="diff".

// Edit pair → a/b headers + -old/+new lines.
assert.equal(
  toolInputAsDiff(
    "Edit",
    JSON.stringify({ file_path: "src/foo.ts", old_string: "const a = 1;", new_string: "const a = 2;" }, null, 2),
  ),
  ["--- a/src/foo.ts", "+++ b/src/foo.ts", "-const a = 1;", "+const a = 2;"].join("\n"),
  "Edit input becomes a -/+ diff with a/b file headers",
);

// Multiline strings keep one gutter prefix per line.
assert.equal(
  toolInputAsDiff(
    "edit",
    JSON.stringify({ file_path: "x.txt", old_string: "one\ntwo", new_string: "one\nTWO\nthree" }),
  ),
  ["--- a/x.txt", "+++ b/x.txt", "-one", "-two", "+one", "+TWO", "+three"].join("\n"),
  "multiline edit strings get per-line -/+ prefixes (name match is case-insensitive)",
);

// Write → all-plus body under a +++ header.
assert.equal(
  toolInputAsDiff("Write", JSON.stringify({ file_path: "new.ts", content: "alpha\nbeta\n" })),
  ["+++ b/new.ts", "+alpha", "+beta"].join("\n"),
  "Write content renders as all-plus lines without a phantom trailing row",
);
assert.equal(
  toolInputAsDiff("Write", JSON.stringify({ file_path: "empty.ts", content: "" })),
  "+++ b/empty.ts",
  "Empty Write content renders only the file header, not a phantom + row",
);
assert.equal(
  toolInputAsDiff("Write", JSON.stringify({ file_path: "blank.ts", content: "\n" })),
  ["+++ b/blank.ts", "+"].join("\n"),
  "Write content containing one blank line renders a meaningful blank + row",
);

// MultiEdit → one @@-labelled hunk per edit, concatenated.
const multi = toolInputAsDiff(
  "MultiEdit",
  JSON.stringify({
    file_path: "m.ts",
    edits: [
      { old_string: "a", new_string: "b" },
      { old_string: "c", new_string: "d" },
    ],
  }),
);
assert.equal(
  multi,
  ["--- a/m.ts", "+++ b/m.ts", "@@ edit 1/2 @@", "-a", "+b", "@@ edit 2/2 @@", "-c", "+d"].join("\n"),
  "MultiEdit concatenates per-edit hunks under @@ headers",
);

// NotebookEdit's new_source is Write-like.
assert.equal(
  toolInputAsDiff("NotebookEdit", JSON.stringify({ notebook_path: "nb.ipynb", new_source: "print(1)" })),
  ["+++ b/nb.ipynb", "+print(1)"].join("\n"),
  "NotebookEdit new_source renders as an all-plus block keyed on notebook_path",
);

// Non-mutation tools and unparseable input fall back to null (raw rendering).
assert.equal(toolInputAsDiff("Bash", JSON.stringify({ command: "rm -rf" })), null, "non-mutation tools return null");
assert.equal(toolInputAsDiff("Read", JSON.stringify({ file_path: "f" })), null, "Read is not a mutation tool");
assert.equal(toolInputAsDiff("Edit", "{ truncated payload …"), null, "unparseable input returns null");
assert.equal(toolInputAsDiff("Edit", JSON.stringify({ file_path: "f" })), null, "unrecognised shapes return null");
assert.equal(toolInputAsDiff("Edit", undefined), null, "absent input returns null");

// Oversize diffs are capped with a truncation marker (~400 lines).
const bigDiff = toolInputAsDiff(
  "Write",
  JSON.stringify({ file_path: "big.txt", content: Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n") }),
);
const bigLines = bigDiff.split("\n");
assert.ok(bigLines.length <= 401, "diff output is capped near 400 lines");
assert.match(bigLines[bigLines.length - 1], /more lines truncated/, "capped diff ends with a truncation marker");

// ToolBlock routes the Input section through toolInputAsDiff with diff chrome,
// otherwise through ToolInputView (readable fields + raw-JSON toggle).
assert.match(
  source,
  /function ToolBlock[\s\S]*?const inputDiff = toolInputAsDiff\(tool\.name, tool\.input\)[\s\S]*?inputDiff \? \([\s\S]*?<SyntaxBlock text=\{inputDiff\} lang="diff" \/>[\s\S]*?<ToolInputView input=\{tool\.input\} \/>/,
  "ToolBlock Input renders the structured diff when available, readable fields otherwise",
);

// ── Diff gutter excludes file headers; @@ rows are muted meta (CHAT-D8-03) ──
// `+++ b/file` must not classify as an addition nor `--- a/file` as a
// deletion; `@@` hunk headers carry the cave-diff-meta chrome class.
assert.match(
  bubbleSource,
  /\/\^@@\/\.test\(plainLine\)\s*\?\s*" cave-diff-meta"\s*:\s*\/\^\(\\\+\\\+\\\+ \|--- \)\/\.test\(plainLine\)\s*\?\s*""/,
  "diff gutter mutes @@ headers and exempts +++/--- file headers before +/- classification",
);
assert.match(
  styles,
  /\.cave-diff-meta\s*\{/,
  "cave-diff-meta CSS rule is defined for hunk-header chrome",
);

// ── Language-aware diffs: content highlighted in the file's grammar ─────────
// A diff whose +++/--- header names a highlightable file renders its content
// through that language's grammar (not the flat whole-line `diff` grammar);
// the +/- markers are re-attached as a dim .cave-diff-marker span so the DOM
// text — what the Copy button reads — stays byte-identical to the raw diff.
assert.match(
  bubbleSource,
  /const diffLang = isDiff \? diffContentLang\(code\) : "text"/,
  "renderCodeBlock resolves the diff's content grammar from its file headers",
);
assert.match(
  codeFenceSource,
  /function classifyDiffLines\(/,
  "diff lines are classified (add/del/ctx/meta/hunk) for language-aware rendering",
);
assert.match(
  bubbleSource,
  /<span class="cave-diff-marker">\$\{dl\.marker\}<\/span>/,
  "stripped +/- markers are re-attached as a cave-diff-marker span",
);
assert.match(
  styles,
  /\.cave-diff-marker\s*\{/,
  "cave-diff-marker CSS rule is defined",
);
// Shiki failure fallback renders the ORIGINAL diff text — the language-aware
// line map must be dropped there or markers would be attached twice.
assert.match(
  bubbleSource,
  /highlighted = `<pre><code>\$\{escHtml\(code\)\}<\/code><\/pre>`;\s*\n\s*diffLines = null/,
  "highlight-failure fallback clears diffLines so markers are not doubled",
);

// ── Archive (cave-nuzg → cave-zolo): delete's reversible sibling, now a DIRECT
// header button. Archive chat PATCHes the session; the chat leaves every rail
// (rails are archive-free by default — chat-siderail-hide-archived.test.ts) but
// the transcript survives, and the same button flips to Unarchive on archived
// chats so restore is one click from the header too.
assert.match(
  sessionHeader,
  /function ArchiveChatButton[\s\S]{0,400}archiveAction\(\{ archived, archiving \}\)/,
  "the direct archive button derives its icon/label/verb from the menu model",
);
assert.match(
  sessionHeader,
  /function ArchiveChatButton[\s\S]{0,700}onClick=\{\(\) => onSetArchived\(!archived\)\}/,
  "clicking the button toggles the session's archived state",
);
assert.match(
  source,
  /<ArchiveChatButton\s+archived=\{Boolean\(session\.archived_at\)\}\s+archiving=\{archiving\}\s+onSetArchived=\{\(next\) => void setChatArchived\(next\)\}/,
  "the header cluster renders the direct archive button off the session's archived_at",
);
// Archive needs no confirm step — it is reversible, unlike Delete above.
assert.match(
  source,
  /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`, \{\s*method: "PATCH",[\s\S]{0,120}body: JSON\.stringify\(\{ archived \}\)/,
  "archiving PATCHes the sessions API with the archived flag",
);
assert.match(
  source,
  /onSessionsChanged\?\.\(\);\s*\/\/ Leaving mirrors delete only for archive; unarchive keeps you in place\.\s*if \(archived\) onBack\?\.\(\);/,
  "archiving refreshes the rails and leaves the chat; unarchiving stays put",
);
assert.match(
  source,
  /archived=\{Boolean\(session\.archived_at\)\}/,
  "the archive button receives the live archived state of the open session",
);

console.log("chat-header-row.test.ts: ok");
