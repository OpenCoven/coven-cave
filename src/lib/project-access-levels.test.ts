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

const { projectAccessLabel, normalizeAccessLevel, resolveEffectiveAccess } = await import(moduleUrl.href);
assert.equal(projectAccessLabel("read"), "Read");
assert.equal(projectAccessLabel("write"), "Full");

// An absent `access` field is a v1 grant, which predates levels and unlocked
// every surface: it must keep meaning write, or upgrading revokes it silently.
assert.equal(normalizeAccessLevel(undefined), "write", "absent access stays legacy write");
assert.equal(normalizeAccessLevel("read"), "read");
assert.equal(normalizeAccessLevel("write"), "write");
// Any other value is unrecognised and means no access, never write.
for (const unrecognised of ["admin", "Write", "full", "", null, 1, true, {}]) {
  assert.equal(
    normalizeAccessLevel(unrecognised),
    null,
    `unrecognised access ${JSON.stringify(unrecognised)} means no access`,
  );
}

const resolve = (directAccess, groupAccess) => resolveEffectiveAccess({
  directGrants: directAccess === "absent"
    ? [{ familiarId: "echo", projectId: "p" }]
    : directAccess === "none" ? [] : [{ familiarId: "echo", projectId: "p", access: directAccess }],
  groups: groupAccess === "none" ? [] : [{
    id: "g", name: "G", memberFamiliarIds: ["echo"],
    projectGrants: [groupAccess === "absent" ? { projectId: "p" } : { projectId: "p", access: groupAccess }],
  }],
  familiarId: "echo",
  projectId: "p",
});
assert.equal(resolve("absent", "none").level, "write", "a v1 direct grant keeps write");
assert.equal(resolve("none", "absent").level, "write", "a v1 group grant keeps write");
assert.equal(resolve("admin", "none").level, null, "an unrecognised direct grant gives no access");
assert.deepEqual(resolve("none", "admin"), { level: null, direct: null, groups: [] },
  "an unrecognised group grant gives no access and is not listed as a source");
assert.equal(resolve("admin", "read").level, "read", "an unrecognised grant never raises another one");

console.log("project-access-levels.test.ts: ok");
