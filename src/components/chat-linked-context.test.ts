// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(url: URL): Promise<string> {
  try {
    return await readFile(url, "utf8");
  } catch {
    return "";
  }
}

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const conversationRoute = await readFile(new URL("../app/api/chat/conversation/[id]/route.ts", import.meta.url), "utf8");
const contextLib = await source(new URL("../lib/chat-linked-context.ts", import.meta.url));

assert.match(
  contextLib,
  /export type ChatLinkedContext =[\s\S]*task:\s*\| \{[\s\S]*github: Array<\{/,
  "Chat linked context should expose task metadata and GitHub PR/issue/review links",
);

assert.match(
  contextLib,
  /export async function linkedContextForSession\(sessionId: string\)[\s\S]*loadBoard\(\)[\s\S]*card\.sessionId === sessionId/,
  "Linked context should resolve the board card tied to the opened chat session",
);

assert.match(
  conversationRoute,
  /linkedContextForSession\(id\)/,
  "Conversation API should include linked task/GitHub context for opened sessions",
);

assert.match(
  conversationRoute,
  /NextResponse\.json\(\{ ok: true, conversation: conv, context \}\)/,
  "Conversation API should return context alongside saved Cave conversations",
);

assert.match(
  conversationRoute,
  /NextResponse\.json\(\{ ok: true, conversation: jsonlConv, context \}\)/,
  "Conversation API should return context alongside OpenClaw JSONL conversations",
);

assert.match(
  chatRouter,
  /const activeSession = view\.kind === "chat" && view\.sessionId[\s\S]*sessions\.find\(\(s\) => s\.id === view\.sessionId\)/,
  "ChatRouter should pass the opened session row into ChatView",
);

assert.match(
  chatRouter,
  /const previousFamiliarIdRef = useRef<string \| null \| undefined>\(undefined\)[\s\S]*if \(previousFamiliarIdRef\.current === undefined\)[\s\S]*previousFamiliarIdRef\.current = nextFamiliarId[\s\S]*return/,
  "ChatRouter familiar-change reset should skip initial mount so opening a session does not become a blank new chat",
);

assert.match(
  chatView,
  /type ChatHistoryState = "idle" \| "loading" \| "loaded" \| "missing" \| "error"/,
  "ChatView should explicitly track history load state for existing sessions",
);

assert.match(
  chatView,
  /const \[linkedContext, setLinkedContext\] = useState<ChatLinkedContext \| null>\(null\)/,
  "ChatView should store linked task/GitHub context from the conversation API",
);

assert.match(
  chatView,
  /setHistoryState\("loading"\)[\s\S]*fetch\(`\/api\/chat\/conversation\/\$\{sessionId\}`[\s\S]*setLinkedContext\(json\.context \?\? null\)[\s\S]*setHistoryState\("loaded"\)/,
  "ChatView should show loading state and capture API context when opening a chat",
);

assert.match(
  chatView,
  /function LinkedContextRow[\s\S]*const task = linkedContext\?\.task[\s\S]*const github = linkedContext\?\.github[\s\S]*github\.map[\s\S]*Open on GitHub/,
  "ChatView should render task and GitHub context chips in the chat header",
);

assert.match(
  chatView,
  /onClick=\{\(\) => onOpenTask\(task\.id\)\}/,
  "Clicking the linked task chip should emit the task id",
);

assert.match(
  workspace,
  /if \(intent\.kind === "focus-card"\) \{[\s\S]*setMode\("board"\)[\s\S]*window\.location\.hash = `card-\$\{intent\.cardId\}`/,
  "Workspace should open the board view and focus the linked task card",
);

// Regression guard: the popstate back-to-list fallback must be gated on an
// EMPTY hash. Writing `#card-<id>` (the task chip's navigation) synchronously
// fires this handler while mode is still "chat"; an unconditional
// showFamiliarChatList() there clobbered the same-batch setMode("board") and
// stranded the user on the chat list instead of the task's board inspector.
assert.match(
  workspace,
  /modeRef\.current === "chat" && !window\.location\.hash\) showFamiliarChatList\(\)/,
  "Workspace popstate must only show the chat list on an empty hash, so the task chip's #card- navigation isn't hijacked back to the list",
);

assert.match(
  chatView,
  /historyState === "loading"[\s\S]*Loading chat history/,
  "ChatView should not show an empty new-chat state while an existing chat history is loading",
);

assert.match(
  chatView,
  /historyState === "missing"[\s\S]*Chat history unavailable/,
  "ChatView should make missing history visible instead of silently opening a blank chat",
);
