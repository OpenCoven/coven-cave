// Bundle-size budget gate. Runs automatically after `pnpm build` (as the
// `postbuild` lifecycle hook), so the existing "Frontend build" CI check fails
// if client JS regresses past budget — no new required status check needed.
//
// What it guards:
//   1. HOME ROUTE — Next's complete first-load JS graph for `/`, including
//      App Router page/layout entries and shared root chunks.
//   2. SHELL — the always-loaded root chunks (build-manifest `rootMainFiles`):
//      the JS every page load pays for, regardless of surface. This is the
//      clearest health signal and what code-splitting protects.
//   3. CATASTROPHIC chunk — a loose ceiling on the single largest chunk, to
//      catch a heavy dep ballooning one chunk back toward the pre-split ~3 MB.
//
// Next 16 writes `.next/diagnostics/route-bundle-stats.json` from the same App
// Router client-reference manifests it uses for its build report. Consuming
// that diagnostic avoids reconstructing Turbopack's route graph ourselves.
//
// Tune by lowering the budgets as splitting work lands. Override at runtime with
// BUNDLE_MAX_HOME_KB / BUNDLE_MAX_SHELL_KB / BUNDLE_MAX_CHUNK_KB for
// experiments.
//
// Run: `node scripts/bundle-budget.mjs` (wired as `pnpm test:bundle` + postbuild).

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(root, ".next");
const chunksDir = path.join(nextDir, "static", "chunks");
const routeStatsFile = path.join(nextDir, "diagnostics", "route-bundle-stats.json");

// Budgets, seeded with headroom over the post-split measured values so ordinary
// feature growth doesn't trip them — only a structural regression does.
// Measured at introduction: shell ~447 KB, largest chunk ~1713 KB (the lazy
// code-editor surface: @uiw/react-codemirror + @xterm).
// #3262 baseline (origin/main d5ed41b): 4,796,271 bytes across 30 first-load
// chunks. After splitting non-conversation surfaces: 2,452,293 bytes across 20
// chunks. 2,800 KiB preserves ~17% growth headroom without allowing the old
// 4.57 MiB graph back in unnoticed.
const MAX_HOME_BYTES = (Number(process.env.BUNDLE_MAX_HOME_KB) || 2800) * 1024;
const MAX_SHELL_BYTES = (Number(process.env.BUNDLE_MAX_SHELL_KB) || 650) * 1024;
const MAX_CHUNK_BYTES = (Number(process.env.BUNDLE_MAX_CHUNK_KB) || 2400) * 1024;
// CSS budgets (#3264). ROOT CSS is what EVERY route pays (measured via the
// minimal _not-found route, which only loads the root layout's styles);
// HOME CSS is the complete first-load stylesheet set for `/`. The Phase A
// stylesheet facades preserve the same cascade, but Turbopack emits the
// imported home/chat/markdown modules as independently optimized chunks:
// current measurements are 665 KiB root / 904 KiB home. Budget raised 900→910
// in the home-minimal PR (2026-07-22): new home Continue cards + context-chip
// styles are home-startup surface CSS (not cross-route), +~18 KiB net.
// Raised 910→915 (2026-07-23, cave-c7hy): --accent-presence-hover token
// definitions (foundations + 15 theme overrides) are cascade-wide a11y
// tokens, +~1 KiB; the measured home set was already at 910.
// Raised 915→920 (2026-07-24, cave-99s9): Blaze backdrop-style rules in
// backdrop.css (fill + reduced-motion hide) are home-startup surface CSS,
// +<1 KiB; the measured home set already sat exactly at the 915 boundary
// after the 3a dashboard redesign (#3758/#3763).
// Raised root 690→696 / home 920→936 (2026-07-24, cave-q8uc): the Familiar
// Analytics modernization (Familiar Analytics.dc.html handoff) grows the
// .fa-* analytics rules in surface-reporting.css — the new 3-column hero,
// needs-attention banner, featured self-heal grid, collapsible panels,
// contract detail panel, pager, and action-modal styling (+~13 KiB home /
// +~3 KiB root). This surface's CSS has always lived in the global bundle;
// follow-up cave-5rqi tracks extracting it to a component-imported sheet.
// Raised home 936→940 (2026-07-25, cave-2l7h): the hearth-Home restore /
// dashboard-to-new-chat swap returns the hearth sheets (landing-composer +
// hearth-continuations) to the home graph while home-dashboard.css stays in
// it (now imported via chat-view's ChatNewDashboard); the pruned dashboard
// chrome/dock offsets most but not all of the restored hearth CSS (+2 KiB
// measured, 938).
// LOWERED root 696→660 / home 940→900 (2026-07-24, cave-5rqi): did that #3264
// extraction — the whole .fa-* analytics surface (~46 KiB) moved from the
// global surface-reporting.css into component-imported src/styles/
// familiar-analytics.css (+ .trace-* → session-trace-overlay.css), so it now
// code-splits out of the every-route/home first load entirely. Net after the
// hearth restore above: ~646 KiB root / ~890 KiB home — still below even the
// pre-modernization budgets (690/920). Banked with headroom.
// Raised home 900->910 (2026-08-01, cave-iktbc): the home set had drifted to
// 899.6 KiB as the chat surfaces landed through 2026-07-31 — the find band
// (#4131), title-row participants (#4127), familiar drag-into-thread (#4132),
// launch-readiness gating (#4141) and the Hermes API card (#4138) — leaving
// ~0.04% of margin. A 378-byte spine-gutter fix was enough to fail the gate,
// which means the NEXT css PR of any size would have failed it too. This bump
// is restoring working headroom for what already merged, not paying for one
// change; root is untouched and still 22 KiB under at 638 KiB.
// LOWERED root 660→640 / home 910→900 (2026-08-01, cave-ii7xi): the second #3264
// extraction — surface-marketplace.css (34 KiB) left the globals.css facade for a
// component import in marketplace-view.tsx, so it code-splits with the
// MarketplaceView next/dynamic chunk. Measured on the same commit (39164745f),
// baseline vs branch: home 908.0 → 882.2 KiB, root 644.1 → 618.5 KiB, −26 KiB each.
// The sheet did NOT move whole: 5 KiB of it was the shared project picker and
// undo toast — components in the always-loaded shell, both labelled "Shared" in
// comments written while they sat in a file named for one surface. Those stay
// in the facade as
// shared-pickers-and-toasts.css, in the exact slot surface-marketplace.css held,
// because primitives.css defines their base rules and these override at equal
// specificity. Moving the file wholesale would have unstyled the project picker
// and the undo toast on the home route with every test still green.
// Home goes back to 900 — reverting cave-iktbc's stopgap raise exactly, since this
// extraction is the fix that raise was buying time for. That leaves 17.8 KiB
// (1.98%), which the headroom reporter still calls THIN, and that is the honest
// reading: one extraction is not enough to make this budget comfortable. Choosing
// a laxer cap to silence the warning would be the exact move cave-7fd41 exists to
// discourage. The remaining facade sheets are the work — see cave-ii7xi.
// LOWERED root 640→600 / home 900→865 (2026-08-01, cave-ii7xi): the third #3264
// extraction — surface-reporting.css. Measured on ad12a391b: home 882.2 → 844.9
// KiB, root 618.5 → 581.2 KiB, −37 KiB each, the largest single reclaim in this
// series and nearly 1.5x what the .fa-* extraction (cave-5rqi) bought.
// The file was four tenants, not one surface: dr-* (daily report, 86 classes),
// growth-* (55) and retro-* (40) are reached ONLY from /dashboard/... and
// /daily-report/... routes, while ~14 KiB of chat and shell chrome — edit cards,
// review modal, tool IO, the thread-signal card, quick-chat keyframes, the
// GitHub reward flare, group-chat next-path and the tools-update fill button —
// sat in the same file under a name that made it look route-scoped. The reporting
// families are now component-imported by the dashboard and daily-report views;
// the shell chrome stayed in the facade as shell-cards-and-controls.css, in the
// slot surface-reporting.css held, so cascade order is unchanged.
// Home lands at 2.32% and root at 3.14% — both above the THIN threshold for the
// first time in this series, which is what two extractions bought that one could
// not. 35 of the 37 reclaimed KiB are given back rather than banked.
// RAISED home 865→880 (2026-08-03, cave-vkegj): the Thread Signal card became a
// triage surface — six score tiles with a per-metric rationale strip and a ranked
// signal queue whose row detail opens as an overlay — which is +6.8 KiB of source
// CSS in shell-cards-and-controls.css. Home measured 862.2 KiB against the 865
// ceiling: within budget but 0.3% headroom, i.e. the gate would have failed the
// NEXT css PR of any size, which is the same stopgap situation cave-iktbc hit.
// The obvious reclaim — a #3264 extraction — is the wrong tool here: cave-ii7xi
// deliberately KEPT this file in the facade three days ago because every consumer
// (chat-view, group-chat-view, github-card, thread-signal-card, quick-chat,
// tools-update) is always-loaded shell, and extracting it would move CSS out of
// the root layout only to have `/` pay for it again through the chat surface.
// Root is untouched at 588 KiB (2.1% headroom) and every declaration in the new
// block is tokenized — tokenize-css.mjs is a no-op over it and the drift ratchets
// for font/space/radius all held. 880 is the smallest ceiling that clears the 2%
// THIN threshold (17.8 KiB / 2.0% headroom) rather than landing still-thin and
// handing the same warning to whoever ships next — which is the whole failure
// this raise exists to end. It is a ceiling for this surface's growth, not a
// licence for the next one.
const MAX_ROOT_CSS_BYTES = (Number(process.env.BUNDLE_MAX_ROOT_CSS_KB) || 600) * 1024;
const MAX_HOME_CSS_BYTES = (Number(process.env.BUNDLE_MAX_HOME_CSS_KB) || 880) * 1024;

if (!existsSync(chunksDir)) {
  console.error(
    `✗ bundle-budget: ${path.relative(root, chunksDir)} not found — run \`pnpm build\` first.`,
  );
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + " KB";

// Warn while there is still room to act. Every budget below used to print only
// its total and its cap, so accretion was invisible until a PR crossed the line
// and ate the failure — the home CSS set drifted to 0.04% of margin over a
// single day of small merges before anyone noticed (cave-7fd41). Reporting the
// remaining headroom on every build turns that into a visible slope.
//
// Deliberately does NOT fail: this is signal, not a new gate. A thin budget is
// information for the next author, not a reason to block the current one.
const THIN_HEADROOM_PCT = 2;
const thin = [];

function headroom(label, bytes, budget) {
  const left = budget - bytes;
  if (left < 0) return; // the caller's failure branch reports the overage
  const pct = (left / budget) * 100;
  const line = `  ${(left / 1024).toFixed(1).padStart(6)} KB headroom  (${pct.toFixed(1)}%)`;
  if (pct < THIN_HEADROOM_PCT) {
    thin.push(label);
    console.log(`${line}  \u26a0 THIN — the next change of any size may fail this gate`);
  } else {
    console.log(line);
  }
}
const sizeOf = (relToNext) => {
  try {
    return statSync(path.join(nextDir, relToNext)).size;
  } catch {
    return 0;
  }
};

// --- All chunks, largest first (for the catastrophic-chunk net + visibility) ---
function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".js"))
      acc.push({ file: path.relative(chunksDir, full), bytes: statSync(full).size });
  }
  return acc;
}
const chunks = walk(chunksDir, []).sort((a, b) => b.bytes - a.bytes);

// --- Complete first-load graph for `/` (App Router entries + shared shell) ---
let homeRoute;
try {
  const routeStats = JSON.parse(readFileSync(routeStatsFile, "utf8"));
  homeRoute = routeStats.find((entry) => entry.route === "/");
} catch {
  // The explicit failure below also covers an unreadable diagnostic.
}

if (!homeRoute || !Number.isFinite(homeRoute.firstLoadUncompressedJsBytes)) {
  console.error(
    `✗ bundle-budget: ${path.relative(root, routeStatsFile)} has no valid "/" route — run \`pnpm build\` first.`,
  );
  process.exit(1);
}

const homeBytes = homeRoute.firstLoadUncompressedJsBytes;
const homeFiles = Array.isArray(homeRoute.firstLoadChunkPaths)
  ? homeRoute.firstLoadChunkPaths
  : [];

// --- Always-loaded shell (rootMainFiles from the build manifest) ---
let shellFiles = [];
try {
  const manifest = JSON.parse(readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
  shellFiles = (manifest.rootMainFiles || []).filter((f) => f.endsWith(".js"));
} catch {
  console.error("✗ bundle-budget: could not read .next/build-manifest.json");
  process.exit(1);
}
const shellBytes = shellFiles.reduce((a, f) => a + sizeOf(f), 0);

console.log(`\nbundle-budget — initial / route JavaScript:`);
console.log(`  ${kb(homeBytes)}  TOTAL first-load JS across ${homeFiles.length} chunks  (budget: ${kb(MAX_HOME_BYTES)})`);
headroom("first-load JS", homeBytes, MAX_HOME_BYTES);

console.log(`\nbundle-budget — always-loaded shell (rootMainFiles):`);
for (const f of shellFiles) console.log(`  ${kb(sizeOf(f))}  ${f.replace("static/chunks/", "")}`);
console.log(`  ${kb(shellBytes)}  TOTAL shell  (budget: ${kb(MAX_SHELL_BYTES)})`);
headroom("always-loaded shell", shellBytes, MAX_SHELL_BYTES);

console.log(`\nbundle-budget — largest client chunks:`);
for (const c of chunks.slice(0, 8)) console.log(`  ${kb(c.bytes)}  ${c.file}`);
const largest = chunks[0];
console.log(`  largest: ${kb(largest?.bytes ?? 0)}  (budget: ${kb(MAX_CHUNK_BYTES)})`);

let failed = false;

if (homeBytes > MAX_HOME_BYTES) {
  failed = true;
  console.error(
    `\n✗ bundle-budget: initial / route JavaScript ${kb(homeBytes).trim()} exceeds budget ` +
      `${kb(MAX_HOME_BYTES).trim()}.\n` +
      `  A mode- or open-gated dependency likely entered the Chat-first startup graph.\n` +
      `  Inspect the / route with \`pnpm analyze:bundle\` and move non-critical UI\n` +
      `  behind src/components/lazy-surfaces.tsx, or raise BUNDLE_MAX_HOME_KB deliberately.`,
  );
}

// --- Full familiar glyph catalogue must stay out of the initial `/` graph ---
// Turbopack records the concrete entry files in the page client-reference
// manifest. Identify the generated catalogue chunk by several names sampled
// from the committed collection, then prove none of those chunks are startup
// entries. This remains valid when content hashes change between builds.
try {
  const clientManifestPath = path.join(nextDir, "server", "app", "page_client-reference-manifest.js");
  const source = readFileSync(clientManifestPath, "utf8");
  const assignment = 'globalThis.__RSC_MANIFEST["/page"] = ';
  const start = source.indexOf(assignment);
  if (start < 0) throw new Error("missing /page manifest assignment");
  const manifest = JSON.parse(source.slice(start + assignment.length).replace(/;\s*$/, ""));
  const pageEntries = new Set(
    (manifest.entryJSFiles?.["[project]/src/app/page"] ?? []).map((file) =>
      file.replace(/^static\/chunks\//, ""),
    ),
  );
  if (pageEntries.size === 0) throw new Error("/page manifest has no JavaScript entries");

  const glyphSource = JSON.parse(
    readFileSync(path.join(root, "src", "lib", "ph-glyph-catalog.json"), "utf8"),
  );
  const glyphNames = Object.keys(glyphSource.icons ?? {});
  const sentinels = [0.08, 0.31, 0.57, 0.83].map(
    (position) => glyphNames[Math.floor(glyphNames.length * position)],
  );
  const catalogChunks = chunks.filter((chunk) => {
    const contents = readFileSync(path.join(chunksDir, chunk.file), "utf8");
    return sentinels.every((name) => contents.includes(JSON.stringify(name)));
  });
  if (catalogChunks.length === 0) {
    throw new Error("could not identify the generated glyph catalogue chunk");
  }
  const eagerCatalogChunks = catalogChunks.filter((chunk) => pageEntries.has(chunk.file));
  console.log(
    `\nbundle-budget — familiar glyph catalog: ${catalogChunks.map((chunk) => `${kb(chunk.bytes).trim()} ${chunk.file}`).join(", ")}`,
  );
  if (eagerCatalogChunks.length > 0) {
    failed = true;
    console.error(
      `\n✗ bundle-budget: full familiar glyph catalogue is eager in /: ` +
        eagerCatalogChunks.map((chunk) => chunk.file).join(", "),
    );
  } else {
    console.log("✓ bundle-budget: full familiar glyph catalogue is lazy for /.\n");
  }
} catch (error) {
  failed = true;
  console.error(`\n✗ bundle-budget: could not verify lazy familiar glyph catalogue: ${error.message}`);
}

if (shellBytes > MAX_SHELL_BYTES) {
  failed = true;
  console.error(
    `\n✗ bundle-budget: always-loaded shell ${kb(shellBytes).trim()} exceeds budget ` +
      `${kb(MAX_SHELL_BYTES).trim()}.\n` +
      `  A dependency likely entered the shared bundle. Check for a new static import\n` +
      `  of a heavy module reachable from the app shell and route it through\n` +
      `  src/components/lazy-surfaces.tsx, or raise BUNDLE_MAX_SHELL_KB deliberately.`,
  );
}

if (largest && largest.bytes > MAX_CHUNK_BYTES) {
  failed = true;
  console.error(
    `\n✗ bundle-budget: largest chunk ${largest.file} (${kb(largest.bytes).trim()}) exceeds ` +
      `budget ${kb(MAX_CHUNK_BYTES).trim()}.\n` +
      `  A heavy dependency ballooned a single chunk. Split it or raise BUNDLE_MAX_CHUNK_KB.`,
  );
}

// --- Route-level CSS budgets (#3264) ---
// The client-reference manifests record every stylesheet a route injects.
// `_not-found` renders nothing but the root layout, so its CSS set IS the
// root stylesheet cost every route pays; `/page` is the home first load.
function routeCssBytes(manifestRelPath, label) {
  const manifestPath = path.join(nextDir, "server", "app", manifestRelPath);
  const source = readFileSync(manifestPath, "utf8");
  const files = [...new Set(source.match(/static\/chunks\/[\w-]+\.css/g) ?? [])];
  if (files.length === 0) throw new Error(`${label}: no css entries in ${manifestRelPath}`);
  const sized = files
    .map((file) => ({ file: file.replace("static/chunks/", ""), bytes: sizeOf(file) }))
    .sort((a, b) => b.bytes - a.bytes);
  return { files: sized, bytes: sized.reduce((a, f) => a + f.bytes, 0) };
}

try {
  const rootCss = routeCssBytes(path.join("_not-found", "page_client-reference-manifest.js"), "root");
  const homeCss = routeCssBytes("page_client-reference-manifest.js", "home");

  console.log(`bundle-budget — root-layout CSS (every route pays this):`);
  for (const f of rootCss.files) console.log(`  ${kb(f.bytes)}  ${f.file}`);
  console.log(`  ${kb(rootCss.bytes)}  TOTAL root CSS  (budget: ${kb(MAX_ROOT_CSS_BYTES)})`);
  headroom("root-layout CSS", rootCss.bytes, MAX_ROOT_CSS_BYTES);
  console.log(`\nbundle-budget — initial / route CSS:`);
  console.log(
    `  ${kb(homeCss.bytes)}  TOTAL first-load CSS across ${homeCss.files.length} stylesheets  (budget: ${kb(MAX_HOME_CSS_BYTES)})`,
  );
  headroom("initial / route CSS", homeCss.bytes, MAX_HOME_CSS_BYTES);

  if (rootCss.bytes > MAX_ROOT_CSS_BYTES) {
    failed = true;
    console.error(
      `\n✗ bundle-budget: root-layout CSS ${kb(rootCss.bytes).trim()} exceeds budget ` +
        `${kb(MAX_ROOT_CSS_BYTES).trim()}.\n` +
        `  A surface stylesheet likely re-entered src/app/globals.css (or a component\n` +
        `  in the always-loaded shell imported one). Import surface CSS from the\n` +
        `  surface's own components instead (#3264), or raise BUNDLE_MAX_ROOT_CSS_KB\n` +
        `  deliberately.`,
    );
  }
  if (homeCss.bytes > MAX_HOME_CSS_BYTES) {
    failed = true;
    console.error(
      `\n✗ bundle-budget: initial / route CSS ${kb(homeCss.bytes).trim()} exceeds budget ` +
        `${kb(MAX_HOME_CSS_BYTES).trim()}.\n` +
        `  A stylesheet for a mode- or open-gated surface entered the home first load.\n` +
        `  Check new css imports on components reachable from the / startup graph, or\n` +
        `  raise BUNDLE_MAX_HOME_CSS_KB deliberately.`,
    );
  }
} catch (error) {
  failed = true;
  console.error(`\n✗ bundle-budget: could not measure route CSS: ${error.message}`);
}

if (failed) process.exit(1);
if (thin.length > 0) {
  console.log(
    `\n\u26a0 bundle-budget: within budget, but thin on ${thin.join(", ")}.\n` +
      `  Reclaim room (move surface CSS to component imports, #3264) or raise the\n` +
      `  cap deliberately with a justification — before it lands on someone else.`,
  );
}
console.log(`\n✓ bundle-budget: within budget.\n`);
