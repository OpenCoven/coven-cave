// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectsView = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");

assert.match(projectsView, /export function ProjectsView/, "ProjectsView should export the workspace surface");
assert.match(projectsView, /useProjects\(\{ familiarId: activeFamiliarId \}\)/, "ProjectsView should scope the live projects hook to the active familiar");
assert.match(projectsView, /createProject\(name, root\)/, "ProjectsView should create projects through the hook");
assert.match(projectsView, /onRename=\{renameProject\}/, "ProjectsView should wire inline rename");
assert.match(projectsView, /onUpdateRoot=\{updateRoot\}/, "ProjectsView should wire root updates");
assert.match(projectsView, /onDelete=\{deleteProject\}/, "ProjectsView should wire deletion");
assert.match(projectsView, /onNewChat\?\.?\(project\.root\)/, "Project rows should start chats with the selected project root");
assert.match(projectsView, /chats=\{chatsByRoot\.get\(normalizeProjectRoot\(project\.root\)\)/, "Project rows receive their chats grouped by normalized project root");
// Nested chats are draggable: reorder within a project, move across projects.
assert.match(projectsView, /<DndContext[\s\S]{0,120}onDragEnd=\{handleDragEnd\}/, "Projects view wraps the cards in a DndContext");
assert.match(projectsView, /function ProjectChatRow/, "chats render as sortable rows");
// The chat row is a div that toggles role button↔checkbox with select mode; keep
// it keyboard-accessible — both Enter and Space activate (ARIA pattern) and it
// shows a visible focus ring. In select mode activate toggles selection.
assert.match(
  projectsView,
  /role=\{selectMode \? "checkbox" : "button"\}/,
  "the chat row is a button normally and a checkbox in select mode",
);
assert.match(
  projectsView,
  /const activate = \(\) => \(selectMode \? onToggleSelect\(session\.id\) : onOpen\(\)\)/,
  "activate toggles selection in select mode, otherwise opens the chat",
);
assert.match(
  projectsView,
  /e\.key === "Enter" \|\| e\.key === " "[\s\S]{0,120}?activate\(\)/,
  "the chat row activates on both Enter and Space",
);
assert.match(
  projectsView,
  /role=\{selectMode \? "checkbox" : "button"\}[\s\S]{0,900}?className=\{?["`]focus-ring /,
  "the chat row has a visible keyboard focus ring",
);

// Bulk multiselect: a Select toggle puts the card into select mode, each chat
// row becomes a checkbox, and a toolbar deletes all selected chats at once.
assert.match(
  projectsView,
  /const \[selectMode, setSelectMode\] = useState\(false\)/,
  "each project card tracks its own select mode",
);
assert.match(
  projectsView,
  /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/,
  "selected chat ids are held in a Set",
);
assert.match(
  projectsView,
  /onDeleteSessions: \(sessionIds: string\[\]\) => Promise<void>/,
  "project rows receive a bulk-delete callback",
);
assert.match(
  projectsView,
  /const handleDeleteSessions = async \(sessionIds: string\[\]\)/,
  "ProjectsView implements a bulk-delete handler",
);
assert.match(
  projectsView,
  /Promise\.all\(sessionIds\.map\(\(id\) => deleteOneSession\(id\)\)\)/,
  "bulk delete runs the per-chat deletes in parallel",
);
assert.match(
  projectsView,
  /results\.some\(Boolean\)\) onSessionsChanged/,
  "bulk delete refetches once if any chat was deleted",
);
assert.match(
  projectsView,
  /\{allVisibleSelected \? "Clear" : "Select all"\}/,
  "the select toolbar offers select-all / clear",
);
assert.match(
  projectsView,
  /\{selectedIds\.size\} selected/,
  "the toolbar shows how many chats are selected",
);
assert.match(
  projectsView,
  /onDeleteSessions=\{handleDeleteSessions\}/,
  "the bulk-delete handler is wired into project rows",
);
// Selection resets whenever the card's chat set changes, so deleted ids never linger.
assert.match(
  projectsView,
  /const chatIdKey = chats\.map\(\(c\) => c\.id\)\.join\(","\)/,
  "selection is keyed to the current chat ids",
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
  "ph:list-checks-bold",
  "ph:check-bold",
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
// rounded card box, so the Projects tab reads as a flat list. Vertical padding
// is density-driven (comfortable vs compact) rather than a fixed py-3.
assert.doesNotMatch(
  projectsView,
  /group rounded-lg border bg-\[var\(--bg-raised\)\]/,
  "Project rows should not be bordered rounded card boxes",
);
assert.match(
  projectsView,
  /group border-b border-\[var\(--border-hairline\)\] px-2 transition-colors/,
  "Project rows should be flat rows separated by a hairline divider",
);
assert.match(
  projectsView,
  /density === "compact" \? "py-1\.5" : "py-3"/,
  "project row vertical padding follows the density preference",
);

// Expand/collapse + density are persisted UI state (the surface remembers how
// you left it) via the shared hook; expansion is keyed per project id.
assert.match(
  projectsView,
  /import \{ useProjectsUiState \} from "@\/lib\/projects\/use-projects-ui-state"/,
  "uses the persisted Projects UI-state hook",
);
assert.match(
  projectsView,
  /const \{ density, setDensity, isExpanded, setExpanded \} = useProjectsUiState\(\)/,
  "ProjectsView reads density + expand state from the hook",
);
assert.match(
  projectsView,
  /expanded=\{isExpanded\(project\.id\)\}/,
  "each project card's expanded state comes from persisted UI state",
);
assert.match(
  projectsView,
  /onSetExpanded=\{\(next\) => setExpanded\(project\.id, next\)\}/,
  "toggling a card persists its expanded state by project id",
);
assert.match(projectsView, /aria-expanded=\{expanded\}/, "the disclosure control reports expanded state");
assert.match(projectsView, /\{expanded \? \(/, "path + sessions render only when the row is expanded");
assert.doesNotMatch(projectsView, /defaultExpanded/, "expansion is controlled by persisted state, not a defaultExpanded flag");

// A density toggle lets the user choose comfortable vs compact list spacing.
assert.match(projectsView, /aria-label="List density"/, "there is a labeled density toggle");
assert.match(projectsView, /aria-pressed=\{density === opt\.value\}/, "the density toggle reflects the active option");

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

// Phase 2 — rich rows: each session row leads with a derived status glyph
// (running spinner / failed / task / chat dot), drops the "Task: " text prefix
// in favor of that glyph, and carries trailing metadata (model · time · diff).
assert.match(
  projectsView,
  /import \{ sessionGlyph, glyphToneClass, stripTaskPrefix \} from "@\/lib\/projects\/session-glyph"/,
  "session rows use the pure glyph helper",
);
assert.match(projectsView, /const glyph = sessionGlyph\(session\)/, "each chat row derives its leading glyph");
assert.match(projectsView, /stripTaskPrefix\(/, 'the "Task: " label is stripped (shown as a glyph instead)');
assert.match(projectsView, /glyph\.spin \? "animate-spin"/, "a running glyph spins");
assert.match(projectsView, /import \{ RelativeTime \} from "@\/components\/ui\/relative-time"/, "rows use the RelativeTime primitive (exact-time tooltip)");
assert.match(projectsView, /<RelativeTime iso=\{session\.updated_at\}/, "every session row shows a consistent relative timestamp");
assert.match(projectsView, /import \{ modelIcon, modelLabel \} from "@\/lib\/model-label"/, "rows render a model chip via the shared model-label helper");
assert.match(projectsView, /modelLabel\(session\.model\)/, "the model chip shows the shortened model label");

// Project headers carry a glanceable stat line (running · tasks · sessions)
// derived from the pure projectStats helper.
assert.match(projectsView, /import \{ projectStats \} from "@\/lib\/projects\/project-stats"/, "headers use the pure stats helper");
assert.match(projectsView, /const stats = projectStats\(chats\)/, "the header derives running/task counts");
assert.match(projectsView, /stats\.running > 0 \?/, "the stat line shows a running count when any session is running");
assert.match(projectsView, /stats\.tasks > 0 \?/, "the stat line shows a task count when the project has tasks");

// The project folder icon is tinted by the project's color (when set).
assert.match(projectsView, /color: project\.color \|\| "var\(--accent-presence\)"/, "the folder icon takes the project color, falling back to the accent");

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

// Phase 3 — keyboard navigation: a roving tabindex (WAI-ARIA) over the
// flattened list of project headers + their visible session rows. ↑/↓ + Home/End
// move focus (shared hook); →/← expand/collapse a focused header.
assert.match(
  projectsView,
  /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/,
  "reuses the shared roving-tabindex hook",
);
assert.match(
  projectsView,
  /useRovingTabIndex\(\{ containerRef: listRef, itemSelector: "\[data-proj-nav\]", orientation: "vertical" \}\)/,
  "rove vertically over [data-proj-nav] items in the list container",
);
assert.match(projectsView, /<main ref=\{listRef\}/, "the scroll container hosts the roving keydown handler");
// Both the project header disclosure and each session row are nav stops.
assert.ok(
  (projectsView.match(/data-proj-nav/g) ?? []).length >= 2,
  "header disclosure + session rows are both tagged as rove stops",
);
assert.match(
  projectsView,
  /e\.key === "ArrowRight" && !expanded[\s\S]{0,80}?setExpanded\(true\)/,
  "ArrowRight expands a focused, collapsed project header",
);
assert.match(
  projectsView,
  /e\.key === "ArrowLeft" && expanded[\s\S]{0,80}?setExpanded\(false\)/,
  "ArrowLeft collapses a focused, expanded project header",
);
// Touch: row actions (drag + delete) stay visible on coarse pointers, where
// there is no hover to reveal them.
assert.match(
  projectsView,
  /\[@media\(pointer:coarse\)\]:opacity-100/,
  "row actions stay visible on touch/coarse-pointer devices",
);

console.log("projects-view.test.ts: ok");
