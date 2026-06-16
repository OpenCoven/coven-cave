// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import { resolveWithinSessionRoots } from "./session-project-roots.ts";

// Use the cwd as a guaranteed-real directory so realpathSync resolves it.
const real = path.resolve(process.cwd());
const parent = path.dirname(real);

// Exact session root → allowed, returns the canonical path.
assert.equal(resolveWithinSessionRoots(real, [real]), real, "exact session root is allowed");

// A subdirectory of a session root → allowed.
assert.equal(
  resolveWithinSessionRoots(path.join(real, "src"), [real]),
  path.join(real, "src"),
  "subpath of a session root is allowed",
);

// A path NOT under any session root → rejected.
assert.equal(resolveWithinSessionRoots(parent, [real]), null, "parent of a session root is not allowed");
assert.equal(resolveWithinSessionRoots("/etc", [real]), null, "unrelated path is rejected");

// Empty session-root list (daemon offline / no sessions) → never widens.
assert.equal(resolveWithinSessionRoots(real, []), null, "no session roots → no widening");

// Sibling-prefix must not false-match (e.g. /a/foo vs /a/foobar).
const sib = `${real}-sibling`;
assert.equal(resolveWithinSessionRoots(sib, [real]), null, "sibling sharing a string prefix is not 'within'");

console.log("session-project-roots.test.ts: ok");
