// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const globals = await readFile(new URL("./globals.css", import.meta.url), "utf8");

assert.match(
  globals,
  /:root \{[\s\S]*?--background:\s*oklch\(0\.13 0\.022 293\);/,
  "Default Coven Cave background should stay on the dark lavender-inked oklch foundation",
);

assert.match(
  globals,
  /--bg-base:\s*var\(--background\);/,
  "Base shell surfaces should inherit the default background token",
);
