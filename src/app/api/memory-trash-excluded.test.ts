import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./memory/route.ts", import.meta.url), "utf8");
assert.match(source, /startsWith\("\."\)/, "memory scan must skip dot-directories (hides .cave-trash)");
console.log("memory-trash-excluded.test: ok");
