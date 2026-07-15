// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const chatProjectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

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
  /deriveChatProjectGroups\(applyProjectOverrides\(filtered, projectOverrides\), projects\)/,
  "ChatList should group from the live project registry, with Cave-local project overrides applied",
);

assert.match(
  chatList,
  /function chatDate\(iso: string, prefs: DateTimePrefs\): string/,
  "ChatList should expose an absolute chat date formatter (pref-aware) for visible metadata",
);

assert.match(
  chatList,
  /\{chatDate\(s\.updated_at, dtPrefs\)\}[\s\S]*\{rel\}/,
  "Chat rows should show the absolute date next to the relative updated age",
);

assert.match(
  chatList,
  /defaultFamiliarId/,
  "Project group launch should carry the latest familiar for that working directory",
);

assert.match(
  chatProjectSidebar,
  /onClick=\{\(\) => \{[\s\S]*onSelect\(key\);[\s\S]*onToggleExpanded\(key\);[\s\S]*\}\}[\s\S]*aria-expanded=\{expanded\}[\s\S]*className=\{\[[\s\S]*flex min-w-0 flex-1 items-center/,
  "Project rows should make the full label/count area the collapse trigger instead of only the caret",
);

assert.match(
  chatProjectSidebar,
  /onOpenProjectsTab\?: \(\) => void/,
  "Chat project rail should accept a Projects-tab jump callback",
);

assert.match(
  chatProjectSidebar,
  /aria-label="Open Projects tab"[\s\S]{0,180}onClick=\{openProjectsTab\}/,
  "Chat project rail should expose a keyboard-accessible Projects-tab button",
);

assert.match(
  chatProjectSidebar,
  /CHAT_OPEN_PROJECTS_EVENT/,
  "Chat project rail should know how to route the shortcut through the shared Projects event",
);

assert.match(
  chatProjectSidebar,
  /function openProjectsTab\(\) \{[\s\S]*?onOpenProjectsTab\(\);[\s\S]*?window\.dispatchEvent\(new CustomEvent\(CHAT_OPEN_PROJECTS_EVENT\)\);[\s\S]*?\}/,
  "Chat project rail should supply a Projects-tab fallback when the parent callback is absent",
);

assert.match(
  chatRouter,
  /onOpenProjectsTab=\{openProjectsTab\}/,
  "ChatRouter should pass the concrete Projects-tab handler to the rail",
);

assert.match(
  workspace,
  /normalizeGitHubTasks/,
  "Workspace should normalize GitHub task context when refreshing sessions",
);
assert.match(
  workspace,
  /pullRequest: session\.pullRequest \?\? \{[\s\S]*number: task\.prNumber[\s\S]*state: task\.status/,
  "Workspace should attach linked PR number and state to chat sessions (server-enriched PR state wins)",
);
assert.match(
  workspace,
  /const githubTasksPromise = fetch\("\/api\/github\/tasks"/,
  "Workspace polls GitHub task context because GitHub is visible by default",
);

console.log("chat-all-familiars-project-list.test.ts: ok");
