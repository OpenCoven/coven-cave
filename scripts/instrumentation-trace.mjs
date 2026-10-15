// Turbopack 16.3 does not apply route tracing exclusions to instrumentation.
// Apply the configured global exclusions to that trace and its standalone
// copies. Never remove a file retained by another Next trace.
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

export async function applyInstrumentationTraceExclusions(root) {
  const dist = path.join(root, ".next");
  const tracePath = path.join(dist, "server", "instrumentation.js.nft.json");
  let trace;
  try { trace = JSON.parse(await readFile(tracePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  const config = JSON.parse(await readFile(path.join(dist, "required-server-files.json"), "utf8")).config;
  const patterns = config.outputFileTracingExcludes?.["*"] ?? [];
  if (!patterns.length) return 0;
  const require = createRequire(import.meta.url);
  const picomatch = require("next/dist/compiled/picomatch");
  const excluded = picomatch(patterns.map(pattern => pattern.replace(/^\.\//, "")), { dot: true });
  const retained = new Set();
  async function readTraces(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await readTraces(file);
      else if (file !== tracePath && entry.name.endsWith(".nft.json")) {
        const data = JSON.parse(await readFile(file, "utf8"));
        for (const dependency of data.files) retained.add(path.resolve(dir, dependency));
      }
    }
  }
  await readTraces(path.join(dist, "server"));
  const removed = [];
  trace.files = trace.files.filter(file => {
    const absolute = path.resolve(path.dirname(tracePath), file);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (relative.startsWith("../") || !excluded(relative)) return true;
    if (!retained.has(absolute)) removed.push(relative);
    return false;
  });
  await writeFile(tracePath, JSON.stringify(trace));
  for (const file of removed) await rm(path.join(dist, "standalone", file), { force: true });
  // Empty excluded roots still fail the artifact guard, so remove only empty
  // directories. No recursive deletion of unaccounted-for artifact files.
  async function removeEmpty(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeEmpty(path.join(dir, entry.name));
    }
    if (dir !== path.join(dist, "standalone") && (await readdir(dir)).length === 0) {
      const { rmdir } = await import("node:fs/promises");
      await rmdir(dir);
    }
  }
  await removeEmpty(path.join(dist, "standalone"));
  return removed.length;
}
