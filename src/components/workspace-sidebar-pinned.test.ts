import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const pinned = source.slice(source.indexOf('<section aria-label="Pinned threads">'), source.indexOf('<section aria-label="Awaiting you">'));
assert.match(pinned, /<ThreadRow/, "pinned chats reuse the full interaction contract");
for (const prop of ["onOpenInSplit", "onToggleSelect", "onToggleArchive", "onRequestDelete", "onTogglePin"]) {
  assert.ok(pinned.includes(prop), `pinned rows retain ${prop}`);
}
console.log("workspace-sidebar-pinned: ok");
