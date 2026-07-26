// Builds the Canvas Sketch sandbox assets into public/sandbox/:
//   - react-runtime.js  — React 19 + sucrase inlined (esbuilt from runtime-entry.ts)
//   - tailwind.js       — @tailwindcss/browser's prebuilt in-browser JIT engine
// Both let JSX/TSX artifacts (with Tailwind utility classes) render live and
// fully offline — no CDN.
//
// Run directly (`node scripts/build-sandbox-runtime.mjs`) or via `prebuild`.
// Exports buildSandboxRuntime() so tests can invoke it without a subprocess.

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(root, "src", "sandbox", "runtime-entry.ts");
const OUTDIR = path.join(root, "public", "sandbox");
export const OUTFILE = path.join(OUTDIR, "react-runtime.js");
export const TAILWIND_OUTFILE = path.join(OUTDIR, "tailwind.js");

async function buildReactRuntime() {
  await build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    // React's dev/prod branch keys off this; production trims warnings + checks.
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "/* Coven Cave Sketch sandbox runtime — generated; do not edit. */" },
  });
}

// @tailwindcss/browser ships a self-contained global IIFE that scans the DOM
// and JIT-compiles utility classes (with a MutationObserver, so it styles
// React output rendered after load). It's already a finished browser bundle —
// copy it as-is rather than re-wrapping it.
async function copyTailwind() {
  const require = createRequire(import.meta.url);
  const src = require.resolve("@tailwindcss/browser");
  await copyFile(src, TAILWIND_OUTFILE);
}

export async function buildSandboxRuntime() {
  await mkdir(OUTDIR, { recursive: true });
  await Promise.all([buildReactRuntime(), copyTailwind()]);
  return OUTFILE;
}

// Run when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSandboxRuntime()
    .then(() => console.log(`sandbox assets → ${path.relative(root, OUTDIR)}/{react-runtime,tailwind}.js`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
