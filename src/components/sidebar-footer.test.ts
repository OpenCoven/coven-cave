// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");
const minimal = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatNav = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// The side-panel footer (Dashboard + Settings) is shared by whichever
// primary sidebar host is active: SidebarMinimal normally, or WorkspaceSidebar
// while Chat replaces it.

// The shared component owns the whole footer.
assert.match(footer, /export function SidebarFooter\(\{[\s\S]*onOpenSettings,[\s\S]*activeDestination/, "SidebarFooter accepts the active standalone destination");
assert.match(footer, /import Link from "next\/link"/, "footer uses Next client navigation");
assert.match(footer, /<Link[\s\S]*?href="\/dashboard"/, "footer links to the Dashboard route through Next");
assert.doesNotMatch(footer, /<a[\s\S]*?href="\/dashboard"/, "footer does not hard-navigate to Dashboard");
assert.match(footer, /onClick=\{onOpenSettings\}[\s\S]*?aria-label="Settings"/, "footer Settings button calls onOpenSettings");
assert.match(footer, /aria-current=\{activeDestination === "dashboard" \? "page" : undefined\}/, "footer exposes the active Dashboard route");
assert.match(footer, /aria-current=\{activeDestination === "settings" \? "page" : undefined\}/, "footer exposes the active Settings route");
assert.match(
  footer,
  /aria-label="Dashboard"[\s\S]*?aria-label="Settings"/,
  "Dashboard precedes Settings in the footer",
);
assert.doesNotMatch(footer, /APP_VERSION|sidebar-version/, "the desktop sidebar omits the version line");

// Each alternate nav host renders it, so the active footer cannot drift…
assert.match(minimal, /import \{ SidebarFooter \} from "@\/components\/sidebar-footer"/, "SidebarMinimal imports the shared footer");
assert.match(minimal, /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>/, "SidebarMinimal renders the shared footer");
// One sidebar renders the footer now; the embedded chat list must NOT mount a
// second copy (cave-fh9so).
assert.doesNotMatch(
  chatNav,
  /import \{ SidebarFooter \} from "@\/components\/sidebar-footer"/,
  "the embedded chat list does not mount a second footer",
)
assert.doesNotMatch(chatNav, /<SidebarFooter/, "the embedded chat list renders no footer of its own");
// …and neither hand-rolls its own copy anymore.
assert.doesNotMatch(minimal, /className="sidebar-foot"[\s\S]{0,40}href="\/dashboard"/, "SidebarMinimal no longer inlines the footer markup");

// WorkspaceSidebar takes onOpenSettings, and workspace threads it through to the
// chat nav so the Settings button is wired on Chat too.
assert.doesNotMatch(
  chatNav,
  /onOpenSettings: \(\) => void;/,
  "the embedded chat list declares no settings prop — the sidebar footer owns it",
)
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]*?onOpenSettings=\{\(\) => \{[\s\S]*?push\("\/settings"\)/,
  "workspace wires onOpenSettings into the one sidebar",
)


// #5888: Dashboard and Canvas no longer share ph:squares-four.
assert.match(footer, /<Icon name="ph:chart-line-up"[^>]*className="sidebar-foot-icon"/, "Dashboard has its own glyph");
assert.doesNotMatch(footer, /<Icon name="ph:squares-four"/, "the footer doesn't reuse Canvas's glyph");
console.log("sidebar-footer.test.ts: ok");
