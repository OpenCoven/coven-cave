// @ts-nocheck
// Master-detail structure pins for the Projects hub (cave-8p7) — the pieces
// that are about the hub's shape rather than the surface's behavior (those
// live in ../projects-view.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../projects-view.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./project-list.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./project-detail.tsx", import.meta.url), "utf8");
const sessionRow = readFileSync(new URL("./session-row.tsx", import.meta.url), "utf8");
const shared = readFileSync(new URL("./projects-shared.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");

// ── The old table shell is gone; the hub replaced it ─────────────────────────
assert.doesNotMatch(shell, /board-table|projects-table|<table|<thead|<colgroup/, "the spreadsheet table shell is fully retired");
for (const src of [shell, list, detail, sessionRow]) {
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
for (const item of ["Rename", "Change folder…", "Copy path", "Delete project…"]) {
  assert.match(detail, new RegExp(item.replace("…", "…")), `overflow offers ${item}`);
}
// Delete is a two-step confirm with an accessible container.
assert.match(detail, /role="alertdialog"[\s\S]{0,80}?aria-label=\{`Delete \$\{project\.name\}\?`\}/, "delete confirm is an alertdialog");
// Switching projects resets edit drafts/confirms (no leakage across selections).
assert.match(detail, /useEffect\(\(\) => \{[\s\S]{0,240}?setConfirmDelete\(false\);[\s\S]{0,120}?\}, \[project\.id, project\.name, project\.root\]\)/, "drafts and confirms reset when the selection changes");

// ── Interim git line: branch from the newest session's git context ──────────
// (PR2 swaps this to /api/changes' branch field; the list pane must stay
// fetch-free either way.)
assert.match(detail, /s\.git\?\.branch/, "the detail head shows the branch from session git context");
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

console.log("projects-hub.test.ts: ok");
