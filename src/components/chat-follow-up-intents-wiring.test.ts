import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChat = await readFile(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const quickChat = await readFile(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");
const journal = await readFile(new URL("./journal/journal-entries.tsx", import.meta.url), "utf8");

assert.match(chatView, /import \{ FollowUpCards \} from "@\/components\/chat-follow-up-cards"/, "ChatView uses the shared typed follow-up cards");
assert.match(chatView, /import \{ FollowUpTaskReview \} from "@\/components\/chat-follow-up-task-review"/, "ChatView owns the review-first task handoff");
assert.match(chatView, /import \{ FollowUpLinkReview \} from "@\/components\/chat-follow-up-link-review"/, "ChatView owns the review-first link handoff");
assert.match(chatView, /type FollowUpActivation = \{ path: NextPath; sourceText: string \}/, "follow-up source pairing stays external to the model object");
assert.match(chatView, /const followUp = useMemo\(\(\) => \{[\s\S]*?turnId: null as string \| null,\s*sourceText: "",\s*suggestions: \[\] as NextPath\[][\s\S]*?return suggestions\.length \? \{ turnId: last\.id, sourceText: last\.text, suggestions \} : empty;/, "the latest follow-up memo keeps both the turn id and its source text");
assert.match(chatView, /<FollowUpCards[\s\S]*paths=\{followUp\.suggestions\}[\s\S]*onActivate=\{\(path\) => handleFollowUp\(\{ path, sourceText: followUp\.sourceText \}\)\}/, "the footer follow-up row pairs each path with the latest assistant turn text");
assert.match(chatView, /<FollowUpCards[\s\S]*paths=\{nextPaths\}[\s\S]*onActivate=\{onSuggestion\}/, "historical assistant turns use the same cards");
assert.match(chatView, /setInput\(path\.prompt\);[\s\S]{0,160}inputRef\.current\?\.focus\(\)/, "reply follow-ups fill and focus the composer without sending");
assert.match(chatView, /path\.kind === "task"[\s\S]{0,120}setTaskSuggestion\(path\)/, "task follow-ups open a review instead of sending");
assert.match(chatView, /path\.actionId === "save-link"[\s\S]{0,240}const links = linksFromFollowUpSource\(sourceText\);[\s\S]{0,180}if \(links\.length === 0\) \{[\s\S]{0,120}announce\("No links available to save", "assertive"\);[\s\S]{0,80}return;[\s\S]{0,120}\}[\s\S]{0,120}setLinkSuggestion\(\{ links \}\);/, "save-link suggestions extract links from their source turn, announce empty state exactly, and otherwise open reviewed state");
assert.match(chatView, /path\.actionId === "open-tasks"[\s\S]{0,180}new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "board" \} \}\)/, "the action allowlist only navigates to Tasks");
assert.match(chatView, /<FollowUpTaskReview[\s\S]*context=\{[\s\S]*turns: activePath,[\s\S]*familiarId: familiar\.id,[\s\S]*projectId: resolvedProjectId/, "task review inherits active-path, familiar, and project context");
assert.match(chatView, /onCreated=\{handleTaskCreated\}/, "created tasks update the chat-linked context");
assert.match(chatView, /<FollowUpLinkReview[\s\S]*open[\s\S]*links=\{linkSuggestion\.links\}[\s\S]*task=\{linkedContext\?\.task \? \{ id: linkedContext\.task\.id, title: linkedContext\.task\.title \} : null\}[\s\S]*onClose=\{\(\) => setLinkSuggestion\(null\)\}/, "link review renders only when links exist and receives only the linked task context it needs");
assert.doesNotMatch(chatView, /onClick=\{\(\) => void send\(s\)\}/, "assistant suggestions never direct-send from the composer row");
assert.doesNotMatch(chatView, /onSuggestion=\{\(sug\) => void handlers\(\)\.send\(sug\)\}/, "assistant suggestions never direct-send from transcript rows");

assert.match(
  groupChat,
  /const suggestions = typedSuggestions[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?\.map\(\(path\) => path\.prompt\);/,
  "group chat filters non-reply paths before rendering reply text",
);
assert.match(groupChat, /suggestions\.map\(\(s, i\) => \{[\s\S]*?sendSuggestion\(s, r\.familiarId/, "only filtered reply text reaches the group send path");
assert.doesNotMatch(groupChat, /typedSuggestions\.map\(/, "raw typed task/action paths never reach group rendering or sendSuggestion");
assert.doesNotMatch(groupChat, /broadcast\(typedSuggestions|sendSuggestion\(typedSuggestions/, "task/action paths never reach group broadcast/send routing");
assert.match(
  quickChat,
  /const suggestions = typedSuggestions[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?\.map\(\(path\) => path\.prompt\);/,
  "quick chat filters typed task/action paths before rendering reply chips",
);
assert.doesNotMatch(quickChat, /typedSuggestions\.map\(/, "raw typed task/action paths never reach quick-chat rendering or send callbacks");
assert.doesNotMatch(journal, /const \{ visible, suggestions \} = useMemo\(\(\) => extractNextPaths\(text\)/, "journal strips follow-up control blocks without routing their intents");

console.log("chat-follow-up-intents-wiring.test.ts: ok");
