import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChat = await readFile(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const quickChat = await readFile(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");
const journal = await readFile(new URL("./journal/journal-entries.tsx", import.meta.url), "utf8");

assert.match(chatView, /import \{ FollowUpCards \} from "@\/components\/chat-follow-up-cards"/, "ChatView uses the shared typed follow-up cards");
assert.match(chatView, /import \{ FollowUpTaskReview \} from "@\/components\/chat-follow-up-task-review"/, "ChatView owns the review-first task handoff");
assert.match(chatView, /<FollowUpCards[\s\S]*paths=\{followUp\.suggestions\}[\s\S]*onActivate=\{handleFollowUp\}/, "the composer placement routes cards through typed handling");
assert.equal([...chatView.matchAll(/<FollowUpCards/g)].length, 1, "historical assistant turns never render action cards");
assert.match(chatView, /setInput\(path\.prompt\);[\s\S]{0,160}inputRef\.current\?\.focus\(\)/, "reply follow-ups fill and focus the composer without sending");
assert.match(chatView, /path\.kind === "task"[\s\S]{0,120}setTaskSuggestion\(path\)/, "task follow-ups open a review instead of sending");
assert.match(chatView, /path\.actionId === "open-tasks"[\s\S]{0,180}new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "board" \} \}\)/, "the action allowlist only navigates to Tasks");
assert.match(chatView, /<FollowUpTaskReview[\s\S]*context=\{[\s\S]*turns: activePath,[\s\S]*familiarId: familiar\.id,[\s\S]*projectId: resolvedProjectId/, "task review inherits active-path, familiar, and project context");
assert.match(chatView, /onCreated=\{handleTaskCreated\}/, "created tasks update the chat-linked context");
assert.doesNotMatch(chatView, /onClick=\{\(\) => void send\(s\)\}/, "assistant suggestions never direct-send from the composer row");
assert.doesNotMatch(chatView, /onSuggestion=\{\(sug\) => void handlers\(\)\.send\(sug\)\}/, "assistant suggestions never direct-send from transcript rows");

// The coven redesign renders suggestions as typed chips through
// CovenAgentSection, but the filter is unchanged and still upstream of both
// rendering and sending: a coven bubble has no task or action router, so a
// click here must only ever send an ordinary message.
assert.match(
  groupChat,
  /const suggestions: CovenSuggestion\[\] =[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)/,
  "group chat filters non-reply paths before rendering reply text",
);
assert.match(
  groupChat,
  /\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?sendSuggestion\(\s*\n\s*path\.prompt,\s*\n\s*agent\.familiarId,/,
  "only filtered reply text reaches the group send path",
);
assert.match(
  groupChat,
  /const isLatestRun = runIndex === visibleRuns\.length - 1;[\s\S]*?isLatestRun && agent\.status === "complete"/,
  "group-chat actions render only for the newest run",
);
assert.doesNotMatch(groupChat, /typed\.map\(/, "raw typed task/action paths never reach group rendering or sendSuggestion");
assert.doesNotMatch(groupChat, /broadcast\(typed\b|sendSuggestion\(typed\b/, "task/action paths never reach group broadcast/send routing");
assert.match(
  quickChat,
  /const suggestions = typedSuggestions[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?\.map\(\(path\) => path\.prompt\);/,
  "quick chat filters typed task/action paths before rendering reply chips",
);
assert.doesNotMatch(quickChat, /typedSuggestions\.map\(/, "raw typed task/action paths never reach quick-chat rendering or send callbacks");
assert.doesNotMatch(journal, /const \{ visible, suggestions \} = useMemo\(\(\) => extractNextPaths\(text\)/, "journal strips follow-up control blocks without routing their intents");

console.log("chat-follow-up-intents-wiring.test.ts: ok");
