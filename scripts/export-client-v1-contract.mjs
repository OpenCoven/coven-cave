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

export const REVIEWED_CLIENT_V1_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/client/v1/health" }),
  Object.freeze({ method: "POST", path: "/api/client/v1/pairing/requests" }),
  Object.freeze({ method: "GET", path: "/api/client/v1/pairing/requests/:id" }),
  Object.freeze({
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange",
  }),
]);

/**
 * The reviewed live declaration, restated here on purpose.
 *
 * This file is the refusal gate: it re-derives the fixture from contract.ts and
 * compares bytes, so a contract change that does not regenerate the artifact
 * fails CI. That only works if the gate holds an expectation of its OWN — a
 * check that read the declaration out of contract.ts and compared it to
 * contract.ts would pass for any value whatsoever, which is precisely how
 * `streaming` and `revisions` stayed advertised with no route (#4869).
 *
 * So changing either list is a two-file edit, and the second file is the one a
 * reviewer reads as "the maintainers decided this". Adding a live operation is
 * additive and cheap; REMOVING or RENAMING one is a compatibility decision, and
 * this is where that decision is recorded.
 */
export const REVIEWED_CLIENT_V1_CAPABILITIES = Object.freeze([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors",
]);

export const REVIEWED_CLIENT_V1_OPERATIONS = Object.freeze([
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "pairing.admin.list",
  "pairing.admin.decide",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
]);

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
  const fixture = execFileSync(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    source,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const parsed = JSON.parse(fixture);
  if (
    JSON.stringify(parsed.contract?.publicRoutes)
      !== JSON.stringify(REVIEWED_CLIENT_V1_PUBLIC_ROUTES)
  ) {
    throw new Error("Client v1 contract omitted the reviewed public routes.");
  }
  if (
    JSON.stringify(parsed.contract?.capabilities)
      !== JSON.stringify(REVIEWED_CLIENT_V1_CAPABILITIES)
  ) {
    throw new Error(
      "Client v1 contract capabilities differ from the reviewed live set. "
      + "Adding one is additive; removing or renaming one is a compatibility "
      + "decision — update REVIEWED_CLIENT_V1_CAPABILITIES deliberately.",
    );
  }
  const exportedOperationIds = Array.isArray(parsed.contract?.operations)
    ? parsed.contract.operations.map((operation) => operation?.id)
    : undefined;
  if (
    JSON.stringify(exportedOperationIds) !== JSON.stringify(REVIEWED_CLIENT_V1_OPERATIONS)
  ) {
    throw new Error(
      "Client v1 contract operations differ from the reviewed live inventory. "
      + "Adding one is additive; removing or renaming one is a compatibility "
      + "decision — update REVIEWED_CLIENT_V1_OPERATIONS deliberately.",
    );
  }
  // Each exported record has to be complete. An id with no method, path or
  // authority class is an entry a client can read and not act on, which is the
  // "advertised but unusable" failure this whole change exists to remove.
  for (const operation of parsed.contract.operations) {
    const complete = operation
      && typeof operation.method === "string" && operation.method
      && typeof operation.path === "string" && operation.path.startsWith("/api/client/v1/")
      && ["public", "admin", "authenticated"].includes(operation.ingress)
      && (operation.scope === null || typeof operation.scope === "string")
      && Array.isArray(operation.families) && operation.families.length > 0
      && operation.families.every((family) =>
        REVIEWED_CLIENT_V1_CAPABILITIES.includes(family),
      );
    if (!complete) {
      throw new Error(
        `Client v1 contract operation ${JSON.stringify(operation?.id)} is incomplete or `
        + "claims a capability family the reviewed live set does not contain.",
      );
    }
  }
  return fixture;
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
