// Turbopack 16.3 does not apply route tracing exclusions to instrumentation.
// Apply the configured global exclusions to that trace and its standalone
// copies. Never remove a file retained by another Next trace.
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

async function readInstrumentationTrace(root) {
  const dist = path.join(root, ".next");
  const tracePath = path.join(dist, "server", "instrumentation.js.nft.json");
  let trace;
  try { trace = JSON.parse(await readFile(tracePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const config = JSON.parse(await readFile(path.join(dist, "required-server-files.json"), "utf8")).config;
  const patterns = config.outputFileTracingExcludes?.["*"] ?? [];
  const require = createRequire(import.meta.url);
  const picomatch = require("next/dist/compiled/picomatch");
  const excluded = patterns.length
    ? picomatch(patterns.map(pattern => pattern.replace(/^\.\//, "")), { dot: true })
    : () => false;
  const relativeOf = file => {
    const relative = path.relative(root, path.resolve(path.dirname(tracePath), file)).split(path.sep).join("/");
    return relative.startsWith("../") ? null : relative;
  };
  return { dist, tracePath, trace, patterns, excluded, relativeOf };
}

// The checkout files the raw instrumentation trace lists although the global
// exclusions cover them (#6082). Next copies every traced file into
// .next/standalone before applyInstrumentationTraceExclusions can drop it, so
// each one is read from the live checkout during the build: a git repack or an
// Xcode build that deletes one mid-copy fails the build with ENOENT. A listed
// file means a runtime-derived path in the instrumentation graph is globbing
// the checkout. Call this before applyInstrumentationTraceExclusions rewrites
// the trace.
export async function instrumentationTraceLeaks(root) {
  const loaded = await readInstrumentationTrace(root);
  if (!loaded) return [];
  return loaded.trace.files
    .map(loaded.relativeOf)
    .filter(relative => relative !== null && loaded.excluded(relative))
    .sort();
}

export async function applyInstrumentationTraceExclusions(root) {
  const loaded = await readInstrumentationTrace(root);
  if (!loaded || !loaded.patterns.length) return 0;
  const { dist, tracePath, trace, excluded, relativeOf } = loaded;
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
    const relative = relativeOf(file);
    if (relative === null || !excluded(relative)) return true;
    if (!retained.has(path.resolve(path.dirname(tracePath), file))) removed.push(relative);
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
