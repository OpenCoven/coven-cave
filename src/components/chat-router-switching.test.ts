// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const familiarChangeEffect =
  source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[familiar\?\.id\]\);/)?.[0] ?? "";

assert.match(
  familiarChangeEffect,
  /prev\.kind === "chat"/,
  "Changing familiars while viewing a chat should stay in chat mode with a fresh session",
);

assert.match(
  familiarChangeEffect,
  /\{[\s\S]*kind: "chat"[\s\S]*sessionId: null[\s\S]*projectRoot: prev\.projectRoot[\s\S]*initialPrompt: prev\.initialPrompt[\s\S]*familiarId: nextFamiliarId[\s\S]*\}/,
  "A familiar switch in chat mode should preserve pending project context for the fresh chat",
);

assert.doesNotMatch(
  familiarChangeEffect,
  /setView\(\{ kind: "list" \}\)/,
  "Changing familiars should not always bounce the user back to the chat list",
);

assert.match(
  familiarChangeEffect,
  /prev\.familiarId === nextFamiliarId[\s\S]*?\? prev/,
  "A familiar change that matches the chat view's own familiarId (router-initiated open) must keep the view — not wipe the sessionId",
);

assert.match(
  source,
  /import \{ ChatProjectSidebar \} from "@\/components\/chat-project-sidebar"/,
  "ChatRouter should own the project sidebar so it can stay visible in chat detail, not only the chat list",
);

assert.match(
  source,
  /<ChatProjectSidebar[\s\S]*activeSessionId=\{view\.kind === "chat" \? view\.sessionId : null\}[\s\S]*<ChatView/,
  "ChatRouter should render the projects sidebar next to ChatView while a chat is open",
);

// ── CHAT-D9-01: URL deep links (#chat-<sessionId>) ───────────────────────────

const workspaceSource = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurfaceSource = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");

const hashSyncEffect =
  source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[syncUrlHash, view\]\);/)?.[0] ?? "";

assert.ok(
  hashSyncEffect.length > 0,
  "ChatRouter should sync the URL hash from an effect keyed on [syncUrlHash, view] — session promotion flows through setView, so the same effect picks up the promoted id",
);

assert.match(
  hashSyncEffect,
  /`#chat-\$\{encodeURIComponent\(view\.sessionId\)\}`/,
  "Opening a chat should write #chat-<sessionId> to the URL hash",
);

assert.match(
  hashSyncEffect,
  /history\.pushState/,
  "Opening a chat must push a history entry so browser Back returns to the list",
);

assert.match(
  hashSyncEffect,
  /hash\.startsWith\("#chat-"\)[\s\S]*?history\.replaceState/,
  "Returning to the list should clear the chat hash via replaceState (no extra history entry)",
);

assert.match(
  hashSyncEffect,
  /if \(!syncUrlHash/,
  "Hash sync must be opt-in — the companion-rail ChatRouter must not fight the main surface for the URL hash",
);

assert.match(
  hashSyncEffect,
  /isFirstRun/,
  "The first effect run (mount lands on the list view) must not clear a deep-link hash before workspace restores it",
);

assert.match(
  source,
  /prev\.kind === "chat" && prev\.sessionId === null\s*\? \{ kind: "chat", sessionId: sid/,
  "Session promotion must update the view's sessionId via setView so the hash-sync effect writes the promoted id",
);

assert.match(
  chatSurfaceSource,
  /<ChatRouter[\s\S]*?syncUrlHash[\s\S]*?\/>/,
  "The main chat surface's ChatRouter must opt into URL hash sync",
);

const restoreEffect =
  workspaceSource.match(
    /useEffect\(\(\) => \{\s*if \(!sessionsLoaded\) return;[\s\S]*?\}, \[sessionsLoaded, sessions, openFamiliarSession, showFamiliarChatList\]\);/,
  )?.[0] ?? "";

assert.ok(
  restoreEffect.length > 0,
  "Workspace's mount-time deep-link restore must wait for the async sessions fetch (sessionsLoaded) before resolving #chat-<sessionId>",
);

assert.match(
  restoreEffect,
  /pendingChatDeepLinkRef/,
  "Mount-time restore should consume the deep-link target captured at mount",
);

assert.match(
  restoreEffect,
  /openFamiliarSession\(sid, target\.familiarId\)/,
  "A resolved deep link should open the session via openFamiliarSession (same lookup as /attach)",
);

assert.match(
  restoreEffect,
  /clearChatHash\(\);\s*showFamiliarChatList\(\)/,
  "Unknown/stale deep-link ids must fall back to the chat list with the hash cleared — no crash",
);

const readChatHashHelper =
  workspaceSource.match(/function readChatHash\(\): string \| null \{[\s\S]*?\n\}/)?.[0] ?? "";

assert.match(
  readChatHashHelper,
  /try \{[\s\S]*decodeURIComponent\(hash\.slice\(CHAT_HASH_PREFIX\.length\)\)[\s\S]*\} catch/,
  "readChatHash should treat malformed percent-encoding as null instead of throwing during render/popstate",
);

const popstateEffect =
  workspaceSource.match(
    /useEffect\(\(\) => \{\s*const onPopState = \(\) => \{[\s\S]*?\};\s*window\.addEventListener\("popstate", onPopState\);[\s\S]*?\}, \[openFamiliarSession, showFamiliarChatList\]\);/,
  )?.[0] ?? "";

assert.match(
  popstateEffect,
  /addEventListener\("popstate"/,
  "Workspace must listen for popstate so browser Back/Forward navigates between list and chat",
);

assert.match(
  popstateEffect,
  /if \(target\) \{\s*openFamiliarSession\(sid, target\.familiarId\);\s*return;\s*\}[\s\S]*clearChatHash\(\);\s*showFamiliarChatList\(\);/,
  "Popstate should clear stale chat hashes and return to the list when the target session is missing",
);

// ── CHAT-D9-04: in-transcript find (turn-level jump + count) ─────────────────
// The find bar lives in ChatView's header meta line; matching is turn-level
// (case-insensitive substring over visible text) via the pure helper in
// src/lib/transcript-find.ts. Intra-turn highlighting is deferred.

const chatViewSource = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatCssSource = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// 1. Behavioral: the pure turn-level match helper.
const { findMatchingTurnIds } = await import("../lib/transcript-find.ts");

assert.deepEqual(
  findMatchingTurnIds(
    [
      { id: "a", text: "Deploy the staging build" },
      { id: "b", text: "nothing relevant here" },
      { id: "c", text: "redeploy after the fix" },
    ],
    "DEPLOY",
  ),
  ["a", "c"],
  "findMatchingTurnIds must be a case-insensitive substring match over turn text, in transcript order",
);

assert.deepEqual(
  findMatchingTurnIds([{ id: "a", text: "anything" }], "   "),
  [],
  "A blank/whitespace query must match zero turns — not every turn via the empty substring",
);

assert.deepEqual(
  findMatchingTurnIds([], "query"),
  [],
  "An empty transcript has no matches",
);

// 2. The find bar renders in the header meta line with n/m count and
//    prev/next navigation carrying aria-labels.
assert.match(
  chatViewSource,
  /<MetaLine[\s\S]*?<ChatFindBar[\s\S]*?<\/MetaLine>/,
  "ChatFindBar must render inside the header MetaLine row so rename/voice/debug/delete actions stay put",
);

assert.match(
  chatViewSource,
  /\$\{activeIndex \+ 1\} \/ \$\{matchCount\}/,
  "The find bar must show a 1-based `n / m` matching-turn count",
);

assert.match(
  chatViewSource,
  /aria-label="Previous match"/,
  "Prev navigation needs an aria-label",
);

assert.match(
  chatViewSource,
  /aria-label="Next match"/,
  "Next navigation needs an aria-label",
);

assert.match(
  chatViewSource,
  /aria-label="Find in conversation"/,
  "The collapsed search toggle needs an aria-label",
);

// 3. ⌘F is scoped to the chat section root — a React keydown handler with
//    preventDefault, NOT a window-level listener (ChatList's ⌘F session
//    search and browser-native find elsewhere must keep working).
const sectionKeyHandler =
  chatViewSource.match(/const onChatSectionKeyDown = useCallback\([\s\S]*?\[openFind\],\s*\);/)?.[0] ?? "";

assert.ok(
  sectionKeyHandler.length > 0,
  "ChatView should define onChatSectionKeyDown for section-scoped find activation",
);

assert.match(
  sectionKeyHandler,
  /\(e\.metaKey \|\| e\.ctrlKey\)[\s\S]*?e\.key\.toLowerCase\(\) === "f"[\s\S]*?e\.preventDefault\(\)/,
  "⌘F/Ctrl+F inside the chat section must preventDefault (suppress browser find) and open the find bar",
);

assert.match(
  chatViewSource,
  /<section[\s\S]{0,200}onKeyDown=\{onChatSectionKeyDown\}/,
  "The keydown handler must sit on the chat section root so it only fires while focus is inside the chat",
);

assert.doesNotMatch(
  chatViewSource,
  /window\.addEventListener\(["']keydown["']/,
  "Find must NOT register a window-level keydown listener — that would shadow ChatList's ⌘F and browser find elsewhere",
);

// 4. Navigating to a match releases the streaming follow-pin (CHAT-D10-01)
//    so the next SSE chunk doesn't yank the reader back to the bottom, and
//    the jump itself is instant (behavior: "auto" — reduced-motion-safe).
const jumpFn =
  chatViewSource.match(/const jumpToFindMatch = useCallback\([\s\S]*?\[[^\]]*updateFollowing[^\]]*\],\s*\);/)?.[0] ?? "";

assert.ok(jumpFn.length > 0, "ChatView should define jumpToFindMatch");

assert.match(
  jumpFn,
  /if \(followingRef\.current\) updateFollowing\(false\);/,
  "A find jump must release the follow-pin before scrolling",
);

assert.match(
  jumpFn,
  /scrollIntoView\(\{ block: "center", behavior: "auto" \}\)/,
  "Find jumps must scroll instantly (behavior: \"auto\") and center the matching turn",
);

assert.match(
  jumpFn,
  /data-turn-id/,
  "Jump targeting should resolve the turn row via its data-turn-id attribute",
);

// 5. Turn rows expose stable DOM ids for scroll targeting in BOTH branches
//    (user/system and assistant).
assert.equal(
  (chatViewSource.match(/data-turn-id=\{turn\.id\}/g) ?? []).length,
  2,
  "Both TurnRow render branches must stamp data-turn-id",
);

// 6. The Esc layering is self-contained: the find input stops propagation so
//    closing find never reaches the composer's Esc handling, and Enter /
//    Shift+Enter cycle next/prev.
const findBarComponent =
  chatViewSource.match(/function ChatFindBar\(\{[\s\S]*?\nfunction MetaLineElapsed/)?.[0] ?? "";

assert.match(
  findBarComponent,
  /e\.key === "Escape"[\s\S]*?e\.stopPropagation\(\);[\s\S]*?onClose\(\)/,
  "Esc in the find input must close the bar without bubbling into composer Esc layering",
);

assert.match(
  findBarComponent,
  /e\.key === "Enter"[\s\S]*?if \(e\.shiftKey\) onPrev\(\);\s*else onNext\(\);/,
  "Enter = next match, Shift+Enter = prev match in the find input",
);

// 7. Matching is debounced and turn-level over VISIBLE text only (reasoning
//    is excluded; assistant inline <thinking> blocks are split out first).
assert.match(
  chatViewSource,
  /setTimeout\(\(\) => setFindDebouncedQuery\(findQuery\), 150\)/,
  "Query matching should be debounced ~150ms",
);

assert.match(
  chatViewSource,
  /t\.role === "assistant" \? splitReasoning\(t\.text\)\.visible : t\.text/,
  "Find must match the VISIBLE transcript text — never turn.reasoning or unsplit thinking blocks",
);

// 8. Highlight CSS: temporary cave-turn-found flash with reduced-motion
//    safety (explicit static fallback on top of the global kill switch).
assert.match(
  chatCssSource,
  /\.cave-turn-found \{\s*animation: cave-turn-found-fade 1\.5s/,
  "The landing turn gets a one-shot 1.5s cave-turn-found fade",
);

assert.match(
  chatCssSource,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.cave-turn-found \{\s*animation: none;/,
  "cave-turn-found must disable its animation under prefers-reduced-motion (static tint instead)",
);

console.log("chat-router-switching.test.ts: ok");
