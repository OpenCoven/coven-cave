import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyCiPaths } from "./ci-paths.mjs";

// docs/api/client-v1.md is the written reference for the Client v1 HTTP
// surface. A reference nothing checks is worse than none: a client author
// trusts it, and the first thing they learn is that it lies.
//
// PR #4840 landed eight routes with no reference at all, even though
// scripts/ci-paths.mjs already routed `docs/api/client-v1` into the client-v1
// CI lane — the wiring anticipated the file and nothing gated its absence.
// This pins the doc to the two artifacts that define the surface: the route
// modules on disk, and the exported contract fixture. A ninth route, a new
// scope, or a new error code that lands without a line here fails this test
// rather than shipping an incomplete reference.
//
// Deliberately NOT pinned: prose, ordering, examples. This asserts coverage,
// not wording — a test that fails on a rewritten sentence trains people to
// stop rewriting sentences.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC_REPO_PATH = "docs/api/client-v1.md";
const docPath = path.join(repoRoot, DOC_REPO_PATH);
const routesRoot = path.join(repoRoot, "src", "app", "api", "client", "v1");
const fixturePath = path.join(
  repoRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "contract-fixture.json",
);

const doc = readFileSync(docPath, "utf8");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const HTTP_METHOD_EXPORT =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

/** Every `route.ts` under src/app/api/client/v1, as `METHOD /api/...` pairs. */
function shippedRoutes(dir = routesRoot, segments = []) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) {
      found.push(...shippedRoutes(path.join(dir, entry.name), [...segments, entry.name]));
      continue;
    }
    if (entry.name !== "route.ts") continue;
    // `[id]` is Next's dynamic segment; the contract and the doc both write
    // it as `:id`, so normalize to the documented spelling.
    const routePath = ["/api/client/v1", ...segments.map((s) => s.replace(/^\[(.+)\]$/u, ":$1"))]
      .join("/");
    const source = readFileSync(path.join(dir, entry.name), "utf8");
    const methods = [...source.matchAll(HTTP_METHOD_EXPORT)].map(([, method]) => method);
    assert.ok(
      methods.length > 0,
      `${routePath}: no exported HTTP method found — the doc pin cannot see this route`,
    );
    for (const method of methods) found.push(`${method} ${routePath}`);
  }
  return found;
}

/**
 * The doc writes every route as a backticked `METHOD /path` heading.
 *
 * Matched with the backticks rather than as a bare substring on purpose:
 * `POST /api/client/v1/pairing/requests` is a prefix of
 * `POST /api/client/v1/pairing/requests/:id/exchange`, so a substring test
 * would let the create route be deleted from the doc and still pass.
 */
function documentsRoute(route) {
  return doc.includes(`\`${route}\``);
}

test("documents every shipped client v1 route with its HTTP method", () => {
  const routes = shippedRoutes();
  assert.ok(routes.length >= 8, `expected the shipped client v1 routes, found ${routes.length}`);
  const undocumented = routes.filter((route) => !documentsRoute(route));
  assert.deepEqual(
    undocumented,
    [],
    `${DOC_REPO_PATH} is missing: ${undocumented.join(", ")} — add a section per route`,
  );
});

test("documents every public route the contract advertises", () => {
  const publicRoutes = fixture.contract.publicRoutes.map(
    ({ method, path: routePath }) => `${method} ${routePath}`,
  );
  const undocumented = publicRoutes.filter((route) => !documentsRoute(route));
  assert.deepEqual(
    undocumented,
    [],
    `${DOC_REPO_PATH} omits contract publicRoutes: ${undocumented.join(", ")}`,
  );
});

test("documents every scope, capability, and error code in the contract", () => {
  for (const [label, values] of [
    ["scope", fixture.contract.pairingScopes],
    ["error code", fixture.contract.errorCodes],
  ]) {
    const missing = values.filter((value) => !doc.includes(`\`${value}\``));
    assert.deepEqual(
      missing,
      [],
      `${DOC_REPO_PATH} never names these ${label}s: ${missing.join(", ")}`,
    );
  }
  const missingCapabilities = fixture.contract.capabilities.filter(
    (capability) => !doc.includes(capability),
  );
  assert.deepEqual(
    missingCapabilities,
    [],
    `${DOC_REPO_PATH} never names these capabilities: ${missingCapabilities.join(", ")}`,
  );
});

test("documents the contract's versions and pairing secret header", () => {
  for (const value of [
    fixture.contract.apiVersion,
    fixture.contract.minimumClientVersion,
    fixture.contract.pairingSecretHeader,
  ]) {
    assert.ok(
      doc.includes(value),
      `${DOC_REPO_PATH} must state ${value} — a client reads it before pairing`,
    );
  }
});

test("lands where the client v1 CI lane already expects it", () => {
  // scripts/ci-paths.mjs routed `docs/api/client-v1` into the client-v1 lane
  // before the file existed. Moving or renaming the doc without updating that
  // regex would silently drop it out of the lane that validates the surface.
  const classified = classifyCiPaths([DOC_REPO_PATH]);
  assert.equal(classified.frontend, true, `${DOC_REPO_PATH} must select the frontend lane`);
  assert.equal(classified.e2e, true, `${DOC_REPO_PATH} must select the e2e lane`);
  assert.equal(classified.docs, true, `${DOC_REPO_PATH} must select the docs lane`);
});
