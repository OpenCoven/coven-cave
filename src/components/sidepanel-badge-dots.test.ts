// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebarCss = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const rail = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");
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

// ── #2 companion-rail tab badge ─────────────────────────────────────────────
assert.match(rail, /chatBadge\?: boolean/, "rail accepts a chat badge flag");
assert.match(rail, /chatBadge = false/, "chat badge defaults off");
assert.match(rail, /className="companion-rail__tab-dot"/, "Chat tab renders a needs-attention dot");
assert.match(globals, /\.companion-rail__tab-dot \{[\s\S]*?position: absolute/, "tab dot is styled");
assert.match(globals, /\.companion-rail__tab \{\n\s*position: relative;/, "tab is the dot's positioning context");
// The right companion rail was removed (drag-to-split replaces it), so the
// workspace no longer wires a Chat-tab needs-reply dot. `workspace` stays read
// above only for the collapsed-nav badge context.
void workspace;

console.log("sidepanel-badge-dots.test.ts: ok");
