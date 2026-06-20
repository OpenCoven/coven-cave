// @ts-nocheck
// The coven daemon derives session titles from the harness prompt, which the
// cave chat route prefixes with the identity canon — so untitled sessions
// showed "Coven identity canon: - Each familiar has a defi…". Two-sided fix:
// titles default to the user's raw prompt at the source, and canon-prefixed
// titles are rejected at the display boundary for historical/streaming rows.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  chatTitleFromPrompt,
  sanitizeSessionTitle,
  defaultChatTitleForSession,
} from "./cave-chat-titles.ts";
import { mergeSessionRows } from "./session-list-merge.ts";
import { buildPromptWithCovenIdentityCanon } from "./coven-identity-canon.ts";
import { buildRuntimeScopePreamble } from "./chat-runtime-scope.ts";

// ── chatTitleFromPrompt ──
assert.equal(
  chatTitleFromPrompt("Reply with exactly the single word: covenant"),
  "Reply with exactly the single word: covenant",
  "short prompts become the title verbatim",
);
assert.equal(
  chatTitleFromPrompt("  line one\nline two  "),
  "line one line two",
  "whitespace and newlines collapse",
);
const long = "x".repeat(200);
assert.ok(
  (chatTitleFromPrompt(long) ?? "").length <= 64,
  "long prompts truncate to a title-sized string",
);
assert.equal(chatTitleFromPrompt("   "), null, "blank prompts yield no title");
// Long multi-word prompts truncate at a word boundary, never mid-word.
const longSentence = "please commit and push and open a pull request for the changes we made to the runtime";
const truncated = chatTitleFromPrompt(longSentence) ?? "";
const kept = truncated.slice(0, -1); // drop the trailing ellipsis
assert.ok(truncated.length <= 64, "stays title-sized");
assert.ok(truncated.endsWith("…"), "marks the truncation");
assert.ok(longSentence.startsWith(kept), "the kept portion is a clean prefix of the prompt");
assert.equal(
  longSentence[kept.length],
  " ",
  "the cut lands on a word boundary — the next prompt char is a space, so no word is split",
);

// ── sanitizeSessionTitle ──
const canonPrompt = buildPromptWithCovenIdentityCanon("hello", "nova");
const leakedTitle = canonPrompt.split("\n").slice(0, 2).join(" ").slice(0, 60);
assert.equal(
  sanitizeSessionTitle(leakedTitle),
  null,
  "titles that start with the canon header are rejected",
);
assert.equal(
  sanitizeSessionTitle("Fix the parser bug"),
  "Fix the parser bug",
  "ordinary titles pass through",
);
assert.equal(
  sanitizeSessionTitle("Coven identity canon (binding): - Valentina is the arbiter"),
  null,
  "legacy '(binding):' preamble variants are rejected too",
);
assert.equal(
  sanitizeSessionTitle("Coven identity canon (binding)"),
  "Coven identity canon (binding)",
  "a colon-less canon-themed name is a legitimate human title and passes through",
);
// The runtime-scope preamble is the other prompt prefix that leaks into daemon
// titles ("Runtime filesystem boundary: - This is the local…", duplicated per
// project). Tie the rejection to the real builder so the literal can't drift.
assert.equal(
  sanitizeSessionTitle(buildRuntimeScopePreamble({ kind: "local", root: "/Users/buns/proj" })),
  null,
  "titles that leaked the runtime-scope preamble are rejected",
);
assert.equal(
  sanitizeSessionTitle(buildRuntimeScopePreamble({ kind: "ssh", host: "beacon", root: "/srv/app" })),
  null,
  "the remote runtime-scope preamble is rejected too",
);
assert.equal(
  sanitizeSessionTitle("Runtime filesystem boundaries between teams"),
  "Runtime filesystem boundaries between teams",
  "a human title that merely starts with similar words (no colon) passes through",
);

// ── merge layer falls back when the daemon title is canon-leaked ──
const state = {
  sessionTitles: {},
  sessionFamiliar: {},
  sessionArchived: {},
  sessionSacrificed: {},
};
const rows = mergeSessionRows({
  daemonSessions: [
    {
      id: "abc12345-dead-beef-0000-000000000000",
      project_root: "",
      harness: "claude",
      title: "Coven identity canon: - Each familiar has a defi",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:00:00Z",
    },
  ],
  localConversations: [],
  state,
  includeArchived: false,
});
assert.equal(rows.length, 1);
assert.ok(
  !rows[0].title.startsWith("Coven identity canon"),
  "merged rows must not surface canon-leaked daemon titles",
);
assert.equal(
  rows[0].title,
  defaultChatTitleForSession("abc12345-dead-beef-0000-000000000000"),
  "canon-leaked titles fall back to the default session title",
);

// override still wins over sanitization
const rows2 = mergeSessionRows({
  daemonSessions: [
    {
      id: "abc12345-dead-beef-0000-000000000000",
      project_root: "",
      harness: "claude",
      title: "Coven identity canon: - Each familiar has a defi",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:00:00Z",
    },
  ],
  localConversations: [],
  state: { ...state, sessionTitles: { "abc12345-dead-beef-0000-000000000000": "My chat" } },
  includeArchived: false,
});
assert.equal(rows2[0].title, "My chat", "explicit title overrides still win");

// runtime-scope leak falls back at the merge layer too
const rows3 = mergeSessionRows({
  daemonSessions: [
    {
      id: "def67890-dead-beef-0000-000000000000",
      project_root: "/Users/buns/proj",
      harness: "claude",
      title: "Runtime filesystem boundary: - This is the local runtime boundary for this Cave",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:00:00Z",
    },
  ],
  localConversations: [],
  state,
  includeArchived: false,
});
assert.equal(
  rows3[0].title,
  defaultChatTitleForSession("def67890-dead-beef-0000-000000000000"),
  "runtime-scope-leaked daemon titles fall back to the default session title",
);

// ── chat/send route titles sessions from the user prompt, early ──
const route = await readFile(
  new URL("../app/api/chat/send/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  route,
  /chatTitleFromPrompt\(promptText\)/,
  "chat/send should derive default session titles from the user's raw prompt, not the session id alone",
);
assert.ok(
  route.indexOf("chatTitleFromPrompt") < route.indexOf('push({ kind: "session", sessionId })') ||
    /setDefaultSessionTitleIfMissing\([^)]*\)[\s\S]{0,200}push\(\{ kind: "session"/.test(route) ||
    /push\(\{ kind: "session", sessionId \}\);\s*\n\s*void setDefaultSessionTitleIfMissing/.test(route),
  "the generic stream path should set the default title when the session id first arrives, not only at save time",
);

console.log("session-title-canon: ok");
