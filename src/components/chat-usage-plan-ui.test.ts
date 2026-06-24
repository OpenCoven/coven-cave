// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/chat/usage/route.ts", import.meta.url), "utf8").catch(() => "");

assert.match(
  chatView,
  /type ChatUsagePlanSnapshot/,
  "ChatView should type the chat usage-plan snapshot it receives from the server",
);

assert.match(
  chatView,
  /fetch\(`\/api\/chat\/usage\?\$\{params\.toString\(\)\}`/,
  "ChatView should fetch model-aware chat usage from /api/chat/usage",
);

assert.match(
  chatView,
  /formatChatUsagePlanSummary\(usagePlan\)/,
  "ChatView should render the compact plan summary through the shared formatter",
);

assert.match(
  chatView,
  /<UsagePlanChip usagePlan=\{usagePlan\} \/>/,
  "The completed meta line should include the plan usage chip",
);

assert.match(
  route,
  /aggregateTurnUsage/,
  "The usage route should aggregate persisted turn usage instead of inventing counters",
);

assert.match(
  route,
  /availability:\s*hasConfiguredLimits/,
  "The usage route should distinguish configured limits from unconfigured local estimates",
);

console.log("chat-usage-plan-ui.test.ts: ok");
