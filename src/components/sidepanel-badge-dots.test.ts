// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebarCss = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── #1 collapsed-rail badge dots ────────────────────────────────────────────
// The collapsed icon rail no longer hides the nav badge outright — it restyles
// it into an accent dot so Board/Schedules/GitHub still signal at a glance.
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-badge \{[\s\S]*?position: absolute[\s\S]*?border-radius: 999px/,
  "collapsed rail shows the nav badge as a dot, not display:none",
);
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-folder-row \{[\s\S]*?position: relative/,
  "collapsed folder row is the positioning context for the dot",
);

// The companion rail and its Chat-tab needs-attention dot were removed with the
// right panel (drag-to-split replaces it). `workspace` stays read above only for
// the collapsed-nav badge context.
void workspace;

console.log("sidepanel-badge-dots.test.ts: ok");
