import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const memoryRoute = await readFile(
  new URL("../app/api/memory/route.ts", import.meta.url),
  "utf8",
);
const fileRoute = await readFile(
  new URL("../app/api/memory/file/route.ts", import.meta.url),
  "utf8",
);
const memoryView = await readFile(
  new URL("./familiars-memory-view.tsx", import.meta.url),
  "utf8",
);
const sourceResolver = await readFile(
  new URL("../lib/server/hermes-memory-source.ts", import.meta.url),
  "utf8",
);

assert.match(
  memoryRoute,
  /hermesOnly[\s\S]*?familiarId required[\s\S]*?resolveHermesMemorySource\(familiarId\)/,
  "Hermes inventory requests require a server-resolved familiar scope",
);
assert.match(
  fileRoute,
  /parseHermesMemoryUri\(target\)[\s\S]*?resolveHermesMemorySource\(reference\.familiarId\)/,
  "opaque record reads resolve the same familiar scope server-side",
);
assert.match(
  memoryView,
  /new URLSearchParams\(\{[\s\S]*?hermesOnly: "1",[\s\S]*?familiarId: effectiveFamiliarFilter/,
  "the Memory surface sends its selected familiar with Hermes queries",
);
assert.match(
  memoryView,
  /serverMatched: Boolean\(normalizedQuery\)/,
  "server FTS matches remain visible without lossy client substring matching",
);
assert.match(
  memoryView,
  /hermesSearch\?\.familiarId !== effectiveFamiliarFilter/,
  "Hermes results cannot carry across familiar switches",
);
assert.match(
  sourceResolver,
  /Object\.hasOwn\(config\.familiars, familiarId\)/,
  "fabricated familiar IDs cannot inherit the global default Hermes binding",
);
assert.match(
  memoryView,
  /<MemoryReaderPane[\s\S]*?key=\{selectedRow\?\.rowId \?\? "empty"\}/,
  "changing records remounts the reader so previous content cannot carry over",
);

console.log("hermes-memory-surface: all assertions passed");
