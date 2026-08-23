// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleUrl = new URL("./project-access-levels.ts", import.meta.url);
const source = readFileSync(moduleUrl, "utf8");

assert.match(
  source,
  /export function projectAccessLabel\(/,
  "project access levels should expose one shared client-safe display label",
);

const { projectAccessLabel } = await import(moduleUrl.href);
assert.equal(projectAccessLabel("read"), "Read");
assert.equal(projectAccessLabel("write"), "Full");

console.log("project-access-levels.test.ts: ok");
