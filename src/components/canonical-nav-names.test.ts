// @ts-nocheck
// Canonical navigation vocabulary (issue #3283, bead cave-m4ih.1): one surface,
// one user-facing name, on every platform. The lightweight workspace navigation
// registry is the source of truth; the desktop sidebar, mobile bottom tabs, and
// workspace page registry
// must agree with it for every destination they share. This pin exists because
// the same surface previously shipped as "Tasks" (desktop) / "Board" (mobile)
// and "Rituals" (desktop) / "Rites" (mobile) at the same time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const pageRegistry = readFileSync(new URL("../lib/workspace-page-registry.ts", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");

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

// ── Page definitions agree with the navigation vocabulary ───────────────────
const pagesBlock = pageRegistry.match(
  /const WORKSPACE_MODE_PAGES = freezePageMap\(\{[\s\S]*?\n\} satisfies Record<WorkspaceMode, WorkspacePageDefinition>\);/,
)?.[0];
assert.ok(pagesBlock, "WORKSPACE_MODE_PAGES should be extractable");
const pageDefinitions = new Map();
for (const m of pagesBlock.matchAll(
  /(?:^|\n)\s*"?([a-z-]+)"?: \{\s*id: "([^"]+)",\s*title: "([^"]+)",\s*canonicalId: ([^,\n]+),/g,
)) {
  pageDefinitions.set(m[1], {
    id: m[2],
    title: m[3],
    canonicalId: m[4].trim().replaceAll('"', ""),
  });
}
for (const [id, canonical] of registryLabels) {
  const definition = pageDefinitions.get(id);
  if (definition === undefined) continue;
  assert.equal(
    definition.title,
    canonical,
    `WORKSPACE_MODE_PAGES["${id}"] must use the canonical navigation label "${canonical}", got "${definition.title}"`,
  );
}

// Alias pages retain distinct, descriptive titles while resolving to the
// canonical surface instead of introducing peer navigation destinations.
assert.equal(pageDefinitions.get("calendar")?.canonicalId, "inbox", "calendar is a tab of Rituals");
assert.equal(pageDefinitions.get("familiar-work-queue")?.canonicalId, "board", "the work queue is a tab of Tasks");

console.log("canonical-nav-names: ok");
