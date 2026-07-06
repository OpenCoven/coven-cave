// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Projects surface is a master-detail hub split into a small component
// tree (shell + project-list + project-detail + session-row + shared helpers).
// These source-text assertions run against the COMBINED source, so each keeps
// verifying behavior regardless of which file a given piece now lives in.
const projectsViewSource = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const projectListSource = readFileSync(new URL("./projects/project-list.tsx", import.meta.url), "utf8");
const projectDetailSource = readFileSync(new URL("./projects/project-detail.tsx", import.meta.url), "utf8");
const sessionRowSource = readFileSync(new URL("./projects/session-row.tsx", import.meta.url), "utf8");
const projectsViewToolbar = projectsViewSource.slice(
  projectsViewSource.indexOf("<header"),
  projectsViewSource.indexOf("<main"),
);
const projectsView = [
  projectsViewSource,
  projectListSource,
  projectDetailSource,
  sessionRowSource,
  readFileSync(new URL("./projects/projects-shared.ts", import.meta.url), "utf8"),
].join("\n\n");
const projectsCss = readFileSync(new URL("../styles/projects.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatProjectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(projectsView, /export function ProjectsView/, "ProjectsView should export the workspace surface");
assert.match(projectsView, /useProjects\(\{ familiarId: activeFamiliarId \}\)/, "ProjectsView should scope the live projects hook to the active familiar");
assert.match(projectsView, /createProject\(name, root\)/, "ProjectsView should create projects through the hook");
assert.match(
  projectsView,
  /addChatProject\(\{[\s\S]{0,160}?familiarId: activeFamiliarId,[\s\S]{0,160}?existingProjectId: project\.id/,
  "Creating a project should also grant it to the scoped familiar — register alone left it 403ing in chat",
);
assert.match(projectsView, /const rootInputRef = useRef<HTMLInputElement>\(null\)/, "new-project flow keeps a root input ref for quick focus");
assert.match(projectsView, /function openCreateProjectForm/, "ProjectsView should centralize opening the quick-create form");
assert.match(projectsView, /rootInputRef\.current\?\.focus\(\)/, "quick-create can focus the path field directly");

// ── Master-detail: persisted selection replaces per-card expansion ────────────
assert.match(
  projectsView,
  /import \{\s*PROJECTS_SELECTED_KEY,\s*parseStoredProjectId,\s*resolveSelectedProjectId,?\s*\} from "@\/lib\/projects\/selected-project"/,
  "selection persistence goes through the pure selected-project helpers",
);
assert.match(
  projectsView,
  /parseStoredProjectId\(window\.localStorage\.getItem\(PROJECTS_SELECTED_KEY\)\)/,
  "the stored selection hydrates in an effect (SSR-safe)",
);
assert.match(
  projectsView,
  /window\.localStorage\.setItem\(PROJECTS_SELECTED_KEY, id\)/,
  "selecting a project persists the id",
);
assert.match(
  projectsView,
  /resolveSelectedProjectId\(\s*storedSelection,/,
  "the render-time selection resolves stale/deleted ids to the activity default",
);
assert.doesNotMatch(projectsView, /useProjectsUiState|isExpanded\(project\.id\)|PROJECTS_EXPANDED_KEY/, "per-card expansion state is gone — selection replaced it");
assert.doesNotMatch(projectsView, /ProjectsDensity|setDensity/, "the density toggle is gone — list and detail each have one style");

// ── Master-detail: dnd is gone; the manual order is still read ────────────────
assert.doesNotMatch(projectsView, /@dnd-kit/, "the Projects hub no longer ships drag-and-drop");
assert.match(projectsView, /applyManualOrder\(list, order\)/, "the chat rail's manual session order still shapes the detail list");
assert.doesNotMatch(projectsView, /writeSessionOrder/, "this surface no longer writes the shared session order (the chat rail owns dnd)");
assert.match(projectsView, /Move to project…/, "the session context menu still moves chats across projects");

// ── Hub layout + narrow collapse ─────────────────────────────────────────────
assert.match(projectsViewSource, /import "@\/styles\/projects\.css"/, "ProjectsView imports its own stylesheet so the hub is always styled");
assert.doesNotMatch(projectsViewSource, /styles\/board\.css/, "Projects no longer leans on board.css");
assert.match(projectsViewSource, /<div className="projects-hub" data-pane=\{pane\}>/, "the hub renders list + detail panes, with data-pane driving the narrow collapse");
assert.match(projectsCss, /container:\s*projects \/ inline-size/, "the hub is a size container so the collapse follows the pane, not the viewport");
assert.match(projectsCss, /@container projects \(max-width: 640px\)/, "narrow hubs collapse to a single pane");
assert.match(projectsCss, /\.projects-hub\[data-pane="detail"\] \.projects-hub__list \{ display: none; \}/, "in detail pane mode the list hides");
assert.match(projectDetailSource, /aria-label="Back to project list"/, "the narrow detail pane has a labeled back affordance");
assert.match(projectsView, /onBack=\{\(\) => setPane\("list"\)\}/, "back returns to the list pane");

// ── List pane rows ───────────────────────────────────────────────────────────
assert.match(projectListSource, /role="listbox" aria-label="Projects"/, "the list pane is a labeled listbox");
assert.match(projectListSource, /role="option"[\s\S]{0,80}?aria-selected=\{selected\}/, "each project row is an option reporting selection");
assert.match(projectsView, /selectedId=\{selectedProjectId\}/, "the list highlights the hub's selection");
assert.match(projectsView, /onSelect=\{selectProject\}/, "clicking a row selects it");
assert.match(
  projectListSource,
  /e\.key === "Enter" \|\| e\.key === " " \|\| e\.key === "ArrowRight"/,
  "rows select on Enter/Space and reveal detail on ArrowRight",
);

// ── Detail pane wiring ───────────────────────────────────────────────────────
assert.match(projectsView, /onRename=\{renameProject\}/, "ProjectsView should wire inline rename");
assert.match(projectsView, /onUpdateRoot=\{updateRoot\}/, "ProjectsView should wire root updates");
assert.match(projectsView, /onDelete=\{deleteProject\}/, "ProjectsView should wire deletion");
assert.match(projectsView, /onNewChat\?\.?\(project\.root\)/, "the detail pane starts chats with the selected project root");
assert.match(projectsView, /chats=\{chatsByRoot\.get\(normalizeProjectRoot\(selectedProject\.root\)\)/, "the detail pane receives its chats grouped by normalized project root");
assert.match(projectsView, /<ProjectDetail\s+key=\{selectedProject\.id\}/, "the detail pane is keyed by project so edit drafts never leak across selections");
// New-chat is the follow-up action after create — the detail pane replaces the
// old "Created X" banner.
assert.match(projectsView, /selectProject\(project\.id\)/, "creating a project selects it (detail pane is the follow-up surface)");
assert.doesNotMatch(projectsView, /createdProject/, "the created-project banner is gone");

// ── Sessions in the detail pane ──────────────────────────────────────────────
assert.match(projectsView, /function ProjectChatRow/, "chats render as rows in the detail pane");
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

// Bulk multiselect: a Select toggle puts the section into select mode, each
// chat row becomes a checkbox, and a toolbar deletes all selected chats.
assert.match(projectsView, /const \[selectMode, setSelectMode\] = useState\(false\)/, "the detail pane tracks select mode");
assert.match(projectsView, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/, "selected chat ids are held in a Set");
assert.match(projectsView, /onDeleteSessions: \(sessionIds: string\[\]\) => Promise<void>/, "the detail pane receives a bulk-delete callback");
assert.match(projectsView, /const handleDeleteSessions = async \(sessionIds: string\[\]\)/, "ProjectsView implements a bulk-delete handler");
assert.match(
  projectsView,
  /Promise\.all\(removed\.map\(\(s\) => deleteOneSession\(s\.id\)\)\)/,
  "bulk delete runs the per-chat deletes in parallel",
);
assert.match(projectsView, /results\.some\(Boolean\)\) onSessionsChanged/, "bulk delete refetches once if any chat was deleted");
// Bulk delete is deferred + undoable (shared useUndoDelete + UndoToast).
assert.match(projectsView, /useUndoDelete<SessionRow\[\]>\(\)/, "bulk delete routes through useUndoDelete");
assert.match(projectsView, /scheduleSessionDelete\(\s*removed,/, "the batch is scheduled through the undo window");
assert.match(projectsView, /const hidden = new Set\(\(deletePending\?\.item \?\? \[\]\)\.map\(\(s\) => s\.id\)\)/, "pending-deleted chats are hidden until commit");
assert.match(projectsView, /onUndo=\{undoSessionDelete\}[\s\S]{0,40}onDismiss=\{commitSessionDelete\}/, "an undo toast restores the batch");
assert.match(projectsView, /\{allVisibleSelected \? "Clear" : "Select all"\}/, "the select toolbar offers select-all / clear");
assert.match(projectsView, /\{selectedIds\.size\} selected/, "the toolbar shows how many chats are selected");
assert.match(projectsView, /onDeleteSessions=\{handleDeleteSessions\}/, "the bulk-delete handler is wired into the detail pane");
// Selection resets whenever the chat set or selected project changes.
assert.match(
  projectsView,
  /const chatIdKey = `\$\{project\.id\}:\$\{chats\.map\(\(c\) => c\.id\)\.join\(","\)\}`/,
  "selection is keyed to the current project + chat ids",
);
assert.match(projectsView, /applyProjectOverrides\(visible, projectOverrides\)/, "chats are grouped with Cave-local project overrides applied (after hiding pending-deleted)");
assert.match(projectsView, /setProjectOverride\(sessionId, targetRoot\)/, "cross-project move applies a Cave-local project override");
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
assert.match(chatProjectSidebar, /CHAT_OPEN_PROJECTS_EVENT/, "Chat rail can jump to the dedicated Projects tab through the shared reroute event");

for (const icon of [
  "ph:folders-bold",
  "ph:folder-open-bold",
  "ph:folder-simple-dashed",
  "ph:chat-circle-dots-bold",
  "ph:trash-bold",
  "ph:pencil-simple-bold",
  "ph:list-checks-bold",
  "ph:check-bold",
]) {
  assert.match(iconSource, new RegExp(`"${icon}"`), `${icon} should be in the icon allowlist`);
}

assert.match(projectsView, /aria-label=\{`New session in /, "new-session action is labeled per project");
assert.doesNotMatch(projectsView, /Open terminal|cave:terminal-open|mode: "terminal"/, "project actions stay focused on chat actions");
assert.match(projectsView, /aria-label=\{`Rename \$\{project\.name\}`\}/, "rename action labeled per project");
assert.match(projectsView, /aria-label=\{`Delete \$\{project\.name\}`\}/, "delete action labeled per project");

// The "New project" inline form closes on Escape (parity with its Cancel button + inline edits).
assert.match(
  projectsView,
  /onSubmit=\{handleCreate\}[\s\S]{0,200}?onKeyDown[\s\S]{0,120}?"Escape"[\s\S]{0,80}?setShowForm\(false\)/,
  "new-project form closes on Escape",
);
assert.match(projectsViewSource, /import \{ Button \}/, "Projects toolbar/form actions use the shared Button primitive");
assert.doesNotMatch(projectsViewToolbar, /<button\b/, "Projects toolbar/form should not hand-roll button controls");
assert.doesNotMatch(
  projectsViewToolbar,
  /rounded-md|rounded-lg|rounded(?=\s|")/,
  "Projects toolbar/form controls should use radius tokens instead of hard-coded radii",
);
assert.doesNotMatch(projectsViewSource, /<button\b/, "ProjectsView container should not hand-roll button controls");
assert.doesNotMatch(
  projectsViewSource,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "ProjectsView container should use tokenized radii instead of hard-coded rounded classes",
);
assert.match(projectDetailSource, /import \{ Button \}/, "detail pane actions use the shared Button primitive");
assert.doesNotMatch(projectDetailSource, /<button\b/, "detail pane should not hand-roll button controls");
assert.doesNotMatch(
  projectDetailSource,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "detail pane controls should use tokenized radii instead of hard-coded rounded classes",
);
assert.doesNotMatch(projectListSource, /<button\b/, "list rows should not hand-roll button controls");
assert.match(sessionRowSource, /import \{ Button \}/, "session row actions use the shared Button primitive");
assert.doesNotMatch(sessionRowSource, /<button\b/, "session row should not hand-roll button controls");
assert.doesNotMatch(
  sessionRowSource,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "session row controls should use tokenized radii instead of hard-coded rounded classes",
);

// Projects are ordered alphabetically by project name/root, not API order or
// most-recent session activity. Sessions inside the detail pane still keep
// their own recency/manual ordering.
assert.match(projectsView, /const sortedProjects = useMemo/, "projects are sorted before rendering");
assert.match(projectsView, /sortProjectsAlphabetically\(projects\)/, "Projects tab uses the shared alphabetical project order");
assert.doesNotMatch(projectsView, /b\.score - a\.score/, "Projects tab must not sort project rows by session recency");

// A filter box narrows the (sorted) list by name or path; the filtered list
// drives the list pane and an empty result shows a no-match message.
assert.match(projectsView, /const visibleProjects = useMemo/, "projects are filtered after sorting");
assert.match(
  projectsView,
  /p\.name\.toLowerCase\(\)\.includes\(q\) \|\| p\.root\.toLowerCase\(\)\.includes\(q\)/,
  "the filter matches on project name or path",
);
assert.match(projectsView, /projects=\{visibleProjects\}/, "the filtered list drives the list pane");
assert.match(projectsView, /aria-label="Filter projects"/, "there is a labeled filter input");
assert.match(projectsView, /No projects match/, "a no-match message shows when the filter excludes everything");

// An opt-in Active filter narrows to projects with a live signal WITHOUT
// reordering — the alphabetical stability is preserved (only the visible set
// shrinks). Active-ness derives from the shared deriveProjectStatus helper.
assert.match(
  projectsView,
  /const \[statusFilter, setStatusFilter\] = useState<"all" \| "active">\("all"\)/,
  "there is an opt-in active/all view filter, defaulting to all",
);
assert.match(
  projectsView,
  /const activeRoots = useMemo[\s\S]{0,240}?deriveProjectStatus\(list\) !== null/,
  "active projects are derived from deriveProjectStatus over each project's chats",
);
assert.match(
  projectsView,
  /statusFilter === "active"[\s\S]{0,160}?activeRoots\.has\(normalizeProjectRoot\(p\.root\)\)/,
  "the Active filter narrows visibleProjects to active roots",
);
assert.match(projectsViewToolbar, /aria-label="Filter by activity"/, "the header exposes a labeled activity filter control");
assert.match(projectsViewToolbar, /aria-pressed=\{statusFilter === opt\.value\}/, "the activity filter reflects the active option");
// The header summary surfaces how many projects are currently active.
assert.match(projectsViewToolbar, /\{activeCount\} active/, "the header summarizes the active-project count");

// The detail head carries a glanceable, accessible sessions count.
assert.match(projectsView, /className="projects-session-count"/, "the sessions stat uses the glanceable treatment");
assert.match(
  projectsView,
  /aria-label=\{`\$\{chats\.length\} \$\{chats\.length === 1 \? "session" : "sessions"\}`\}/,
  "the sessions count keeps a full accessible label",
);

// Project rows and the detail head carry a glanceable status dot: accent when
// a session is running, danger when the most-recent session failed.
assert.match(projectsView, /const projectStatus = deriveProjectStatus\(chats\)/, "detail status comes from the shared deriveProjectStatus helper");
assert.match(projectsView, /import \{ deriveProjectStatus \} from "@\/lib\/project-status"/, "imports the status helper");
assert.match(projectListSource, /const status = deriveProjectStatus\(chats\)/, "list rows derive the same status — zero extra fetches");

// Paths are home-collapsed + truncated so the identical absolute prefix stops
// dominating; the full path stays in the title and the editor.
assert.match(projectsView, /\{shortRoot\(project\.root\)\}/, "the displayed path is shortened");
assert.match(projectsView, /title=\{project\.root\}/, "the full path remains available via the title");
assert.match(projectsView, /relativeTime\(/, "the detail head shows a relative last-active label (shared relative-time helper)");

// Rich session rows: each leads with a derived status glyph (running spinner /
// failed / task / chat dot), drops the "Task: " text prefix in favor of that
// glyph, and carries trailing metadata (model · branch · diff · time).
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

// The detail head carries a glanceable stat line (running · tasks · sessions)
// derived from the pure projectStats helper.
assert.match(projectsView, /import \{ projectStats \} from "@\/lib\/projects\/project-stats"/, "the detail head uses the pure stats helper");
assert.match(projectsView, /const stats = projectStats\(chats\)/, "the detail head derives running/task counts");
assert.match(projectsView, /stats\.running > 0 \?/, "the stat line shows a running count when any session is running");
assert.match(projectsView, /stats\.tasks > 0 \?/, "the stat line shows a task count when the project has tasks");

// The project identity tile is the shared ProjectAvatar (uploaded image or
// monogram), tinted by the project's color when set.
assert.match(projectsView, /<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\}/, "the identity tile is the shared ProjectAvatar, fed the project color");

// The command palette's "Open project" navigation selects that project in the
// hub (CHAT_FOCUS_PROJECT_EVENT) and scrolls its list row into view — the
// listener lives in the shell now, not per-row.
assert.match(projectsViewSource, /addEventListener\(CHAT_FOCUS_PROJECT_EVENT/, "the shell listens for the focus-project event");
assert.match(
  projectsViewSource,
  /const match = projects\.find\(\(p\) => normalizeProjectRoot\(p\.root\) === rootKey\)[\s\S]{0,120}?selectProject\(match\.id\)/,
  "a matching focus event selects the project",
);
assert.match(projectListSource, /id=\{`pcard-el:\$\{normalizeProjectRoot\(project\.root\)\}`\}/, "list rows carry a stable id so they can be scrolled into view");
assert.match(
  projectsViewSource,
  /scrollIntoView\(\{ block: "nearest", behavior: smoothScrollBehavior\(\) \}\)/,
  "the focus scroll honors reduced motion via smoothScrollBehavior",
);

// Keyboard navigation: a roving tabindex (WAI-ARIA) over the project rows in
// the list pane. ↑/↓ + Home/End move focus (shared hook); Enter/Space select.
assert.match(projectsView, /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/, "reuses the shared roving-tabindex hook");
assert.match(
  projectsView,
  /useRovingTabIndex\(\{ containerRef: listRef, itemSelector: "\[data-proj-nav\]", orientation: "vertical" \}\)/,
  "rove vertically over [data-proj-nav] items in the list pane",
);
assert.match(projectsViewSource, /<div ref=\{listRef\} className="projects-hub__list">/, "the list pane hosts the roving keydown handler");
assert.match(projectListSource, /data-proj-nav/, "project rows are rove stops");

// Touch: row actions stay visible on coarse pointers, where there is no hover.
assert.match(projectsView, /\[@media\(pointer:coarse\)\]:opacity-100/, "row actions stay visible on touch/coarse-pointer devices");

// Right-click context menus on project rows and session rows, built on the
// shared ContextMenu/Popover primitives.
assert.match(
  projectsView,
  /import \{ ContextMenu, openContextMenuAt, type ContextMenuState \} from "@\/components\/ui\/context-menu"/,
  "uses the shared ContextMenu primitive",
);
assert.match(
  projectsView,
  /import \{ PopoverItem, PopoverSeparator \} from "@\/components\/ui\/popover"/,
  "menu items use the shared Popover item/separator",
);
assert.ok(
  (projectsView.match(/openContextMenuAt\(setMenu\)/g) ?? []).length >= 2,
  "both the project list row and session rows open a context menu at the cursor",
);
assert.match(projectsView, /Actions for \$\{project\.name\}/, "the project row has a context menu");
assert.doesNotMatch(projectsView, /openTerminalHere/, "the project menu stays focused on project actions");
assert.match(projectsView, /Delete project…/, "the detail overflow offers delete (routes through the inline confirm)");
assert.match(projectsView, /onSelect=\{\(\) => setConfirmDelete\(true\)\}/, "menu delete shows the two-step confirm");
assert.match(projectsView, /Actions for \$\{title\}/, "each session row has a context menu");
assert.match(projectsView, /Delete chat…/, "session menu offers delete (routes through the inline confirm)");
assert.match(
  projectsView,
  /aria-label=\{`Delete thread \$\{title\}`\}[\s\S]{0,520}?leadingIcon="ph:x-bold"/,
  "each thread row exposes a close-button delete affordance inline",
);

// Cross-project-move undo (the context-menu path is now the only mover).
assert.match(projectsView, /import \{ applyProjectOverrides, setProjectOverride, clearProjectOverride \}/, "imports clearProjectOverride for undo");
assert.match(projectsView, /import \{ UndoToast \} from "@\/components\/ui\/undo-toast"/, "uses the shared UndoToast primitive");
assert.match(projectsView, /const prevRoot = projectOverrides\[sessionId\] \?\? null/, "the move captures the prior override for a precise undo");
assert.match(projectsView, /setMoveToast\(\{ sessionId, prevRoot, label:/, "a cross-project move raises the undo toast");
assert.match(
  projectsView,
  /moveToast\.prevRoot\) setProjectOverride\(moveToast\.sessionId, moveToast\.prevRoot\)[\s\S]{0,90}?clearProjectOverride\(moveToast\.sessionId\)/,
  "undo restores the prior override, or clears it when there wasn't one",
);
assert.match(
  projectsView,
  /<UndoToast\s+key=\{moveToast\.sessionId\}[\s\S]{0,400}?autoDismiss/,
  "the toast renders (keyed, self-dismissing) via the shared UndoToast",
);

// Render-virtualization: off-screen session rows skip layout/paint via
// content-visibility (the repo's established strategy), staying in the DOM so
// keyboard nav / find still work.
assert.match(projectsView, /focus-ring projects-session-row/, "each session row carries the render-virtualization class");
assert.match(
  globalsCss,
  /\.projects-session-row \{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto 32px;[\s\S]*?\}/,
  "session rows set content-visibility:auto with a cached intrinsic-size",
);

// Type-ahead jump: typing letters moves focus to the next project whose label
// matches, staying in sync with the roving tab stop (pure matcher).
assert.match(projectsView, /import \{ nextTypeAheadIndex \} from "@\/lib\/projects\/type-ahead"/, "uses the pure type-ahead matcher");
assert.match(projectsView, /const \{ setActiveIndex \} = useRovingTabIndex/, "captures the roving setActiveIndex to keep nav in sync");
assert.match(projectsView, /data-proj-label=\{project\.name\}/, "project rows expose their name for type-ahead");
assert.match(projectsView, /e\.key\.length !== 1 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey/, "type-ahead only handles plain printable keys");
assert.match(projectsView, /state\.buffer \+= e\.key/, "keystrokes accumulate into a type-ahead buffer");
assert.match(projectsView, /typeAheadRef\.current\.buffer = ""/, "the buffer resets after a pause");
assert.match(projectsView, /const next = nextTypeAheadIndex\(labels, current, state\.buffer\)/, "the next focus comes from the pure matcher");
assert.match(projectsView, /items\[next\]\.focus\(\);\s*setActiveIndex\(next\)/, "a match focuses the item and updates the roving tab stop");

// "Move to project" submenu: the session context menu drills into a list of the
// other projects; selecting one moves the chat there (same move+undo path),
// shared via the extracted moveSessionToProject.
assert.match(projectsView, /const moveSessionToProject = \(sessionId: string, targetRoot: string\)/, "the cross-project move is a shared helper");
assert.match(projectsView, /onMoveSession=\{moveSessionToProject\}/, "the move helper is wired into the detail pane");
assert.match(
  projectsView,
  /allProjects[\s\S]{0,160}?normalizeProjectRoot\(p\.root\) !== rootKey/,
  "the detail pane offers the OTHER projects as move targets",
);
assert.match(projectsView, /const \[menuView, setMenuView\] = useState<"root" \| "move">/, "the session menu tracks a root/move drill-in view");
assert.match(projectsView, /onSelect=\{\(\) => setMenuView\("move"\)\}/, '"Move to project…" drills into the project picker');
assert.match(
  projectsView,
  /moveTargets\.map\(\(target\)[\s\S]{0,260}?onMoveSession\(session\.id, target\.root\)/,
  "picking a target project moves the chat there",
);
assert.match(projectsView, /onSelect=\{\(\) => setMenuView\("root"\)\}[\s\S]{0,40}?Back/, "the picker has a Back affordance");

console.log("projects-view.test.ts: ok");
