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
assert.match(projectsView, /chats=\{chatsByRoot\.get\(normalizeProjectRoot\(project\.root\)\)/, "Project rows receive their chats grouped by normalized project root");
// Nested chats are draggable: reorder within a project, move across projects.
assert.match(projectsView, /<DndContext[\s\S]{0,120}onDragEnd=\{handleDragEnd\}/, "Projects view wraps the cards in a DndContext");
assert.match(projectsView, /function ProjectChatRow/, "chats render as sortable rows");
// The chat row is a div role="button"; keep it keyboard-accessible — both Enter
// and Space activate (ARIA button pattern) and it shows a visible focus ring.
assert.match(
  projectsView,
  /role="button"[\s\S]{0,400}?e\.key === "Enter" \|\| e\.key === " "[\s\S]{0,120}?onOpen\(\)/,
  "the chat row activates on both Enter and Space",
);
assert.match(
  projectsView,
  /role="button"[\s\S]{0,700}?className="focus-ring /,
  "the chat row has a visible keyboard focus ring",
);
assert.match(projectsView, /useDroppable\(\{\s*id: `pcard:/, "project cards are drop targets");
assert.match(projectsView, /applyProjectOverrides\(sessions, projectOverrides\)/, "chats are grouped with Cave-local project overrides applied");
assert.match(projectsView, /setProjectOverride\(activeId, targetRoot\)/, "cross-project drop moves the chat via an override");
assert.match(projectsView, /mergeVisibleOrder[\s\S]{0,120}writeSessionOrder/, "same-project drop reorders via the shared manual order");
assert.match(projectsView, /cave:agents-open-session/, "clicking a chat opens it via the agents-open-session event");
// Long chat lists are capped with a Show all / Show less toggle.
assert.match(projectsView, /const CHAT_CAP =/, "nested chat lists are capped");
assert.match(projectsView, /chats\.slice\(0, CHAT_CAP\)/, "only the first CHAT_CAP chats render until expanded");
assert.match(projectsView, /Show all \$\{chats\.length\} sessions/, "a toggle reveals the rest");
assert.match(projectsView, /import \{ EmptyState \} from "@\/components\/ui\/empty-state"/, "uses EmptyState primitive");
assert.match(projectsView, /import \{ ErrorState \} from "@\/components\/ui\/error-state"/, "uses ErrorState primitive");
assert.match(projectsView, /import \{ SkeletonRows \} from "@\/components\/ui\/skeleton"/, "uses SkeletonRows for first load");
assert.match(projectsView, /<SkeletonRows/, "first load renders skeleton rows");
assert.match(projectsView, /<EmptyState/, "empty state renders EmptyState");
assert.match(projectsView, /<ErrorState/, "error renders ErrorState");
assert.doesNotMatch(projectsView, /Loading projects\.\.\./, "bare loading text replaced by skeletons");
assert.match(projectsView, /error && projects\.length === 0 \?/, "full-screen error only when there is no list to fall back to");

const chatTabEvents = readFileSync(new URL("../lib/chat-tab-events.ts", import.meta.url), "utf8");

assert.doesNotMatch(workspaceMode, /\| "projects"/, "projects is no longer a top-level workspace mode");
assert.doesNotMatch(workspace, /import \{ ProjectsView \} from "@\/components\/projects-view"/, "workspace no longer renders ProjectsView directly");
assert.doesNotMatch(workspace, /mode === "projects" \?/, "workspace has no projects render branch");
assert.match(chatTabEvents, /CHAT_OPEN_PROJECTS_EVENT/, "reroute event exists");
assert.match(workspace, /case "\/projects":[\s\S]*?setMode\("chat"\)[\s\S]*?CHAT_OPEN_PROJECTS_EVENT/, "/projects reroutes: setMode(chat) + chat-open-projects event");

assert.doesNotMatch(sidebar, /id: "projects"/, "Sidebar no longer shows a Projects entry — Projects lives only in the Chat tab");
assert.doesNotMatch(sidebar, /CHAT_OPEN_PROJECTS_EVENT/, "Sidebar no longer imports the chat-tab reroute event (entry removed)");

for (const icon of [
  "ph:folders-bold",
  "ph:folder-open-bold",
  "ph:folder-simple-dashed",
  "ph:chat-circle-dots-bold",
  "ph:terminal-window-bold",
  "ph:trash-bold",
  "ph:pencil-simple-bold",
]) {
  assert.match(iconSource, new RegExp(`"${icon}"`), `${icon} should be in the icon allowlist`);
}

// Row actions must stay keyboard-reachable (focus-within), never display:none.
assert.match(projectsView, /group-hover:opacity-100/, "row actions reveal on hover");
assert.match(projectsView, /group-focus-within:opacity-100/, "row actions also reveal on keyboard focus");
assert.match(projectsView, /aria-label=\{`New session in /, "new-session action is labeled per project");
// Terminal action launches a terminal in the project's cwd, then jumps to the surface.
assert.match(projectsView, /aria-label=\{`Open terminal in \$\{project\.name\}`\}/, "terminal action labeled per project");
assert.match(
  projectsView,
  /new CustomEvent\("cave:terminal-open", \{ detail: \{ projectRoot: project\.root \} \}\)/,
  "terminal action launches a terminal scoped to the project's cwd",
);
assert.match(
  projectsView,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "terminal" \} \}\)/,
  "terminal action brings the Terminal surface to the foreground",
);
assert.match(projectsView, /aria-label=\{`Rename \$\{project\.name\}`\}/, "rename action labeled per project");
assert.match(projectsView, /aria-label=\{`Delete \$\{project\.name\}`\}/, "delete action labeled per project");
assert.match(projectsView, /motion-reduce:transition-none/, "reveal respects reduced motion");

// The "New project" inline form closes on Escape (parity with its Cancel button + the row inline-edits).
assert.match(
  projectsView,
  /onSubmit=\{handleCreate\}[\s\S]{0,200}?onKeyDown[\s\S]{0,120}?"Escape"[\s\S]{0,80}?setShowForm\(false\)/,
  "new-project form closes on Escape",
);

// Project rows render flat — a bottom hairline divider instead of a bordered
// rounded card box, so the Projects tab reads as a flat list.
assert.doesNotMatch(
  projectsView,
  /group rounded-lg border bg-\[var\(--bg-raised\)\]/,
  "Project rows should not be bordered rounded card boxes",
);
assert.match(
  projectsView,
  /group border-b border-\[var\(--border-hairline\)\] px-2 py-3/,
  "Project rows should be flat rows separated by a hairline divider",
);

// Projects collapse to one scannable row and expand to reveal the path +
// sessions; every project starts collapsed.
assert.match(projectsView, /const \[expanded, setExpanded\] = useState\(false\)/, "each project row starts collapsed");
assert.match(projectsView, /aria-expanded=\{expanded\}/, "the disclosure control reports expanded state");
assert.match(projectsView, /\{expanded \? \(/, "path + sessions render only when the row is expanded");
assert.doesNotMatch(projectsView, /defaultExpanded/, "no project auto-expands — the list stays a flat, scannable set of rows");

// Projects are ordered by most-recent session activity, not API order.
assert.match(projectsView, /const sortedProjects = useMemo/, "projects are sorted before rendering");
assert.match(projectsView, /function lastActiveMs/, "recency is derived from each project's latest session");

// A filter box narrows the (sorted) list by name or path; the filtered list
// drives the render and an empty result shows a no-match message.
assert.match(projectsView, /const visibleProjects = useMemo/, "projects are filtered after sorting");
assert.match(
  projectsView,
  /p\.name\.toLowerCase\(\)\.includes\(q\) \|\| p\.root\.toLowerCase\(\)\.includes\(q\)/,
  "the filter matches on project name or path",
);
assert.match(projectsView, /visibleProjects\.map\(\(project\)/, "the filtered list drives the render");
assert.match(projectsView, /aria-label="Filter projects"/, "there is a labeled filter input");
assert.match(projectsView, /No projects match/, "a no-match message shows when the filter excludes everything");

// Each project row carries a glanceable status dot: accent when a session is
// running, danger when the most-recent session failed.
assert.match(
  projectsView,
  /const projectStatus = deriveProjectStatus\(chats\)/,
  "row status comes from the shared deriveProjectStatus helper",
);
assert.match(projectsView, /import \{ deriveProjectStatus \} from "@\/lib\/project-status"/, "imports the status helper");
assert.match(projectsView, /projectStatus \? \(/, "the status dot renders only when running or failed");

// Paths are home-collapsed + truncated so the identical absolute prefix stops
// dominating; the full path stays in the title and the editor.
assert.match(projectsView, /\{shortRoot\(project\.root\)\}/, "the displayed path is shortened");
assert.match(projectsView, /title=\{project\.root\}/, "the full path remains available via the title");
assert.match(projectsView, /relativeTime\(/, "each row shows a relative last-active label (shared relative-time helper)");

// A project card expands + scrolls into view when the command palette's
// "Open project" navigation fires CHAT_FOCUS_PROJECT_EVENT for its root.
assert.match(
  projectsView,
  /addEventListener\(CHAT_FOCUS_PROJECT_EVENT/,
  "project cards listen for the focus-project event",
);
assert.match(
  projectsView,
  /normalizeProjectRoot\(detail\.root\) !== cardKey[\s\S]{0,120}?setExpanded\(true\)/,
  "a matching focus event expands the card",
);
assert.match(
  projectsView,
  /id=\{`pcard-el:\$\{cardKey\}`\}/,
  "the card carries a stable id so it can be scrolled into view",
);

console.log("projects-view.test.ts: ok");
