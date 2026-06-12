// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /isMissingExecutableError\(err\)[\s\S]*covenCliMissingError\(\)/,
  "daemon start should not surface raw spawn coven ENOENT on new installs",
);

console.log("daemon start route.test.ts: ok");
