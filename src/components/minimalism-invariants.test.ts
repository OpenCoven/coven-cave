// @ts-nocheck
// Minimalism-initiative invariants (epic cave-6pe, design language §8).
// Repo-wide source scans that keep the quieting work from regressing:
//
//  1. No hardcoded white foreground on an --accent-presence fill. The token
//     contract (globals.css) is explicit: white fails AA on the 22 of 32
//     palette×mode combos whose accent is light — use
//     --accent-presence-foreground (swept app-wide in PR #2499).
//
//  2. Every component that applies `.reveal-on-hover` must also establish a
//     `.reveal-scope` (or rely on a self-revealing guard) in the same file —
//     an orphaned reveal-on-hover control would simply be invisible.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Temporary debt: another live session holds the edit claim on chat-view.tsx
// (multi-session coordination §1), so its two accent/text-white instances are
// tracked on bead cave-6pe.7 instead of being fixed here. Remove this entry
// with that bead.
const ACCENT_WHITE_ALLOWLIST = new Set(["components/chat-view.tsx"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) yield full;
  }
}

const offendersWhite = [];
const offendersScope = [];

for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(SRC, file);

  // 1. Same class string carrying both an accent-presence background and a
  //    hardcoded white foreground.
  for (const m of src.matchAll(/className=\{?[`"']([^`"']*)[`"']/g)) {
    const cls = m[1];
    if (cls.includes("bg-[var(--accent-presence)]") && /(?:^|\s)text-white(?:\/\d+)?(?:\s|$)/.test(cls)) {
      offendersWhite.push(rel);
    }
  }
  // Also catch ternary halves like `? "bg-[var(--accent-presence)] text-white"`.
  if (/bg-\[var\(--accent-presence\)\][^"'`\n]*text-white/.test(src)) {
    offendersWhite.push(rel);
  }

  // 2. reveal-on-hover applied as a class needs a reveal-scope in the file.
  const applies = /(?:className|class)=[^>\n]*reveal-on-hover/.test(src);
  if (applies && !src.includes("reveal-scope")) {
    offendersScope.push(rel);
  }
}

assert.deepEqual(
  [...new Set(offendersWhite)].filter((f) => !ACCENT_WHITE_ALLOWLIST.has(f)),
  [],
  "hardcoded white foreground on an accent-presence fill — use --accent-presence-foreground (design language §2/§8)",
);
assert.deepEqual(
  offendersScope,
  [],
  "reveal-on-hover applied without a reveal-scope in the same file — the control would never reveal (design language §8)",
);

console.log("minimalism-invariants.test.ts: ok");
