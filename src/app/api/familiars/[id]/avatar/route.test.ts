// @ts-nocheck
//
// Guards for the familiar avatar route. GET serves a downscaled image; POST
// (added for the "New familiar" dialog's photo upload) accepts raw image bytes,
// normalizes them through sharp, and writes the canonical `<id>.png`.
//
// Source-text assertions (same pattern as the other route tests) — the id slug
// guard is the security-critical invariant, so it's asserted explicitly.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function GET\(/, "avatar route should still serve via GET");
assert.match(source, /export async function POST\(/, "avatar route should accept uploads via POST");

// The id is the only user input that reaches the filesystem; it MUST be
// slug-guarded with a 403 before any path is built, in BOTH handlers.
const guards = [...source.matchAll(/isValidFamiliarId\(id\)/g)];
assert.ok(guards.length >= 2, "both GET and POST must slug-guard the id");
assert.match(source, /path not allowed/, "guard must use the standard path-deny error");
assert.match(source, /status:\s*403/, "guard must return 403");

// POST decodes/normalizes through sharp before persisting (rejects non-images)
// and writes the canonical <id>.png the resolver prefers.
assert.match(source, /sharp\(raw\)/, "POST should decode the upload through sharp");
assert.match(source, /not a decodable image/, "POST should reject undecodable payloads with 400");
assert.match(
  source,
  /writeFile\(path\.join\(dir, `\$\{path\.basename\(id\)\}\.png`\)/,
  "POST should write the canonical <id>.png into the avatars dir (filename sanitized via basename)",
);
// The path build re-asserts the slug guard inline (barrier pattern) so the id
// can't reach familiarWorkspace/path.join unvalidated.
assert.match(
  source,
  /async function avatarsDirFor\(id: string\)[\s\S]*?isValidFamiliarId\(id\)/,
  "avatars-dir helper must re-assert the id guard before building the path",
);

// Size is bounded before the expensive decode.
assert.match(source, /MAX_AVATAR_BYTES/, "POST should bound the upload size");

console.log("avatar route.test.ts: ok");
