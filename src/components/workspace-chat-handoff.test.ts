// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const pendingChatActionLib = await readFile(new URL("../lib/pending-chat-action.ts", import.meta.url), "utf8");

assert.match(
  pendingChatActionLib,
  /export type PendingChatAction =[\s\S]*kind: "new"[\s\S]*kind: "open"[\s\S]*kind: "list"/,
  "PendingChatAction should be defined once in the shared lib so Workspace and ChatSurface cannot drift",
);

assert.match(
  workspace,
  /import type \{ PendingChatAction \} from "@\/lib\/pending-chat-action"/,
  "Workspace should import the shared PendingChatAction type instead of redeclaring it",
);

assert.match(
  chatSurface,
  /import type \{ PendingChatAction \} from "@\/lib\/pending-chat-action"/,
  "ChatSurface should import the shared PendingChatAction type instead of redeclaring it",
);

assert.doesNotMatch(
  workspace,
  /^type PendingChatAction =/m,
  "Workspace must not redeclare PendingChatAction locally",
);

assert.doesNotMatch(
  chatSurface,
  /^type PendingChatAction =/m,
  "ChatSurface must not redeclare PendingChatAction locally",
);

assert.match(
  workspace,
  /const \[pendingChatAction, setPendingChatAction\] = useState<PendingChatAction>\(null\)/,
  "Workspace should keep pending chat actions in state so ChatSurface can consume them after mounting",
);

assert.match(
  workspace,
  /const startFamiliarChat = useCallback\([\s\S]*setPendingChatAction\(\{[\s\S]*kind: "new"[\s\S]*familiarId[\s\S]*projectRoot[\s\S]*nonce: Date\.now\(\)[\s\S]*\}\)[\s\S]*setMode\("chat"\)/,
  "New chat should enqueue a pending chat action before entering chat mode",
);

assert.match(
  workspace,
  /const openFamiliarSession = useCallback\([\s\S]*setPendingChatAction\(\{[\s\S]*kind: "open"[\s\S]*sessionId[\s\S]*familiarId[\s\S]*nonce: Date\.now\(\)[\s\S]*\}\)[\s\S]*setMode\("chat"\)/,
  "Opening a session should enqueue a pending chat action before entering chat mode",
);

assert.match(
  workspace,
  /const showFamiliarChatList = useCallback\([\s\S]*setPendingChatAction\(\{ kind: "list", nonce: Date\.now\(\) \}\)[\s\S]*setMode\("chat"\)/,
  "Showing the chat list should enqueue a pending chat action before entering chat mode",
);

assert.doesNotMatch(
  workspace,
  /window\.dispatchEvent\(\s*new CustomEvent\("cave:agents-(?:new-chat|open-session|list)"/,
  "Workspace should not dispatch chat navigation events before ChatSurface has mounted",
);

assert.match(
  workspace,
  /pendingChatAction=\{pendingChatAction\}[\s\S]*onPendingChatActionHandled=\{\(\) => setPendingChatAction\(null\)\}/,
  "Workspace should pass pending chat actions into ChatSurface and clear them after consumption",
);

assert.match(
  chatSurface,
  /pendingChatAction\?: PendingChatAction/,
  "ChatSurface should accept pending chat actions from Workspace",
);

assert.match(
  chatSurface,
  /useEffect\(\(\) => \{[\s\S]*if \(!pendingChatAction\) return[\s\S]*pendingChatAction\.kind === "new"[\s\S]*routerRef\.current\?\.newChat[\s\S]*pendingChatAction\.kind === "open"[\s\S]*routerRef\.current\?\.openSession[\s\S]*routerRef\.current\?\.goToList[\s\S]*onPendingChatActionHandled\(\)/,
  "ChatSurface should consume pending chat actions after it is mounted",
);
