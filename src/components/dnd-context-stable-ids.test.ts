import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @dnd-kit's <DndContext> derives its screen-reader description element id
// (`DndDescribedBy-N`) from a module-level counter unless given an explicit
// `id`. With several DndContexts in the app, the counter advances in a
// different order on the server vs. the client, so an SSR-ed context hydrates
// with a mismatched `aria-describedby` ("hydration mismatch"). Passing a stable
// `id` to every DndContext makes those ids deterministic. This guard fails CI if
// a new DndContext is added without one.

// fileURLToPath, never .pathname: on Windows a file:// pathname is `/C:/…`,
// and readdirSync rejects that leading slash, so this guard threw instead of
// running and every <DndContext> went unchecked.
const root = fileURLToPath(new URL("..", import.meta.url)); // src/

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
      // Normalise separators so the failure message reads identically
      // whichever platform surfaced the offender.
      const relative = file.replace(root, "src/").replaceAll("\\", "/");
      offenders.push(`${relative}: ${m[0].slice(0, 60)}…`);
    }
  }
}

assert.equal(
  offenders.length,
  0,
  `Every <DndContext> needs an explicit stable \`id\` to avoid an SSR hydration mismatch on \`aria-describedby\`. Missing on:\n${offenders.join("\n")}`,
);

console.log("dnd-context-stable-ids: OK");
