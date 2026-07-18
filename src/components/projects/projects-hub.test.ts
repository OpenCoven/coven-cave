// @ts-nocheck
// Master-detail structure pins for the Projects hub (cave-8p7) — the pieces
// that are about the hub's shape rather than the surface's behavior (those
// live in ../projects-view.test.ts).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const shell = readFileSync(new URL("../projects-view.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./project-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./project-detail.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./detail-sections.tsx", import.meta.url), "utf8");
const sessionRow = readFileSync(new URL("./session-row.tsx", import.meta.url), "utf8");
const shared = readFileSync(new URL("./projects-shared.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");

// ── The old table shell is gone; the hub replaced it ─────────────────────────
assert.doesNotMatch(shell, /board-table|projects-table|<table|<thead|<colgroup/, "the spreadsheet table shell is fully retired");
for (const src of [shell, list, detail, sections, sessionRow]) {
  assert.doesNotMatch(src, /@dnd-kit/, "no hub component ships dnd-kit");
}

// ── CSS contract: every class the components use exists in projects.css ─────
for (const cls of [
  "projects-shell",
  "projects-hub",
  "projects-hub__list",
  "projects-hub__detail",
  "projects-list-row",
  "projects-detail-head",
  "projects-detail-section",
  "projects-detail-empty",
  "projects-detail-back",
  "projects-status-dot",
  "projects-session-count",
  "projects-session-chip",
]) {
  assert.match(css, new RegExp(`\\.${cls.replace(/([[\]().*+?^$|\\])/g, "\\$1")}\\b`), `projects.css defines .${cls}`);
}
// Selected row treatment rides aria-selected — state and style can't drift apart.
assert.match(css, /\.projects-list-row\[aria-selected="true"\]/, "selection styling keys off aria-selected");
// The query container is the WRAPPER around the hub, never the hub itself: an
// element's own @container rules only match against an ANCESTOR container, so
// `.projects-hub { … }` inside `@container projects` would silently no-op if
// the hub declared the container (its descendants' rules would still apply,
// masking the breakage — this bit us live).
const shellBlock = css.slice(css.indexOf(".projects-shell {"), css.indexOf("}", css.indexOf(".projects-shell {")));
assert.match(shellBlock, /container: projects \/ inline-size/, "the container declaration lives on .projects-shell");
assert.equal(
  (css.match(/container: projects \/ inline-size/g) ?? []).length,
  1,
  "exactly one element declares the projects container",
);
// Dashed = invitation (design language §3) for empty sections.
assert.match(css, /\.projects-detail-empty \{[\s\S]*?border: 1px dashed/, "empty sections use the dashed invitation treatment");

// ── Detail pane: identity edits all survived the move from the old row ──────
assert.match(detail, /const commitName = async/, "inline rename survives in the detail head");
assert.match(detail, /const commitRoot = async/, "inline root edit survives in the detail head");
assert.match(detail, /moveProjectImage\(project\.root, next\)/, "changing the root re-keys the avatar image");
assert.match(detail, /clearProjectImage\(project\.root\)/, "deleting the project clears its avatar image");
assert.match(detail, /setProjectImage\(project\.root, prepared\)/, "the avatar button uploads through the shared image pipeline");
assert.match(detail, /PROJECT_COLOR_SWATCHES\.map/, "the color swatches render in the detail pane");
assert.match(shared, /export const PROJECT_COLOR_SWATCHES/, "the swatch palette lives in projects-shared");
assert.match(detail, /projectTint\(project\.root\)/, "the auto swatch previews the root-hash tint");
assert.match(detail, /aria-pressed=\{!project\.color\}/, "the auto swatch reports selection");
// Chrome budget (§8): ≤2 always-visible header actions + one overflow menu.
assert.match(detail, /import \{ OverflowMenu \} from "@\/components\/ui\/overflow-menu"/, "secondary actions live in the shared OverflowMenu");
assert.match(detail, /OverflowMenu ariaLabel=\{`More actions for \$\{project\.name\}`\}/, "the overflow trigger is named per project");
for (const item of ["Rename", "Change folder…", "Copy path", "Browse files", "Delete project…"]) {
  assert.match(detail, new RegExp(item), `overflow offers ${item}`);
}
// cave-z44: "Browse files" drills into the project's tree via the code rail by
// dispatching a cross-surface event workspace.tsx bridges to chat mode. It
// carries only the root, and stays in the overflow (keeps the ≤2-visible budget).
assert.match(
  detail,
  /new CustomEvent\("cave:browse-project-files", \{ detail: \{ root: project\.root \} \}\)/,
  "Browse files dispatches the browse event with the project root",
);
// Delete is a two-step confirm with an accessible container.
assert.match(detail, /role="alertdialog"[\s\S]{0,80}?aria-label=\{`Delete \$\{project\.name\}\?`\}/, "delete confirm is an alertdialog");
// Switching projects resets edit drafts/confirms (no leakage across selections).
assert.match(detail, /useEffect\(\(\) => \{[\s\S]{0,240}?setConfirmDelete\(false\);[\s\S]{0,120}?\}, \[project\.id, project\.name, project\.root\]\)/, "drafts and confirms reset when the selection changes");

// ── Session-git branch fallback (the Git section's authoritative branch from
// /api/changes wins once loaded); the list pane must stay fetch-free. ────────
assert.match(detail, /s\.git\?\.branch/, "the detail derives a fallback branch from session git context");
assert.doesNotMatch(list, /fetch\(/, "the list pane performs no fetches — status derives from sessions already in memory");
assert.doesNotMatch(list, /\/api\/changes/, "the list pane never polls git changes");

// ── List rows ────────────────────────────────────────────────────────────────
assert.match(list, /import \{ RelativeTime \} from "@\/components\/ui\/relative-time"/, "list rows show recency via the shared primitive");
assert.match(list, /projects-list-row__count/, "list rows show a session-count pill");
assert.match(list, /tabIndex=\{selected \? 0 : -1\}/, "the selected row is the natural tab stop (roving pattern)");
assert.match(list, /animate-pulse/, "a running project's dot pulses");
assert.match(list, /aria-label=\{`\$\{project\.name\}\$\{statusLabel\}`\}/, "row labels carry the status in words — color never stands alone");

// ── Session rows: dnd stripped, capabilities kept ────────────────────────────
assert.doesNotMatch(sessionRow, /useSortable|dots-six-vertical|Drag to reorder/, "session rows no longer drag");
assert.match(sessionRow, /Move to project…/, "the explicit move flow replaces cross-project drag");
assert.doesNotMatch(sessionRow, /density/, "session rows have one density — metadata chips always render");
assert.match(sessionRow, /modelLabel\(session\.model\)/, "the model chip always renders when known");


// ── PR2: Git / Tasks / Grants detail sections ────────────────────────────────
// Polling gate: exactly ONE useChangesSummary call in the whole hub, fed the
// SELECTED project's root — list rows must never poll git.
assert.equal(
  ([shell, list, detail, sections, sessionRow].join("\n").match(/useChangesSummary\(/g) ?? []).length,
  1,
  "exactly one component calls useChangesSummary",
);
assert.match(sections, /useChangesSummary\(projectRoot, true\)/, "the Git section polls only the selected root");
assert.match(sections, /changes\.branch \?\? sessionBranch/, "the authoritative branch wins over the session-git fallback");
assert.match(detail, /<GitSection projectRoot=\{project\.root\} sessionBranch=\{branch\}/, "the detail pane mounts the Git section");

// Tasks: one board fetch in the SHELL (not per selection — the detail remounts
// on every switch), refetched on window refocus, filtered client-side.
assert.equal((shell.match(/fetch\("\/api\/board"/g) ?? []).length, 1, "the shell fetches the board exactly once per mount");
assert.equal(
  (sections.match(/fetch\("\/api\/board"/g) ?? []).length,
  1,
  "the Tasks section touches /api/board exactly once",
);
assert.match(
  sections,
  /fetch\("\/api\/board", \{\s*\n\s*method: "POST"/,
  "…and that one call is the quick-add create (a mutation) — card READS still arrive from the shell",
);
assert.match(shell, /useRefreshOnFocus\(loadBoardCards\)/, "board cards refetch on window refocus (throttled)");
assert.match(
  sections,
  /card\.projectId === project\.id \|\|[\s\S]{0,120}?normalizeProjectRoot\(card\.cwd \?\? ""\) === rootKey/,
  "cards match by stable projectId with a normalized-cwd fallback",
);
assert.match(sections, /const TASK_CAP = 5/, "the Tasks section caps the inline list");
assert.match(sections, /Open board/, "the Tasks section drills through to the board");

// Grants: optimistic toggle with revert, supreme-familiar read-only, announced.
assert.match(sections, /method: next \? "POST" : "DELETE"/, "grant/revoke drive /api/project-grants");
assert.match(sections, /targetFamiliarId: familiarId, projectId: project\.id/, "the grant body names the familiar and project");
assert.match(sections, /\/\/ Revert on failure\./, "a failed mutation reverts the optimistic state");
assert.match(sections, /familiar\.id === supremeFamiliarId/, "the supreme familiar renders as always-granted");
assert.match(sections, /disabled=\{busy \|\| isSupremeFamiliar\}/, "supreme access can't be toggled off");
assert.match(sections, /useAnnouncer\(\)/, "grant changes are announced to assistive tech");
assert.match(sections, /announce\(`\$\{next \? "Granted" : "Revoked"\}/, "the announcement names the action");
assert.match(detail, /<GrantsSection project=\{project\} familiars=\{familiars\}/, "the detail pane mounts the Grants section");
assert.match(shell, /familiars=\{familiars\}/, "the shell threads the familiar roster down");

// ── PR3: announcer coverage, arrow-key pane hand-off, dead-code stays dead ───
// Every identity mutation announces its outcome; failures speak assertively.
assert.match(detail, /useAnnouncer\(\)/, "the detail pane announces its mutations");
assert.match(detail, /announce\(`Renamed to \$\{next\}\.`\)/, "rename success is announced");
assert.match(detail, /announce\("Project folder updated\."\)/, "root change success is announced");
assert.match(detail, /announce\(`Deleted project \$\{project\.name\}\.`\)/, "project delete is announced");
assert.match(detail, /announce\("Path copied\."\)/, "copy path is announced");
assert.match(detail, /Color set to/, "color changes are announced by swatch name");
assert.equal(
  (detail.match(/"assertive"/g) ?? []).length >= 4,
  true,
  "rename/root/color/delete failures announce assertively",
);
assert.match(shell, /useAnnouncer\(\)/, "the shell announces create/undo outcomes");
assert.match(shell, /announce\(`Created project \$\{name\}\.`\)/, "project creation is announced");
assert.match(shell, /announce\("Move undone\."\)/, "undoing a move is announced");
assert.match(shell, /announce\("Delete undone\."\)/, "undoing a bulk delete is announced");
// Move + bulk delete themselves speak through the UndoToast's role="status" —
// the shell must NOT double-announce them.
assert.doesNotMatch(shell, /announce\(`Moved/, "the move itself speaks only through the UndoToast");

// Arrow keys hand focus between the panes: → selects and enters the detail,
// ← returns to the selected list row (text fields keep their caret).
assert.match(list, /e\.key === "ArrowRight"[\s\S]{0,120}?onEnterDetail\?\.\(\)/, "ArrowRight on a row hands focus into the detail pane");
assert.match(shell, /onEnterDetail=\{focusDetailPane\}/, "the shell wires the ArrowRight hand-off");
assert.match(shell, /e\.key !== "ArrowLeft"/, "ArrowLeft in the detail hands focus back to the list");
assert.match(shell, /INPUT\|TEXTAREA\|SELECT/, "the ArrowLeft hand-off never steals the caret from a field");
assert.match(shell, /ref=\{detailRef\}\s+tabIndex=\{-1\}\s+role="region"/, "the detail pane is a focusable named region");

// The narrow collapse has a sidebar-band refinement, not just the 640px flip.
assert.match(css, /@container projects \(max-width: 420px\)/, "the 200–480px sidebar band tightens the pane padding");

// The old table's dead weight stays deleted: board.css no longer carries any
// projects-* rules (projects.css is the canonical home) and the expand/density
// persistence helpers are gone with the UI that used them.
const boardCss = readFileSync(new URL("../../styles/board.css", import.meta.url), "utf8");
assert.doesNotMatch(boardCss, /projects-table|projects-session-count|projects-session-chip|board-table-cell-sessions|board-table-cell-status--idle/, "board.css carries no projects-surface rules");
for (const dead of ["../../lib/projects/projects-ui-state.ts", "../../lib/projects/use-projects-ui-state.ts"]) {
  assert.equal(existsSync(new URL(dead, import.meta.url)), false, `${dead} stays deleted`);
}

// ── Hub updates (cave-ihox): quick-add · honest git · sort · titles ─────────
// Tasks quick-add: optimistic local append + a board-reload nudge for the rest
// of the app; the created card comes back from the server (cwd derived from
// projectId server-side, never client-supplied).
assert.match(sections, /JSON\.stringify\(\{ title, projectId: project\.id \}\)/, "quick-add sends title + projectId only");
assert.match(sections, /setCreatedCards\(\(prev\) => \[json\.card as Card, \.\.\.prev\]\)/, "the created card appends optimistically");
assert.match(sections, /window\.dispatchEvent\(new Event\("cave:board:reload"\)\)/, "creation nudges the app-wide board reload");
assert.match(sections, /aria-label=\{`Add a task to \$\{project\.name\}`\}/, "the quick-add input is named for AT");

// Git: a dirty tree is status, not activity — the chip must not pulse; the
// branch is click-to-copy.
assert.doesNotMatch(sections, /projects-session-chip--running"\s*\n?\s*title=\{`\$\{changes\.count\}/, "the changed-files chip does not wear the running pulse");
assert.match(sections, /uncommitted changes in the working tree/, "the chip says what the count actually is");
assert.match(sections, /aria-label=\{`Copy branch name \$\{branch\}`\}/, "the branch is a copy button");

// List sort: alphabetical or most-recent-first, persisted per machine.
assert.match(shell, /"cave:projects:sort"/, "the sort choice persists to localStorage");
assert.match(shell, /aria-label="Sort projects"/, "the sort toggle is a labelled group");
assert.match(shell, /lastActiveByRootKey\.get\(normalizeProjectRoot\(b\.root\)\) \?\? 0/, "recent sort orders by last session activity");

// Meta-row comprehension: the status word and session count explain themselves.
assert.match(detail, /title="Project state, derived from its latest sessions"/, "the status word carries its derivation");
assert.match(detail, /\} in this project`\}/, "the session count chip is titled");

// Grants explain themselves where the chips are.
assert.match(sections, /dashed means no access yet/, "the grants section says what a chip click does");

// ── Hub round 2 (cave-dn9w): deep-links · reveal · demoted color row ─────────
assert.match(sections, /window\.location\.hash = `card-\$\{card\.id\}`/, "task rows deep-link to their board card");
assert.match(sections, /onOpenBoard\?\.\(\);\s*\n\s*window\.location\.hash/, "…after switching to the board surface");
assert.match(shared, /export async function revealProjectFolder/, "the reveal helper lives in projects-shared");
assert.match(shared, /invoke\("shell_open_path", \{ path: root \}\)/, "…and uses the app's absolute-path-validated command");
assert.match(detail, /hasDesktopBridge\(\) \?[\s\S]{0,400}Reveal in Finder/, "the detail overflow reveals the folder, desktop only");
assert.match(list, /hasDesktopBridge\(\) \?[\s\S]{0,500}Reveal in Finder/, "the list row context menu reveals too, desktop only");
// The color swatches moved INTO the overflow — no always-visible header row.
assert.match(detail, /PopoverSeparator \/>[\s\S]{0,1400}aria-label=\{`Tile color for \$\{project\.name\}`\}/, "the tile-color swatches live inside the overflow menu");
console.log("projects-hub.test.ts: ok");
