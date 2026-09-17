import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const sheet = await read(`${iosRoot}/Views/LinkedTasksSheet.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const chat = await read(`${iosRoot}/Views/ChatView.swift`);
const tasks = await read(`${iosRoot}/Views/TasksView.swift`);

// Linked task assignment is two-stage: first the task must still belong to the
// chat's project context, then the familiar/search filters apply within that
// project-scoped set.
assert.match(
  sheet,
  /private var linked: \[BoardCard\] \{ app\.projectLinkedTasks\(for: thread\) \}/,
  "the linked section should hide tasks that no longer belong to this chat's project context",
);
assert.match(
  sheet,
  /private var assignable: \[BoardCard\] \{\s*app\.projectAssignableTasks\(for: thread, matching: query\)\s*\}/,
  "assignable tasks should come from the project-scoped AppModel helper",
);
assert.match(
  model,
  /func projectLinkedTasks\(for thread: ChatThread\) -> \[BoardCard\][\s\S]*context\.matches\(task: \$0, registeredProjects: projects\)/,
  "project-linked tasks should filter existing links back down to the thread's current project",
);
assert.match(
  model,
  /func projectAssignableTasks\(for thread: ChatThread, matching query: String\) -> \[BoardCard\]/,
  "AppModel should expose a dedicated project-scoped assignable-task helper",
);
assert.match(
  model,
  /let context = projectContext\(for: thread\)/,
  "assignable tasks should derive the thread's current project context first",
);
assert.match(
  model,
  /guard context\.matches\(task: card, registeredProjects: projects\) else \{ return false \}/,
  "tasks from another project must be rejected before familiar or text filtering",
);
assert.match(
  model,
  /let owner = normalizedFamiliarID\(card\.familiarId\)/,
  "the familiar filter should normalize the card owner before comparing it to the chat roster",
);
assert.match(
  model,
  /let belongsHere = owner == nil \|\| chatFamiliars\.contains\(owner!\)/,
  "after project scoping, a task is assignable only when unassigned or owned by one of the chat's familiars",
);
assert.match(
  model,
  /return trimmedQuery\.isEmpty \|\| card\.title\.lowercased\(\)\.contains\(trimmedQuery\)/,
  "the search query should still narrow the already project-and-familiar-scoped task set",
);
assert.match(
  chat,
  /if !app\.projectLinkedTasks\(for: thread\)\.isEmpty \{/,
  "chat should only advertise linked tasks that still belong to the active project scope",
);
assert.match(
  chat,
  /private var linkedGitHubContext: \(link: CardGitHubLink, url: URL\)\? \{[\s\S]*app\.projectLinkedTasks\(for: thread\)/,
  "linked GitHub context should come from the same project-scoped task set as the sheet",
);
assert.match(
  chat,
  /private var linkedContextStrip: some View \{[\s\S]*let cards = app\.projectLinkedTasks\(for: thread\)/,
  "linked task count and header should use the same project-scoped helper as the sheet",
);
assert.doesNotMatch(
  chat,
  /app\.linkedTasks\(for: thread\)/,
  "chat should not advertise out-of-scope linked tasks once project scoping is active",
);
assert.match(
  tasks,
  /let wasPresentingBoardDetail = boardDetail != nil[\s\S]{0,200}let consumesRequestedCard = card == nil[\s\S]{0,200}&& !wasPresentingBoardDetail[\s\S]{0,120}boardDetail = card[\s\S]{0,120}if consumesRequestedCard \{[\s\S]{0,80}app\.cardToOpen = nil/,
  "dismissing a manually opened compact detail should preserve a deferred cross-surface task intent",
);

console.log("ios-task-search-familiar-scope.test.mjs: ok");
