// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Familiar selection is dropdown-only ───────────────────────────────────────
// The one-tap avatar strip (and its avatars/dropdown style preference) is
// retired: FamiliarQuickSwitch is a thin wrapper around the full switcher menu.
assert.match(source, /<FamiliarSwitcher/, "renders the FamiliarSwitcher dropdown");
assert.doesNotMatch(source, /familiar-quickswitch__strip/, "the avatar strip markup is retired");
assert.doesNotMatch(source, /useFamiliarSwitcherStyle|useFamiliarStripScope/, "the strip style/scope preferences are retired");
assert.doesNotMatch(source, /computeQuickSwitch/, "the strip's pin/recency selector is retired");

// Strip CSS is gone with it (the wrapper class stays for the top-bar cluster).
assert.doesNotMatch(globals, /\.familiar-quickswitch__strip \{/, "strip CSS removed");
assert.match(globals, /\.familiar-quickswitch \{/, "wrapper CSS remains for the top-bar call site");

// ── Desktop home: the chat sidebar's header switcher ─────────────────────────
// The desktop menu bar no longer hosts familiar selection; the sidebar header
// does (labeled trigger, All-familiars scope via onSelectFamiliar).
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
assert.match(
  sidebar,
  /<header className="cnav__header">[\s\S]*?<FamiliarSwitcher[\s\S]*?onSelectFamiliar=\{onSelectFamiliar\}[\s\S]*?labeled/,
  "the chat sidebar header hosts the labeled familiar switcher",
);

console.log("familiar-quick-switch component: all assertions passed");
