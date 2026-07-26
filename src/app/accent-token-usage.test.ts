// @ts-nocheck
// Accent token discipline (cave-ilkk). In this app `--accent` is the
// shadcn *surface* token — near-black in dark themes, near-white in light —
// while the BRAND accent is `--accent-presence` (paired with
// `--accent-presence-foreground` for text/icons on a filled accent).
//
// Consuming `var(--accent)` for text, borders, ticks, or focus rings renders
// them nearly invisible (the familiar-card "Review heal requests" /
// "Refresh memory" buttons and the "View all →" link shipped that way), and
// `var(--accent-foreground)` on an `--accent-presence` fill breaks contrast
// in light mode. This scanner forbids both classes in hand-written CSS:
//
//   - `var(--accent)` / `var(--accent,…)` may only appear on the RIGHT side
//     of a custom-property definition (e.g. the theme blocks' shadcn mapping
//     `--bg-hover: var(--accent);`) — never consumed directly by a style
//     property. Use `var(--accent-presence)` (or `--ring-focus` for focus
//     outlines) instead.
//   - `var(--accent-foreground…)` is not consumed in CSS at all — on a
//     presence fill use `var(--accent-presence-foreground)`; shadcn pairings
//     live in Tailwind utilities, not these sheets.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function collectCss(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectCss(full)));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const offenders: string[] = [];
for (const file of await collectCss(SRC)) {
  const rel = path.relative(SRC, file);
  const lines = stripComments(await readFile(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    const declaration = line.trim();
    // Defining another token from --accent (shadcn theme mapping) is fine.
    const definesToken = /^--[\w-]+\s*:/.test(declaration);
    if (!definesToken && /var\(--accent[,)\s]/.test(line)) {
      offenders.push(`${rel}:${i + 1} consumes var(--accent) — use var(--accent-presence)`);
    }
    if (/var\(--accent-foreground[,)\s]/.test(line)) {
      offenders.push(`${rel}:${i + 1} consumes var(--accent-foreground) — use var(--accent-presence-foreground)`);
    }
  });
}

assert.deepEqual(
  offenders,
  [],
  `--accent is the shadcn surface token, not the brand accent; these render ` +
    `nearly invisible chrome. Offenders:\n${offenders.join("\n")}`,
);

console.log("accent-token-usage: ok");
