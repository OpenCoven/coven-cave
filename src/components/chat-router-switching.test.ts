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
    /useEffect\(\(\) => \{\s*if \(!sessionsLoaded\) return;[\s\S]*?\}, \[sessionsLoaded, sessions, openAgentSession, showAgentChatList\]\);/,
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
  /openAgentSession\(sid, target\.familiarId\)/,
  "A resolved deep link should open the session via openAgentSession (same lookup as /attach)",
);

assert.match(
  restoreEffect,
  /clearChatHash\(\);\s*showAgentChatList\(\)/,
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
    /useEffect\(\(\) => \{\s*const onPopState = \(\) => \{[\s\S]*?\};\s*window\.addEventListener\("popstate", onPopState\);[\s\S]*?\}, \[openAgentSession, showAgentChatList\]\);/,
  )?.[0] ?? "";

assert.match(
  popstateEffect,
  /addEventListener\("popstate"/,
  "Workspace must listen for popstate so browser Back/Forward navigates between list and chat",
);

assert.match(
  popstateEffect,
  /if \(target\) \{\s*openAgentSession\(sid, target\.familiarId\);\s*return;\s*\}[\s\S]*clearChatHash\(\);\s*showAgentChatList\(\);/,
  "Popstate should clear stale chat hashes and return to the list when the target session is missing",
);

console.log("chat-router-switching.test.ts: ok");
