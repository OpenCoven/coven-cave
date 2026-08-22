import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
//
// It does pin three things beyond bare name coverage, because mutation-testing
// the first version showed a wrong doc passing it:
//
//   - Routes are matched as SECTION HEADINGS with a body, not as any mention.
//     Naming a route in a cross-reference is not documenting it, and a heading
//     over nothing is a doc that has already rotted.
//   - Every route heading must name a route that exists. A reference can be
//     wrong by INVENTION as well as by omission, and inventing is worse: a
//     client author writes code against an endpoint that 404s.
//   - The error-code table's HTTP statuses are compared against
//     httpStatusForClientV1ErrorCode. That table is the densest factual claim
//     in the file and the one a client branches on.

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
 * Every `### `METHOD /path`` heading in the doc, mapped to its section body.
 *
 * Headings are read with their backticks rather than as bare substrings on
 * purpose: `POST /api/client/v1/pairing/requests` is a prefix of
 * `POST /api/client/v1/pairing/requests/:id/exchange`, so a substring test
 * would let the create route be deleted from the doc and still pass.
 */
function documentedSections() {
  const headings = [
    ...doc.matchAll(/^### `((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/api\/[^`\n]*)`\s*$/gmu),
  ];
  return new Map(
    headings.map((match, index) => {
      const bodyStart = match.index + match[0].length;
      const next = headings[index + 1];
      const bodyEnd = next === undefined ? doc.length : next.index;
      const body = doc.slice(bodyStart, bodyEnd).split(/^#{1,3} /mu)[0];
      return [match[1], body.trim()];
    }),
  );
}

/** A heading over nothing is not a reference. Low enough to be a floor, not a
 *  style rule: the shortest real section here is several times this. */
const MINIMUM_SECTION_CHARACTERS = 200;

test("documents every shipped client v1 route in its own section", () => {
  const routes = shippedRoutes();
  assert.ok(routes.length >= 8, `expected the shipped client v1 routes, found ${routes.length}`);
  const sections = documentedSections();
  const undocumented = routes.filter((route) => !sections.has(route));
  assert.deepEqual(
    undocumented,
    [],
    `${DOC_REPO_PATH} is missing: ${undocumented.join(", ")} — add a \`### \`METHOD /path\`\` section per route`,
  );
  const empty = routes.filter(
    (route) => (sections.get(route) ?? "").length < MINIMUM_SECTION_CHARACTERS,
  );
  assert.deepEqual(
    empty,
    [],
    `${DOC_REPO_PATH} has a heading but effectively no body for: ${empty.join(", ")}`,
  );
});

test("documents no route that does not exist", () => {
  // Omission ships an incomplete reference; invention ships a client written
  // against an endpoint that answers 404. The second is the worse failure and
  // nothing else here would catch it.
  const shipped = new Set(shippedRoutes());
  const invented = [...documentedSections().keys()].filter((route) => !shipped.has(route));
  assert.deepEqual(
    invented,
    [],
    `${DOC_REPO_PATH} documents routes with no route.ts under src/app/api/client/v1: ${invented.join(", ")}`,
  );
});

test("documents every public route the contract advertises", () => {
  const publicRoutes = fixture.contract.publicRoutes.map(
    ({ method, path: routePath }) => `${method} ${routePath}`,
  );
  const sections = documentedSections();
  const undocumented = publicRoutes.filter((route) => !sections.has(route));
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
  // As a quoted or backticked literal, not as a bare substring: `pairing`,
  // `projects`, `streaming` and most of the rest are ordinary English words
  // this document uses in prose, so a bare `includes` was satisfied whether or
  // not the capability list was actually there.
  const missingCapabilities = fixture.contract.capabilities.filter(
    (capability) => !doc.includes(`"${capability}"`) && !doc.includes(`\`${capability}\``),
  );
  assert.deepEqual(
    missingCapabilities,
    [],
    `${DOC_REPO_PATH} never names these capabilities as literals: ${missingCapabilities.join(", ")}`,
  );
});

test("documents the contract's versions and pairing secret header", () => {
  // Version numbers are matched as whole tokens: "1.0" is a substring of
  // "0.1.0", so a bare `includes` let the apiVersion vanish from the document
  // entirely while minimumClientVersion kept the assertion green.
  for (const version of [fixture.contract.apiVersion, fixture.contract.minimumClientVersion]) {
    const token = new RegExp(`(?<![\\d.])${version.replaceAll(".", "\\.")}(?![\\d.])`, "u");
    assert.ok(
      token.test(doc),
      `${DOC_REPO_PATH} must state ${version} — a client reads it before pairing`,
    );
  }
  assert.ok(
    doc.includes(fixture.contract.pairingSecretHeader),
    `${DOC_REPO_PATH} must state ${fixture.contract.pairingSecretHeader} — a client reads it before pairing`,
  );
});

/** The canonical code → status map, read from responses.ts rather than
 *  re-typed. Same `--experimental-strip-types` hop
 *  scripts/export-client-v1-contract.mjs uses to read contract.ts. */
function canonicalErrorStatuses() {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "src", "lib", "server", "client-v1", "responses.ts"),
  ).href;
  const source = [
    `import { httpStatusForClientV1ErrorCode } from ${JSON.stringify(moduleUrl)};`,
    `const codes = ${JSON.stringify(fixture.contract.errorCodes)};`,
    "process.stdout.write(JSON.stringify(Object.fromEntries(",
    "  codes.map((code) => [code, httpStatusForClientV1ErrorCode(code)]),",
    ")));",
  ].join("\n");
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", "--input-type=module", "--eval", source],
      { cwd: repoRoot, encoding: "utf8" },
    ),
  );
}

test("pins every error code to the HTTP status responses.ts actually serves", () => {
  // The mapping table is the densest factual claim in the file and the one a
  // client branches on. Nothing else here reads the numbers in it, so a code
  // moved between statuses — or mistyped in the table — shipped silently.
  const canonical = canonicalErrorStatuses();
  const wrong = [];
  for (const [code, status] of Object.entries(canonical)) {
    const row = new RegExp(`^\\|\\s*\`${code}\`\\s*\\|\\s*(\\d{3})\\s*\\|`, "mu");
    const match = row.exec(doc);
    if (!match) wrong.push(`${code}: no \`| \`${code}\` | <status> |\` table row`);
    else if (Number(match[1]) !== status) {
      wrong.push(`${code}: documented ${match[1]}, responses.ts serves ${status}`);
    }
  }
  assert.deepEqual(wrong, [], `${DOC_REPO_PATH} error-code table disagrees with responses.ts: ${wrong.join("; ")}`);
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
