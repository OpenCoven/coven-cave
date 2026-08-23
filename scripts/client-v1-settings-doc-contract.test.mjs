import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { classifyCiPaths } from "./ci-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC_REPO_PATH = "docs/client-v1-settings.md";
const docPath = path.join(repoRoot, DOC_REPO_PATH);
const runTestsPath = path.join(repoRoot, "scripts", "run-tests.mjs");
const settingsClientAccessPath = path.join(
  repoRoot,
  "src",
  "components",
  "settings-client-access.tsx",
);
const pairingDecisionRoutePath = path.join(
  repoRoot,
  "src",
  "app",
  "api",
  "client",
  "v1",
  "admin",
  "pairing-requests",
  "[id]",
  "decision",
  "route.ts",
);
const credentialDeleteRoutePath = path.join(
  repoRoot,
  "src",
  "app",
  "api",
  "client",
  "v1",
  "admin",
  "credentials",
  "[id]",
  "route.ts",
);
const adminAuthPath = path.join(
  repoRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "admin-auth.ts",
);

const doc = readFileSync(docPath, "utf8");
const runTestsSource = readFileSync(runTestsPath, "utf8");
const settingsClientAccessSource = readFileSync(settingsClientAccessPath, "utf8");
const pairingDecisionRouteSource = readFileSync(pairingDecisionRoutePath, "utf8");
const credentialDeleteRouteSource = readFileSync(credentialDeleteRoutePath, "utf8");
const adminAuthSource = readFileSync(adminAuthPath, "utf8");

function parseWordOrNumber(docText, valuePattern, wordPattern, wordValue) {
  const numeric = new RegExp(`\\b(\\d+)\\s+${valuePattern}\\b`, "iu").exec(docText);
  if (numeric) return Number(numeric[1]);
  if (new RegExp(`\\b${wordPattern}\\s+${valuePattern}\\b`, "iu").test(docText)) {
    return wordValue;
  }
  return null;
}

function parseExportedNumberLiteral(source, exportName) {
  const match = new RegExp(`export const ${exportName} = ([\\d_]+);`, "u").exec(source);
  assert.ok(match, `${exportName} must remain a numeric literal export.`);
  return Number(match[1].replaceAll("_", ""));
}

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(repoRoot, relativePath)).href;
}

function tsEvalJson(lines) {
  return JSON.parse(execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      lines.join("\n"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  ));
}

test("documents the shipped client access operator actions behind the admin route family", () => {
  for (const action of ["Approve", "Deny", "Revoke"]) {
    assert.match(doc, new RegExp(`\\*\\*${action}\\*\\*`, "u"));
  }
  assert.match(doc, /same-origin browser source\./u);
  assert.match(doc, /admin route family/u);

  assert.match(
    pairingDecisionRouteSource,
    /requireClientV1Admin\(req, \{ mutation: true \}\)/u,
  );
  assert.match(
    pairingDecisionRouteSource,
    /body\.decision !== "approved" && body\.decision !== "denied"/u,
  );
  assert.match(
    credentialDeleteRouteSource,
    /requireClientV1Admin\(req, \{ mutation: true \}\)/u,
  );
  assert.match(credentialDeleteRouteSource, /export async function DELETE/u);
  assert.match(
    adminAuthSource,
    /Cave admin mutations require a same-origin request source\./u,
  );
});

test("documents pairing expiry and polling cadence from current source constants", () => {
  const pairingMinutes = parseWordOrNumber(doc, "minutes?", "five", 5);
  assert.equal(pairingMinutes, 5);

  const pairingTtlMs = tsEvalJson([
    `import { PAIRING_TTL_MS } from ${JSON.stringify(moduleUrl("src/lib/server/client-v1/pairing-store.ts"))};`,
    "process.stdout.write(JSON.stringify({ pairingTtlMs: PAIRING_TTL_MS }));",
  ]).pairingTtlMs;
  assert.equal(
    pairingMinutes,
    pairingTtlMs / 60_000,
    `${DOC_REPO_PATH} pairing expiry must match PAIRING_TTL_MS.`,
  );

  const documentedPollSeconds = parseWordOrNumber(doc, "seconds?", "ten", 10);
  if (documentedPollSeconds !== null) {
    assert.equal(
      documentedPollSeconds,
      parseExportedNumberLiteral(settingsClientAccessSource, "CLIENT_ACCESS_POLL_MS") / 1_000,
      `${DOC_REPO_PATH} polling cadence must match CLIENT_ACCESS_POLL_MS.`,
    );
  }
  assert.match(doc, /pauses polling[\s\S]*app is hidden/u);
  assert.match(
    settingsClientAccessSource,
    /usePausablePoll\([\s\S]*CLIENT_ACCESS_POLL_MS[\s\S]*enabled: active/u,
  );
});

test("documents terminal reconciliation without turning network failures into authority", () => {
  assert.match(doc, /no longer pending/u);
  assert.match(doc, /generic network or server error/u);
  assert.match(
    settingsClientAccessSource,
    /status === 404 \|\| status === 409/u,
  );
  assert.match(settingsClientAccessSource, /The request is no longer pending\./u);
  assert.match(settingsClientAccessSource, /load\("authoritative"/u);
});

test("documents strict secret isolation and stays wired into the client-v1 lanes", () => {
  const projected = tsEvalJson([
    `import { createPairingStore } from ${JSON.stringify(moduleUrl("src/lib/server/client-v1/pairing-store.ts"))};`,
    `import { clientV1CredentialMetadata } from ${JSON.stringify(moduleUrl("src/lib/server/client-v1/credential-store.ts"))};`,
    "const store = createPairingStore({ now: () => 1_000 });",
    "const issued = store.create({ appName: 'Doc Contract', installationId: 'doc-install', scopes: ['chat:read'] });",
    "const pending = store.listPending()[0];",
    "const credential = clientV1CredentialMetadata({",
    "  id: 'credential-doc',",
    "  appName: 'Doc Contract',",
    "  installationId: 'doc-install',",
    "  scopes: ['chat:read'],",
    "  bearerHash: 'f'.repeat(64),",
    "  createdAt: 1_000,",
    "  lastUsedAt: null,",
    "  revokedAt: null,",
    "  revocationReason: null,",
    "});",
    "process.stdout.write(JSON.stringify({",
    "  issuedKeys: Object.keys(issued).sort(),",
    "  pendingKeys: Object.keys(pending).sort(),",
    "  credentialKeys: Object.keys(credential).sort(),",
    "}));",
  ]);

  assert.equal(projected.issuedKeys.includes("secret"), true);
  assert.equal(projected.pendingKeys.includes("secret"), false);
  assert.equal(projected.pendingKeys.includes("secretHash"), false);
  assert.equal(projected.credentialKeys.includes("bearerHash"), false);
  assert.match(doc, /Secret values are never shown\./u);
  assert.match(doc, /stores bearer hashes only/u);

  const classified = classifyCiPaths([DOC_REPO_PATH]);
  assert.equal(classified.frontend, true);
  assert.equal(classified.e2e, true);
  assert.equal(classified.docs, true);
  assert.match(
    runTestsSource,
    /"scripts\/client-v1-settings-doc-contract\.test\.mjs"/u,
  );
});
