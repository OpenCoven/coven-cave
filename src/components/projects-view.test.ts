// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectsView = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");

assert.match(projectsView, /export function ProjectsView/, "ProjectsView should export the workspace surface");
assert.match(projectsView, /useProjects\(\)/, "ProjectsView should use the live projects hook");
assert.match(projectsView, /createProject\(name, root\)/, "ProjectsView should create projects through the hook");
assert.match(projectsView, /onRename=\{renameProject\}/, "ProjectsView should wire inline rename");
assert.match(projectsView, /onUpdateRoot=\{updateRoot\}/, "ProjectsView should wire root updates");
assert.match(projectsView, /onDelete=\{deleteProject\}/, "ProjectsView should wire deletion");
assert.match(projectsView, /onNewChat\?\.?\(project\.root\)/, "Project rows should start chats with the selected project root");
assert.match(projectsView, /chatCounts\.get\(normalizeProjectRoot\(project\.root\)\)/, "Project rows should count chats by normalized project root");
assert.match(projectsView, /Loading projects\.\.\./, "ProjectsView should expose loading feedback");

assert.match(workspaceMode, /\| "projects"/, "WorkspaceMode should include projects");
assert.match(workspace, /import \{ ProjectsView \} from "@\/components\/projects-view"/, "Workspace should import ProjectsView");
assert.match(workspace, /projects: "Projects"/, "Workspace h1 title map should cover projects mode");
assert.match(workspace, /case "\/projects":[\s\S]*?setMode\("projects"\)/, "/projects slash command should open the Projects workspace");
assert.match(workspace, /mode === "projects" \? \([\s\S]*?<ProjectsView[\s\S]*?sessions=\{sessions\}/, "Workspace should render ProjectsView for projects mode");

assert.match(sidebar, /\| "projects"/, "Sidebar mode union should include projects");
assert.match(sidebar, /\{ id: "projects", label: "Projects", iconName: "ph:folders-bold", group: "tools"/, "Sidebar should expose Projects in Tools");

for (const icon of [
  "ph:folders-bold",
  "ph:folder-open-bold",
  "ph:folder-simple-dashed",
  "ph:chat-circle-dots-bold",
  "ph:trash-bold",
  "ph:circle-notch-bold",
]) {
  assert.match(iconSource, new RegExp(`"${icon}"`), `${icon} should be in the icon allowlist`);
}

console.log("projects-view.test.ts: ok");
