// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const lib = readFileSync(new URL("../../../../../lib/server/familiar-notes.ts", import.meta.url), "utf8");

// ── route: methods + auth gating ─────────────────────────────────────────────
assert.match(route, /export async function GET/, "exposes GET");
assert.match(route, /export async function POST/, "exposes POST");
assert.match(route, /export async function DELETE/, "exposes DELETE");
assert.match(route, /export const runtime = "nodejs"/, "runs on the node runtime for fs access");

assert.match(
  route,
  /if \(!id \|\| !isValidFamiliarId\(id\)\) \{[\s\S]*status: 403/,
  "every method gates the familiar id on isValidFamiliarId before fs access",
);
assert.match(
  route,
  /if \(!isValidNoteDate\(date\)\) \{[\s\S]*status: 400/,
  "an invalid date is rejected with 400 before fs access",
);

// ── lib: path-injection barriers ─────────────────────────────────────────────
assert.match(lib, /if \(!isValidFamiliarId\(id\)\) throw/, "the fs layer re-asserts the id guard inline");
assert.match(lib, /if \(!isValidNoteDate\(date\)\) throw/, "the fs layer re-asserts the date guard inline");
assert.match(
  lib,
  /path\.relative\(dir, file\)\.startsWith\("\.\."\)/,
  "the resolved note file must stay inside the familiar's notes dir",
);
assert.match(lib, /isEmptyNote\(note\)/, "an emptied note deletes its file instead of writing an empty husk");

console.log("familiars/[id]/notes route: all assertions passed");
