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

console.log("chat-router-switching.test.ts: ok");
