import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const guard = await readFile(new URL("./check-opencode-registry-release.mjs", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/opencode-compatibility-registry.md", import.meta.url), "utf8");

assert.match(workflow, /Require signed OpenCode compatibility registry[\s\S]*?NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL[\s\S]*?check-opencode-registry-release\.mjs/);
assert.match(workflow, /NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS/);
assert.match(workflow, /NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT/);
assert.match(guard, /registry URL must use HTTPS without credentials/);
assert.match(guard, /asymmetricKeyType !== "ed25519"/);
assert.match(guard, /keyring must contain one to four keys/);
assert.match(guard, /payloadHash/);
assert.match(docs, /rotation/i);
assert.match(docs, /built-in profile/i);
assert.match(docs, /Signature canonicalization \(format 1\)/);
assert.match(docs, /canonical UTF-8 text/);

// A registry endpoint is public build metadata, so an HTTPS URL that embeds
// basic-auth userinfo must fail without echoing its credential into CI output.
const { publicKey } = generateKeyPairSync("ed25519");
const credential = "publisher-token-must-not-leak";
const credentialed = spawnSync(process.execPath, ["scripts/check-opencode-registry-release.mjs"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
  env: {
    ...process.env,
    NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL: `https://publisher:${credential}@registry.example/opencode.json`,
    NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT: JSON.stringify({ sequence: 1, payloadHash: "a".repeat(64) }),
  },
});
assert.notEqual(credentialed.status, 0, "credentialed registry URLs must be rejected before packaging");
assert.match(credentialed.stderr, /without credentials/);
assert.doesNotMatch(credentialed.stderr, new RegExp(credential));
console.log("check-opencode-registry-release.test.mjs: ok");
