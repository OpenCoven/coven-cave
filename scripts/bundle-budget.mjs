// Bundle-size budget gate. Runs automatically after `pnpm build` (as the
// `postbuild` lifecycle hook), so the existing "Frontend build" CI check fails
// if client JS regresses past budget — no new required status check needed.
//
// What it guards:
//   1. SHELL — the always-loaded root chunks (build-manifest `rootMainFiles`):
//      the JS every page load pays for, regardless of surface. This is the
//      clearest health signal and what code-splitting protects.
//   2. CATASTROPHIC chunk — a loose ceiling on the single largest chunk, to
//      catch a heavy dep ballooning one chunk back toward the pre-split ~3 MB.
//
// Why not gate per-route "First Load JS": this app builds with Turbopack, which
// does not emit the App Router client chunk graph (`app-build-manifest.json`),
// so a precise per-route eager-load number isn't available here. The two
// signals above are what we can measure robustly.
//
// Tune by lowering the budgets as splitting work lands. Override at runtime with
// BUNDLE_MAX_SHELL_KB / BUNDLE_MAX_CHUNK_KB for experiments.
//
// Run: `node scripts/bundle-budget.mjs` (wired as `pnpm test:bundle` + postbuild).

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(root, ".next");
const chunksDir = path.join(nextDir, "static", "chunks");

// Budgets, seeded with headroom over the post-split measured values so ordinary
// feature growth doesn't trip them — only a structural regression does.
// Measured at introduction: shell ~447 KB, largest chunk ~1713 KB (the lazy
// code-editor surface: @uiw/react-codemirror + @xterm).
const MAX_SHELL_BYTES = (Number(process.env.BUNDLE_MAX_SHELL_KB) || 650) * 1024;
const MAX_CHUNK_BYTES = (Number(process.env.BUNDLE_MAX_CHUNK_KB) || 2400) * 1024;

if (!existsSync(chunksDir)) {
  console.error(
    `✗ bundle-budget: ${path.relative(root, chunksDir)} not found — run \`pnpm build\` first.`,
  );
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + " KB";
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

console.log(`\nbundle-budget — always-loaded shell (rootMainFiles):`);
for (const f of shellFiles) console.log(`  ${kb(sizeOf(f))}  ${f.replace("static/chunks/", "")}`);
console.log(`  ${kb(shellBytes)}  TOTAL shell  (budget: ${kb(MAX_SHELL_BYTES)})`);

console.log(`\nbundle-budget — largest client chunks:`);
for (const c of chunks.slice(0, 8)) console.log(`  ${kb(c.bytes)}  ${c.file}`);
const largest = chunks[0];
console.log(`  largest: ${kb(largest?.bytes ?? 0)}  (budget: ${kb(MAX_CHUNK_BYTES)})`);

let failed = false;

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

if (failed) process.exit(1);
console.log(`\n✓ bundle-budget: within budget.\n`);
