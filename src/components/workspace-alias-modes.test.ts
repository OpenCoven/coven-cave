// @ts-nocheck
// Alias-mode wiring pins (issue #3283, cave-m4ih.3): the Workspace must route
// every compatibility mode exactly where MODE_ALIASES says it lands. setMode's
// rewrite branches and the render branches are hand-written (they carry side
// effects and per-surface tab props), so this test cross-checks each one
// against the table — if the table and the wiring ever disagree, this fails
// before a deep link can strand a user on the wrong surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODE_ALIASES } from "../lib/workspace-mode.ts";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const urlState = readFileSync(new URL("../lib/workspace-url-state.ts", import.meta.url), "utf8");
const navState = readFileSync(new URL("../lib/sidebar-nav-state.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");

// ── Rewrite aliases: setMode replaces them, so `mode` never holds them ───────

function branchTarget(alias) {
  const m = workspace.match(
    new RegExp(`if \\(next === "${alias}"\\) \\{[\\s\\S]{0,700}?setModeRaw\\("([a-z-]+)"\\)`),
  );
  assert.ok(m, `setMode should have a rewrite branch for the "${alias}" alias`);
  return m[1];
}

for (const alias of ["groupchat", "journal", "flow"]) {
  assert.equal(
    branchTarget(alias),
    MODE_ALIASES[alias],
    `setMode's "${alias}" branch must land on MODE_ALIASES.${alias} ("${MODE_ALIASES[alias]}")`,
  );
}

// ── Tab aliases: kept in state; the render branch mounts the canonical
//    surface on the matching tab, keyed by the alias so deep links land ──────

assert.equal(MODE_ALIASES["familiar-work-queue"], "board");
assert.match(
  workspace,
  /mode === "board" \|\| mode === "familiar-work-queue"[\s\S]{0,400}?<BoardView\s+key=\{mode\}\s+initialTab=\{mode === "familiar-work-queue" \? "queue" : "tasks"\}/,
  "the familiar-work-queue alias renders the Tasks surface on its Queue tab (keyed remount)",
);

assert.equal(MODE_ALIASES.calendar, "inbox");
assert.match(
  workspace,
  /mode === "inbox" \|\| mode === "calendar"[\s\S]{0,400}?key=\{mode\}\s+initialTab=\{mode === "calendar" \? "calendar" : "overview"\}/,
  "the calendar alias renders the Rituals surface on its Calendar tab (keyed remount)",
);

assert.equal(MODE_ALIASES.roles, "marketplace");
assert.equal(MODE_ALIASES.capabilities, "marketplace");
assert.match(
  workspace,
  /mode === "marketplace" \|\| mode === "roles" \|\| mode === "capabilities"[\s\S]{0,500}?key=\{mode\}\s+initialSection=\{mode === "roles" \? "roles" : mode === "capabilities" \? "capabilities" : "browse"\}/,
  "the roles/capabilities aliases render the Marketplace hub on their sections (keyed remount)",
);

// ── Every mode-string entry point validates/routes through the shared
//    vocabulary instead of ad-hoc special cases ──────────────────────────────

assert.match(
  urlState,
  /function readModeParam\(\): WorkspaceMode \| null \{[\s\S]{0,300}?isWorkspaceMode\(raw\)/,
  "?mode= deep links validate via isWorkspaceMode (canonical + alias vocabulary)",
);
assert.match(
  workspace,
  /if \(last && \(isWorkspaceMode\(last\) \|\| isRoleSurfaceMode\(last\)\)\) setMode\(last as CaveMode\)/,
  "persisted last-surface restore validates via isWorkspaceMode and lets setMode route aliases",
);
assert.doesNotMatch(
  workspace,
  /last === "flow"|targetMode === "flow"/,
  "no ad-hoc flow special-casing outside setMode's alias funnel",
);

// ── Row highlighting and the sidebar vocabulary derive from the same table ───

assert.match(
  navState,
  /import \{ MODE_ALIASES, isAliasWorkspaceMode \} from "\.\/workspace-mode\.ts"/,
  "sidebar-nav-state derives row highlighting from the shared MODE_ALIASES table",
);
assert.match(
  sidebar,
  /export type FolderMode = WorkspaceMode/,
  "the sidebar reuses the WorkspaceMode union instead of a drifting copy",
);

console.log("workspace-alias-modes: ok");
