import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildSandboxRuntime, OUTFILE, TAILWIND_OUTFILE } from "./build-sandbox-runtime.mjs";

// Build the sandbox runtime and assert it produced a self-contained browser
// bundle with React + sucrase inlined and the runtime's public surface intact.
// (Functional render is covered by a Playwright check run outside CI.)

const scriptPath = fileURLToPath(new URL("./build-sandbox-runtime.mjs", import.meta.url));
const cli = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
assert.equal(cli.status, 0, `direct sandbox build failed: ${cli.stderr || cli.error}`);
assert.match(
  cli.stdout,
  /sandbox assets/,
  "direct execution must work when process.argv[1] is a native Windows path",
);

await buildSandboxRuntime();

const info = await stat(OUTFILE);
assert.ok(info.isFile(), "react-runtime.js must be emitted");
// React 19 + ReactDOM + sucrase bundled and minified lands well over 100KB;
// a tiny file means the bundle silently dropped a dependency.
assert.ok(info.size > 100_000, `bundle looks too small (${info.size} bytes) — a dependency may be missing`);

const src = await readFile(OUTFILE, "utf8");

assert.match(src, /generated; do not edit/, "keeps the generated banner");
// Runtime public surface — these are the contract the iframe harness relies on.
for (const sym of ["__transpile", "__mount", "createRoot", "sandbox-error"]) {
  assert.ok(src.includes(sym), `bundle must expose/reference \`${sym}\``);
}
// Offline guarantee: nothing should be fetched from a CDN at runtime.
assert.doesNotMatch(src, /https?:\/\/(unpkg|esm\.sh|cdn\.|jsdelivr)/i, "runtime must not reference a CDN (offline)");
// Production React (no dev-only invariant message machinery bloating the sandbox).
assert.doesNotMatch(src, /react-dom\.development/i, "must bundle the production React build");

// Tailwind's offline in-browser engine is self-hosted alongside (served from
// /sandbox), so utility classes work without a CDN.
const tw = await stat(TAILWIND_OUTFILE);
assert.ok(tw.isFile(), "tailwind.js must be emitted");
assert.ok(tw.size > 100_000, `tailwind bundle looks too small (${tw.size} bytes)`);

console.log("build-sandbox-runtime.test.mjs: ok");
