// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanPromptsDir } from "../../../lib/server/prompt-scan.ts";

const routeSrc = await readFile(new URL("./pack-prompts/route.ts", import.meta.url), "utf8");
assert.match(routeSrc, /resolveCatalogName\(id\)/);
assert.match(routeSrc, /return NextResponse\.json\(\{ ok: false[\s\S]{0,80}?status: 400/);
assert.match(routeSrc, /scanPromptsDir\(path\.join\((?:\/\* turbopackIgnore: true \*\/ )?await ensureMarketplacePlugin\(name\), "prompts"\)/);
assert.match(routeSrc, /status: 503/, "download failures are explicit, not empty successful previews");

const catalog = JSON.parse(await readFile(new URL("../../../../marketplace/catalog.json", import.meta.url), "utf8"));
const pins = JSON.parse(await readFile(new URL("../../../../marketplace/payloads.json", import.meta.url), "utf8"));
const owners = new Map();
for (const plugin of catalog.plugins) {
  const prompts = plugin.prompts ?? plugin.craft?.bundled?.prompts ?? [];
  for (const prompt of prompts) {
    assert.ok(!owners.has(prompt.id), "prompt IDs must remain unique across packs");
    owners.set(prompt.id, plugin.name);
    assert.match(pins.plugins[plugin.name].fileSha256["prompts/" + prompt.id + ".md"], /^[a-f0-9]{64}$/);
    assert.ok(prompt.body.trim());
  }
}
const defaults = await readFile(new URL("../../../lib/prompt-defaults.ts", import.meta.url), "utf8");
for (const match of defaults.matchAll(/id:\s*"([^"]+)"/g)) assert.ok(!owners.has(match[1]));

const root = await mkdtemp(path.join(tmpdir(), "cave-prompt-preview-"));
try {
  const prompts = path.join(root, "prompts");
  await mkdir(prompts);
  await writeFile(path.join(prompts, "standup.md"), "---\nname: Standup\ndescription: Team status\n---\n\nTeam {{team|the team}}. Blockers: {{blockers|none}}.");
  const scanned = [];
  await scanPromptsDir(prompts, "pack:example", scanned);
  assert.equal(scanned.length, 1);
  assert.equal(scanned[0].name, "Standup");
  assert.equal(scanned[0].source, "pack:example");
  assert.match(scanned[0].body, /\{\{team\|the team\}\}/);
  assert.match(scanned[0].body, /\{\{blockers\|none\}\}/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("pack-prompts-route.test.ts: ok");
