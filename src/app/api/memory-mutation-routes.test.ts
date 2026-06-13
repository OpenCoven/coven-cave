import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
for (const [file, fn] of [["delete", "archiveMemoryFile"], ["restore", "restoreMemoryFile"], ["purge", "purgeMemoryTrash"]] as const) {
  const src = await readFile(new URL(`./memory/${file}/route.ts`, import.meta.url), "utf8");
  assert.match(src, /export async function POST/, `${file} route is POST`);
  assert.match(src, new RegExp(fn), `${file} route calls ${fn}`);
}
console.log("memory-mutation-routes.test: ok");
