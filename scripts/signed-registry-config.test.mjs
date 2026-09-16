import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateSignedRegistryConfig } from "./signed-registry-config.mjs";

const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const { publicKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

const providers = [
  { name: "OpenCode", slug: "opencode", optional: false },
  { name: "Grok", slug: "grok", optional: false },
  { name: "OpenClaw", slug: "openclaw", optional: true },
];

test("shared validator accepts a valid Ed25519 registry contract", () => {
  assert.equal(
    validateSignedRegistryConfig({
      url: "https://registry.example/current.json",
      publicKey: pem,
      publicKeys: undefined,
      checkpoint: JSON.stringify({ sequence: 1, payloadHash: "a".repeat(64) }),
    }),
    null,
  );
});

test("shared validator classifies incomplete contracts without exposing values", () => {
  assert.deepEqual(
    validateSignedRegistryConfig({
      url: "https://registry.example/current.json",
      publicKey: pem,
      publicKeys: undefined,
      checkpoint: undefined,
    }),
    { kind: "missing" },
  );
});

for (const { name, slug, optional } of providers) {
  test(`${name} release guard delegates shared validation and rejects credentialed URLs`, async () => {
    const guard = await readFile(new URL(`./check-${slug}-registry-release.mjs`, import.meta.url), "utf8");

    assert.match(
      guard,
      /validateSignedRegistryConfig/,
      `${name} must delegate URL, keyring, and checkpoint validation to the shared guard`,
    );
    assert.match(
      workflow,
      new RegExp(`Require signed ${name} compatibility registry[\\s\\S]*?check-${slug}-registry-release\\.mjs`),
    );

    const credential = `${slug}-credential-must-not-leak`;
    const envPrefix = `NEXT_PUBLIC_COVEN_${slug.toUpperCase()}_SCHEMA_REGISTRY_`;
    const result = spawnSync(process.execPath, [`scripts/check-${slug}-registry-release.mjs`], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        [`${envPrefix}URL`]: `https://publisher:${credential}@registry.example/${slug}.json`,
        [`${envPrefix}PUBLIC_KEY`]: pem,
        [`${envPrefix}CHECKPOINT`]: JSON.stringify({ sequence: 1, payloadHash: "a".repeat(64) }),
      },
    });

    assert.notEqual(result.status, 0, "credentialed registry URLs must be rejected before packaging");
    assert.match(result.stderr, /without credentials/);
    assert.doesNotMatch(result.stderr, new RegExp(credential));

    if (optional) {
      const unconfiguredEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith(envPrefix)),
      );
      const unconfigured = spawnSync(process.execPath, [`scripts/check-${slug}-registry-release.mjs`], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: unconfiguredEnv,
      });
      assert.equal(unconfigured.status, 0, "OpenClaw remains optional when no registry field is configured");
      assert.match(unconfigured.stdout, /built-in compatibility baseline/);

      const partial = spawnSync(process.execPath, [`scripts/check-${slug}-registry-release.mjs`], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...unconfiguredEnv, [`${envPrefix}URL`]: "https://registry.example/openclaw.json" },
      });
      assert.notEqual(partial.status, 0, "a partial optional OpenClaw configuration fails closed");
      assert.match(partial.stderr, /configuration is partial/);
    } else {
      const missingEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith(envPrefix)));
      const missing = spawnSync(process.execPath, [`scripts/check-${slug}-registry-release.mjs`], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: missingEnv,
      });
      assert.notEqual(missing.status, 0, "required registry configuration cannot be omitted");
      assert.match(missing.stderr, new RegExp(`${name} compatibility registry URL`));
    }
  });
}
