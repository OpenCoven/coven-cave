// @ts-nocheck
// Canonical names in the command palette + shortcut help (issue #3283, bead
// cave-m4ih.6): the ⌘K launcher and the shortcuts sheet must speak the same
// vocabulary as the sidebar. "Go to …" rows already derive from FOLDER_MODES
// at runtime, so this pins the derivation itself plus the two hand-written
// spots that CAN drift: the "Tasks: …" board-view rows and the ⌘1–⌘5 help
// entry, both cross-checked against the sidebar's labels so a future rename
// fails here instead of shipping a stale name.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./shortcuts-sheet.tsx", import.meta.url), "utf8");

// Canonical id -> label (and id -> kbd) from the sidebar's FOLDER_MODES —
// the same source of truth canonical-nav-names.test.ts pins mobile against.
const folderModesBlock = sidebar.match(/const FOLDER_MODES[\s\S]*?\n\];/)?.[0];
assert.ok(folderModesBlock, "FOLDER_MODES block should be extractable");
const labels = new Map();
const kbds = new Map();
for (const m of folderModesBlock.matchAll(/\{ id: "([a-z-]+)", label: "([^"]+)"(?:[^\n]*?kbd: "([^"]+)")?/g)) {
  labels.set(m[1], m[2]);
  if (m[3]) kbds.set(m[1], m[3]);
}
assert.ok(labels.size > 0, "FOLDER_MODES should declare id/label rows");

// ── "Go to <surface>" rows derive from FOLDER_MODES at runtime ───────────────
assert.match(
  palette,
  /import \{ FOLDER_MODES, type FolderMode \} from "@\/components\/sidebar-minimal"/,
  "the palette imports the sidebar's FOLDER_MODES rather than its own surface list",
);
assert.match(
  palette,
  /name: `Go to \$\{fm\.label\}`/,
  "Go-to rows interpolate the canonical sidebar label (renames flow through automatically)",
);

// ── Board-view rows carry the canonical Tasks label as their prefix ──────────
const boardLabel = labels.get("board");
assert.ok(boardLabel, "the sidebar declares a board surface");
const boardViewsBlock = palette.match(/const BOARD_VIEWS[\s\S]*?\n\s*\];/)?.[0];
assert.ok(boardViewsBlock, "BOARD_VIEWS block should be extractable");
const boardViewLabels = [...boardViewsBlock.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
assert.ok(boardViewLabels.length >= 3, "the palette offers the board's views");
for (const label of boardViewLabels) {
  assert.ok(
    label.startsWith(`${boardLabel}: `),
    `board-view row "${label}" must lead with the canonical "${boardLabel}" label`,
  );
}

// ── ⌘1–⌘5 help lists exactly the shortcut surfaces, in order, by canonical
//    name — cross-checked against workspace.tsx's SURFACE_ORDER dispatch ──────
const surfaceOrderBlock = workspace.match(/const SURFACE_ORDER: WorkspaceMode\[\] = \[([\s\S]*?)\]/)?.[1];
assert.ok(surfaceOrderBlock, "SURFACE_ORDER should be extractable from workspace.tsx");
const surfaceOrder = [...surfaceOrderBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
assert.equal(surfaceOrder.length, 5, "⌘1–⌘5 dispatches five surfaces");

const orderedLabels = surfaceOrder.map((id) => {
  const label = labels.get(id);
  assert.ok(label, `SURFACE_ORDER mode "${id}" must be a sidebar surface`);
  return label;
});
assert.match(
  shortcuts,
  new RegExp(`keys: "⌘1–⌘5", description: "Jump to a surface \\(${orderedLabels.join(", ")}\\)"`),
  `the shortcut help must list the ⌘1–⌘5 surfaces as "${orderedLabels.join(", ")}" (canonical, dispatch order)`,
);

// The sidebar's per-row kbd hints agree with the same dispatch order.
surfaceOrder.forEach((id, i) => {
  assert.equal(
    kbds.get(id),
    `⌘${i + 1}`,
    `sidebar surface "${id}" should advertise ⌘${i + 1} to match SURFACE_ORDER`,
  );
});

// ── The shortcuts sheet renders the shared catalog (no second copy) ──────────
assert.match(
  sheet,
  /import \{[^}]*SHORTCUT_GROUPS[^}]*\} from "@\/lib\/keyboard-shortcuts"/,
  "the shortcuts sheet renders SHORTCUT_GROUPS instead of hand-written rows",
);

console.log("palette-canonical-names: ok");
