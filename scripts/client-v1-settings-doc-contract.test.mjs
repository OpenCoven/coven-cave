import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// docs/client-v1-settings.md is the operator-facing companion to the public
// Client v1 HTTP reference. It intentionally repeats a handful of volatile
// facts from the shipped routes and the Settings surface itself — route-family
// counts, poll cadence, terminal 404/409 reconciliation, revoke semantics, and
// discovery/tokenless guidance. This keeps those facts useful only if they
// stay synced to the code that serves them.
//
// Deliberately NOT pinned: prose, ordering, or surrounding explanation. These
// assertions derive the facts from source constants, route code, and the
// current Settings UI, then look for those facts in the document. Rewriting
// sentences stays free; drifting operator guidance does not.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extract(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `could not derive ${label}`);
  return match[1];
}

function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  if (!endMarker) return text.slice(start);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing marker: ${endMarker}`);
  return text.slice(start, end);
}

function adminSettingsRoutes(settingsSource) {
  const routes = new Set();
  for (const match of settingsSource.matchAll(
    /fetch\(\s*(?:`([^`]+)`|"([^"]+)"|'([^']+)')/g,
  )) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    if (!raw.startsWith("/api/client/v1/admin/")) continue;
    routes.add(raw.replace(/\$\{[^}]+\}/g, ":id"));
  }
  return [...routes].sort();
}

const DOC_REPO_PATH = "docs/client-v1-settings.md";
const doc = read(DOC_REPO_PATH);
const settingsSource = read("src/components/settings-client-access.tsx");
const decisionRouteSource = read("src/app/api/client/v1/admin/pairing-requests/[id]/decision/route.ts");
const adminAuthSource = read("src/lib/server/client-v1/admin-auth.ts");
const credentialStoreSource = read("src/lib/server/client-v1/credential-store.ts");
const serverSource = read("server.ts");
const fixture = JSON.parse(read("src/lib/server/client-v1/contract-fixture.json"));

const workflowPublicRoutes = fixture.contract.publicRoutes.filter(
  ({ path: routePath }) =>
    routePath === "/api/client/v1/health" || routePath.startsWith("/api/client/v1/pairing/"),
);
const pairingRoutes = workflowPublicRoutes.filter(({ path: routePath }) =>
  routePath.startsWith("/api/client/v1/pairing/"),
);
const adminRoutes = adminSettingsRoutes(settingsSource);
const totalWorkflowRoutes = workflowPublicRoutes.length + adminRoutes.length;

const pollMs = Number(
  extract(
    settingsSource,
    /usePausablePoll\(refreshLedgerInBackground,\s*([\d_]+)/,
    "Client access poll interval",
  ).replaceAll("_", ""),
);
assert.equal(pollMs % 1000, 0, "poll interval must convert cleanly to whole seconds");
const pollSeconds = pollMs / 1000;

const revokeReason = extract(
  settingsSource,
  /const REVOKE_REASON = "([^"]+)"/,
  "Settings revoke reason",
);
const conflictReason = extract(
  decisionRouteSource,
  /reason:\s*"([^"]+)"/,
  "pairing conflict reason",
);
const terminalDecisionStatuses = [
  ...new Set(
    [...settingsSource.matchAll(/error\.status === (\d+)/g)].map(([, status]) => Number(status)),
  ),
].sort((left, right) => left - right);

test("states the approval workflow route families and companion API reference", () => {
  assert.ok(
    doc.includes("[Client v1 HTTP API](api/client-v1.md)"),
    `${DOC_REPO_PATH} should point operators at the canonical API reference`,
  );
  assert.ok(
    doc.includes("`GET /api/client/v1/health`"),
    `${DOC_REPO_PATH} should name the workflow health route`,
  );
  assert.match(
    doc,
    new RegExp(`\\b${totalWorkflowRoutes}\\s+shipped Client v1 routes\\b`),
    `${DOC_REPO_PATH} should state the current workflow route count (${totalWorkflowRoutes})`,
  );
  assert.match(
    doc,
    new RegExp(`\\b${pairingRoutes.length}\\s+pairing routes\\b`),
    `${DOC_REPO_PATH} should state the current pairing-route count (${pairingRoutes.length})`,
  );
  assert.match(
    doc,
    new RegExp(`\\b${adminRoutes.length}\\s+administrator routes\\b`),
    `${DOC_REPO_PATH} should state the current admin-route count (${adminRoutes.length})`,
  );
});

test("pins the shipped poll cadence and manual refresh path", () => {
  assert.match(
    settingsSource,
    /if \(busyActionsRef\.current\.size > 0 \|\| loadInFlightRef\.current\) return;/,
    "background refresh runs only while the ledger is idle",
  );
  assert.match(
    doc,
    new RegExp(`polls again every ${pollSeconds} seconds\\s+while idle`, "i"),
    `${DOC_REPO_PATH} should publish the current ${pollSeconds}s poll cadence`,
  );
  assert.match(
    doc,
    /\*\*Refresh\*\* for a manual reload\./,
    `${DOC_REPO_PATH} should mention the manual refresh affordance`,
  );
});

test("pins terminal 404/409 reconciliation to the shipped Settings behavior", () => {
  assert.deepEqual(
    terminalDecisionStatuses,
    [404, 409],
    "ClientAccessSection currently treats 404 + 409 pairing decisions as terminal reconciliation",
  );
  assert.match(
    settingsSource,
    /if \(isTerminalPairingDecisionError\(error\)\) \{[\s\S]*loadLedger\(\{ pairingsAlert: alert \}\)[\s\S]*alert,\s*\}\)\);/m,
    "terminal pairing failures keep the alert and force an authoritative refresh",
  );

  const section = between(
    doc,
    "Decision races reconcile in three distinct ways:",
    "If the failure is non-terminal",
  );
  for (const status of terminalDecisionStatuses) {
    assert.match(
      section,
      new RegExp(`\\b${status}\\b`),
      `${DOC_REPO_PATH} should mention terminal decision status ${status}`,
    );
  }
  assert.ok(
    section.includes(`\`${conflictReason}\``),
    `${DOC_REPO_PATH} should name the shipped conflict reason \`${conflictReason}\``,
  );
  assert.ok(
    section.includes("`not_found`"),
    `${DOC_REPO_PATH} should name the shipped 404 code \`not_found\``,
  );
  assert.match(
    section,
    /keeps? the failure message visible/i,
    `${DOC_REPO_PATH} should explain that terminal reconciliation preserves the failure alert`,
  );
  assert.match(
    section,
    /authoritative refresh|refresh authoritatively/i,
    `${DOC_REPO_PATH} should explain that terminal reconciliation refreshes from the real ledger`,
  );
});

test("pins revoke guidance to the shipped mutation payload and bearer invalidation", () => {
  assert.match(
    settingsSource,
    /body:\s*JSON\.stringify\(\{ reason: REVOKE_REASON \}\)/,
    "Settings sends the fixed revoke reason from REVOKE_REASON",
  );
  assert.match(
    credentialStoreSource,
    /if \(!record \|\| record\.revokedAt !== null \|\| !matches\) return false;/,
    "revoked credentials stop verifying immediately",
  );
  const section = between(
    doc,
    "## Revoke a credential",
    "## Current scopes and least-privilege guidance",
  );
  assert.ok(
    section.includes(`\`${revokeReason}\``),
    `${DOC_REPO_PATH} should state the shipped revoke reason \`${revokeReason}\``,
  );
  for (const field of ["revokedAt", "revocationReason"]) {
    assert.ok(
      section.includes(`\`${field}\``),
      `${DOC_REPO_PATH} should name credential field \`${field}\``,
    );
  }
  assert.match(
    section,
    /revoked tombstone/i,
    `${DOC_REPO_PATH} should explain that revoked credentials stay listed as tombstones`,
  );
  assert.ok(
    section.includes("`unauthorized`"),
    `${DOC_REPO_PATH} should state the post-revoke auth outcome`,
  );
});

test("pins discovery and tokenless guidance to the shipped contract", () => {
  assert.match(
    adminAuthSource,
    /process\.env\.COVEN_CAVE_AUTH_TOKEN\?\.trim\(\)/,
    "admin auth availability depends on COVEN_CAVE_AUTH_TOKEN",
  );
  assert.match(
    adminAuthSource,
    /clientV1ErrorResponse\(\s*"service_unavailable"/,
    "missing admin auth returns service_unavailable",
  );
  assert.match(
    serverSource,
    new RegExp(`const CLIENT_V1_DISCOVERY_FILE = "${escapeRegExp(fixture.contract.discovery.fileName)}"`),
    "server.ts discovery filename stays in sync with the contract fixture",
  );
  assert.match(
    serverSource,
    /publishStandaloneClientV1DiscoveryRecord\(loopbackHttpEndpoint\(hostname,\s*port\)\)/,
    "server publishes discovery after the listener is ready",
  );
  assert.match(
    serverSource,
    /removeStandaloneClientV1DiscoveryRecord\(CLIENT_V1_DISCOVERY_NONCE\)/,
    "server removes discovery on clean shutdown",
  );

  assert.ok(
    doc.includes("`COVEN_CAVE_AUTH_TOKEN`"),
    `${DOC_REPO_PATH} should name the admin-auth environment variable`,
  );
  assert.ok(
    doc.includes(`\`${fixture.contract.discovery.fileName}\``),
    `${DOC_REPO_PATH} should name the discovery file`,
  );
  assert.ok(
    doc.includes("`minimumClientVersion`"),
    `${DOC_REPO_PATH} should name the version floor field`,
  );
  assert.match(
    doc,
    /tokenless local mode/i,
    `${DOC_REPO_PATH} should describe tokenless local operation`,
  );
  assert.match(
    doc,
    new RegExp(`\\b${workflowPublicRoutes.length}\\s+public client routes\\b`),
    `${DOC_REPO_PATH} should state the current public-route count (${workflowPublicRoutes.length}) in tokenless mode guidance`,
  );
  assert.match(
    doc,
    new RegExp(`\\b${adminRoutes.length}\\s+admin routes\\b`),
    `${DOC_REPO_PATH} should state the current admin-route count (${adminRoutes.length}) in tokenless mode guidance`,
  );
  const section = between(
    doc,
    "### The client cannot find or reach this Cave",
    null,
  );
  assert.match(
    section,
    /after startup/i,
    `${DOC_REPO_PATH} should explain when discovery is published`,
  );
  assert.match(
    section,
    /clean shutdown removes the current record/i,
    `${DOC_REPO_PATH} should explain clean-shutdown discovery removal`,
  );
  assert.match(
    section,
    /crash or forced kill can leave a stale record/i,
    `${DOC_REPO_PATH} should explain stale-record recovery`,
  );
});
