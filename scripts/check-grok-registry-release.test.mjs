import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const guard = await readFile(new URL("./check-grok-registry-release.mjs", import.meta.url), "utf8");
assert.match(workflow, /Require signed Grok compatibility registry[\s\S]*?NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL[\s\S]*?check-grok-registry-release\.mjs/);
assert.match(guard, /registry URL must use HTTPS without credentials/);
const { publicKey } = generateKeyPairSync("ed25519");
const result = spawnSync(process.execPath, ["scripts/check-grok-registry-release.mjs"], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_URL: "https://publisher:secret@registry.example/grok.json", NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(), NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_CHECKPOINT: JSON.stringify({ sequence: 1, payloadHash: "a".repeat(64) }) } });
assert.notEqual(result.status, 0);
assert.doesNotMatch(result.stderr, /secret/);
console.log("check-grok-registry-release.test.mjs: ok");
