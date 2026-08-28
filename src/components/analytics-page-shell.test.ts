import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const routePage = await source("app/familiars/[id]/analytics/page.tsx");
const dashPage = await source("app/dashboard/familiars/[id]/analytics/page.tsx");
const shell = await source("components/analytics-page-shell.tsx");
const workspaceShell = await source("components/shell.tsx");
const css = await source("styles/analytics-page-shell.css");
const desktopChrome = await source("styles/globals/desktop-chrome.css");
const navigation = await source("lib/workspace-navigation.ts");
const analyticsView = await source("components/familiar-analytics-view.tsx");

// ── The canonical analytics route wraps the view in the left-sidepanel shell ──
assert.match(dashPage, /import \{ AnalyticsPageShell \} from "@\/components\/analytics-page-shell"/, "/dashboard/familiars/[id]/analytics imports the shell");
assert.match(
  dashPage,
  /<AnalyticsPageShell>[\s\S]*<FamiliarAnalyticsView familiarId=\{id\} \/>[\s\S]*<\/AnalyticsPageShell>/,
  "/dashboard/familiars/[id]/analytics renders the analytics view inside AnalyticsPageShell (left sidepanel)",
);

// ── The old top-level twin is a redirect stub into the canonical tree
//    (route consolidation, cave-m4ih.5) — deep links keep working ─────────────
assert.match(routePage, /import \{ redirect \} from "next\/navigation"/, "/familiars/[id]/analytics is a redirect stub");
assert.match(
  routePage,
  /redirect\(`\/dashboard\/familiars\/\$\{encodeURIComponent\(id\)\}\/analytics\$\{suffix\}`\)/,
  "/familiars/[id]/analytics forwards into the canonical dashboard route (query preserved)",
);
assert.doesNotMatch(routePage, /AnalyticsPageShell/, "the stub renders nothing of its own");

// ── Standalone routes use the real application shell ───────────────────────────
assert.match(
  shell,
  /import \{ Shell, type ShellHandle \} from "@\/components\/shell"/,
  "destination pages reuse the canonical workspace Shell",
);
assert.match(
  shell,
  /nav=\{<DestinationSidebar pathname=\{pathname\} \/>\}/,
  "the canonical Shell receives the standalone sidebar",
);
assert.match(
  shell,
  /navPolicy="remembered"/,
  "standalone routes share the workspace navigation preference",
);
assert.doesNotMatch(
  shell,
  /\baps(?:-|")/,
  "the deleted parallel aps frame is no longer rendered",
);

// ── The sidebar and mobile navigation share canonical registries/primitives ───
// The Home/Chat section switcher is retired (cave-fh9so): Chat is a
// destination in one flat list rather than a mode the rail toggles between, so
// there is no switcher left to share. What must still hold is that this
// standalone shell derives its rows from the SAME registry the workspace uses
// rather than hard-coding a second list.
assert.doesNotMatch(shell, /NavSectionTabs/, "the retired section switcher is not resurrected here");
assert.match(shell, /VISIBLE_WORKSPACE_NAV_ITEMS/, "standalone sidebar rows come from the shared navigation registry");

// Settings and Dashboard render through this shell, so its rail is the one the
// user sees on those pages. It must be grouped the way the workspace rail is —
// a flat list here made them the only two pages whose sidebar looked different.
assert.match(shell, /import \{ SidebarSection \}/, "the standalone rail uses the shared section primitive");
assert.match(
  shell,
  /<SidebarSection id="navigation" label="Navigation">/,
  "…with the same Navigation group as the workspace rail",
);
assert.match(
  shell,
  /<SidebarSection\s+id="explore"\s+label="Explore"\s+hideWhenEmpty/,
  "…and the same Explore group for the quiet destinations",
);
// The unlabelled step that used to separate the quiet rows is gone: the
// heading carries that meaning, and both together read as a gap inside a
// titled group.
assert.doesNotMatch(shell, /sidebar-folder-row--quiet-lead/, "no unlabelled step survives beside the Explore heading");
assert.match(shell, /className="sidebar-minimal"/, "standalone sidebar uses the canonical sidebar host");
assert.match(shell, /className=\{`sidebar-folder-row focus-ring/, "standalone links use canonical destination-row styling");
assert.match(shell, /<SidebarFooter[\s\S]*activeDestination=/, "standalone sidebar reuses the shared Dashboard/Settings footer");
assert.match(shell, /<MobileBottomTabs/, "mobile destinations use the same bottom navigation as the workspace");
assert.match(navigation, /\{ id: "home", label: "Home"/, "canonical navigation registry includes Home");
assert.match(navigation, /\{ id: "chat", label: "Chat"/, "canonical navigation registry includes Chat");
assert.match(navigation, /\{ id: "board", label: "Tasks"/, "canonical navigation registry includes Tasks");

// ── Desktop and mobile chrome come from the shared Shell implementation ──────
assert.match(workspaceShell, /<DesktopHistoryNav \/>/, "the canonical Shell owns browser history controls");
assert.match(workspaceShell, /className="shell-detail-panel"/, "the canonical Shell owns the inset detail frame");
assert.match(workspaceShell, /<MobileDrawer/, "the canonical Shell owns responsive sidebar drawers");
assert.match(shell, /shellRef\.current\?\.toggleNav\(\)/, "the destination mobile bar toggles the canonical nav drawer");
assert.match(css, /\.destination-shell__mobile-title/, "destination-only CSS is limited to the mobile title slot");
assert.doesNotMatch(css, /\.aps/, "no parallel shell geometry remains");
assert.match(desktopChrome, /\.shell-frame \.settings-shell__header/, "settings avoids a duplicate traffic-light inset inside the shared Shell");
assert.match(desktopChrome, /\.shell-frame \.dr-topbar/, "dashboard breadcrumbs avoid a duplicate traffic-light inset inside the shared Shell");
assert.doesNotMatch(analyticsView, /<main className="fa-page"/, "familiar analytics does not nest a second main landmark inside Shell");

console.log("analytics-page-shell guard passed");
