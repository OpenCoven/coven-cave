// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const globals = await readFile(new URL("./globals.css", import.meta.url), "utf8");

assert.match(
  globals,
  /--background:\s*#19191c;/,
  "Default Coven Cave background should stay on the darker Mood C foundation",
);

assert.match(
  globals,
  /--bg-base:\s*var\(--background\);/,
  "Base shell surfaces should inherit the default background token",
);
