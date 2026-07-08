// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// workspace-sidebar.tsx feature assertions
assert.match(workspaceSidebar, /deriveChatProjectGroups\(applyProjectOverrides/, "should group by project with overrides");
assert.match(workspaceSidebar, /handleRegister/, "should offer register-as-project for unregistered roots");
assert.match(workspaceSidebar, /Register \$\{label\} as a project/, "register label must be accessible");
assert.match(workspaceSidebar, /deriveChatRecencyBuckets\(/, "should derive time buckets for Recent view");
assert.match(workspaceSidebar, /Organize sidebar/, "should expose Organize sidebar menu");
assert.match(workspaceSidebar, /readChatSidebarView\(\)/, "organize mode should hydrate from persisted pref");
assert.match(workspaceSidebar, /relativeTime\(iso, Date\.now\(\), "bare"\)/, 'row times should use bare density');
assert.ok((workspaceSidebar.match(/<ThreadRow/g) ?? []).length >= 2, "both view branches should render ThreadRow");
assert.match(workspaceSidebar, /const sessionProjectById = useMemo\(\(\) => \{[\s\S]*?for \(const group of groups\)/, "recent-row project lookup derives from override-aware groups");
assert.match(workspaceSidebar, /indent="flat"\s*\n\s*project=\{sessionProjectById\.get\(session\.id\) \?\? null\}/, "recent rows pass project identity");
assert.match(workspaceSidebar, /cnav__thread-proj[\s\S]*?<ProjectAvatar name=\{project\.name\} root=\{project\.root\} size="sm"/, "renders ProjectAvatar tile in flat rows");
assert.match(workspaceSidebar, /<span className="sr-only">\{project\.name\}<\/span>/, "project name is announced for AT");
assert.doesNotMatch(workspaceSidebar, /cnav__footer|cnav__user-plan/, "should not render user plan footer");
// New features from code-sidebar
assert.match(workspaceSidebar, /cave:code-select-project/, "should broadcast code-select-project on project expand");
// One-row quick actions: New chat + the Scheduled/Plugins icon chips share a
// single row (no stacked mini-row), and the header hosts the familiar switcher.
assert.doesNotMatch(workspaceSidebar, /cnav__mini-row/, "the stacked mini-row is retired — quick actions are one row");
assert.match(workspaceSidebar, /aria-label=\{scheduledCount \? `Scheduled \(\$\{scheduledCount\}\)` : "Scheduled"\}/, "Scheduled shortcut is an icon chip with an accessible name");
assert.match(workspaceSidebar, /<header className="cnav__header">[\s\S]*?<FamiliarSwitcher/, "the sidebar header hosts the familiar switcher dropdown");
assert.doesNotMatch(workspaceSidebar, /cnav__title|cnav__eyebrow/, "the Chats/Recent title stack is retired in favor of the switcher header");
assert.match(workspaceSidebar, /ph:git-pull-request/, "should support PR glyph on thread rows");
assert.match(workspaceSidebar, /scheduledCount/, "should accept scheduledCount prop");
// Outer CSS classes for e2e compat
assert.match(workspaceSidebar, /workspace-sidebar chat-sidebar/, "outer div must include both CSS classes for e2e compat");
// chat-view wiring (unchanged — just verify it still exists)
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture failing project root on 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement add-project recovery");

console.log("workspace-sidebar-wiring.test.ts passed");
