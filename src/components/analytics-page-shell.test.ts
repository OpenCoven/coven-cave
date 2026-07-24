import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const routePage = await source("app/familiars/[id]/analytics/page.tsx");
const dashPage = await source("app/dashboard/familiars/[id]/analytics/page.tsx");
const shell = await source("components/analytics-page-shell.tsx");
const css = await source("styles/analytics-page-shell.css");
const historyNav = await source("components/desktop-history-nav.tsx");

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
assert.match(shell, /<nav className="aps-rail" aria-label="Primary">/, "shell renders a labelled left nav rail");
assert.match(shell, /href: "\/\?mode=home"/, "rail deep-links Home into the SPA");
assert.match(shell, /href: "\/\?mode=chat"/, "rail deep-links Chat");
assert.match(shell, /href: "\/\?mode=board"/, "rail deep-links Tasks");
assert.match(shell, /href="\/dashboard"/, "rail links to the Dashboard route");

// â”€â”€ Destination routes share the desktop Shell chrome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
assert.match(shell, /import \{ DesktopHistoryNav \} from "@\/components\/desktop-history-nav"/, "standalone shell reuses the shared history controls");
assert.match(shell, /const isMobile = useIsMobile\(\)/, "standalone desktop chrome follows the shared mobile breakpoint");
assert.match(shell, /const railOpen = navOpen \|\| isMobile/, "mobile retains its existing primary rail when desktop navigation is collapsed");
assert.match(shell, /className="aps-top shell-top"/, "standalone shell mounts the shared desktop title bar");
assert.match(shell, /aria-label=\{navOpen \? "Collapse navigation" : "Expand navigation"\}/, "standalone title bar exposes the navigation toggle state");
assert.match(shell, /<DesktopHistoryNav \/>/, "standalone title bar includes the Back\/Forward pair");
assert.match(historyNav, /aria-label="Go back"/, "shared history navigation exposes Back accessibly");
assert.match(historyNav, /aria-label="Go forward"/, "shared history navigation exposes Forward accessibly");
assert.match(historyNav, /window\.history\.back\(\)/, "Back drives browser history");
assert.match(historyNav, /window\.history\.forward\(\)/, "Forward drives browser history");

// ── Persistent at EVERY screen size — the rail must not be hidden on small widths ─
assert.match(css, /\.aps-rail\s*\{/, "the rail has base styles");
assert.doesNotMatch(css, /\.aps-rail[^{]*\{[^}]*display:\s*none/, "the rail is never display:none");
assert.doesNotMatch(css, /@media[^{]*\{[^}]*\.aps-rail[^}]*display:\s*none/, "no media query hides the rail on small screens");
assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?\.aps-top\s*\{[\s\S]*?display:\s*none/, "mobile hides only the desktop title bar");

console.log("analytics-page-shell guard passed");
