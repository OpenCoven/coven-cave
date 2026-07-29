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
const historyNav = await source("components/desktop-history-nav.tsx");
const navigation = await source("lib/workspace-navigation.ts");

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

// ── The shell renders a real left nav rail into the app's SPA surfaces ──────────
assert.match(
  shell,
  /className=\{`aps-rail\$\{isExpanded \? " aps-rail--expanded" : ""\}`\}/,
  "shell renders a labelled rail with an explicit expanded state",
);
assert.match(
  shell,
  /import \{ VISIBLE_WORKSPACE_NAV_ITEMS \} from "@\/lib\/workspace-navigation"/,
  "standalone routes consume the same navigation registry as the workspace sidebar",
);
assert.match(
  shell,
  /const PRIMARY = VISIBLE_WORKSPACE_NAV_ITEMS\.map/,
  "the standalone rail derives its destinations from the shared visible registry",
);
assert.doesNotMatch(
  shell,
  /\{ href: "\/\?mode=/,
  "the standalone rail must not hand-copy workspace deep links",
);
assert.match(navigation, /\{ id: "home", label: "Home"/, "canonical navigation registry includes Home");
assert.match(navigation, /\{ id: "chat", label: "Chat"/, "canonical navigation registry includes Chat");
assert.match(navigation, /\{ id: "board", label: "Tasks"/, "canonical navigation registry includes Tasks");
assert.match(shell, /href="\/dashboard"/, "rail links to the Dashboard route");
assert.match(shell, /<span className="aps-rail-label">Dashboard<\/span>/, "expanded rail links have visible labels");

// â”€â”€ Destination routes share the desktop Shell chrome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
assert.match(shell, /import \{ DesktopHistoryNav \} from "@\/components\/desktop-history-nav"/, "standalone shell reuses the shared history controls");
assert.match(shell, /const isMobile = useIsMobile\(\)/, "standalone desktop chrome follows the shared mobile breakpoint");
assert.match(shell, /const NAV_OPEN_PREF_KEY = "cave:shell:nav-open"/, "standalone routes share the workspace navigation preference");
assert.match(shell, /const \[navOpen, setNavOpen\] = useState\(false\)/, "SSR starts from the compact navigation rail");
assert.match(shell, /useLayoutEffect\(\(\) => \{[\s\S]*?const pref = readNavOpenPref\(\)/, "desktop restores its preference before paint");
assert.match(shell, /const pref = readNavOpenPref\(\)/, "standalone routes restore the shared navigation preference after hydration");
assert.match(shell, /writeNavOpenPref\(next\)/, "standalone route toggles persist the shared navigation preference");
assert.match(shell, /const isExpanded = !isMobile && navOpen/, "mobile always keeps the compact icon rail");
assert.match(shell, /className="aps-top shell-top"/, "standalone shell mounts the shared desktop title bar");
assert.match(shell, /aria-label=\{navOpen \? "Collapse navigation" : "Expand navigation"\}/, "standalone title bar exposes the navigation toggle state");
assert.match(shell, /<DesktopHistoryNav \/>/, "standalone title bar includes the Back\/Forward pair");
assert.match(historyNav, /aria-label="Go back"/, "shared history navigation exposes Back accessibly");
assert.match(historyNav, /aria-label="Go forward"/, "shared history navigation exposes Forward accessibly");
assert.equal((historyNav.match(/className="shell-top-toggle focus-ring"/g) ?? []).length, 2, "both history controls retain visible keyboard focus");
assert.equal((historyNav.match(/width=\{CAVE_ICON_SIZE\.shellToggle\}\s+height=\{CAVE_ICON_SIZE\.shellToggle\}/g) ?? []).length, 2, "both history controls use the shared shell icon size");
assert.match(historyNav, /window\.history\.back\(\)/, "Back drives browser history");
assert.match(historyNav, /window\.history\.forward\(\)/, "Forward drives browser history");
assert.equal((workspaceShell.match(/<DesktopHistoryNav/g) ?? []).length, 1, "workspace renders one shared history group");

// ── Persistent at EVERY screen size — the rail must not be hidden on small widths ─
assert.match(css, /\.aps-rail\s*\{/, "the rail has base styles");
assert.match(css, /\.aps-rail\s*\{[\s\S]*?overflow-x:\s*hidden/, "width transitions clip only the horizontal axis");
assert.doesNotMatch(css, /\.aps-rail\s*\{[^}]*overflow:\s*hidden/, "the rail never clips short viewport navigation vertically");
assert.match(css, /\.aps-rail-list\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto/, "short viewports scroll the destination list while keeping rail chrome fixed");
assert.match(css, /\.aps-rail-label\s*\{[\s\S]*?display:\s*none/, "labels stay hidden in the compact rail");
assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*?\.aps-rail--expanded\s*\{[\s\S]*?width:\s*var\(--shell-nav-width\)/, "only desktop can expand the rail");
assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*?\.aps-rail--expanded \.aps-rail-label\s*\{[\s\S]*?display:\s*block/, "expanded desktop rail reveals labels");
assert.doesNotMatch(css, /\.aps-rail\s*\{[^}]*display:\s*none/, "the rail is never display:none");
assert.doesNotMatch(css, /@media[^{]*\{[^}]*\.aps-rail[^}]*display:\s*none/, "no media query hides the rail on small screens");
assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?\.aps-top\s*\{[\s\S]*?display:\s*none/, "mobile hides only the desktop title bar");
assert.match(css, /\.aps-main > \.dr-page\s*\{[\s\S]*?min-height:\s*100%;[\s\S]*?height:\s*100%;/, "reporting pages stay within the pane below desktop chrome instead of adding a second page scrollbar");
assert.match(desktopChrome, /@media \(min-width: 1024px\) \{[\s\S]*?\.aps-top \+ \.aps-body \.settings-shell__header\s*\{[\s\S]*?padding-left:\s*var\(--space-3\)/, "destination settings header avoids a duplicate traffic-light inset only with visible desktop chrome");
assert.match(desktopChrome, /@media \(min-width: 1024px\) \{[\s\S]*?\.aps-top \+ \.aps-body \.dr-topbar\s*\{[\s\S]*?padding-left:\s*clamp\(20px, 5vw, 64px\)/, "destination report breadcrumbs avoid a duplicate traffic-light inset only with visible desktop chrome");

console.log("analytics-page-shell guard passed");
