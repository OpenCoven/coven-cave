// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// The <li> wrapping each memory file row must clamp its inner button.
assert.match(
  source,
  /<li\s+key=\{entry\.fullPath\}\s+className="[^"]*\bmin-w-0\b/,
  "Memory file <li> must include min-w-0 to prevent horizontal overflow",
);

// The <button> inside the <li> must also have min-w-0 so its child truncate clamps.
assert.match(
  source,
  /className="focus-ring-inset flex min-w-0 flex-1 items-start/,
  "Memory file row <button> must include min-w-0 so truncate clamps",
);

console.log("agents-memory-view-overflow.test.ts: ok");
