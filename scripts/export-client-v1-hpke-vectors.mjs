#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const vectorModuleUrl = pathToFileURL(
  path.join(
    repositoryRoot,
    "src",
    "lib",
    "server",
    "client-v1",
    "hpke-bound-v1-vector.ts",
  ),
).href;

export const CLIENT_V1_HPKE_VECTOR_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "hpke-bound-v1-vectors.json",
);
export const CLIENT_V1_HPKE_VECTOR_SHA256_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "hpke-bound-v1-vectors.sha256",
);

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(asciiCompare)
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function renderClientV1HpkeVector(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function clientV1HpkeVectorSha256(vector) {
  return `${createHash("sha256").update(vector).digest("hex")}\n`;
}

async function buildVector() {
  const source = [
    `import { createClientV1HpkeBoundV1Vector } from ${JSON.stringify(vectorModuleUrl)};`,
    "process.stdout.write(JSON.stringify(await createClientV1HpkeBoundV1Vector()));",
  ].join("\n");
  const rendered = execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      source,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  return JSON.parse(rendered);
}

function parseArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  throw new Error("usage: export-client-v1-hpke-vectors.mjs [--check]");
}

function matchesCommittedFile(filePath, expected) {
  try {
    return readFileSync(filePath).equals(Buffer.from(expected));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function writePairAtomically(vector, digest) {
  const vectorTemporaryPath =
    `${CLIENT_V1_HPKE_VECTOR_PATH}.${process.pid}.new`;
  const digestTemporaryPath =
    `${CLIENT_V1_HPKE_VECTOR_SHA256_PATH}.${process.pid}.new`;
  try {
    writeFileSync(vectorTemporaryPath, vector, { flag: "wx" });
    writeFileSync(digestTemporaryPath, digest, { flag: "wx" });
    renameSync(vectorTemporaryPath, CLIENT_V1_HPKE_VECTOR_PATH);
    renameSync(digestTemporaryPath, CLIENT_V1_HPKE_VECTOR_SHA256_PATH);
  } finally {
    rmSync(vectorTemporaryPath, { force: true });
    rmSync(digestTemporaryPath, { force: true });
  }
}

async function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const vector = renderClientV1HpkeVector(await buildVector());
  const digest = clientV1HpkeVectorSha256(vector);

  if (check) {
    if (
      !matchesCommittedFile(CLIENT_V1_HPKE_VECTOR_PATH, vector)
      || !matchesCommittedFile(CLIENT_V1_HPKE_VECTOR_SHA256_PATH, digest)
    ) {
      throw new Error(
        "Client v1 HPKE vector fixture is stale. "
        + "Run node scripts/export-client-v1-hpke-vectors.mjs.",
      );
    }
    return;
  }

  writePairAtomically(vector, digest);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
