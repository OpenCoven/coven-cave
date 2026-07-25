import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const guard = await readFile(new URL("./check-opencode-registry-release.mjs", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/opencode-compatibility-registry.md", import.meta.url), "utf8");

assert.match(workflow, /Require signed OpenCode compatibility registry[\s\S]*?NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL[\s\S]*?check-opencode-registry-release\.mjs/);
assert.match(workflow, /NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS/);
assert.match(guard, /new URL\(url\)\.protocol !== "https:"/);
assert.match(guard, /asymmetricKeyType !== "ed25519"/);
assert.match(guard, /keyring must contain one to four keys/);
assert.match(docs, /rotation/i);
assert.match(docs, /built-in profile/i);
console.log("check-opencode-registry-release.test.mjs: ok");
