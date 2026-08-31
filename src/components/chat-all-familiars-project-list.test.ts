// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const githubTaskContext = readFileSync(new URL("../lib/workspace-github-task-context.ts", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*familiars=\{familiars\}[\s\S]*onSetActiveFamiliar=\{onSetActiveFamiliar\}/,
  "ChatSurface should pass all familiars into ChatRouter so the generic Familiars scope can still list chats",
);

assert.doesNotMatch(
  chatRouter,
  /if \(!familiar\) \{[\s\S]*?Choose a familiar/,
  "ChatRouter should not hide the chat list when the generic Familiars scope is selected",
);

assert.match(
  chatRouter,
  /<ChatList[\s\S]*familiar=\{familiar\}[\s\S]*familiars=\{familiars\}/,
  "ChatRouter should render ChatList with nullable familiar plus the full familiar list",
);

assert.match(
  chatRouter,
  /onSetActiveFamiliar\?\.\(next\.id\)/,
  "Opening a chat or project-scoped launch from all-familiars mode should select that familiar before entering the chat",
);

assert.match(
  chatRouter,
  /newChat: \(projectRoot\?: string, initialPrompt\?: string, familiarId\?: string \| null, origin\?: SessionOrigin, initialControls\?: InitialCommandControls, initialAttachments\?: ChatAttachment\[\]\)/,
  "Imperative new-chat launches should carry a familiar id with the project root",
);

assert.match(
  chatList,
  /createChatProjectIndex\(projects\)[\s\S]*deriveChatListProjectGroups\(\s*filtered,\s*railSessions,\s*projects,\s*projectIndex,\s*projectOverrides/,
  "ChatList should group from the live project registry through its shared index, with Cave-local project overrides applied",
);

assert.match(
  chatList,
  /function chatDate\(iso: string, prefs: DateTimePrefs\): string/,
  "ChatList should expose an absolute chat date formatter (pref-aware) for visible metadata",
);

assert.match(
  chatList,
  /\{rel\}[\s\S]*\{chatDate\(s\.updated_at, dtPrefs\)\}/,
  "Chat rows should show the absolute date next to the relative updated age",
);

assert.match(
  chatList,
  /defaultFamiliarId/,
  "Project group launch should carry the latest familiar for that working directory",
);

assert.match(
  workspace,
  /normalizeGitHubTasks/,
  "Workspace should normalize GitHub task context when refreshing sessions",
);
assert.match(
  githubTaskContext,
  /pullRequest: session\.pullRequest \?\? \{[\s\S]*number: task\.prNumber[\s\S]*state: task\.status/,
  "GitHub task context should attach linked PR number and state without replacing server-enriched state",
);
assert.match(
  workspace,
  /attachGitHubTaskContext\(visibleBaseSessions, tasks\)/,
  "Workspace should apply the extracted GitHub task context when refreshing sessions",
);
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void loadGitHubTasks\(\), GITHUB_TASKS_POLL_MS/,
  "Workspace refreshes GitHub task context on its dedicated slow cadence",
);
assert.doesNotMatch(
  workspace,
  /const loadSessions = useCallback[\s\S]*?fetch\("\/api\/github\/tasks"/,
  "The four-second session poll must not fetch GitHub tasks",
);
assert.match(
  workspace,
  /startedDuringForcedRefresh[\s\S]*?forceEpoch !== loadGitHubTasksForceEpochRef\.current/,
  "A scheduled read cannot supersede an explicit GitHub task refresh",
);

console.log("chat-all-familiars-project-list.test.ts: ok");
