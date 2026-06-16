// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolArgSummary } from "../lib/tool-arg-summary.ts";
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

assert.match(
  source,
  /onBack &&[\s\S]*aria-label="Back to chats"[\s\S]*onClick=\{onBack\}/,
  "ChatView should expose a normal back button in the chat header",
);

assert.match(
  source,
  /function ChatBackButton\(\{ onBack \}[\s\S]*aria-label="Back to chats"[\s\S]*onClick=\{onBack\}[\s\S]*<Icon name="ph:arrow-left-bold"[\s\S]*<\/button>/,
  "ChatView back button should be a reusable icon-only control",
);

assert.match(
  source,
  /<div className=\{`cave-chat-meta-line[\s\S]*\{onBack \? <ChatBackButton onBack=\{onBack\} \/> : null\}[\s\S]*<ChatTitleEditable/,
  "ChatView back button should sit inline before the desktop chat title",
);

assert.match(
  source,
  /<div className="cave-mobile-header-familiar">\s*\{onBack \? <ChatBackButton onBack=\{onBack\} \/> : null\}\s*<FamiliarIcon/,
  "ChatView mobile header should reuse the icon-only back control next to the chat name",
);

assert.doesNotMatch(
  source,
  /aria-label="Back to chats"[\s\S]*>\s*<Icon name="ph:arrow-left-bold"[\s\S]*>\s*Back\s*<\/button>/,
  "ChatView back button should not render a separate text label",
);

assert.match(
  source,
  /<LinkedContextRow\b/,
  "ChatView renders LinkedContextRow for task/GitHub chips",
);

assert.match(
  source,
  /function LinkedContextRow[\s\S]*?if \(!task && github\.length === 0\) return null/,
  "LinkedContextRow only renders when linked context has entries",
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

assert.doesNotMatch(
  styles,
  /\.cave-chat-lifecycle-status/,
  "Standalone lifecycle status bar CSS is removed (folded into meta line)",
);

// In-chat delete: header trash action with the same two-step confirm as the
// Chats-page rows — first click only ARMS, the explicit Delete commits, and
// success refreshes the session list and navigates back.
assert.match(
  source,
  /danger onSelect=\{\(\) => onConfirmDeleteChange\(true\)\}>\s*Delete chat/,
  "Overflow-menu Delete only arms the confirmation — it must not delete",
);
assert.match(
  source,
  /confirmDelete \?[\s\S]*?Cancel[\s\S]*?Confirm delete/,
  "Armed state offers explicit Cancel and Delete actions",
);
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

// ToolBlock routes the Input section through toolInputAsDiff with diff chrome.
assert.match(
  source,
  /function ToolBlock[\s\S]*?const inputDiff = toolInputAsDiff\(tool\.name, tool\.input\)[\s\S]*?\{inputDiff \? <SyntaxBlock text=\{inputDiff\} lang="diff" \/> : <SyntaxBlock text=\{tool\.input\} \/>\}/,
  "ToolBlock Input renders the structured diff when available, raw payload otherwise",
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
