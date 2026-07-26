// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const globals = await readFile(new URL("./globals.css", import.meta.url), "utf8");

const covenRoot = globals.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.match(covenRoot, /--background:\s*oklch\(0\.225 0\.004 291\);/);
assert.match(covenRoot, /--card:\s*oklch\(0\.245 0\.005 291\);/);
assert.match(covenRoot, /--popover:\s*oklch\(0\.245 0\.005 291\);/);
assert.match(covenRoot, /--secondary:\s*oklch\(0\.275 0\.006 291\);/);
assert.match(covenRoot, /--muted:\s*oklch\(0\.275 0\.006 291\);/);
assert.match(covenRoot, /--accent:\s*oklch\(0\.275 0\.006 291\);/);
assert.match(covenRoot, /--bg-panel:\s*oklch\(0\.205 0\.004 291\);/);
assert.match(covenRoot, /--bg-elevated:\s*oklch\(0\.275 0\.006 291\);/);
assert.match(covenRoot, /--bg-hover:\s*oklch\(0\.305 0\.007 291\);/);

assert.match(
  globals,
  /--bg-base:\s*var\(--background\);/,
  "Base shell surfaces should inherit the default background token",
);
