// @ts-nocheck
// Source-regex pins for the /dashboard bento surface (Claude Design import,
// cave-g9os). The pure derivations behind every panel are behavior-tested in
// src/lib/bento-dashboard.test.ts; these pins cover the React wiring — which
// data sources feed the surface, which helpers drive each panel, and the
// interaction/a11y contract of the design (collapsibles, carousel, roster).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// ── Page (server shell) ───────────────────────────────────────────────────────

const pageUrl = new URL("./dashboard/page.tsx", import.meta.url);
assert.equal(existsSync(pageUrl), true, "dashboard route should exist at /dashboard");
const page = readFileSync(pageUrl, "utf8");

assert.match(page, /loadInbox/, "dashboard seeds from the persisted inbox");
assert.match(page, /buildDashboardModel/, "dashboard builds the first-paint view-model");
assert.match(page, /BentoDashboard/, "dashboard renders the bento surface");
assert.match(page, /dr-page dr-page--bento/, "page opts into the flex shell so the frame fills the viewport");
assert.match(page, /dr-topbar/, "the sticky breadcrumb topbar stays");
assert.match(page, /AnalyticsPageShell/, "dashboard mounts the standalone left side-panel (cave-4i6u)");
assert.doesNotMatch(page, /<main /, "the shell's aps-main is the page's main landmark — no nested <main>");

// ── Component wiring ──────────────────────────────────────────────────────────

const bentoUrl = new URL("../components/dashboard/bento-dashboard.tsx", import.meta.url);
assert.equal(existsSync(bentoUrl), true, "BentoDashboard component should exist");
const bento = readFileSync(bentoUrl, "utf8");

// Live data sources — every panel is real data, none of the design's fixtures.
assert.match(bento, /\/api\/board/, "board panel pulls the live board");
assert.match(bento, /\/api\/familiars/, "roster pulls the familiar list");
assert.match(bento, /\/api\/inbox/, "needs-you pulls the live inbox");
assert.match(bento, /\/api\/sessions\/list/, "stats/heatmap/carousel pull sessions");
assert.match(bento, /\/api\/coven-memory/, "familiar card stats pull coven memory");
assert.match(bento, /\/api\/projects/, "the projects stat pulls the project registry");
assert.match(bento, /\/api\/github\/activity/, "github rail pulls activity");
assert.match(bento, /\/api\/github\/assigned/, "github rail merges assigned items");
assert.match(bento, /usePausablePoll\(load, 30_000\)/, "polls on the shared pausable interval");
assert.match(bento, /aliveRef/, "poll results guard against unmounted setState");
assert.match(
  bento,
  /inboxReady \? buildDashboardModel\(data\.inbox, new Date\(\)\) : initialModel/,
  "the server model is only the first-paint seed — polls rebuild it from the fresh inbox",
);

// Pure helpers drive every panel — no inline derivation drift.
assert.match(bento, /sessionTotals\(/, "stat tiles derive from sessionTotals");
assert.match(bento, /covenStreak\(/, "streak tile uses the shared covenStreak");
assert.match(bento, /longestStreak\(/, "streak tile shows the personal best");
assert.match(bento, /streakPips\(/, "streak pips fill against the best");
assert.match(bento, /heatmapCells\(/, "heatmap derives from heatmapCells");
assert.match(bento, /activityFeed\(/, "feed derives from activityFeed");
assert.match(bento, /boardBuckets\(/, "board columns derive from boardBuckets");
assert.match(bento, /buildFamiliarCardStats\(/, "roster stats derive from buildFamiliarCardStats");
assert.match(bento, /carouselSlides\(/, "carousel derives from carouselSlides");
assert.match(bento, /sparkPath\(/, "carousel charts render sparkPath SVGs");
assert.match(bento, /useFamiliarContracts\(data\.familiars\)/, "matrix sources self-reports through the shared hook");
assert.match(bento, /matrixRows\(/, "matrix derives from matrixRows");
assert.match(bento, /githubByRepo\(/, "github rail groups by repo");
assert.match(bento, /ciSummary\(/, "github footer rolls up CI status");
assert.match(bento, /topCollaborators\(/, "footer ranks collaborators by session volume");
assert.match(bento, /useUserProfile\(\)/, "human card reads the operator profile store");
assert.match(bento, /userAvatarUrl\(/, "human avatar uses the authed object URL, never a raw /api src");

// Design interactions.
assert.match(bento, /aria-expanded=\{heatOpen\}/, "heatmap header is a collapsible button");
assert.match(bento, /aria-expanded=\{famOpen\}/, "familiars header is a collapsible button");
assert.match(bento, /aria-pressed=\{selFam === f\.id\}/, "roster selection is a toggle button");
assert.match(bento, /scrollBy\(\{ left: dir \* el\.clientWidth, behavior: "smooth" \}\)/, "‹› page the roster a viewport at a time");
assert.match(bento, /suppressClickRef/, "grab-to-scroll suppresses the click that ends a drag");
assert.match(bento, /setInterval\(\(\) => \{/, "carousel auto-advances");
assert.match(bento, /, 6000\)/, "…every 6 seconds");
assert.match(bento, /onMouseEnter=\{\(\) => setPaused\(true\)\}/, "hovering the carousel pauses auto-advance");
assert.match(bento, /aria-current=\{i === slide\}/, "carousel dots expose the active slide");
assert.match(bento, /href="\/dashboard\/familiars\/growth"/, "matrix links through to the growth dashboard");
assert.match(bento, /openExternalUrl\(g\.url\)/, "github rows open externally (Tauri-safe)");
assert.match(bento, /<time/, "timestamps render as <time> elements");

// A11y conventions: interactive things are buttons/links, not clickable divs.
assert.doesNotMatch(bento, /<div[^>]*onClick/, "no clickable divs");
assert.match(bento, /focus-ring/, "interactive elements carry the shared focus ring");

// ── Styles ────────────────────────────────────────────────────────────────────

const cssUrl = new URL("../styles/bento-dashboard.css", import.meta.url);
assert.equal(existsSync(cssUrl), true, "bento stylesheet should exist");
const css = readFileSync(cssUrl, "utf8");

assert.match(css, /\.dr-page--bento/, "defines the page flex modifier");
assert.match(css, /--accent-presence/, "accent ramp derives from the theme accent token");
assert.match(css, /--glow-numeral/, "stat values use the shared light-mode-safe glow token");
assert.match(css, /grid-auto-flow: column/, "heatmap grid is column-major (weeks as columns)");
assert.match(css, /prefers-reduced-motion/, "carousel transition respects reduced motion");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hard-coded hex colors — theme tokens only");

// ── The cockpit stays deleted ─────────────────────────────────────────────────

for (const rel of [
  "../components/dashboard/dashboard-cockpit.tsx",
  "../components/dashboard/cockpit-panels.tsx",
  "../components/dashboard/action-inbox.tsx",
  "../components/dashboard/today-summary.tsx",
  "../components/dashboard/recent-reports.tsx",
  "../components/dashboard/report-callout.tsx",
  "../lib/dashboard-cockpit-format.ts",
]) {
  assert.equal(existsSync(new URL(rel, import.meta.url)), false, `${rel} stays deleted`);
}
assert.doesNotMatch(page, /DashboardCockpit/, "page no longer references the cockpit");

console.log("dashboard-page.test.ts: ok");
