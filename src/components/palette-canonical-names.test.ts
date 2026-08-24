// @ts-nocheck
// Canonical names in the command palette + shortcut help (issue #3283, bead
// cave-m4ih.6): the ⌘K launcher and the shortcuts sheet must speak the same
// vocabulary as the shared workspace destination policy. The policy itself
// now composes page-registry titles with the workspace navigation metadata, so
// this pins the cross-check plus the two hand-written spots that CAN drift:
// the "Tasks: …" board-view rows and the ⌘1–⌘5 help entry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHORTCUT_GROUPS } from "../lib/keyboard-shortcuts.ts";
import { paletteDestinations } from "../lib/workspace-destination-policy.ts";
import { workspacePageDefinition } from "../lib/workspace-page-registry.ts";
import { WORKSPACE_NAV_ITEMS } from "../lib/workspace-navigation.ts";

const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./shortcuts-sheet.tsx", import.meta.url), "utf8");

const labels = new Map(WORKSPACE_NAV_ITEMS.map((item) => [item.id, item.label]));
const kbds = new Map(WORKSPACE_NAV_ITEMS.map((item) => [item.id, item.kbd]));
const destinations = paletteDestinations();
assert.ok(destinations.length > 0, "paletteDestinations() should stay populated");

for (const destination of destinations) {
  const navLabel = labels.get(destination.id);
  assert.ok(navLabel, `palette destination "${destination.id}" needs shared navigation metadata`);
  assert.equal(
    destination.title,
    navLabel,
    `palette destination "${destination.id}" must use the shared navigation label "${navLabel}"`,
  );
  const pageDefinition = workspacePageDefinition(destination.id);
  assert.ok(pageDefinition, `palette destination "${destination.id}" needs a page definition`);
  assert.equal(
    destination.title,
    pageDefinition.title,
    `palette destination "${destination.id}" must keep the page registry title in sync with navigation`,
  );
}

// ── "Go to <surface>" rows derive from the shared destination policy ─────────
assert.match(
  palette,
  /import \{ paletteDestinations \} from "@\/lib\/workspace-destination-policy"/,
  "the palette imports the shared destination policy rather than its own surface list",
);
assert.match(
  palette,
  /name: `Go to \$\{destination\.title\}`/,
  "Go-to rows interpolate the canonical destination title (renames flow through automatically)",
);

// ── Board-view rows carry the canonical Tasks label as their prefix ──────────
const boardDestination = destinations.find(({ id }) => id === "board");
assert.ok(boardDestination, "paletteDestinations() should include the board surface");
const boardViewsBlock = palette.match(/const BOARD_VIEWS[\s\S]*?\n\s*\];/)?.[0];
assert.ok(boardViewsBlock, "BOARD_VIEWS block should be extractable");
const boardViewLabels = [...boardViewsBlock.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
assert.ok(boardViewLabels.length >= 3, "the palette offers the board's views");
for (const label of boardViewLabels) {
  assert.ok(
    label.startsWith(`${boardDestination.title}: `),
    `board-view row "${label}" must lead with the canonical "${boardDestination.title}" label`,
  );
}

// ── ⌘1–⌘5 help lists exactly the shortcut surfaces, in order, by canonical
//    name — cross-checked against workspace.tsx's SURFACE_ORDER dispatch and
//    the shared destination metadata ──────────────────────────────────────────
const surfaceOrderBlock = workspace.match(/const SURFACE_ORDER: WorkspaceMode\[\] = \[([\s\S]*?)\]/)?.[1];
assert.ok(surfaceOrderBlock, "SURFACE_ORDER should be extractable from workspace.tsx");
const surfaceOrder = [...surfaceOrderBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
assert.equal(surfaceOrder.length, 5, "⌘1–⌘5 dispatches five surfaces");

const orderedLabels = surfaceOrder.map((id) => {
  const destination = destinations.find((candidate) => candidate.id === id);
  assert.ok(destination, `SURFACE_ORDER mode "${id}" must stay palette-reachable`);
  return destination.title;
});
assert.equal(
  SHORTCUT_GROUPS.find(
    (group) => group.id === "panels",
  )?.entries.find((entry) => entry.keys === "⌘1–⌘5")?.description,
  `Jump to a surface (${orderedLabels.join(", ")})`,
  `the shortcut help must list the ⌘1–⌘5 surfaces as "${orderedLabels.join(", ")}" (canonical, dispatch order)`,
);

// The navigation registry's per-row kbd hints agree with the same dispatch order.
surfaceOrder.forEach((id, i) => {
  assert.equal(
    kbds.get(id),
    `⌘${i + 1}`,
    `surface "${id}" should advertise ⌘${i + 1} to match SURFACE_ORDER`,
  );
});

// ── The shortcuts sheet renders the shared catalog (no second copy) ──────────
assert.match(
  sheet,
  /import \{[^}]*SHORTCUT_GROUPS[^}]*\} from "@\/lib\/keyboard-shortcuts"/,
  "the shortcuts sheet renders SHORTCUT_GROUPS instead of hand-written rows",
);

console.log("palette-canonical-names: ok");
