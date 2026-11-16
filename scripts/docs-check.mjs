#!/usr/bin/env node
// Report what in the README and the living docs no longer matches the tree.
//
//   pnpm docs:check            # print the report, always exit 0
//   pnpm docs:check --strict   # exit 1 when anything is reported
//
// Three checks, over README.md and every document under the "Living" heading
// of docs/README.md:
//   - a relative Markdown link whose target file is gone;
//   - a backticked source path (`src/…`, `scripts/…`, …) that no longer exists;
//   - a mention of a surface the product has retired.
//
// It is a reading list for the person refreshing docs after a release, not a
// gate: a hit can be a deliberate historical reference. The release train runs
// it as its `docs` phase; see docs/workflows/release-train.md.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Surfaces removed from the default product. Add a row when one is retired;
// drop it once the living docs no longer mention it.
export const RETIRED_SURFACES = [
  { pattern: /Ask Salem/i, note: "built-in Ask Salem was removed (#6399)" },
  { pattern: /\bFeed tab\b/i, note: "the familiar Feed tab was removed (#6398)" },
  { pattern: /marketplace packages|marketplace-seeded/i, note: "Marketplace left the default navigation (#6398)" },
];
// A line that already says the surface is gone is not stale.
const ACKNOWLEDGES_RETIREMENT = /retired|removed|no longer|historical|legacy|deprecated|former/i;

const SOURCE_ROOTS = ["src", "scripts", "docs", "src-tauri", "ios", ".github", ".agents", "public", "e2e", "screenshots"];
const SOURCE_PATH = new RegExp(`^(?:${SOURCE_ROOTS.map((root) => root.replace(".", "\\.")).join("|")})/[\\w./@\\[\\]-]+$`);

export function livingDocs(index) {
  const start = index.search(/^## Living\s*$/m);
  if (start === -1) return [];
  const rest = index.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  const files = [...section.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map((match) => path.posix.join("docs", match[1]));
  return [...new Set(files)];
}

export function deadLinks(file, text, exists) {
  const found = [];
  for (const { line, content } of proseLines(text)) {
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      // Skip URLs, in-page anchors, and placeholders such as `(…)` in a syntax example.
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target) || !/[a-z0-9]/i.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURI(target.split("#")[0])));
      if (!exists(resolved)) found.push({ file, line, target });
    }
  }
  return found;
}

export function missingPaths(file, text, exists) {
  const found = [];
  for (const { line, content } of proseLines(text)) {
    for (const match of content.matchAll(/`([^`\s]+)`/g)) {
      const target = match[1].replace(/:\d+(?:-\d+)?$/, "");
      if (!SOURCE_PATH.test(target) || target.endsWith("/")) continue;
      if (!exists(target)) found.push({ file, line, target });
    }
  }
  return found;
}

export function retiredMentions(file, text) {
  const found = [];
  for (const { line, content } of proseLines(text)) {
    if (ACKNOWLEDGES_RETIREMENT.test(content)) continue;
    for (const surface of RETIRED_SURFACES) {
      const match = surface.pattern.exec(content);
      if (match) found.push({ file, line, target: `"${match[0]}": ${surface.note}` });
    }
  }
  return found;
}

// Lines outside fenced code blocks, numbered from 1.
function proseLines(text) {
  const lines = [];
  let fenced = false;
  text.split("\n").forEach((content, index) => {
    if (/^\s*(```|~~~)/.test(content)) fenced = !fenced;
    else if (!fenced) lines.push({ line: index + 1, content });
  });
  return lines;
}

export function runDocsCheck({ root = ROOT, log = console.log } = {}) {
  const exists = (file) => existsSync(path.join(root, file));
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const files = ["README.md", ...livingDocs(read("docs/README.md")).filter(exists)];
  const sections = [
    ["Dead local links", (file, text) => deadLinks(file, text, exists)],
    ["Source paths that no longer exist", (file, text) => missingPaths(file, text, exists)],
    ["Mentions of retired surfaces", (file, text) => retiredMentions(file, text)],
  ];
  let total = 0;
  for (const [title, check] of sections) {
    const hits = files.flatMap((file) => check(file, read(file)));
    total += hits.length;
    log(`\n${title}: ${hits.length}`);
    for (const hit of hits) log(`  ${hit.file}:${hit.line}  ${hit.target}`);
  }
  log(`\nChecked README.md and ${files.length - 1} living documents; ${total} item(s) to review.`);
  return total;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const total = runDocsCheck();
  process.exit(process.argv.includes("--strict") && total > 0 ? 1 : 0);
}
