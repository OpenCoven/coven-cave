// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");
const minimal = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatNav = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// The side-panel footer (Dashboard + Settings + version) is a single shared
// component so it renders identically in every host — the global nav
// SidebarMinimal and Chat's independent WorkspaceSidebar thread list.

// The shared component owns the whole footer.
assert.match(footer, /export function SidebarFooter\(\{ onOpenSettings \}/, "SidebarFooter is a shared component taking onOpenSettings");
assert.match(footer, /href="\/dashboard"/, "footer links to the Dashboard route");
assert.match(footer, /onClick=\{onOpenSettings\}[\s\S]*?aria-label="Settings"/, "footer Settings button calls onOpenSettings");
assert.match(footer, /className="sidebar-version"[\s\S]*?v\{APP_VERSION\}/, "footer shows the app version line");

// Both nav hosts render it (so the footer can't drift between them)…
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
