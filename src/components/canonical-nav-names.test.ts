// @ts-nocheck
// Canonical navigation vocabulary (issue #3283, bead cave-m4ih.1): one surface,
// one user-facing name, on every platform. The lightweight workspace navigation
// registry is the source of truth; the desktop sidebar, mobile bottom tabs, and
// workspace sr-title map
// must agree with it for every destination they share. This pin exists because
// the same surface previously shipped as "Tasks" (desktop) / "Board" (mobile)
// and "Rituals" (desktop) / "Rites" (mobile) at the same time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
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

const registryLabels = extractLabels(
  registry,
  "WORKSPACE_NAV_ITEMS",
  /export const WORKSPACE_NAV_ITEMS[\s\S]*?\n\];/,
);

// ── Mobile bottom tabs DERIVE from the shared primary cluster ────────────────
// Parity by construction (issue #3283 acceptance: "Desktop and mobile present
// the same conceptual hierarchy"): the registry owns the quiet/navHidden
// filtering, and the tab strip maps the resulting primary rows while reusing
// the canonical label as both the visible label and accessible name.
assert.match(
  mobileTabs,
  /import \{ PRIMARY_WORKSPACE_NAV_ITEMS \} from "@\/lib\/workspace-navigation";/,
  "mobile tabs must import the shared primary navigation registry",
);
const tabsDeclaration = mobileTabs.match(
  /const\s+TABS\s*=\s*PRIMARY_WORKSPACE_NAV_ITEMS\.map\([\s\S]*?\n\);/,
)?.[0];
assert.ok(tabsDeclaration, "mobile tabs must derive TABS directly from PRIMARY_WORKSPACE_NAV_ITEMS");
for (const field of ["id", "label", "ariaLabel", "iconName"]) {
  const sourceField = field === "ariaLabel" ? "label" : field;
  assert.match(
    tabsDeclaration,
    new RegExp(`\\b${field}\\s*:\\s*fm\\.${sourceField}\\b`),
    `mobile tabs must derive ${field} from the canonical workspace navigation row`,
  );
}
assert.doesNotMatch(
  mobileTabs,
  /\{ id: "[a-z-]+", label: "/,
  "mobile tabs must not hand-copy id/label rows — derive them from the shared registry",
);

// The primary cluster the tabs mirror stays the four daily destinations, and
// the drawer keeps the rest reachable: quiet rows exist in WORKSPACE_NAV_ITEMS.
const primaryIds = [];
const registryBlock = registry.match(/export const WORKSPACE_NAV_ITEMS[\s\S]*?\n\];/)[0];
for (const row of registryBlock.matchAll(/\{[\s\S]*?\}/g)) {
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
// workspace.tsx migrated from a hand-written WORKSPACE_MODE_TITLES map to
// deriving titles from workspacePageDefinition (workspace-page-registry.ts);
// the canonical label check now targets the page registry directly.
const pageRegistry = readFileSync(new URL("../lib/workspace-page-registry.ts", import.meta.url), "utf8");
// Extract id/title pairs from the WORKSPACE_MODE_PAGES block (ends before SUPPLEMENTAL_PAGES).
const pageRegistryBlock = pageRegistry.slice(
  pageRegistry.indexOf("const WORKSPACE_MODE_PAGES"),
  pageRegistry.indexOf("\nconst SUPPLEMENTAL_PAGES"),
);
assert.ok(pageRegistryBlock.length > 0, "WORKSPACE_MODE_PAGES should be extractable from workspace-page-registry.ts");
const modeTitles = new Map();
for (const m of pageRegistryBlock.matchAll(/\bid\s*:\s*"([a-z-]+)"[\s\S]*?\btitle\s*:\s*"([^"]+)"/g)) {
  modeTitles.set(m[1], m[2]);
}
assert.ok(modeTitles.size > 0, "WORKSPACE_MODE_PAGES should declare id/title rows");
for (const [id, canonical] of registryLabels) {
  const title = modeTitles.get(id);
  if (title === undefined) continue;
  assert.equal(
    title,
    canonical,
    `workspace-page-registry["${id}"].title must use the canonical navigation label "${canonical}", got "${title}"`,
  );
}

// Alias modes that render another surface's view keep that surface's name —
// they must never introduce a new peer vocabulary (issue #3283 acceptance:
// "Compatibility aliases do not appear as peer destinations").
// The canonical relationship is tracked via canonicalId in the page registry.
const canonicalIds = new Map();
for (const m of pageRegistryBlock.matchAll(/\bid\s*:\s*"([a-z-]+)"[\s\S]*?\bcanonicalId\s*:\s*"([a-z-]+)"/g)) {
  canonicalIds.set(m[1], m[2]);
}
assert.equal(canonicalIds.get("calendar"), "inbox", "calendar is a tab of Rituals, not a new name");
assert.equal(canonicalIds.get("familiar-work-queue"), "board", "the work queue is a tab of Tasks, not a new name");

console.log("canonical-nav-names: ok");
