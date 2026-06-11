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

// ── merge layer falls back when the daemon title is canon-leaked ──
const daemonRow = {
  id: "abc12345-dead-beef-0000-000000000000",
  project_root: "",
  harness: "claude",
  title: "Coven identity canon: - Each familiar has a defi",
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-06-11T00:00:00Z",
  updated_at: "2026-06-11T00:00:00Z",
};
const emptyState = {
  sessionTitles: {},
  sessionFamiliar: {},
  sessionArchived: {},
  sessionSacrificed: {},
};
const rows = mergeSessionRows({
  daemonSessions: [daemonRow],
  localConversations: [],
  state: emptyState,
  includeArchived: false,
});
assert.equal(rows.length, 1);
assert.ok(
  !rows[0].title.startsWith("Coven identity canon"),
  "merged rows must not surface canon-leaked daemon titles",
);
assert.equal(
  rows[0].title,
  defaultChatTitleForSession(daemonRow.id),
  "canon-leaked titles fall back to the default session title",
);

// explicit title overrides still win over sanitization
const rows2 = mergeSessionRows({
  daemonSessions: [daemonRow],
  localConversations: [],
  state: { ...emptyState, sessionTitles: { [daemonRow.id]: "My chat" } },
  includeArchived: false,
});
assert.equal(rows2[0].title, "My chat", "explicit title overrides still win");

// ── chat/send route titles sessions from the user prompt, early ──
const route = await readFile(
  new URL("../app/api/chat/send/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  route,
  /chatTitleFromPrompt\(promptText\)/,
  "chat/send should derive default session titles from the user's raw prompt",
);
assert.match(
  route,
  /push\(\{ kind: "session", sessionId \}\);[\s\S]{0,500}?setDefaultSessionTitleIfMissing\(/,
  "the stream path should set the default title when the session id first arrives, not only at save time",
);
assert.match(
  route,
  /chatTitleFromPrompt\(args\.promptText\)/,
  "the openclaw path should also title sessions from the user's raw prompt",
);

console.log("session-title-canon: ok");
