import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

assert.doesNotMatch(source, /memory-masthead|headerCollapsed|onListScroll/, "the scroll-reactive masthead is removed");
assert.match(source, />\s*Familiar Memory\s*</, "the compact scope row keeps the surface name visible");
assert.match(source, /\{selectedFamiliar\?\.display_name \?\? "No familiar selected"\}/, "the scope row names the active familiar");
assert.match(source, /Canonical status unavailable|Checking canonical status/, "the scope row reports canonical status");
assert.match(source, /aria-expanded=\{overviewOpen\}/, "the compact status exposes the canonical overview disclosure state");
assert.match(source, /<CanonicalMemoryOverviewPanel/, "the overview remains reachable without restoring the masthead");
assert.match(source, /<SearchInput[\s\S]*?placeholder=/, "search remains stable while the list scrolls");
assert.match(source, /<Popover[\s\S]*?ariaLabel="Memory filters"/, "filters stay in a focus-return popover");

console.log("ok - familiars-memory-view: compact scope and controls stay stable");
