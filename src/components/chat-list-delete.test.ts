// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PINNED_SESSIONS_KEY,
  readPinnedSessions,
  togglePinnedSession,
  sortPinnedFirst,
} from "../lib/chat-session-prefs.ts";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /busyTuiId|openInTui|tui\s*→|Open in Coven Code TUI/,
  "ChatList should replace the old TUI row action with deletion",
);

assert.match(
  source,
  /const \[confirmDeleteId, setConfirmDeleteId\] = useState<string \| null>\(null\)/,
  "ChatList should keep an explicit per-row delete confirmation state",
);

assert.match(
  source,
  /fetch\(`\/api\/chat\/conversation\/\$\{encodeURIComponent\(sessionId\)\}`,[\s\S]*method: "DELETE"/,
  "ChatList should delete through the conversation endpoint for the selected session",
);

assert.match(
  source,
  /onSessionsChanged\?\.\(\)/,
  "ChatList should ask the shell to refresh sessions after deleting a chat",
);

assert.match(
  source,
  /<Icon name="ph:trash"/,
  "ChatList delete action should use the trash icon",
);

// ── Pin & archive (CHAT-D9-03) ───────────────────────────────────────────────

// Pin store: Cave-local localStorage set with SSR-safe reads.
assert.equal(
  PINNED_SESSIONS_KEY,
  "cave:chat:pinned-sessions",
  "pinned sessions persist under a cave-scoped localStorage key",
);
assert.deepEqual(
  readPinnedSessions(),
  [],
  "readPinnedSessions degrades to empty without a window (SSR)",
);
assert.deepEqual(togglePinnedSession([], "s1"), ["s1"], "toggle adds a missing id");
assert.deepEqual(togglePinnedSession(["s1", "s2"], "s1"), ["s2"], "toggle removes a present id");

// Pinned rows sort first within their project group; recency order is
// preserved inside both partitions and pin-free groups keep their reference.
const row = (id) => ({ id });
const groups = [
  {
    projectRoot: "/repo",
    sessions: [row("a"), row("b"), row("c"), row("d")],
    defaultFamiliarId: null,
    updatedAt: null,
  },
  {
    projectRoot: null,
    sessions: [row("e")],
    defaultFamiliarId: null,
    updatedAt: null,
  },
];
const sorted = sortPinnedFirst(groups, ["d", "b"]);
assert.deepEqual(
  sorted[0].sessions.map((s) => s.id),
  ["b", "d", "a", "c"],
  "pinned rows float to the top of their group, keeping recency order within partitions",
);
assert.equal(sorted[1], groups[1], "groups without pins keep their reference");
assert.equal(sortPinnedFirst(groups, []), groups, "no pins → groups returned untouched");

// ChatList wiring: persisted pin state drives a pinned-first ordering.
assert.match(
  source,
  /setPinnedIds\(readPinnedSessions\(\)\)/,
  "ChatList should hydrate pinned ids from the localStorage store after mount",
);
assert.match(
  source,
  /window\.localStorage\.setItem\(PINNED_SESSIONS_KEY, JSON\.stringify\(pinnedIds\)\)/,
  "ChatList should persist pin toggles back to the localStorage store",
);
assert.match(
  source,
  /sortPinnedFirst\(scopedGroups, pinnedIds\)/,
  "ChatList should float pinned rows to the top of their project group",
);
assert.match(
  source,
  /togglePinnedSession\(prev, sessionId\)/,
  "ChatList pin action should toggle through the shared store helper",
);
assert.match(
  source,
  /aria-label=\{`\$\{pinned \? "Unpin" : "Pin"\} chat \$\{rowName\}`\}/,
  "Pin toggle should be a real button with a state-aware aria-label",
);

// Archive rides the existing sessions PATCH endpoint (Cave-local archived_at)
// and archived rows stay hidden until the Show archived filter opts in.
assert.match(
  source,
  /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`, \{\s*method: "PATCH",[\s\S]*?JSON\.stringify\(\{ archived \}\)/,
  "Archive action should persist through the sessions PATCH endpoint",
);
assert.match(
  source,
  /aria-label=\{`\$\{s\.archived_at \? "Unarchive" : "Archive"\} chat \$\{rowName\}`\}/,
  "Archive toggle should be a real button with a state-aware aria-label",
);
assert.match(
  source,
  /if \(!showArchived\) \{\s*setArchivedRows\(\[\]\);/,
  "Archived rows should be dropped whenever the Show archived toggle is off",
);
assert.match(
  source,
  /\/api\/sessions\/list\?includeArchived=1/,
  "Archived rows should load only via the opt-in includeArchived list query",
);
assert.match(
  source,
  /aria-pressed=\{showArchived\}[\s\S]*?aria-label=\{showArchived \? "Hide archived chats" : "Show archived chats"\}/,
  "Show archived filter should be an aria-labeled toggle alongside the existing filters",
);

// ── Content search (CHAT-D9-02) ──────────────────────────────────────────────

// The search box also fires a content search against /api/chat/search for
// queries of length ≥2 — debounced ~300ms with an abortable fetch.
assert.match(
  source,
  /fetch\(`\/api\/chat\/search\?q=\$\{encodeURIComponent\(q\)\}`,\s*\{\s*cache: "no-store",\s*signal: controller\.signal,/,
  "ChatList should query the content-search endpoint with an abortable fetch",
);
assert.match(
  source,
  /const timer = window\.setTimeout\([\s\S]{0,900}?\}, 300\);/,
  "Content search should debounce ~300ms behind the keystroke",
);
assert.match(
  source,
  /window\.clearTimeout\(timer\);\s*\n\s*controller\.abort\(\);/,
  "A retype must clear the pending debounce and abort the in-flight fetch",
);
assert.match(
  source,
  /if \(q\.length < 2\) \{\s*\n\s*setContentHits\(\[\]\);\s*\n\s*setContentLoading\(false\);/,
  "Queries under 2 chars must clear content hits instead of fetching",
);

// Title-filtered rows stay primary: sessions already visible by title match
// are deduped out of the content section, and hits resolve against the
// familiar-scoped rows so other familiars' chats never leak in.
assert.match(
  source,
  /if \(shown\.has\(hit\.sessionId\)\) continue;/,
  "Content hits already shown by the title filter must be deduped",
);
assert.match(
  source,
  /const byId = new Map\(mine\.map\(\(s\) => \[s\.id, s\]\)\);/,
  "Content hits must resolve against the familiar-scoped session rows",
);

// Render: secondary "In conversations" section with highlighted snippet,
// loading shimmer, and the existing onOpen path for clicks.
assert.match(
  source,
  /In conversations/,
  "Content matches render under an 'In conversations' section header",
);
assert.match(
  source,
  /contentLoading && contentMatches\.length === 0 \?[\s\S]{0,200}?animate-pulse/,
  "Content search shows the shimmer idiom while the first fetch is in flight",
);
assert.match(
  source,
  /<mark className=/,
  "The matched substring inside the snippet is highlighted with <mark>",
);
assert.match(
  source,
  /HighlightedSnippet snippet=\{hit\.snippet\} query=\{search\.trim\(\)\}/,
  "Snippets render through the highlight helper with the live query",
);
assert.match(
  source,
  /onClick=\{\(\) => \{ setActiveId\(hit\.sessionId\); onOpen\(hit\.sessionId, row\.familiarId\); \}\}/,
  "Clicking a content hit opens the session via the existing onOpen path",
);

console.log("chat-list-delete.test.ts: ok");
