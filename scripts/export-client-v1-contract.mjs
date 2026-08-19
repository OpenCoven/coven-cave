#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const fixtureModuleUrl = pathToFileURL(
  path.join(repositoryRoot, "src", "lib", "server", "client-v1", "contract.ts"),
).href;

export const CLIENT_V1_CONTRACT_FIXTURE_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "contract-fixture.json",
);
export const CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "contract-fixture.sha256",
);

function buildFixture() {
  const source = [
    `import { renderClientV1ContractFixture } from ${JSON.stringify(fixtureModuleUrl)};`,
    "process.stdout.write(renderClientV1ContractFixture());",
  ].join("\n");
  return execFileSync(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    source,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

export function renderClientV1ContractFixture() {
  return buildFixture();
}

export function clientV1ContractFixtureSha256(fixture) {
  return `${createHash("sha256").update(fixture).digest("hex")}\n`;
}

function parseArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  throw new Error("usage: export-client-v1-contract.mjs [--check]");
}

function matchesCommittedFile(filePath, expected) {
  try {
    return readFileSync(filePath).equals(Buffer.from(expected));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const fixture = renderClientV1ContractFixture();
  const fixtureHash = clientV1ContractFixtureSha256(fixture);

  if (check) {
    if (
      !matchesCommittedFile(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixture)
      || !matchesCommittedFile(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, fixtureHash)
    ) {
      throw new Error(
        "Client v1 contract fixture is stale. Run node scripts/export-client-v1-contract.mjs.",
      );
    }
    return;
  }

  writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixture);
  writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, fixtureHash);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
