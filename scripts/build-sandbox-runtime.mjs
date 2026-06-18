// Bundles the Canvas Sketch React sandbox runtime (src/sandbox/runtime-entry.ts)
// into public/sandbox/react-runtime.js — a self-contained browser IIFE with
// React 19 + sucrase inlined, so JSX/TSX artifacts render live and offline.
//
// Run directly (`node scripts/build-sandbox-runtime.mjs`) or via `prebuild`.
// Exports buildSandboxRuntime() so tests can invoke it without a subprocess.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(root, "src", "sandbox", "runtime-entry.ts");
export const OUTFILE = path.join(root, "public", "sandbox", "react-runtime.js");

export async function buildSandboxRuntime() {
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
  return OUTFILE;
}

// Run when invoked directly (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  buildSandboxRuntime()
    .then((out) => console.log(`sandbox runtime → ${path.relative(root, out)}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
