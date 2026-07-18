// @ts-nocheck
// Canonical navigation vocabulary (issue #3283, bead cave-m4ih.1): one surface,
// one user-facing name, on every platform. The desktop sidebar's FOLDER_MODES
// is the source of truth; the mobile bottom tabs and the workspace sr-title map
// must agree with it for every destination they share. This pin exists because
// the same surface previously shipped as "Tasks" (desktop) / "Board" (mobile)
// and "Rituals" (desktop) / "Rites" (mobile) at the same time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// Extract `id -> label` pairs from `{ id: "...", label: "..." }` object rows.
function extractLabels(source, blockName, blockRe) {
  const block = source.match(blockRe)?.[0];
  assert.ok(block, `${blockName} block should be extractable`);
  const labels = new Map();
  for (const m of block.matchAll(/\{ id: "([a-z-]+)", label: "([^"]+)"/g)) {
    labels.set(m[1], m[2]);
  }
  assert.ok(labels.size > 0, `${blockName} should declare id/label rows`);
  return labels;
}

const sidebarLabels = extractLabels(
  sidebar,
  "FOLDER_MODES",
  /const FOLDER_MODES[\s\S]*?\n\];/,
);

// ── Mobile bottom tabs DERIVE from the sidebar's primary cluster ─────────────
// Parity by construction (issue #3283 acceptance: "Desktop and mobile present
// the same conceptual hierarchy"): the tab strip maps FOLDER_MODES rows that
// are neither quiet nor navHidden, reusing the canonical label as both the
// visible label and the accessible name. No hand-copied row list may return.
assert.match(
  mobileTabs,
  /import \{ FOLDER_MODES \} from "@\/components\/sidebar-minimal";/,
  "mobile tabs must import the sidebar's FOLDER_MODES source of truth",
);
const tabsDeclaration = mobileTabs.match(
  /const\s+TABS\s*=\s*FOLDER_MODES[\s\S]*?;(?=\s*\n)/,
)?.[0];
assert.ok(tabsDeclaration, "mobile tabs must derive TABS directly from FOLDER_MODES");
assert.match(
  tabsDeclaration,
  /\.filter\(\s*\(?\s*fm\s*\)?\s*=>\s*!fm\.quiet\s*&&\s*!fm\.navHidden\s*\)/,
  "mobile tabs must be derived from the sidebar's primary (non-quiet, non-hidden) cluster",
);
for (const field of ["id", "label", "ariaLabel", "iconName"]) {
  const sourceField = field === "ariaLabel" ? "label" : field;
  assert.match(
    tabsDeclaration,
    new RegExp(`\\b${field}\\s*:\\s*fm\\.${sourceField}\\b`),
    `mobile tabs must derive ${field} from the canonical FOLDER_MODES row`,
  );
}
assert.doesNotMatch(
  mobileTabs,
  /\{ id: "[a-z-]+", label: "/,
  "mobile tabs must not hand-copy id/label rows — derive them from FOLDER_MODES",
);

// The primary cluster the tabs mirror stays the four daily destinations, and
// the drawer keeps the rest reachable: quiet rows exist in FOLDER_MODES.
const primaryIds = [];
const folderBlock = sidebar.match(/const FOLDER_MODES[\s\S]*?\n\];/)[0];
for (const row of folderBlock.matchAll(/\{[\s\S]*?\}/g)) {
  const id = row[0].match(/\bid\s*:\s*"([a-z-]+)"/)?.[1];
  if (!id) continue;
  if (!/\bquiet\s*:\s*true\b/.test(row[0]) && !/\bnavHidden\s*:\s*true\b/.test(row[0])) {
    primaryIds.push(id);
  }
}
assert.deepEqual(
  primaryIds,
  ["home", "chat", "board", "inbox"],
  "sidebar primary cluster (→ mobile tabs) should be the four daily destinations",
);

// ── The sr-only h1 / split-tile title map agrees for sidebar destinations ────
const titlesBlock = workspace.match(
  /const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = \{[\s\S]*?\n\};/,
)?.[0];
assert.ok(titlesBlock, "WORKSPACE_MODE_TITLES should be extractable");
const modeTitles = new Map();
for (const m of titlesBlock.matchAll(/"?([a-z-]+)"?: "([^"]+)"/g)) {
  modeTitles.set(m[1], m[2]);
}
for (const [id, canonical] of sidebarLabels) {
  const title = modeTitles.get(id);
  if (title === undefined) continue;
  assert.equal(
    title,
    canonical,
    `WORKSPACE_MODE_TITLES["${id}"] must use the canonical sidebar label "${canonical}", got "${title}"`,
  );
}

// Alias modes that render another surface's view keep that surface's name —
// they must never introduce a new peer vocabulary (issue #3283 acceptance:
// "Compatibility aliases do not appear as peer destinations").
assert.equal(modeTitles.get("calendar"), modeTitles.get("inbox"), "calendar is a tab of Rituals, not a new name");
assert.equal(modeTitles.get("familiar-work-queue"), modeTitles.get("board"), "the work queue is a tab of Tasks, not a new name");

console.log("canonical-nav-names: ok");
