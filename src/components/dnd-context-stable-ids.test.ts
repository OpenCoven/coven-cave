import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// @dnd-kit's <DndContext> derives its screen-reader description element id
// (`DndDescribedBy-N`) from a module-level counter unless given an explicit
// `id`. With several DndContexts in the app, the counter advances in a
// different order on the server vs. the client, so an SSR-ed context hydrates
// with a mismatched `aria-describedby` ("hydration mismatch"). Passing a stable
// `id` to every DndContext makes those ids deterministic. This guard fails CI if
// a new DndContext is added without one.

const root = new URL("..", import.meta.url).pathname; // src/

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  // Each opening <DndContext ...> tag — capture up to the closing '>' of the tag.
  for (const m of src.matchAll(/<DndContext\b[^>]*>/g)) {
    if (!/\bid=/.test(m[0])) {
      offenders.push(`${file.replace(root, "src/")}: ${m[0].slice(0, 60)}…`);
    }
  }
}

assert.equal(
  offenders.length,
  0,
  `Every <DndContext> needs an explicit stable \`id\` to avoid an SSR hydration mismatch on \`aria-describedby\`. Missing on:\n${offenders.join("\n")}`,
);

console.log("dnd-context-stable-ids: OK");
