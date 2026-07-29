// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");
const minimal = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatNav = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// The side-panel footer (Dashboard + Settings + version) is shared by whichever
// primary sidebar host is active: SidebarMinimal normally, or WorkspaceSidebar
// while Chat replaces it.

// The shared component owns the whole footer.
assert.match(footer, /export function SidebarFooter\(\{ onOpenSettings \}/, "SidebarFooter is a shared component taking onOpenSettings");
assert.match(footer, /href="\/dashboard"/, "footer links to the Dashboard route");
assert.match(footer, /onClick=\{onOpenSettings\}[\s\S]*?aria-label="Settings"/, "footer Settings button calls onOpenSettings");
assert.match(footer, /className="sidebar-version"[\s\S]*?v\{APP_VERSION\}/, "footer shows the app version line");
// The version line is the shortest path to what it's about: Settings → About
// carries the version, updates and project links, and the settings shell
// honours the `#about` section hash. It's a real link to the standalone route
// (same idiom as the Dashboard link above), not an onOpenSettings caller —
// which also keeps middle-click / open-in-new-window working.
assert.match(footer, /href="\/settings#about"/, "the version line deep-links to Settings → About");
assert.match(
  footer,
  /className="sidebar-version"[\s\S]{0,240}?aria-label=\{`CovenCave v\$\{APP_VERSION\} — open About in Settings`\}/,
  "the version link says where it goes, since 'v0.2.0' alone is not an action",
);
const aboutSection = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
assert.match(aboutSection, /id: "about"/, "the About section id the version line targets exists");

// Quiet at rest, and only admits to being a link on hover/focus — the footer's
// calm is the point.
const shellChrome = readFileSync(new URL("../styles/sidebar-minimal/shell-chrome.css", import.meta.url), "utf8");
assert.match(
  shellChrome,
  /\.sidebar-version:hover,\s*\n\.sidebar-version:focus-visible \{\s*\n\s*color: var\(--text-primary\);/,
  "the version link brightens on hover and keyboard focus",
);
assert.match(
  shellChrome,
  /\.sidebar-version \{[\s\S]*?text-decoration: none;/,
  "no underline — it stays the calmest line in the footer",
);

// Each alternate nav host renders it, so the active footer cannot drift…
assert.match(minimal, /import \{ SidebarFooter \} from "@\/components\/sidebar-footer"/, "SidebarMinimal imports the shared footer");
assert.match(minimal, /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>/, "SidebarMinimal renders the shared footer");
assert.match(chatNav, /import \{ SidebarFooter \} from "@\/components\/sidebar-footer"/, "the chat nav imports the shared footer");
assert.match(chatNav, /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>/, "the chat nav (WorkspaceSidebar) renders the shared footer so Chat keeps it");
// …and neither hand-rolls its own copy anymore.
assert.doesNotMatch(minimal, /className="sidebar-foot"[\s\S]{0,40}href="\/dashboard"/, "SidebarMinimal no longer inlines the footer markup");

// WorkspaceSidebar takes onOpenSettings, and workspace threads it through to the
// chat nav so the Settings button is wired on Chat too.
assert.match(chatNav, /onOpenSettings: \(\) => void;/, "WorkspaceSidebar declares an onOpenSettings prop");
assert.match(workspace, /<WorkspaceSidebar[\s\S]*?onOpenSettings=\{\(\) => \{[\s\S]*?push\("\/settings"\)/, "workspace wires onOpenSettings into the chat nav");

console.log("sidebar-footer.test.ts: ok");
