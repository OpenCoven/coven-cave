// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");
const minimal = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatNav = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// The side-panel footer (Dashboard + Settings + version) is a single shared
// component so it renders identically in every nav host — and, critically,
// persists on Chat, whose nav panel swaps SidebarMinimal out for WorkspaceSidebar.

// The shared component owns the whole footer.
assert.match(footer, /export function SidebarFooter\(\{ onOpenSettings \}/, "SidebarFooter is a shared component taking onOpenSettings");
assert.match(footer, /function DraggablePageDestination\(/, "footer shares one focused draggable destination implementation");
assert.equal(
  footer.match(/setData\(PAGE_DRAG_MIME/g)?.length,
  1,
  "Dashboard and Settings share one page-drag protocol instead of copying it",
);
assert.match(footer, /pageId="dashboard"[\s\S]{0,160}href="\/dashboard"/, "Dashboard keeps its real /dashboard link semantics");
assert.match(footer, /pageId="settings"[\s\S]{0,160}onClick=\{onOpenSettings\}/, "Settings keeps its existing onOpenSettings button semantics");
assert.match(footer, /draggable[\s\S]{0,300}onDragStart=\{handleDragStart\}[\s\S]{0,160}onDragEnd=\{emitPageDragEnd\}/, "both footer destinations use the shared draggable behavior");
assert.match(footer, /setData\(PAGE_DRAG_MIME, pageId\)/, "footer drag data carries the exact registry page id");
assert.match(footer, /setData\("text\/plain", label\)/, "footer drag data includes the registry label");
assert.match(footer, /effectAllowed = "copy"/, "footer page drags advertise copy semantics");
assert.match(footer, /emitPageDragStart\(\{ mode: pageId, label \}\)/, "footer announces drag start with page id and label");
assert.match(footer, /onDragEnd=\{emitPageDragEnd\}/, "footer clears the shared drag state when dragging ends");
assert.match(footer, /aria-label=\{label\}/, "footer controls preserve an accessible registry-derived label");
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
