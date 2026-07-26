import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  assert.ok(existsSync(path), `${relativePath} should exist`);
  return readFileSync(path, "utf8");
};

const source = read("./task-link-picker.tsx");

assert.match(source, /embedded\?: boolean/);
assert.match(
  source,
  /className=\{`task-link-picker \$\{embedded \? "task-link-picker--embedded" : "task-link-picker--floating"\}`\}/,
  "the picker should switch between floating and in-flow shells",
);
assert.match(source, /data-embedded=\{embedded \|\| undefined\}/);
assert.match(source, /tabIndex=\{-1\}/);
assert.match(source, /autoFocus/);
assert.match(source, /document\.addEventListener\("mousedown", onDown\);/);
assert.match(source, /if \(e\.key === "Escape"\) onClose\(\);/);
assert.match(
  source,
  /className="max-h-\[16rem\] overflow-y-auto py-1"/,
  "the picker still keeps its own scrollable results list",
);

console.log("task-link-picker.test.ts: ok");
