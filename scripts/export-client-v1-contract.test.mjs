import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CLIENT_V1_CONTRACT_FIXTURE_PATH,
  CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH,
  clientV1ContractFixtureSha256,
  renderClientV1ContractFixture,
} from "./export-client-v1-contract.mjs";

const gitAttributes = readFileSync(new URL("../../..", import.meta.url), "utf8");

function runExporter(...args) {
  return spawnSync(process.execPath, ["scripts/export-client-v1-contract.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function withTrackedFixtureRestored(run) {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    return run();
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
}

test("documents the tracked client v1 fixture paths and LF normalization", () => {
  assert.equal(
    CLIENT_V1_CONTRACT_FIXTURE_PATH,
    path.join(process.cwd(), "src", "lib", "server", "client-v1", "contract-fixture.json"),
  );
  assert.equal(
    CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH,
    path.join(process.cwd(), "src", "lib", "server", "client-v1", "contract-fixture.sha256"),
  );
  for (const rule of [
    "src/lib/server/client-v1/contract-fixture.json text eol=lf",
    "src/lib/server/client-v1/contract-fixture.sha256 text eol=lf",
  ]) {
    assert.ok(gitAttributes.split(/\r?\n/u).includes(rule), `.gitattributes must include: ${rule}`);
  }
});

test("checks generated contract bytes without rewriting committed files before any write path runs", () => {
  const beforeFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const beforeHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);
  const result = runExporter("--check");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH), beforeFixture);
  assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH), beforeHash);
});

test("fails read-only validation when the committed fixture bytes go stale", () => {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, `${fixtureBytes.toString("utf8").replace(/\n$/, "")} stale\n`, "utf8");
    const staleFixture = runExporter("--check");
    assert.notEqual(staleFixture.status, 0, staleFixture.stdout + staleFixture.stderr);
    assert.match(
      staleFixture.stderr || staleFixture.stdout,
      /Client v1 contract fixture is stale/,
    );
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
});

test("fails read-only validation when the committed digest bytes go stale", () => {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, `${"0".repeat(64)}\n`, "utf8");
    const staleDigest = runExporter("--check");
    assert.notEqual(staleDigest.status, 0, staleDigest.stdout + staleDigest.stderr);
    assert.match(
      staleDigest.stderr || staleDigest.stdout,
      /Client v1 contract fixture is stale/,
    );
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
});

test("restores tracked client v1 bytes when a write-path assertion fails", () => {
  const originalFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const originalHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);
  const dirtyFixture = Buffer.from(
    `${originalFixture.toString("utf8").replace(/\n$/, "")}\n// local-only dirty bytes\n`,
    "utf8",
  );
  const dirtyHash = Buffer.from(`${"f".repeat(64)}\n`, "utf8");

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, dirtyFixture);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, dirtyHash);
    const foundFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
    const foundHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

    assert.throws(
      () =>
        withTrackedFixtureRestored(() => {
          const first = runExporter();
          assert.equal(first.status, 0, first.stderr || first.stdout);
          throw new Error("simulated failure after write");
        }),
      /simulated failure after write/,
    );
    assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH), foundFixture);
    assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH), foundHash);
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, originalFixture);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, originalHash);
  }
});

test("exports deterministic client v1 bytes across consecutive writes", () => {
  withTrackedFixtureRestored(() => {
    const first = runExporter();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, "utf8");
    const firstHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, "utf8");

    const second = runExporter();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, "utf8");
    const secondHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, "utf8");

    assert.equal(firstFixture, renderClientV1ContractFixture());
    assert.equal(firstFixture, secondFixture);
    assert.equal(firstHash, secondHash);
    assert.match(firstHash, /^[0-9a-f]{64}\n$/);
    assert.equal(firstHash, clientV1ContractFixtureSha256(firstFixture));
    assert.equal(firstHash, `${createHash("sha256").update(firstFixture).digest("hex")}\n`);
  });
});
