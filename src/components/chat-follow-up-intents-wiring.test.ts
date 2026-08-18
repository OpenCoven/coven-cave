import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const groupChat = await readFile(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const quickChat = await readFile(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");
const journal = await readFile(new URL("./journal/journal-entries.tsx", import.meta.url), "utf8");

assert.match(chatView, /import \{ FollowUpCards \} from "@\/components\/chat-follow-up-cards"/, "ChatView uses the shared typed follow-up cards");
assert.match(chatView, /import \{ FollowUpTaskReview \} from "@\/components\/chat-follow-up-task-review"/, "ChatView owns the review-first task handoff");
assert.match(chatView, /import \{ FollowUpLinkReview \} from "@\/components\/chat-follow-up-link-review"/, "ChatView owns reviewed link saving");
assert.match(chatView, /import \{ linksFromFollowUpSource \} from "@\/lib\/chat-follow-up-links"/, "ChatView extracts links through the reviewed helper");
assert.match(chatView, /type FollowUpActivation = \{ path: NextPath; sourceText: string \};/, "follow-up routing carries source text outside model-produced NextPath");
assert.match(
  chatView,
  /type LinkReviewState = \{[\s\S]*?links: string\[\];[\s\S]*?originSessionId: string \| null;[\s\S]*?task: \{ id: string; title: string \} \| null;[\s\S]*?\};/,
  "link review state owns its origin session and task snapshot",
);
assert.match(
  chatView,
  /const empty = \{ turnId: null, sourceText: "", suggestions: \[\] as NextPath\[\], saveLinkAvailable: true \};[\s\S]*if \(!suggestions\.length\) return empty;[\s\S]*?return \{[\s\S]*?turnId: last\.id,[\s\S]*?sourceText: last\.text,[\s\S]*?suggestions,[\s\S]*?saveLinkAvailable: linksFromFollowUpSource\(last\.text\)\.length > 0,[\s\S]*?\};/,
  "the latest settled footer state retains its exact source turn, an empty (available) source for empty state, and a truthful save-link availability computed from that exact turn",
);
assert.match(
  chatView,
  /paths=\{followUp\.suggestions\}[\s\S]{0,180}onActivate=\{\(path\) => handleFollowUp\(\{ path, sourceText: followUp\.sourceText \}\)\}[\s\S]{0,80}saveLinkAvailable=\{followUp\.saveLinkAvailable\}/,
  "the composer footer pairs activation with the latest settled source and passes its truthful save-link availability",
);
assert.match(
  chatView,
  /const saveLinkAvailable = linksFromFollowUpSource\(turn\.text\)\.length > 0;/,
  "each historical row computes save-link availability from its own exact source turn",
);
assert.match(
  chatView,
  /<FollowUpCards paths=\{nextPaths\} onActivate=\{onFollowUp\} saveLinkAvailable=\{saveLinkAvailable\} \/>/,
  "historical rows pass their row-exact save-link availability down, never leaving FollowUpCards to infer it",
);
assert.equal(
  [...chatView.matchAll(/onFollowUp=\{\(path\) => handlers\(\)\.handleFollowUp\(\{ path, sourceText: t\.text \}\)\}/g)].length,
  2,
  "single and voice-group historical rows pair activation with that row's exact source text",
);
assert.match(chatView, /latestFollowUpTurnId=\{followUp\.turnId\}/, "the latest footer turn is excluded from duplicate historical cards");
assert.match(chatView, /setInput\(path\.prompt\);[\s\S]{0,160}inputRef\.current\?\.focus\(\)/, "reply follow-ups fill and focus the composer without sending");
assert.match(
  chatView,
  /type TaskReviewState = \{[\s\S]*?suggestion: Extract<NextPath, \{ kind: "task" \}>;[\s\S]*?originSessionId: string;[\s\S]*?originViewKey: string;[\s\S]*?context: ChatHandoffContext;[\s\S]*?\};/,
  "task review state owns its origin session, view, and handoff context",
);
assert.match(
  chatView,
  /path\.kind === "task"[\s\S]*?if \(!sessionId\) return;[\s\S]*?setTaskReview\(\{[\s\S]*?suggestion: path,[\s\S]*?originSessionId: sessionId,[\s\S]*?originViewKey: followUpViewKey,[\s\S]*?context: \{[\s\S]*?turns: \[\.\.\.activePath\],[\s\S]*?familiarId: familiar\.id,[\s\S]*?projectId: resolvedProjectId !== NO_PROJECT_ID \? resolvedProjectId : null,[\s\S]*?\},[\s\S]*?\}\)/,
  "task activation snapshots the current session and context instead of retargeting through later render values",
);
assert.match(
  chatView,
  /path\.actionId === "save-link"[\s\S]*?linksFromFollowUpSource\(sourceText\)[\s\S]*?links\.length === 0[\s\S]*?announce\("No links available to save", "assertive"\)[\s\S]*?return;[\s\S]*?const task = linkedContext\?\.task;[\s\S]*?setLinkReview\(\{[\s\S]*?links,[\s\S]*?originSessionId: sessionId,[\s\S]*?task: task \? \{ id: task\.id, title: task\.title \} : null,[\s\S]*?\}\)/,
  "save-link extracts only the provided source and snapshots the origin session and task",
);
assert.match(chatView, /path\.actionId === "open-tasks"[\s\S]{0,180}new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "board" \} \}\)/, "the action allowlist only navigates to Tasks");
assert.match(
  chatView,
  /const viewKey = `\$\{sessionId \?\? ""\}\|\$\{projectRoot \?\? ""\}`;[\s\S]*?const viewChanged = draftViewKeyRef\.current !== viewKey;[\s\S]*?if \(viewChanged\) \{[\s\S]{0,160}setTaskReview\(null\);[\s\S]{0,80}setLinkReview\(null\);[\s\S]{0,40}\}/,
  "session and compose-target switches clear per-thread task and link reviews",
);
assert.match(
  chatView,
  /\{linkReview && linkReview\.originSessionId === sessionId \? \([\s\S]*?<FollowUpLinkReview[\s\S]*?reviewIdentity=\{linkReview\}[\s\S]*?links=\{linkReview\.links\}[\s\S]*?task=\{linkReview\.task\}[\s\S]*?onClose=\{\(\) => setLinkReview\(\(current\) => current === linkReview \? null : current\)\}/,
  "link review fails closed across sessions, retains its review identity, and cannot stale-close a replacement",
);
assert.doesNotMatch(
  chatView,
  /\{linkReview && linkReview\.originSessionId === sessionId \? \([\s\S]*?<FollowUpLinkReview[\s\S]*?task=\{[\s\S]*?linkedContext\?\.task/,
  "an active review never targets a task read from a later linked context",
);
assert.doesNotMatch(
  chatView,
  /onClose=\{\(\) => \{[\s\S]{0,240}focus\(/,
  "link-review focus return remains owned by the shared Modal",
);
assert.match(
  chatView,
  /\{taskReview && taskReview\.originSessionId === sessionId && taskReview\.originViewKey === followUpViewKey \? \([\s\S]*?<FollowUpTaskReview[\s\S]*?sessionId=\{taskReview\.originSessionId\}[\s\S]*?suggestion=\{taskReview\.suggestion\}[\s\S]*?context=\{taskReview\.context\}/,
  "task review renders only for its origin view and receives only its stored context",
);
assert.match(
  chatView,
  /onCreated=\{\(card\) => handleTaskCreated\(taskReview, card\)\}[\s\S]*?onClose=\{\(\) => setTaskReview\(\(current\) => current === taskReview \? null : current\)\}/,
  "task review completion and close callbacks retain the originating review identity",
);
assert.match(
  chatView,
  /const handleTaskCreated = useCallback\(\(review: TaskReviewState, card: Card\) => \{[\s\S]*?if \(taskReviewRef\.current !== review \|\| followUpViewKeyRef\.current !== review\.originViewKey\) return;/,
  "stale task creation cannot mutate a later review or view",
);
assert.doesNotMatch(chatView, /onClick=\{\(\) => void send\(s\)\}/, "assistant suggestions never direct-send from the composer row");
assert.doesNotMatch(chatView, /onSuggestion=\{\(sug\) => void handlers\(\)\.send\(sug\)\}/, "assistant suggestions never direct-send from transcript rows");
assert.doesNotMatch(chatView, /dispatchEvent\(new CustomEvent\(path\./, "assistant strings never become event names or route payloads");

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
