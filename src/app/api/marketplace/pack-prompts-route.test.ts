// @ts-nocheck
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPromptsDir } from "../../../lib/server/prompt-scan.ts";

// Marketplace prompt-pack previews (cave-1f9h). The route itself is thin
// (resolveCatalogName → scanPromptsDir), so these tests exercise the real
// pack files on disk: every shipped pack parses, the shipping pack is present
// with multi-placeholder + defaulted bodies, and NO prompt id collides across
// packs or the built-ins (the merge is by id, so a collision would silently
// shadow a template).

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const pluginsDir = path.join(repoRoot, "marketplace", "plugins");

// ── Route source pins ────────────────────────────────────────────────────────
const routeSrc = await readFile(new URL("./pack-prompts/route.ts", import.meta.url), "utf8");
assert.match(routeSrc, /export async function GET/, "pack-prompts exposes GET");
assert.match(routeSrc, /resolveCatalogName\(id\)/, "the id is resolved against the catalog allowlist");
assert.match(routeSrc, /return NextResponse\.json\(\{ ok: false[\s\S]{0,80}?status: 400/, "an unknown id is a 400");
assert.match(routeSrc, /scanPromptsDir\(path\.join\(pluginDir\(name\), "prompts"\)/, "scans the resolved pack's prompts dir");
assert.doesNotMatch(routeSrc, /isLocalOrigin/, "read-only preview needs no local-origin gate");

// ── Every shipped pack's prompts parse ───────────────────────────────────────
const packNames = (await readdir(pluginsDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const idOwners = new Map(); // prompt id → first source that claimed it
let totalPromptFiles = 0;
for (const name of packNames) {
  const scanned = [];
  await scanPromptsDir(path.join(pluginsDir, name, "prompts"), `pack:${name}`, scanned);
  for (const p of scanned) {
    totalPromptFiles += 1;
    assert.ok(p.body.trim().length > 0, `${name}/${p.id} has a body`);
    // Collision check across packs.
    if (idOwners.has(p.id)) {
      assert.fail(`prompt id "${p.id}" is shared by ${idOwners.get(p.id)} and pack:${name}`);
    }
    idOwners.set(p.id, `pack:${name}`);
  }
}
assert.ok(totalPromptFiles > 0, "at least one pack ships prompt templates");

// ── No pack id collides with a built-in ──────────────────────────────────────
const defaultsSrc = await readFile(new URL("../../../lib/prompt-defaults.ts", import.meta.url), "utf8");
const builtinIds = [...defaultsSrc.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
assert.ok(builtinIds.length >= 3, "found the built-in ids");
for (const id of builtinIds) {
  assert.ok(!idOwners.has(id), `built-in id "${id}" must not collide with pack ${idOwners.get(id)}`);
}

// ── The shipping pack (this PR) is present and showcases placeholders ─────────
const shipping = [];
await scanPromptsDir(path.join(pluginsDir, "prompt-pack-shipping", "prompts"), "pack:prompt-pack-shipping", shipping);
assert.ok(shipping.length >= 5, "prompt-pack-shipping ships its five templates");
const byId = Object.fromEntries(shipping.map((p) => [p.id, p]));
for (const id of ["release-notes-launch", "pr-description-detailed", "bug-repro", "standup-update", "retro-notes"]) {
  assert.ok(byId[id], `shipping pack includes ${id}`);
}
// Distinct from the essentials pack's ids (no release-notes / pr-description clash).
assert.ok(!byId["release-notes"], "shipping uses release-notes-launch, not release-notes");
assert.ok(!byId["pr-description"], "shipping uses pr-description-detailed, not pr-description");
// Multi-placeholder with defaults is the pack's showcase.
assert.match(byId["standup-update"].body, /\{\{team\|the team\}\}/, "standup shows a defaulted placeholder");
assert.match(byId["standup-update"].body, /\{\{blockers\|none\}\}/, "standup has a second defaulted placeholder");
assert.match(byId["release-notes-launch"].body, /\{\{last release\|the last tag\}\}/, "launch notes carry a defaulted token");

console.log("pack-prompts-route.test.ts: ok");
