// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const itemRoute = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const seedRoute = readFileSync(new URL("./seed/route.ts", import.meta.url), "utf8");

assert.match(listRoute, /seedDefaultProjectsIfEmpty/, "GET /api/projects should seed defaults before listing");
assert.match(listRoute, /export async function GET\(\)/, "projects route should expose GET");
assert.match(listRoute, /export async function POST\(req: Request\)/, "projects route should expose POST");
assert.match(listRoute, /name and root are required/, "POST /api/projects should validate required fields");
assert.match(listRoute, /status:\s*201/, "POST /api/projects should return 201 when creating");

assert.match(itemRoute, /export async function PUT/, "project item route should expose PUT");
assert.match(itemRoute, /export async function DELETE/, "project item route should expose DELETE");
assert.match(itemRoute, /nothing to update/, "PUT /api/projects/[id] should reject empty patches");
assert.match(itemRoute, /not found/, "project item route should return not-found errors");

assert.match(seedRoute, /seedDefaultProjectsIfEmpty/, "seed route should invoke default seeding");
assert.match(seedRoute, /export async function POST\(\)/, "seed route should expose POST only");

console.log("projects route.test.ts: ok");
