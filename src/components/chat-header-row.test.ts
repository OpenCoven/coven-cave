// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolArgDetail, toolArgSummary } from "../lib/tool-arg-summary.ts";
import { toolInputAsDiff } from "../lib/tool-input-diff.ts";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
const bubbleSource = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");

// After the streamline refactor the header is MetaLine (title + status meta)
// plus an optional LinkedContextRow — no ChatContextStrip, no headline row.
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

assert.match(
  source,
  /<LinkedContextRow\b/,
  "ChatView renders LinkedContextRow for task/GitHub chips",
);

assert.match(
  source,
  /function LinkedContextRow[\s\S]*?if \(!task && github\.length === 0 && !canLink\) return null/,
  "LinkedContextRow renders when there's linked context OR a chat session that can link a task",
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

// In-chat delete lives ONLY in the header trash button now — it opens a confirm
// popover, the explicit Delete commits via deleteChat, and success refreshes the
// session list and navigates back. The overflow menu no longer carries delete.
assert.match(
  source,
  /const deleteChat = async[\s\S]*?fetch\(`\/api\/chat\/conversation\/\$\{encodeURIComponent\(sessionId\)\}`, \{ method: "DELETE" \}\)/,
  "Confirmed delete calls DELETE /api/chat/conversation/:id",
);
assert.match(
  source,
  /onSessionsChanged\?\.\(\);\s*\n\s*onBack\?\.\(\);/,
  "Successful delete refreshes sessions and navigates back to the list",
);

// A standalone delete (trash) button sits at the top of the session, beside the
// overflow menu, opening a confirm popover before it commits via deleteChat.
assert.match(
  source,
  /function HeaderDeleteButton[\s\S]*?aria-label="Delete chat"[\s\S]*?Delete this chat permanently\?[\s\S]*?disabled=\{deleting\} onSelect=\{\(\) => onDelete\(\)\}/,
  "HeaderDeleteButton renders a guarded trash trigger that confirms before deleting",
);
assert.match(
  source,
  /function HeaderDebugButton[\s\S]*?aria-label="Debug chat"[\s\S]*?<Icon name="ph:bug-bold"/,
  "HeaderDebugButton renders a visible bug trigger for the debug panel",
);
assert.match(
  source,
  /<HeaderDebugButton onOpenDebug=\{openDebug\} \/>[\s\S]*?<HeaderDeleteButton key=\{sessionId\} onDelete=\{\(\) => void deleteChat\(\)\} deleting=\{deleting\} \/>/,
  "the chat header mounts the visible debug bug immediately before the standalone delete button",
);
// The overflow (kebab) menu no longer offers delete — it's header-only.
assert.doesNotMatch(
  source,
  /onConfirmDeleteChange/,
  "the overflow menu's two-step delete wiring is removed",
);
assert.doesNotMatch(
  source,
  /Confirm delete/,
  "no 'Confirm delete' item remains in the overflow menu",
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

console.log("chat-header-row.test.ts: ok");
