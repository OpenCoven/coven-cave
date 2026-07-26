// @ts-nocheck
// Fire-and-forget fetches must never crash the app (cave: toast dismiss threw
// an unhandled "Failed to fetch" TypeError from markInboxItemRead when the
// daemon was unreachable — a background best-effort POST became a Runtime
// Error overlay). Rule: every `void fetch(...)` statement carries a `.catch`
// somewhere in its chain. `void` explicitly discards the promise, so nothing
// downstream can ever attach the handler — the statement itself must.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function collect(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Extract the full `void fetch(...)` statement starting at `start`: walk the
 * expression tracking bracket depth and skipping strings, template literals,
 * and comments, ending at the first top-level `;`.
 */
function statementAt(text: string, start: number): string {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (ch === "/" && next === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) break;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === ";" && depth === 0) return text.slice(start, i + 1);
    i += 1;
  }
  return text.slice(start, i);
}

const offenders: string[] = [];
for (const file of await collect(SRC)) {
  const text = await readFile(file, "utf8");
  let from = 0;
  for (;;) {
    const at = text.indexOf("void fetch(", from);
    if (at === -1) break;
    const statement = statementAt(text, at);
    if (!statement.includes(".catch(")) {
      const line = text.slice(0, at).split("\n").length;
      offenders.push(`${path.relative(SRC, file)}:${line}`);
    }
    from = at + 1;
  }
}

assert.deepEqual(
  offenders,
  [],
  `every void fetch(...) must chain a .catch — a rejected best-effort request ` +
    `(daemon down, network drop) otherwise surfaces as an unhandled runtime ` +
    `TypeError. Unguarded: ${offenders.join(", ")}`,
);

console.log("fire-and-forget-fetch-guard: ok");
