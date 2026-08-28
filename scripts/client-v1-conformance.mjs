#!/usr/bin/env node

/**
 * Client v1 real-authority conformance run.
 *
 * Drives pairing, revocation and the five canonical reads against a *running,
 * release-mode* Cave over a real TCP socket, with real on-disk stores. It
 * exists because the program's operating rule 8 refuses to close a gate on
 * unit-test proxies: `src/lib/server/client-v1/**` and the route tests call the
 * handlers directly, so everything between the socket and the handler — the
 * listener's local-peer stamp, `proxy.ts`'s ingress refusals, its 411/413 body
 * rules, Next's own routing and percent-decoding, and the credential file the
 * store actually writes — is unasserted by all of them.
 *
 * Scope is the **Cave half only**. Issue #4838 names Cave, the SDK and Chat;
 * the SDK and Chat halves live in other repositories and are not exercised
 * here. Nothing in this file should be read as covering them.
 *
 *   node scripts/client-v1-conformance.mjs [--out <path>] [--include-ttl] [--include-authority-takeover] [--keep-fixture]
 *
 * Exits 0 when every assertion passed, 1 otherwise, and prints one line per
 * assertion. `--out` also writes the evidence record described in
 * docs/workflows/client-v1-conformance.md.
 *
 * TWO RULES THIS FILE LEARNED THE HARD WAY, both from builds that were broken
 * and that an earlier version of this run reported green:
 *
 *   - a projection is checked by KEY *and* by VALUE. A key-set check alone
 *     passes `root: project.id`, `harness: summary.harnessSessionId` and
 *     `text: turn.role` — a wrong path, a withheld id disclosed under an
 *     allowed key, and every transcript body replaced. Measured: 89 passed, 0
 *     failed, exit 0. See checkRecordValues.
 *   - a fixture has to carry what the projection withholds. A `forbidden` list
 *     cannot name a leak of a field the store never held, and a count cannot be
 *     wrong when the true answer is zero everywhere. See
 *     fixtureBranchedConversation's `b-a1`.
 *
 * And one about the record itself: a leg guarded by `if (someToken)` must record
 * a skip in its `else`, never nothing. See EXPECTED_ASSERTION_IDS.
 *
 * WHAT IT WILL NOT DO. It never reads or writes the operator's real Cave home.
 * Every run mints its own `COVEN_HOME`/`COVEN_CAVE_HOME` under a temp
 * directory, mints its own admin token, and removes both afterwards. A previous
 * hand-driven cycle used the real `~/.coven` and left a live credential behind
 * that had to be revoked by hand; a committed harness that can do that is worse
 * than no harness.
 *
 * WHAT IT DELIBERATELY LEAVES OUT, rather than faking:
 *
 *   - the real Coven daemon. `/api/client/v1/familiars` projects a daemon HTTP
 *     response, so the run stands up a fixture daemon on loopback and points
 *     the fixture Cave at it in hub mode. That is a real socket serving a real
 *     roster payload — but it is not the production daemon, and the run says so
 *     in its own output.
 *   - anything needing a second machine. The off-machine ingress refusals
 *     (#4843/#4855) are exercised by making the *listener* classify the request
 *     as forwarded, which is the same signal it reads for a real remote peer,
 *     but no request in this run actually originates elsewhere.
 *   - the 5-minute pairing TTL, unless `--include-ttl` is passed. There is no
 *     clock injection reachable from outside the process, so the only honest
 *     way to observe `pairing_expired` is to wait. Left off by default and
 *     reported as not-run rather than asserted from a shorter wait.
 */

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { connect as netConnect, createServer as createNetServer } from "node:net";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

/**
 * The `updatedAt` a mid-walk touch writes.
 *
 * Far in the future so it is unambiguously the newest row in the ledger by that
 * field: under the old, mutable page key this value is exactly what lifted a
 * touched row above an open cursor and lost it (cave-fhjlu).
 */
export const TOUCHED_AT = "2026-12-31T00:00:00.000Z";

export const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";
export const ADMIN_TOKEN_HEADER = "x-coven-cave-token";
export const CLIENT_V1_PREFIX = "/api/client/v1";
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
/** The contract's pairing TTL. Only `--include-ttl` waits it out. */
export const PAIRING_TTL_MS = 5 * 60_000;
/** The per-pairing wrong-secret budget, shared by the poll and exchange routes. */
export const PAIRING_FAILURE_LIMIT = 10;

// ── argument parsing ─────────────────────────────────────────────────────────

/**
 * Parse the flags, refusing anything unrecognised.
 *
 * A silently ignored flag is how a run that was asked for the slow TTL leg
 * reports a clean pass without ever having run it — the one outcome a
 * conformance harness must not produce.
 */
export function parseConformanceArgs(argv) {
  const options = {
    out: null,
    includeTtl: false,
    includeAuthorityTakeover: false,
    keepFixture: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--include-ttl") {
      options.includeTtl = true;
      continue;
    }
    if (flag === "--include-authority-takeover") {
      options.includeAuthorityTakeover = true;
      continue;
    }
    if (flag === "--keep-fixture") {
      options.keepFixture = true;
      continue;
    }
    if (flag === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out requires a path, for example --out docs/client-v1-conformance-results/run.json");
      }
      options.out = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown option ${JSON.stringify(flag)}`);
  }
  return options;
}

// ── assertion recording ──────────────────────────────────────────────────────

/**
 * One run's assertions, in the order they were made.
 *
 * Failures accumulate rather than throwing, for the reason the release smoke
 * gives: a run that stops at the first failure costs one full build-and-serve
 * cycle per fix. A leg that cannot even be attempted records `skipped` with the
 * reason, which is a different thing from a pass and is counted separately.
 */
export function createRecorder() {
  const entries = [];
  return {
    entries,
    pass(id, detail = "") {
      entries.push({ id, result: "pass", detail });
    },
    fail(id, detail) {
      entries.push({ id, result: "fail", detail });
    },
    skip(id, detail) {
      entries.push({ id, result: "skip", detail });
    },
    /** Record `failures` (empty means pass) against one id. */
    expect(id, failures, detail = "") {
      if (failures.length === 0) entries.push({ id, result: "pass", detail });
      else entries.push({ id, result: "fail", detail: failures.join("; ") });
    },
  };
}

/**
 * Every assertion id one run is required to produce, TTL leg aside.
 *
 * A leg guarded by `if (someToken)` used to vanish from the record when the
 * precondition failed, taking its id with it: the run then reported a smaller,
 * still-green total and nothing said which legs had gone. Two of the four the
 * write-up called "reported as skips" were in fact reported as nothing at all.
 *
 * Every such guard now records a skip, and this list is what makes that
 * checkable rather than a convention: a run that does not produce exactly these
 * ids fails on `harness.assertion-coverage`, whatever the individual legs said.
 * Add an id here in the same change that adds the assertion.
 */
export const EXPECTED_ASSERTION_IDS = [
  "admin.unconfigured/admin/pairing-requests.GET",
  "admin.unconfigured/admin/credentials.GET",
  "admin.unconfigured/admin/pairing-requests/:id/decision.POST",
  "admin.unconfigured/admin/credentials/:id.DELETE",
  "admin.unconfigured.pairing-still-opens",
  "admin.unconfigured.exchange-stays-pending",
  "health.envelope",
  "health.live-inventory",
  "health.instance-stable",
  "health.discovery-record",
  "ingress.escaped-path.percent",
  "ingress.escaped-path.percent-encoded-separator",
  "ingress.backslash-path-reaches-no-handler",
  "ingress.forwarded.public",
  "ingress.forwarded.authenticated",
  "ingress.forwarded.admin",
  "ingress.exchange-requires-content-length",
  "ingress.refuses-transfer-encoding",
  "ingress.body-cap",
  "ingress.pairing-content-type",
  "admin.wrong-token",
  "admin.no-token",
  "admin.mutation-requires-source",
  "pairing.create",
  "pairing.poll-pending",
  "pairing.admin-queue",
  "pairing.admin-approve",
  "pairing.poll-approved",
  "pairing.admin-approve-idempotent",
  "pairing.admin-decision-conflict",
  "pairing.exchange",
  "pairing.bearer-works",
  "pairing.replay-refused",
  "pairing.poll-after-exchange",
  "pairing.poll-denied",
  "pairing.exchange-denied",
  "pairing.unknown-id",
  "pairing.wrong-secret",
  "pairing.correct-secret-polling-is-free",
  "pairing.budget-charges-wrong-secret-on-poll",
  "pairing.budget-locks-out-the-holder",
  "pairing.budget-is-shared-across-routes",
  "pairing.budget-is-per-pairing",
  "reads.empty-first-page/projects",
  "reads.empty-first-page/conversations",
  "reads.no-bearer",
  "reads.unknown-bearer",
  "reads.bearer-not-accepted-in-query",
  "reads.scope-denied",
  "reads.familiars",
  "reads.familiars-paging",
  "reads.projects-shape",
  "reads.projects-paging-partial-final-page",
  "reads.cursor-replay-is-stable",
  "reads.cursor-current-echoes-the-token",
  "reads.cursor-survives-deletion",
  "reads.projects-paging-exact-multiple",
  "reads.refuses.limit-zero",
  "reads.refuses.limit-over-ceiling",
  "reads.refuses.limit-leading-zero",
  "reads.refuses.limit-exponent",
  "reads.refuses.limit-signed",
  "reads.refuses.limit-repeated",
  "reads.refuses.unsupported-parameter",
  "reads.refuses.offset",
  "reads.refuses.cursor-outside-alphabet",
  "reads.refuses.cursor-not-canonical",
  "reads.limit-ceiling-is-served",
  "reads.default-page-size",
  "reads.conversations-shape",
  "reads.conversations-paging",
  "reads.conversation-by-id",
  "reads.conversation-by-id-refuses-limit",
  "reads.conversation-by-id-refuses-cursor",
  "reads.conversation-by-id-not-found",
  "reads.conversations-touch-unserved-row-is-still-served",
  "reads.conversations-touch-served-row-is-not-repeated",
  "reads.conversations-touch-cursor-row-keeps-the-position",
  "reads.conversations-row-created-mid-walk-is-not-served",
  "reads.conversations-row-deleted-mid-walk-does-not-strand",
  "reads.conversations-tied-sort-key-breaks-on-id",
  "reads.conversations-without-created-at-are-served-last",
  "reads.conversations-keyless-row-written-mid-walk-is-still-served",
  "reads.conversations-keyless-rows-tie-on-the-id-tiebreak",
  "reads.conversations-keyless-row-keyed-between-walks-moves-once",
  "reads.conversations-unreadable-row-keeps-its-position-mid-walk",
  "reads.conversations-recovering-row-keeps-its-position-mid-walk",
  "reads.messages-active-branch",
  "reads.messages-values",
  "reads.messages-paging",
  "reads.messages-counts-not-contents",
  "reads.messages-reconcile-required",
  "reads.messages-restart-after-reconcile",
  "reads.messages-not-found",
  "reads.messages-canonical-conversation-id",
  "revocation.bearer-works-before",
  "revocation.admin-listing",
  "revocation.revoke",
  "revocation.bearer-refused-after",
  "revocation.is-idempotent",
  "revocation.unknown-credential",
  "revocation.tombstone-persists",
];

/** The TTL leg records one id or the other, never both and never neither. */
export const TTL_ASSERTION_IDS = {
  waited: ["pairing.ttl-poll-expired", "pairing.ttl-exchange-expired"],
  skipped: ["pairing.ttl-expiry"],
};

export const AUTHORITY_TAKEOVER_ASSERTION_IDS = Object.freeze([
  "takeover.legacy.exposes-pairing-secret",
  "takeover.bound.exposes-ciphertext-only",
  "takeover.bound.replacement-cannot-open",
  "takeover.bound.plaintext-response-rejected",
  "takeover.bound.forged-auth-response-rejected",
]);

export const AUTHORITY_TAKEOVER_SKIP_ID =
  "takeover.authority-listener-proof";

/** The id this coverage check records under; never part of the expected set. */
export const COVERAGE_ASSERTION_ID = "harness.assertion-coverage";

export function expectedAssertionIds(
  includeTtl,
  includeAuthorityTakeover = false,
) {
  return [
    ...EXPECTED_ASSERTION_IDS,
    ...(includeTtl ? TTL_ASSERTION_IDS.waited : TTL_ASSERTION_IDS.skipped),
    ...(
      includeAuthorityTakeover
        ? AUTHORITY_TAKEOVER_ASSERTION_IDS
        : [AUTHORITY_TAKEOVER_SKIP_ID]
    ),
  ];
}

/**
 * Every expected id present exactly once, and nothing unexpected.
 *
 * A missing id is the failure this exists for. A duplicate is reported too:
 * two entries under one id make `passed` and `total` disagree with what a
 * reader thinks the record covers.
 */
export function checkAssertionCoverage(entries, expected) {
  const failures = [];
  const seen = new Map();
  for (const entry of entries) {
    if (entry.id === COVERAGE_ASSERTION_ID) continue;
    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
  }
  for (const id of expected) {
    const count = seen.get(id) ?? 0;
    if (count === 0) failures.push(`assertion ${JSON.stringify(id)} was never recorded, not even as a skip`);
    else if (count > 1) failures.push(`assertion ${JSON.stringify(id)} was recorded ${count} times`);
  }
  const allowed = new Set(expected);
  for (const id of seen.keys()) {
    if (!allowed.has(id)) failures.push(`assertion ${JSON.stringify(id)} is not in the expected set`);
  }
  return failures;
}

export function summarizeConformance(entries) {
  const passed = entries.filter((entry) => entry.result === "pass").length;
  const failed = entries.filter((entry) => entry.result === "fail").length;
  const skipped = entries.filter((entry) => entry.result === "skip").length;
  return {
    total: entries.length,
    passed,
    failed,
    skipped,
    // `skipped` does not fail the run — a leg that says out loud it did not run
    // is the honest partial this harness is required to produce — but it is
    // never folded into `passed`, so a record cannot claim coverage it lacks.
    status: failed > 0 ? "failed" : "passed",
  };
}

// ── shape checks (pure; unit-tested without a server) ────────────────────────

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The envelope every Client v1 response carries.
 *
 * Checked on every single response the run makes, not once, because the
 * envelope is the contract's only universal promise and a route that drops it
 * is a route a client cannot read its own failure from.
 */
export function checkEnvelope(body, expectation) {
  const failures = [];
  if (!isRecord(body)) return ["response body is not a JSON object"];
  if (typeof body.apiVersion !== "string" || !body.apiVersion) {
    failures.push(`apiVersion is ${JSON.stringify(body.apiVersion)}`);
  }
  if (typeof body.minimumClientVersion !== "string" || !body.minimumClientVersion) {
    failures.push(`minimumClientVersion is ${JSON.stringify(body.minimumClientVersion)}`);
  }
  if (!Array.isArray(body.capabilities) || body.capabilities.length === 0) {
    failures.push("capabilities is missing or empty");
  }
  // The live operation inventory rides every response too, and it is what an
  // SDK's supports() reads. Checked on every response for the same reason the
  // capability list is: a route that drops it publishes a Cave that appears to
  // be able to do nothing (cave-8a0s2).
  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    failures.push("operations is missing or empty");
  }
  if (expectation?.kind === "success") {
    if (!isRecord(body.data)) failures.push("success envelope carries no data record");
    if (body.error !== undefined) failures.push("success envelope carries an error");
  }
  if (expectation?.kind === "error") {
    if (!isRecord(body.error)) {
      failures.push("error envelope carries no error record");
      return failures;
    }
    if (body.error.code !== expectation.code) {
      failures.push(`error.code is ${JSON.stringify(body.error.code)}, expected ${JSON.stringify(expectation.code)}`);
    }
    if (typeof body.error.message !== "string" || !body.error.message) {
      failures.push("error.message is missing or empty");
    }
    if (typeof body.error.retryable !== "boolean") {
      failures.push(`error.retryable is ${JSON.stringify(body.error.retryable)}, expected a boolean`);
    }
    if (expectation.retryable !== undefined && body.error.retryable !== expectation.retryable) {
      failures.push(
        `error.retryable is ${JSON.stringify(body.error.retryable)}, expected ${expectation.retryable}`,
      );
    }
    if (expectation.reason !== undefined) {
      const reason = isRecord(body.error.details) ? body.error.details.reason : undefined;
      if (reason !== expectation.reason) {
        failures.push(`error.details.reason is ${JSON.stringify(reason)}, expected ${JSON.stringify(expectation.reason)}`);
      }
    }
  }
  return failures;
}

/**
 * A projected record, checked as a whole key set rather than field by field.
 *
 * `forbidden` overlaps `unexpected` on purpose. Both would catch a leak, but
 * only the named list says *which* leak the projection exists to prevent — a
 * credential's `bearerHash`, a turn's `reasoning` or `tools`, a project's
 * `access`. A generic "unexpected key" on those reads like a schema drift
 * rather than the disclosure it is.
 *
 * ⚠️ This checks KEYS ONLY. It says nothing about what the values are, so it
 * cannot see a projection that serves a withheld *value* under an allowed key
 * (`harness: summary.harnessSessionId`) or simply the wrong field
 * (`root: project.id`). Both were measured passing a whole run. `checkRecordValues`
 * is the other half and every projection leg is required to use both.
 */
export function checkRecordShape(record, spec, label) {
  const failures = [];
  if (!isRecord(record)) return [`${label} is not a JSON object`];
  const keys = new Set(Object.keys(record));
  for (const key of spec.required ?? []) {
    if (!keys.has(key)) failures.push(`${label} is missing required "${key}"`);
  }
  for (const key of spec.forbidden ?? []) {
    if (keys.has(key)) failures.push(`${label} leaks withheld field "${key}"`);
  }
  const allowed = new Set([...(spec.required ?? []), ...(spec.optional ?? [])]);
  for (const key of keys) {
    if (!allowed.has(key) && !(spec.forbidden ?? []).includes(key)) {
      failures.push(`${label} carries unexpected field "${key}"`);
    }
  }
  return failures;
}

/**
 * The VALUES a projected record must carry, against what the fixture seeded.
 *
 * Written because the key-set check above is not a projection test on its own,
 * and the gap is not theoretical: a build serving `root: project.id`,
 * `harness: summary.harnessSessionId` and `text: turn.role` — a wrong path, a
 * withheld id disclosed under an allowed key, and every transcript body
 * replaced — passed all 89 assertions of an otherwise identical run. Every key
 * was right, so nothing looked.
 *
 * `expected` names only the fields whose value the fixture pins. A field the
 * fixture cannot predict (a server-minted id, an instant) belongs in the shape
 * spec, not here.
 */
export function checkRecordValues(record, expected, label) {
  if (!isRecord(record)) return [`${label} is not a JSON object`];
  const failures = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = record[key];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${label}.${key} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
  return failures;
}

/**
 * The invariants a paged walk owes a client, checked over the whole walk.
 *
 * Per-page checks miss the two failures that actually strand a client: a
 * boundary that repeats or skips a record (only visible across pages), and a
 * `hasMore` that disagrees with whether a further page exists. `expectedIds`
 * is the ordering the store should have produced, so a walk that is internally
 * consistent but serves the wrong set still fails.
 */
export function checkPageWalk(pages, options) {
  const failures = [];
  const { limit, expectedIds } = options;
  const seen = [];
  for (const [index, page] of pages.entries()) {
    const isLast = index === pages.length - 1;
    if (page.ids.length > limit) {
      failures.push(`page ${index + 1} served ${page.ids.length} rows, above the requested limit ${limit}`);
    }
    if (!isLast && page.ids.length !== limit) {
      failures.push(`page ${index + 1} is not the last page but served ${page.ids.length} of ${limit} rows`);
    }
    if (!isLast) {
      if (page.hasMore !== true) failures.push(`page ${index + 1} reported hasMore ${JSON.stringify(page.hasMore)} with a page after it`);
      if (typeof page.next !== "string" || !page.next) {
        failures.push(`page ${index + 1} published no next token with a page after it`);
      }
    } else {
      if (page.hasMore === true) failures.push("the final page reported hasMore true");
      if (page.next !== undefined && page.next !== null) {
        failures.push("the final page published a next token");
      }
    }
    for (const id of page.ids) {
      if (seen.includes(id)) failures.push(`id ${JSON.stringify(id)} was served twice in one walk`);
      seen.push(id);
    }
  }
  if (expectedIds) {
    const actual = seen.join(",");
    const expected = expectedIds.join(",");
    if (actual !== expected) {
      failures.push(`walk served [${actual}], expected [${expected}]`);
    }
  }
  return failures;
}

/** `cursor` must be absent entirely when there is no token to publish. */
export function checkEmptyFirstPage(body, collection) {
  const failures = [];
  if (!isRecord(body) || !isRecord(body.data)) return ["response carries no data record"];
  const items = body.data[collection];
  if (!Array.isArray(items)) failures.push(`data.${collection} is not an array`);
  else if (items.length !== 0) failures.push(`data.${collection} served ${items.length} rows, expected none`);
  if ("cursor" in body) {
    failures.push("an empty first page published a cursor; the contract omits the field when there is no token");
  }
  return failures;
}

// ── the record shapes the doc publishes ──────────────────────────────────────

export const RECORD_SHAPES = {
  familiar: {
    required: ["id", "displayName", "role"],
    optional: ["description", "pronouns", "status", "lastSeenAt", "activeSessions"],
    forbidden: ["emoji", "icon", "memory_freshness", "display_name", "last_seen", "active_sessions"],
  },
  project: {
    required: ["id", "name", "root", "createdAt", "updatedAt"],
    optional: ["color", "repoUrl"],
    forbidden: ["legacyRoot", "access"],
  },
  conversation: {
    required: ["id", "familiarId", "updatedAt"],
    optional: ["harness", "model", "runtime", "title", "origin", "status", "exitCode", "pending", "createdAt"],
    forbidden: ["harnessSessionId", "branch", "prUrl", "turns", "attentionEvidence", "sessionId"],
  },
  message: {
    required: ["id", "conversationId", "parentId", "role", "text", "createdAt", "attachmentCount", "toolCount"],
    optional: ["isError", "cancelled"],
    forbidden: ["reasoning", "tools", "usage", "costUsd", "attachments", "progress", "durationMs", "harnessSessionId"],
  },
  credential: {
    required: ["id", "appName", "installationId", "scopes", "createdAt", "lastUsedAt", "revokedAt", "revocationReason"],
    optional: [],
    forbidden: ["bearerHash", "bearer"],
  },
  pairingRequest: {
    required: ["id", "appName", "installationId", "scopes", "status", "createdAt", "expiresAt", "decidedAt"],
    optional: [],
    forbidden: ["secret", "secretHash"],
  },
  pairingStatus: {
    required: ["id", "status", "expiresAt"],
    optional: [],
    forbidden: ["appName", "installationId", "scopes", "createdAt", "decidedAt", "secret", "secretHash"],
  },
};

// ── HTTP over a real socket ──────────────────────────────────────────────────

/**
 * One request, spelled by hand rather than through `fetch`.
 *
 * `fetch` is the wrong tool for this run in three specific ways, and each one
 * hides an assertion the issues ask for: it attaches a `content-length` to a
 * bodyless POST (so the documented 411 on the exchange becomes untestable), it
 * re-encodes the request target (so the `%`/`\` refusal from #4855 never
 * reaches the wire as written), and it refuses some header spellings outright.
 */
export function requestOnce(origin, options) {
  const { method = "GET", path: target, headers = {}, body } = options;
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const outgoing = { ...headers };
    if (body !== undefined && outgoing["content-length"] === undefined) {
      outgoing["content-length"] = String(Buffer.byteLength(body));
    }
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        method,
        path: target,
        headers: outgoing,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
        });
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * One request written byte for byte onto the socket.
 *
 * Needed for the two cases `http.request` cannot express, both of which the
 * contract has an explicit answer for and neither of which was reachable
 * without this:
 *
 *   - a body-bearing method carrying NEITHER `Content-Length` NOR
 *     `Transfer-Encoding`. Node's client sets `useChunkedEncodingByDefault` for
 *     POST, so removing the length header silently substitutes chunked — which
 *     the proxy answers `400 invalid content-length`, not the `411` the missing
 *     header is supposed to produce. The first draft of this harness reported
 *     that 400 as a conformance failure; it was the harness that was wrong.
 *   - a request target Node would rewrite before sending it.
 *
 * The response is parsed only as far as the status line and the body, which is
 * all any assertion here reads.
 */
export function rawRequestOnce(origin, requestText) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = netConnect(Number(url.port), url.hostname);
    let received = "";
    socket.on("connect", () => socket.write(requestText));
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(parseRawResponse(received)));
    socket.setTimeout(20_000, () => {
      socket.destroy();
      resolve(parseRawResponse(received || "HTTP/1.1 000 no response\r\n\r\n"));
    });
  });
}

export function parseRawResponse(text) {
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? 0);
  const separator = text.indexOf("\r\n\r\n");
  const head = separator === -1 ? text : text.slice(0, separator);
  const rest = separator === -1 ? "" : text.slice(separator + 4);
  const headers = {};
  for (const line of head.split("\r\n").slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  // Every refusal on this path is answered chunked, so pull the JSON object out
  // of the framing rather than reimplementing a chunked decoder for one line.
  const start = rest.indexOf("{");
  const end = rest.lastIndexOf("}");
  let json = null;
  if (start !== -1 && end > start) {
    try {
      json = JSON.parse(rest.slice(start, end + 1));
    } catch {
      json = null;
    }
  }
  return { status, headers, text: rest, json };
}

// ── process and fixture plumbing ─────────────────────────────────────────────

export async function freePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A loopback stand-in for the Coven daemon's familiar roster.
 *
 * Only `/api/v1/familiars` is served, because that is the only daemon call the
 * canonical reads make. Anything else answers 404 rather than an empty success,
 * so a route that starts calling a second endpoint fails visibly here instead
 * of silently reading a fabricated answer.
 */
async function startFixtureDaemon(roster) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v1/familiars") {
      const payload = JSON.stringify(roster);
      res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) });
      res.end(payload);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"fixture daemon serves only /api/v1/familiars"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function buildCaveEnvironment({
  port,
  caveHomeDir,
  covenHomeDir,
  adminToken,
  authorityMode = "off",
}, inherited = process.env) {
  const env = {
    ...inherited,
    NODE_ENV: "production",
    COVEN_HOME: covenHomeDir,
    COVEN_CAVE_HOME: caveHomeDir,
    COVEN_CAVE_PORT: String(port),
    // A per-run instance id would be minted into the fixture home anyway; the
    // point of clearing these is that an operator's own environment must not
    // reach the server this run judges.
    COVEN_CAVE_HEAP_MONITOR: "0",
    COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE: authorityMode,
  };
  delete env.COVEN_CAVE_BUNDLE;
  delete env.COVEN_CAVE_ACCESS_TOKEN;
  delete env.COVEN_CAVE_PASSKEY_REQUIRED;
  delete env.COVEN_CAVE_PASSKEY_SESSION_SECRET;
  delete env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  delete env.COVEN_CAVE_LOCAL_PEER_SECRET;
  delete env.COVEN_CAVE_TAILNET_PEER_SECRET;
  delete env.PORT;
  if (adminToken) env.COVEN_CAVE_AUTH_TOKEN = adminToken;
  else delete env.COVEN_CAVE_AUTH_TOKEN;
  return env;
}

export async function startCave(input) {
  const { port } = input;
  const env = buildCaveEnvironment(input);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  let failure = "Cave readiness timed out after 120 seconds.";
  while (Date.now() < deadline) {
    if (exited) {
      failure = "Cave exited before readiness.";
      break;
    }
    try {
      const response = await requestOnce(origin, { path: `${CLIENT_V1_PREFIX}/health` });
      if (response.status === 200) return { child, origin, port };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopCave({ child }, port).catch(() => {});
  throw new Error(failure);
}

/**
 * Stop the Cave this run started, and prove the port came back.
 *
 * A conformance run that strands a listener poisons the next run — and on
 * Windows a strand is easy, because a signal that the parent reports as
 * delivered can leave the Next worker holding the socket. So the teardown ends
 * with an actual connect attempt rather than with a resolved promise.
 */
export async function stopCave(server, port) {
  if (!server?.child) return;
  const { child } = server;
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  const wasRunning = isRunning();
  const exit = wasRunning ? once(child, "exit") : Promise.resolve();
  if (isRunning() && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else if (isRunning()) {
    child.kill("SIGTERM");
  }
  const timer = wasRunning
    ? setTimeout(() => {
      if (isRunning()) child.kill("SIGKILL");
    }, 10_000)
    : null;
  try {
    await exit;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const stillUp = await requestOnce(`http://127.0.0.1:${port}`, { path: "/" }).then(() => true, () => false);
    if (!stillUp) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`port ${port} is still answering after the Cave was stopped`);
}

// ── the fixture Cave home ────────────────────────────────────────────────────

export async function seedIsolatedCaveHomes(root) {
  const covenHomeDir = path.join(root, "coven");
  const caveHomeDir = path.join(covenHomeDir, "cave");
  await mkdir(caveHomeDir, { recursive: true });
  return { covenHomeDir, caveHomeDir };
}

export const FIXTURE_ROSTER = [
  { id: "archivist", display_name: "Archivist", role: "Keeper", description: "Keeps the ledger.", pronouns: "they/them", status: "idle", last_seen: "not-an-instant", active_sessions: 2 },
  { id: "brewer", display_name: "Brewer", role: "Alchemist" },
  { id: "cartographer", display_name: "Cartographer", role: "Scout", status: "busy" },
  { id: "diviner", display_name: "Diviner", role: "Oracle" },
  { id: "engraver", display_name: "Engraver", role: "Smith" },
];

/** Seven projects, so a limit of three exercises a partial final page. */
export function fixtureProjects() {
  return Array.from({ length: 7 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return {
      id: `project-${n}`,
      name: `Fixture ${n}`,
      root: `/client-v1-conformance/project-${n}`,
      color: index % 2 === 0 ? "#123456" : undefined,
      createdAt: `2026-01-${n}T00:00:00.000Z`,
      updatedAt: `2026-02-${n}T00:00:00.000Z`,
    };
  }).map((project) => {
    if (project.color === undefined) {
      const { color: _unused, ...rest } = project;
      return rest;
    }
    return project;
  });
}

/**
 * Six conversations, so a limit of three exercises an exact-multiple walk.
 *
 * Two properties of the timestamps are load-bearing and neither is decoration:
 *
 *   - **`createdAt` and `updatedAt` order the set in OPPOSITE directions.**
 *     `createdAt` runs 01 → 06 while `updatedAt` runs 06 → 01, so
 *     createdAt-descending is `[06…01]` and updatedAt-descending is `[01…06]`.
 *     They used to run the same way, which meant the run could not tell which
 *     field keyed the page: the ordering assertion passed either way, and the
 *     skip that cave-fhjlu fixed was invisible to it. A build that reverts to
 *     the mutable key now fails `reads.conversations-shape` outright.
 *   - **`conversation-03` and `conversation-04` share a `createdAt`.** The key
 *     is only total because of the id tiebreak, and a tiebreak nothing ties
 *     cannot be wrong. The tie is placed so the expected order is unchanged
 *     (`04` before `03`, id descending), which keeps every other leg readable.
 */
export function fixtureConversations() {
  return Array.from({ length: 6 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    // 03 and 04 tie; the rest are distinct. Written as an explicit map rather
    // than as arithmetic so the tie is visible at the point it is created.
    const createdDay = index + 1 === 3 ? "04" : n;
    const updatedDay = String(6 - index).padStart(2, "0");
    return {
      sessionId: `conversation-${n}`,
      familiarId: "archivist",
      harness: "claude",
      // Withheld fields, present in the store so the projection has something
      // to withhold. A shape assertion over a record that never carried the
      // field proves nothing.
      harnessSessionId: `harness-${n}`,
      branch: "feat/fixture",
      prUrl: "https://github.com/OpenCoven/coven-cave/pull/1",
      createdAt: `2026-03-${createdDay}T00:00:00.000Z`,
      updatedAt: `2026-04-${updatedDay}T00:00:00.000Z`,
      turns: [
        {
          id: `${n}-t1`,
          parentId: null,
          role: "user",
          text: `prompt ${n}`,
          createdAt: `2026-03-${n}T00:00:00.000Z`,
        },
        {
          id: `${n}-t2`,
          parentId: `${n}-t1`,
          role: "assistant",
          text: `reply ${n}`,
          createdAt: `2026-03-${n}T00:00:00.000Z`,
          reasoning: "private scratchpad",
          tools: [{ id: "tool-1", name: "read", input: "/etc/passwd", status: "ok" }],
          usage: { inputTokens: 1, outputTokens: 2 },
          costUsd: 0.01,
        },
      ],
      activeLeafId: `${n}-t2`,
    };
  });
}

/**
 * A branched transcript, so the messages route has an abandoned branch to omit
 * and an active branch that can be moved out from under an open cursor.
 *
 * Roles are user/assistant only: `resolveActivePath` splices parentless system
 * turns back into the chain by timestamp, which would make the expected
 * sequence depend on that splice rather than on the branch.
 */
export function fixtureBranchedConversation() {
  const turn = (id, parentId, role, index) => ({
    id,
    parentId,
    role,
    text: `${id} body`,
    createdAt: `2026-05-01T00:0${index}:00.000Z`,
    // ONE turn on the active branch carries every field the message projection
    // exists to withhold, and carries more than one of each countable kind.
    //
    // Without this the whole projection leg was inert: `forbidden` cannot name
    // a leak of a field the store never held, and `attachmentCount` /
    // `toolCount` cannot be wrong when the true answer is zero everywhere. A
    // build that served `reasoning` and the tool inputs whenever a turn had
    // them, and hardcoded both counts to zero, passed the entire run.
    ...(id === "b-a1"
      ? {
          reasoning: "private scratchpad — never served",
          tools: [
            { id: "tool-1", name: "read", input: "/etc/passwd", status: "ok" },
            { id: "tool-2", name: "bash", input: "cat ~/.ssh/id_ed25519", status: "ok" },
          ],
          attachments: [{ name: "secret-plan.txt", type: "text/plain", text: "withheld" }],
          usage: { inputTokens: 11, outputTokens: 22 },
          costUsd: 0.42,
          durationMs: 1234,
          harnessSessionId: "harness-branched",
        }
      : {}),
  });
  return {
    sessionId: "branched",
    familiarId: "archivist",
    harness: "claude",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T01:00:00.000Z",
    turns: [
      turn("b-r1", null, "user", 0),
      turn("b-a1", "b-r1", "assistant", 1),
      turn("b-a2", "b-a1", "user", 2),
      turn("b-a3", "b-a2", "assistant", 3),
      turn("b-a4", "b-a3", "user", 4),
      turn("b-a5", "b-a4", "assistant", 5),
      // The abandoned branch. It must never be served while `activeLeafId`
      // names the chain above.
      turn("b-x1", "b-r1", "assistant", 6),
    ],
    activeLeafId: "b-a5",
  };
}

export const BRANCHED_ACTIVE_SEQUENCE = ["b-r1", "b-a1", "b-a2", "b-a3", "b-a4", "b-a5"];

/** What each active-branch turn must be projected as, value for value. */
export function expectedBranchedMessages() {
  const bodyOf = (id, parentId, role, index) => ({
    id,
    conversationId: "branched",
    parentId,
    role,
    text: `${id} body`,
    createdAt: `2026-05-01T00:0${index}:00.000Z`,
    attachmentCount: id === "b-a1" ? 1 : 0,
    toolCount: id === "b-a1" ? 2 : 0,
  });
  return [
    bodyOf("b-r1", null, "user", 0),
    bodyOf("b-a1", "b-r1", "assistant", 1),
    bodyOf("b-a2", "b-a1", "user", 2),
    bodyOf("b-a3", "b-a2", "assistant", 3),
    bodyOf("b-a4", "b-a3", "user", 4),
    bodyOf("b-a5", "b-a4", "assistant", 5),
  ];
}

async function seedFixture({ caveHomeDir, covenHomeDir, daemonUrl }) {
  await mkdir(caveHomeDir, { recursive: true });
  await mkdir(covenHomeDir, { recursive: true });
  await writeFile(
    path.join(caveHomeDir, "config.json"),
    // Hub mode is the only daemon target that speaks HTTP, so it is the only
    // one a fixture daemon can stand behind. It changes nothing else the
    // canonical reads touch.
    `${JSON.stringify({ version: 1, multiHost: { mode: "hub", hubUrl: daemonUrl, executorUrls: [] } }, null, 2)}\n`,
    "utf8",
  );
}

async function writeProjects(caveHomeDir, projects) {
  await writeFile(
    path.join(caveHomeDir, "projects.json"),
    `${JSON.stringify({ version: 1, projects }, null, 2)}\n`,
    "utf8",
  );
}

async function writeConversation(caveHomeDir, conversation) {
  const dir = path.join(caveHomeDir, "conversations");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${conversation.sessionId}.json`),
    `${JSON.stringify(conversation, null, 2)}\n`,
    "utf8",
  );
}

async function removeConversation(caveHomeDir, sessionId) {
  await rm(path.join(caveHomeDir, "conversations", `${sessionId}.json`), { force: true });
}

/**
 * A transcript file Cave can stat but cannot parse.
 *
 * `listConversations` answers with `fallbackConversationSummary` for one of
 * these — the row a walk has to keep serving, and keep in the same place, or a
 * file that flips between readable and unreadable moves a row under an open
 * cursor. Truncated JSON rather than a deleted file on purpose: the trigger the
 * defect named is a torn write that a later atomic replace completes.
 */
async function writeCorruptConversation(caveHomeDir, sessionId) {
  const dir = path.join(caveHomeDir, "conversations");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sessionId}.json`), '{"sessionId": "', "utf8");
}

/**
 * Append a turn through `POST /api/chat/conversation/:id` — Cave's own write
 * path, over the socket, not a rewritten file.
 *
 * This is the route that used to stamp `createdAt` onto a record that had none
 * (`args.existing?.createdAt ?? now`), which is the whole of cave-wbxcu. A test
 * that simulated the stamp by writing the file would keep passing after the
 * write path was fixed, and would keep failing after it was broken again.
 */
async function appendChatTurn(client, sessionId) {
  return client.request({
    method: "POST",
    path: `/api/chat/conversation/${encodeURIComponent(sessionId)}`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turn: {
        id: `${sessionId}-mid-walk`,
        role: "user",
        text: "written while a cursor was open",
        createdAt: "2026-04-09T00:00:00.000Z",
      },
    }),
  });
}

/**
 * The order `/conversations` owes a client: `createdAt` descending, `id`
 * descending on a tie, and every row without a `createdAt` at the tail.
 *
 * Spelled out here rather than reusing the fixture's array order so a leg that
 * seeds an extra row — one created mid-walk, one with no `createdAt` at all —
 * can derive its own expectation instead of hand-listing ids that then rot.
 */
export function expectedConversationOrder(conversations) {
  return [...conversations]
    .sort((left, right) => {
      const l = left.createdAt ?? "";
      const r = right.createdAt ?? "";
      if (l !== r) return l < r ? 1 : -1;
      return left.sessionId < right.sessionId ? 1 : -1;
    })
    .map((conversation) => conversation.sessionId);
}

// ── a small client bound to one origin ───────────────────────────────────────

function createClient(origin) {
  return {
    origin,
    request(options) {
      return requestOnce(origin, options);
    },
    read(target, bearer, extraHeaders = {}) {
      return requestOnce(origin, {
        path: `${CLIENT_V1_PREFIX}${target}`,
        headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extraHeaders },
      });
    },
    admin(method, target, token, options = {}) {
      const headers = { ...(token ? { [ADMIN_TOKEN_HEADER]: token } : {}) };
      if (options.mutation !== false) headers.origin = origin;
      if (options.body !== undefined) headers["content-type"] = "application/json";
      return requestOnce(origin, {
        method,
        path: `${CLIENT_V1_PREFIX}${target}`,
        headers: { ...headers, ...(options.headers ?? {}) },
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
    },
  };
}

/**
 * Open one pairing request, retrying once through the creation budget.
 *
 * Creation is bounded process-wide at 10 per 60 s, and this run opens several.
 * A 429 here is the limiter behaving, not a defect, so the helper honours
 * `Retry-After` once rather than reporting a conformance failure — the budget
 * itself is asserted deliberately elsewhere.
 */
async function createPairing(client, input) {
  const body = JSON.stringify(input);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.request({
      method: "POST",
      path: `${CLIENT_V1_PREFIX}/pairing/requests`,
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status !== 429) return response;
    const wait = Number(response.headers["retry-after"] ?? "5");
    await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(wait) ? wait : 5) * 1000 + 500));
  }
  throw new Error("pairing creation stayed rate limited across two attempts");
}

function pairingInput(installationId, scopes) {
  return { appName: "Client v1 conformance", installationId, scopes };
}

/** Drive a pairing all the way to a bearer. Used by the read legs. */
async function pairApproved(client, adminToken, installationId, scopes) {
  const created = await createPairing(client, pairingInput(installationId, scopes));
  if (created.status !== 201) {
    throw new Error(`pairing creation answered ${created.status}: ${created.text.slice(0, 200)}`);
  }
  const { requestId, secret } = created.json.data;
  const decision = await client.admin("POST", `/admin/pairing-requests/${requestId}/decision`, adminToken, {
    body: JSON.stringify({ decision: "approved" }),
  });
  if (decision.status !== 200) {
    throw new Error(`approval answered ${decision.status}: ${decision.text.slice(0, 200)}`);
  }
  const exchanged = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: secret, "content-length": "0" },
  });
  if (exchanged.status !== 200) {
    throw new Error(`exchange answered ${exchanged.status}: ${exchanged.text.slice(0, 200)}`);
  }
  return { requestId, secret, bearer: exchanged.json.data.bearer, credential: exchanged.json.data.credential };
}

/** Follow `cursor.next` to the end, collecting one entry per page. */
async function walk(client, target, bearer, collection, limit) {
  const pages = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const response = await client.read(`${target}?${query.toString()}`, bearer);
    if (response.status !== 200) {
      pages.push({ status: response.status, body: response.json, ids: [], hasMore: false });
      return pages;
    }
    const items = response.json?.data?.[collection] ?? [];
    pages.push({
      status: 200,
      body: response.json,
      items,
      ids: items.map((item) => item.id),
      hasMore: response.json?.cursor?.hasMore,
      next: response.json?.cursor?.next,
      current: response.json?.cursor?.current,
    });
    if (!response.json?.cursor?.next) return pages;
    cursor = response.json.cursor.next;
  }
  throw new Error(`paging ${target} did not terminate within 50 pages`);
}

// ── legs ─────────────────────────────────────────────────────────────────────

/**
 * Phase A: a Cave with no `COVEN_CAVE_AUTH_TOKEN`.
 *
 * This is the state a plain `pnpm dev` is in, and the doc's stated consequence
 * is stronger than "the admin routes 503": a client can open a pairing request
 * and can *never* get it approved. That whole sequence is asserted here,
 * because the 503 alone reads like an inconvenience rather than a dead end.
 */
async function runUnconfiguredAdminLeg(client, recorder) {
  const probes = [
    ["GET", "/admin/pairing-requests", undefined],
    ["GET", "/admin/credentials", undefined],
    ["POST", `/admin/pairing-requests/${randomUUID()}/decision`, JSON.stringify({ decision: "approved" })],
    ["DELETE", `/admin/credentials/${randomUUID()}`, JSON.stringify({ reason: "conformance" })],
  ];
  for (const [method, target, body] of probes) {
    const response = await client.admin(method, target, "any-token-at-all", body === undefined ? {} : { body });
    const failures = [];
    if (response.status !== 503) failures.push(`${method} ${target} answered ${response.status}, expected 503`);
    failures.push(...checkEnvelope(response.json, { kind: "error", code: "service_unavailable", retryable: false }));
    recorder.expect(`admin.unconfigured${target.replace(/\/[0-9a-f-]{36}/, "/:id")}.${method}`, failures);
  }

  const created = await createPairing(client, pairingInput("conformance-tokenless", ["chat:read"]));
  recorder.expect(
    "admin.unconfigured.pairing-still-opens",
    created.status === 201 ? [] : [`pairing creation answered ${created.status} on a tokenless Cave, expected 201`],
    "a tokenless Cave still opens pairing requests",
  );
  if (created.status === 201) {
    const { requestId, secret } = created.json.data;
    const exchanged = await client.request({
      method: "POST",
      path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}/exchange`,
      headers: { [PAIRING_SECRET_HEADER]: secret, "content-length": "0" },
    });
    const failures = [];
    if (exchanged.status !== 409) failures.push(`exchange answered ${exchanged.status}, expected 409`);
    failures.push(...checkEnvelope(exchanged.json, { kind: "error", code: "pairing_pending", retryable: true }));
    recorder.expect(
      "admin.unconfigured.exchange-stays-pending",
      failures,
      "the documented dead end: no approval route, so the exchange can only ever answer pairing_pending",
    );
  } else {
    recorder.skip("admin.unconfigured.exchange-stays-pending", "no pairing request was opened to exchange");
  }
}

async function runIngressLeg(client, recorder, adminToken) {
  // #4855: any client-v1 request target carrying a percent-escape or a
  // backslash is refused before it is classified — and refused in the proxy's
  // own shape, NOT the Client v1 envelope, which is the thing a client author
  // most often gets wrong.
  for (const [id, target] of [
    ["percent", `${CLIENT_V1_PREFIX}/pairing/requests/%41`],
    ["percent-encoded-separator", `${CLIENT_V1_PREFIX}/conversations%2Fx`],
  ]) {
    const response = await client.request({ path: target });
    const failures = [];
    if (response.status !== 400) failures.push(`answered ${response.status}, expected 400`);
    if (response.json?.error !== "invalid client v1 path") {
      failures.push(`body was ${JSON.stringify(response.text.slice(0, 120))}, expected {"ok":false,"error":"invalid client v1 path"}`);
    }
    if (response.json?.ok !== false) failures.push("proxy refusal did not carry ok:false");
    recorder.expect(`ingress.escaped-path.${id}`, failures, target);
  }

  // A BACKSLASH target never reaches `proxy.ts` at all, so the documented
  // `400 invalid client v1 path` is not the answer a client sees — measured
  // 2026-08-22 against this build. Next normalises `\` to `/` in the
  // request target and answers 308 first, which is why this is written raw:
  // `http.request` would rewrite the target before it left the process, and the
  // harness would be asserting against its own client rather than the server.
  //
  // The outcome is still safe, and that is what is asserted: the redirect
  // target is not a client-v1 route, and following it serves nothing. The gap
  // is between the doc and reality, not in the gate.
  const backslash = await rawRequestOnce(
    client.origin,
    `GET ${CLIENT_V1_PREFIX}/pairing/requests/a\\b HTTP/1.1\r\nHost: ${new URL(client.origin).host}\r\nConnection: close\r\n\r\n`,
  );
  const backslashFailures = [];
  const location = backslash.headers.location;
  if (backslash.status === 400 && backslash.json?.error === "invalid client v1 path") {
    // The documented answer. If a later change makes the refusal reachable,
    // this branch is correct and nothing below needs to run.
  } else if (backslash.status === 308 && location === `${CLIENT_V1_PREFIX}/pairing/requests/a/b`) {
    const followed = await client.request({ path: location });
    if (followed.status === 200) {
      backslashFailures.push(`following the normalised target ${location} was SERVED (200); a backslash target must not reach a handler`);
    }
  } else {
    backslashFailures.push(
      `answered ${backslash.status} (location ${JSON.stringify(location)}); expected either the documented 400 refusal or a 308 to the normalised target`,
    );
  }
  recorder.expect(
    "ingress.backslash-path-reaches-no-handler",
    backslashFailures,
    `answered ${backslash.status}; the documented 400 fires for "%" only — see the run's notes`,
  );

  // A forwarding header is what the listener reads to decide a request is not a
  // direct loopback peer, so it is the closest this machine can get to a
  // request arriving from somewhere else without a second machine.
  const forwarded = { "x-forwarded-for": "203.0.113.7" };
  const forwardedProbes = [
    ["public", "/pairing/requests", "forbidden peer: client v1 requires direct loopback"],
    ["authenticated", "/conversations", "forbidden peer: client v1 requires direct loopback"],
    ["admin", "/admin/credentials", "forbidden peer: client v1 admin requires direct loopback"],
  ];
  for (const [id, target, expected] of forwardedProbes) {
    const response = await client.request({
      path: `${CLIENT_V1_PREFIX}${target}`,
      headers: { ...forwarded, ...(id === "admin" ? { [ADMIN_TOKEN_HEADER]: adminToken } : {}) },
    });
    const failures = [];
    if (response.status !== 403) failures.push(`answered ${response.status}, expected 403`);
    if (response.json?.error !== expected) {
      failures.push(`error was ${JSON.stringify(response.json?.error)}, expected ${JSON.stringify(expected)}`);
    }
    recorder.expect(`ingress.forwarded.${id}`, failures, `${target} with x-forwarded-for`);
  }

  // The exchange carries no body, and the single most likely reason a
  // hand-rolled client fails against a real Cave while passing against the
  // handler is that it therefore sends no Content-Length. Raw, because the two
  // ways of "not sending" it are answered differently and only one of them is
  // this one — see rawRequestOnce.
  const host = new URL(client.origin).host;
  const noLength = await rawRequestOnce(
    client.origin,
    `POST ${CLIENT_V1_PREFIX}/pairing/requests/${randomUUID()}/exchange HTTP/1.1\r\nHost: ${host}\r\n`
      + `${PAIRING_SECRET_HEADER}: ${"A".repeat(43)}\r\nConnection: close\r\n\r\n`,
  );
  recorder.expect(
    "ingress.exchange-requires-content-length",
    noLength.status === 411 && noLength.json?.error === "content-length required"
      ? []
      : [`answered ${noLength.status} ${JSON.stringify(noLength.json?.error)}, expected 411 "content-length required"`],
  );

  const chunked = await rawRequestOnce(
    client.origin,
    `POST ${CLIENT_V1_PREFIX}/pairing/requests HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\n`
      + "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
  );
  recorder.expect(
    "ingress.refuses-transfer-encoding",
    chunked.status === 400 && chunked.json?.error === "invalid content-length"
      ? []
      : [`answered ${chunked.status} ${JSON.stringify(chunked.json?.error)}, expected 400 "invalid content-length"`],
    "a chunked control-plane body has no declared length to cap",
  );

  // Really oversized, not merely declared oversized: a Content-Length that
  // overstates the bytes actually written makes the server wait for the rest
  // and time out, which reads like a 408 rather than the cap firing.
  const oversized = JSON.stringify({
    appName: "x",
    installationId: "x",
    scopes: ["chat:read"],
    padding: "p".repeat(70_000),
  });
  const capped = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests`,
    headers: { "content-type": "application/json" },
    body: oversized,
  });
  recorder.expect(
    "ingress.body-cap",
    capped.status === 413 && capped.json?.error === "request body too large"
      ? []
      : [`answered ${capped.status} ${JSON.stringify(capped.json?.error)}, expected 413 "request body too large"`],
    `${Buffer.byteLength(oversized)} bytes against the 65536-byte control-plane cap`,
  );

  const wrongType = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests`,
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  recorder.expect(
    "ingress.pairing-content-type",
    wrongType.status === 415 ? [] : [`answered ${wrongType.status}, expected 415`],
  );
}

/**
 * The live declaration a real listener serves, against the generated fixture.
 *
 * This is the only vantage point from which the DECLARATION can be checked as a
 * thing a client actually receives: every unit test in
 * `src/lib/server/client-v1/**` reads the same constants the route builds its
 * envelope from, so a build that shipped a different fixture than it serves
 * would satisfy all of them. Here the bytes come off a socket and the
 * expectation comes off disk.
 */
export function checkLiveInventory(envelope, fixtureContract) {
  const failures = [];
  const expectedCapabilities = fixtureContract?.capabilities ?? [];
  const expectedOperations = (fixtureContract?.operations ?? []).map((operation) => operation.id);
  if (JSON.stringify(envelope?.capabilities) !== JSON.stringify(expectedCapabilities)) {
    failures.push(
      `capabilities are ${JSON.stringify(envelope?.capabilities)}, the generated fixture pins ${JSON.stringify(expectedCapabilities)}`,
    );
  }
  if (JSON.stringify(envelope?.operations) !== JSON.stringify(expectedOperations)) {
    failures.push(
      `operations are ${JSON.stringify(envelope?.operations)}, the generated fixture pins ${JSON.stringify(expectedOperations)}`,
    );
  }
  // Named individually rather than left to the comparison above, because these
  // two are the reason the check exists (#4869) and a diff of two long arrays
  // does not say so.
  for (const retired of ["streaming", "revisions"]) {
    if ((envelope?.capabilities ?? []).includes(retired)) {
      failures.push(`capabilities still advertises ${retired}, which no route serves`);
    }
    if ((envelope?.operations ?? []).some((id) => String(id).startsWith(`${retired}.`))) {
      failures.push(`operations still advertises ${retired}, which no route serves`);
    }
  }
  return failures;
}

async function runHealthLeg(client, recorder, caveHomeDir) {
  const first = await client.request({ path: `${CLIENT_V1_PREFIX}/health` });
  const failures = [];
  if (first.status !== 200) failures.push(`answered ${first.status}, expected 200`);
  failures.push(...checkEnvelope(first.json, { kind: "success" }));
  const dataKeys = Object.keys(first.json?.data ?? {}).sort().join(",");
  if (dataKeys !== "instanceId,pairingRequired,releaseVersion") {
    failures.push(`data keys are [${dataKeys}], expected [instanceId,pairingRequired,releaseVersion]`);
  }
  if (first.json?.data?.pairingRequired !== true) failures.push("pairingRequired is not true");
  recorder.expect("health.envelope", failures);

  // The declaration a client reads before it holds any credential, compared to
  // the byte-pinned fixture an SDK vendors. If these disagree, the SDK's
  // supports() is answering for a build other than the one running.
  let fixtureContract = null;
  try {
    fixtureContract = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "src", "lib", "server", "client-v1", "contract-fixture.json"),
        "utf8",
      ),
    ).contract;
  } catch (error) {
    recorder.fail("health.live-inventory", `cannot read the generated contract fixture: ${error.message}`);
  }
  if (fixtureContract) {
    recorder.expect("health.live-inventory", checkLiveInventory(first.json, fixtureContract));
  }

  const second = await client.request({ path: `${CLIENT_V1_PREFIX}/health` });
  recorder.expect(
    "health.instance-stable",
    first.json?.data?.instanceId && first.json.data.instanceId === second.json?.data?.instanceId
      ? []
      : ["instanceId is missing or changed between two reads"],
  );

  // The listener publishes where it actually bound, from inside the listen
  // callback. It is the only way a client with no configuration finds this
  // Cave, so a run against a real listener is the only place it can be checked.
  const discoveryPath = path.join(caveHomeDir, "client-v1-discovery.json");
  let discovery = null;
  try {
    discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
  } catch (error) {
    recorder.fail("health.discovery-record", `cannot read ${discoveryPath}: ${error.message}`);
  }
  if (discovery) {
    const discoveryFailures = [];
    if (discovery.endpoint !== client.origin) {
      discoveryFailures.push(`endpoint is ${JSON.stringify(discovery.endpoint)}, expected ${client.origin}`);
    }
    if (discovery.version !== 1) discoveryFailures.push(`version is ${JSON.stringify(discovery.version)}`);
    if (typeof discovery.pid !== "number") discoveryFailures.push("pid is missing");
    recorder.expect("health.discovery-record", discoveryFailures);
  }
}

async function runPairingLeg(client, recorder, adminToken, options) {
  // ── the happy path, end to end ──
  const created = await createPairing(client, pairingInput("conformance-happy", ["chat:read", "chat:write"]));
  const createFailures = [];
  if (created.status !== 201) createFailures.push(`creation answered ${created.status}, expected 201`);
  createFailures.push(...checkEnvelope(created.json, { kind: "success" }));
  const issued = created.json?.data ?? {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(issued.requestId ?? "")) {
    createFailures.push(`requestId is not a UUID: ${JSON.stringify(issued.requestId)}`);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(issued.secret ?? "")) {
    createFailures.push("secret is not 43 base64url characters");
  }
  if (typeof issued.expiresAt !== "number" || Math.abs(issued.expiresAt - Date.now() - PAIRING_TTL_MS) > 30_000) {
    createFailures.push(`expiresAt ${JSON.stringify(issued.expiresAt)} is not creation + 5 minutes`);
  }
  recorder.expect("pairing.create", createFailures);
  const { requestId, secret } = issued;

  const pendingPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}`,
    headers: { [PAIRING_SECRET_HEADER]: secret },
  });
  const pendingFailures = [];
  if (pendingPoll.status !== 200) pendingFailures.push(`poll answered ${pendingPoll.status}, expected 200`);
  pendingFailures.push(...checkEnvelope(pendingPoll.json, { kind: "success" }));
  pendingFailures.push(...checkRecordShape(pendingPoll.json?.data, RECORD_SHAPES.pairingStatus, "poll record"));
  if (pendingPoll.json?.data?.status !== "pending") {
    pendingFailures.push(`status is ${JSON.stringify(pendingPoll.json?.data?.status)}, expected "pending"`);
  }
  recorder.expect("pairing.poll-pending", pendingFailures);

  const queue = await client.admin("GET", "/admin/pairing-requests", adminToken, { mutation: false });
  const queueFailures = [];
  if (queue.status !== 200) queueFailures.push(`answered ${queue.status}, expected 200`);
  const queued = (queue.json?.data?.pairingRequests ?? []).find((entry) => entry.id === requestId);
  if (!queued) queueFailures.push("the pending request is not in the approval queue");
  else queueFailures.push(...checkRecordShape(queued, RECORD_SHAPES.pairingRequest, "queued pairing request"));
  recorder.expect("pairing.admin-queue", queueFailures);

  const approval = await client.admin("POST", `/admin/pairing-requests/${requestId}/decision`, adminToken, {
    body: JSON.stringify({ decision: "approved" }),
  });
  const approvalFailures = [];
  if (approval.status !== 200) approvalFailures.push(`approval answered ${approval.status}, expected 200`);
  const approved = approval.json?.data?.pairingRequest;
  if (approved?.status !== "approved") approvalFailures.push(`status is ${JSON.stringify(approved?.status)}`);
  if (typeof approved?.decidedAt !== "number") approvalFailures.push("decidedAt was not set");
  recorder.expect("pairing.admin-approve", approvalFailures);

  const approvedPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}`,
    headers: { [PAIRING_SECRET_HEADER]: secret },
  });
  recorder.expect(
    "pairing.poll-approved",
    approvedPoll.json?.data?.status === "approved" && approvedPoll.status === 200
      ? []
      : [`poll answered ${approvedPoll.status} ${JSON.stringify(approvedPoll.json?.data?.status)}, expected 200 "approved"`],
  );

  // Re-sending the same decision is idempotent; the contradicting one conflicts.
  const sameAgain = await client.admin("POST", `/admin/pairing-requests/${requestId}/decision`, adminToken, {
    body: JSON.stringify({ decision: "approved" }),
  });
  recorder.expect(
    "pairing.admin-approve-idempotent",
    sameAgain.status === 200 && sameAgain.json?.data?.pairingRequest?.decidedAt === approved?.decidedAt
      ? []
      : [`re-approval answered ${sameAgain.status} with decidedAt ${JSON.stringify(sameAgain.json?.data?.pairingRequest?.decidedAt)}`],
  );
  const contradicting = await client.admin("POST", `/admin/pairing-requests/${requestId}/decision`, adminToken, {
    body: JSON.stringify({ decision: "denied" }),
  });
  const contradictFailures = [];
  if (contradicting.status !== 409) contradictFailures.push(`answered ${contradicting.status}, expected 409`);
  contradictFailures.push(
    ...checkEnvelope(contradicting.json, { kind: "error", code: "conflict", reason: "pairing_already_decided" }),
  );
  recorder.expect("pairing.admin-decision-conflict", contradictFailures);

  const exchanged = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: secret, "content-length": "0" },
  });
  const exchangeFailures = [];
  if (exchanged.status !== 200) exchangeFailures.push(`exchange answered ${exchanged.status}, expected 200`);
  exchangeFailures.push(...checkEnvelope(exchanged.json, { kind: "success" }));
  const bearer = exchanged.json?.data?.bearer;
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer ?? "")) exchangeFailures.push("bearer is not 43 base64url characters");
  exchangeFailures.push(...checkRecordShape(exchanged.json?.data?.credential, RECORD_SHAPES.credential, "issued credential"));
  const grantedScopes = exchanged.json?.data?.credential?.scopes ?? [];
  if (grantedScopes.join(",") !== "chat:read,chat:write") {
    exchangeFailures.push(`granted scopes are [${grantedScopes}], expected the requested [chat:read,chat:write]`);
  }
  recorder.expect("pairing.exchange", exchangeFailures);

  const authenticated = await client.read("/projects", bearer);
  recorder.expect(
    "pairing.bearer-works",
    authenticated.status === 200 ? [] : [`an authenticated read answered ${authenticated.status}, expected 200`],
  );

  // ── replay ──
  const replay = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: secret, "content-length": "0" },
  });
  const replayFailures = [];
  if (replay.status !== 409) replayFailures.push(`replayed exchange answered ${replay.status}, expected 409`);
  replayFailures.push(...checkEnvelope(replay.json, { kind: "error", code: "conflict", reason: "pairing_replayed" }));
  recorder.expect("pairing.replay-refused", replayFailures);

  const replayPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${requestId}`,
    headers: { [PAIRING_SECRET_HEADER]: secret },
  });
  recorder.expect(
    "pairing.poll-after-exchange",
    replayPoll.status === 409 && replayPoll.json?.error?.details?.reason === "pairing_replayed"
      ? []
      : [`poll after exchange answered ${replayPoll.status} ${JSON.stringify(replayPoll.json?.error?.code)}, expected 409 conflict`],
  );

  // ── denial ──
  const deniedRequest = await createPairing(client, pairingInput("conformance-denied", ["chat:read"]));
  const deniedId = deniedRequest.json.data.requestId;
  const deniedSecret = deniedRequest.json.data.secret;
  await client.admin("POST", `/admin/pairing-requests/${deniedId}/decision`, adminToken, {
    body: JSON.stringify({ decision: "denied" }),
  });
  const deniedPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${deniedId}`,
    headers: { [PAIRING_SECRET_HEADER]: deniedSecret },
  });
  recorder.expect(
    "pairing.poll-denied",
    deniedPoll.json?.data?.status === "denied" ? [] : [`poll reported ${JSON.stringify(deniedPoll.json?.data?.status)}, expected "denied"`],
  );
  const deniedExchange = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${deniedId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: deniedSecret, "content-length": "0" },
  });
  const deniedFailures = [];
  if (deniedExchange.status !== 403) deniedFailures.push(`answered ${deniedExchange.status}, expected 403`);
  deniedFailures.push(...checkEnvelope(deniedExchange.json, { kind: "error", code: "pairing_denied", retryable: false }));
  recorder.expect("pairing.exchange-denied", deniedFailures);

  // ── an unknown but well-formed id ──
  const unknown = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${randomUUID()}`,
    headers: { [PAIRING_SECRET_HEADER]: "A".repeat(43) },
  });
  const unknownFailures = [];
  if (unknown.status !== 404) unknownFailures.push(`answered ${unknown.status}, expected 404`);
  unknownFailures.push(...checkEnvelope(unknown.json, { kind: "error", code: "not_found" }));
  recorder.expect("pairing.unknown-id", unknownFailures);

  // ── the wrong secret, and the shared per-pairing budget ──
  const budgetRequest = await createPairing(client, pairingInput("conformance-budget", ["chat:read"]));
  const budgetId = budgetRequest.json.data.requestId;
  const budgetSecret = budgetRequest.json.data.secret;
  const wrongSecret = budgetSecret === "B".repeat(43) ? "C".repeat(43) : "B".repeat(43);

  const wrongOnExchange = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: wrongSecret, "content-length": "0" },
  });
  const wrongFailures = [];
  if (wrongOnExchange.status !== 401) wrongFailures.push(`answered ${wrongOnExchange.status}, expected 401`);
  wrongFailures.push(...checkEnvelope(wrongOnExchange.json, { kind: "error", code: "unauthorized" }));
  recorder.expect("pairing.wrong-secret", wrongFailures, "one wrong secret charged on the exchange route");

  // Polling with the CORRECT secret must stay free, or a client waiting on a
  // human decision would rate limit itself.
  for (let poll = 0; poll < 20; poll += 1) {
    await client.request({
      path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}`,
      headers: { [PAIRING_SECRET_HEADER]: budgetSecret },
    });
  }
  const stillPolling = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}`,
    headers: { [PAIRING_SECRET_HEADER]: budgetSecret },
  });
  recorder.expect(
    "pairing.correct-secret-polling-is-free",
    stillPolling.status === 200 ? [] : [`the 22nd correct-secret poll answered ${stillPolling.status}, expected 200`],
  );

  // The budget is shared between the poll and the exchange: spend the rest of
  // it through the POLL route, having already spent one on the EXCHANGE, and
  // both must then refuse.
  let sawWrongSecret401 = 0;
  for (let attempt = 0; attempt < PAIRING_FAILURE_LIMIT - 1; attempt += 1) {
    const response = await client.request({
      path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}`,
      headers: { [PAIRING_SECRET_HEADER]: wrongSecret },
    });
    if (response.status === 401) sawWrongSecret401 += 1;
  }
  recorder.expect(
    "pairing.budget-charges-wrong-secret-on-poll",
    sawWrongSecret401 === PAIRING_FAILURE_LIMIT - 1
      ? []
      : [`${sawWrongSecret401} of ${PAIRING_FAILURE_LIMIT - 1} wrong-secret polls answered 401`],
  );

  const exhaustedPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}`,
    headers: { [PAIRING_SECRET_HEADER]: budgetSecret },
  });
  const limitFailures = [];
  if (exhaustedPoll.status !== 429) limitFailures.push(`answered ${exhaustedPoll.status}, expected 429`);
  limitFailures.push(...checkEnvelope(exhaustedPoll.json, { kind: "error", code: "rate_limited", retryable: true }));
  if (!exhaustedPoll.headers["retry-after"]) limitFailures.push("no Retry-After header");
  const details = exhaustedPoll.json?.error?.details ?? {};
  if (details.limit !== String(PAIRING_FAILURE_LIMIT)) {
    limitFailures.push(`details.limit is ${JSON.stringify(details.limit)}, expected "${PAIRING_FAILURE_LIMIT}"`);
  }
  if (typeof details.resetAt !== "string") limitFailures.push("details.resetAt is not a string");
  recorder.expect(
    "pairing.budget-locks-out-the-holder",
    limitFailures,
    "ten wrong secrets across BOTH routes; the correct secret is refused too",
  );

  const exhaustedExchange = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${budgetId}/exchange`,
    headers: { [PAIRING_SECRET_HEADER]: budgetSecret, "content-length": "0" },
  });
  recorder.expect(
    "pairing.budget-is-shared-across-routes",
    exhaustedExchange.status === 429
      ? []
      : [`the exchange answered ${exhaustedExchange.status} after the budget was spent on the poll route, expected 429`],
  );

  // A different pairing must be untouched — the lockout is per pairing.
  const neighbour = await createPairing(client, pairingInput("conformance-neighbour", ["chat:read"]));
  const neighbourPoll = await client.request({
    path: `${CLIENT_V1_PREFIX}/pairing/requests/${neighbour.json.data.requestId}`,
    headers: { [PAIRING_SECRET_HEADER]: neighbour.json.data.secret },
  });
  recorder.expect(
    "pairing.budget-is-per-pairing",
    neighbourPoll.status === 200 ? [] : [`an unrelated pairing answered ${neighbourPoll.status}, expected 200`],
  );

  // ── the TTL, only when asked for ──
  if (options.includeTtl) {
    const expiring = await createPairing(client, pairingInput("conformance-ttl", ["chat:read"]));
    const expiringId = expiring.json.data.requestId;
    const expiringSecret = expiring.json.data.secret;
    await new Promise((resolve) => setTimeout(resolve, PAIRING_TTL_MS + 5_000));
    const expiredPoll = await client.request({
      path: `${CLIENT_V1_PREFIX}/pairing/requests/${expiringId}`,
      headers: { [PAIRING_SECRET_HEADER]: expiringSecret },
    });
    recorder.expect(
      "pairing.ttl-poll-expired",
      expiredPoll.status === 200 && expiredPoll.json?.data?.status === "expired"
        ? []
        : [`poll answered ${expiredPoll.status} ${JSON.stringify(expiredPoll.json?.data?.status)}, expected 200 "expired"`],
    );
    const expiredExchange = await client.request({
      method: "POST",
      path: `${CLIENT_V1_PREFIX}/pairing/requests/${expiringId}/exchange`,
      headers: { [PAIRING_SECRET_HEADER]: expiringSecret, "content-length": "0" },
    });
    const ttlFailures = [];
    if (expiredExchange.status !== 410) ttlFailures.push(`answered ${expiredExchange.status}, expected 410`);
    ttlFailures.push(...checkEnvelope(expiredExchange.json, { kind: "error", code: "pairing_expired" }));
    recorder.expect("pairing.ttl-exchange-expired", ttlFailures);
  } else {
    recorder.skip(
      "pairing.ttl-expiry",
      "the 5-minute TTL is real time and there is no clock seam from outside the process; re-run with --include-ttl",
    );
  }

  return { bearer, credentialId: exchanged.json?.data?.credential?.id };
}

async function runAdminAuthLeg(client, recorder, adminToken) {
  // A wrong or absent admin token is refused 401 by the PROXY's ordinary
  // sidecar-token gate, in the proxy's `{"ok":false,"error":…}` shape — not by
  // `requireClientV1Admin`, whose own `unauthorized` envelope is therefore
  // unreachable over a real socket on a Cave that has a token configured.
  // Measured 2026-08-22; the doc describes the route's answer, which is the one
  // a handler-level test sees and a client never does.
  //
  // Asserted as the proxy shape rather than "corrected" to the envelope,
  // because the point of a real-authority run is to record what the wire does.
  for (const [id, token] of [["wrong-token", "not-the-token"], ["no-token", null]]) {
    const response = await client.admin("GET", "/admin/credentials", token, { mutation: false });
    const failures = [];
    if (response.status !== 401) failures.push(`answered ${response.status}, expected 401`);
    if (response.json?.ok !== false || response.json?.error !== "unauthorized") {
      failures.push(`body was ${JSON.stringify(response.text.slice(0, 160))}, expected the proxy refusal {"ok":false,"error":"unauthorized"}`);
    }
    recorder.expect(`admin.${id}`, failures, "refused by the proxy's sidecar gate, ahead of requireClientV1Admin");
  }

  // A mutation carrying neither Origin nor Referer is refused; the non-browser
  // caller that sends no source header at all is exactly what that rule stops.
  const sourceless = await client.request({
    method: "POST",
    path: `${CLIENT_V1_PREFIX}/admin/pairing-requests/${randomUUID()}/decision`,
    headers: { [ADMIN_TOKEN_HEADER]: adminToken, "content-type": "application/json" },
    body: JSON.stringify({ decision: "approved" }),
  });
  const sourceFailures = [];
  if (sourceless.status !== 403) sourceFailures.push(`answered ${sourceless.status}, expected 403`);
  sourceFailures.push(...checkEnvelope(sourceless.json, { kind: "error", code: "scope_denied" }));
  recorder.expect("admin.mutation-requires-source", sourceFailures);
}

async function runRevocationLeg(client, recorder, adminToken, credentialId, bearer) {
  const before = await client.read("/projects", bearer);
  recorder.expect(
    "revocation.bearer-works-before",
    before.status === 200 ? [] : [`the credential answered ${before.status} before revocation, expected 200`],
  );

  const listed = await client.admin("GET", "/admin/credentials", adminToken, { mutation: false });
  const listFailures = [];
  const record = (listed.json?.data?.credentials ?? []).find((entry) => entry.id === credentialId);
  if (!record) listFailures.push("the issued credential is not in the admin listing");
  else listFailures.push(...checkRecordShape(record, RECORD_SHAPES.credential, "listed credential"));
  recorder.expect("revocation.admin-listing", listFailures);

  const revoked = await client.admin("DELETE", `/admin/credentials/${credentialId}`, adminToken, {
    body: JSON.stringify({ reason: "client-v1 conformance run" }),
  });
  const revokeFailures = [];
  if (revoked.status !== 200) revokeFailures.push(`answered ${revoked.status}, expected 200`);
  const tombstone = revoked.json?.data?.credential;
  revokeFailures.push(...checkRecordShape(tombstone, RECORD_SHAPES.credential, "revoked credential"));
  if (typeof tombstone?.revokedAt !== "number") revokeFailures.push("revokedAt was not set");
  if (tombstone?.revocationReason !== "client-v1 conformance run") {
    revokeFailures.push(`revocationReason is ${JSON.stringify(tombstone?.revocationReason)}`);
  }
  recorder.expect("revocation.revoke", revokeFailures);

  // Every read route, not one. `read-guard.ts` says outright that the credential
  // check is written out in each route module rather than delegated, so that
  // `api-contracts.test.ts` can read it in the route's own source — which means
  // there are five copies of this decision and a single-route probe clears one
  // of them. That contract test is a source-text assertion, which is exactly the
  // unit-test proxy operating rule 8 refuses to close a gate on.
  const afterFailures = [];
  for (const target of [
    "/familiars",
    "/projects",
    "/conversations",
    "/conversations/branched",
    "/conversations/branched/messages",
  ]) {
    const after = await client.read(target, bearer);
    if (after.status !== 401) {
      afterFailures.push(`${target} answered ${after.status} to a revoked credential, expected 401`);
    }
    afterFailures.push(...checkEnvelope(after.json, { kind: "error", code: "unauthorized" }).map(
      (failure) => `${target}: ${failure}`,
    ));
  }
  recorder.expect("revocation.bearer-refused-after", afterFailures, "all five canonical reads");

  const again = await client.admin("DELETE", `/admin/credentials/${credentialId}`, adminToken, {
    body: JSON.stringify({ reason: "second revocation" }),
  });
  recorder.expect(
    "revocation.is-idempotent",
    again.status === 200 && again.json?.data?.credential?.revocationReason === "client-v1 conformance run"
      ? []
      : [`re-revocation answered ${again.status} with reason ${JSON.stringify(again.json?.data?.credential?.revocationReason)}, expected the original tombstone`],
  );

  const missing = await client.admin("DELETE", `/admin/credentials/${randomUUID()}`, adminToken, {
    body: JSON.stringify({ reason: "no such credential" }),
  });
  const missingFailures = [];
  if (missing.status !== 404) missingFailures.push(`answered ${missing.status}, expected 404`);
  missingFailures.push(...checkEnvelope(missing.json, { kind: "error", code: "not_found" }));
  recorder.expect("revocation.unknown-credential", missingFailures);

  // The store is a file, and the audit trail surviving on disk is the point of
  // a tombstone. Read it back through the admin route on a fresh reload rather
  // than trusting the response we just got.
  const reloaded = await client.admin("GET", "/admin/credentials", adminToken, { mutation: false });
  const persisted = (reloaded.json?.data?.credentials ?? []).find((entry) => entry.id === credentialId);
  recorder.expect(
    "revocation.tombstone-persists",
    persisted && typeof persisted.revokedAt === "number"
      ? []
      : ["the revoked credential is absent or unrevoked after a store reload"],
  );
}

async function runEmptyReadsLeg(client, recorder, bearer) {
  for (const [target, collection] of [["/projects", "projects"], ["/conversations", "conversations"]]) {
    const response = await client.read(target, bearer);
    const failures = [];
    if (response.status !== 200) failures.push(`answered ${response.status}, expected 200`);
    failures.push(...checkEnvelope(response.json, { kind: "success" }));
    failures.push(...checkEmptyFirstPage(response.json, collection));
    recorder.expect(`reads.empty-first-page${target}`, failures);
  }
}

async function runAuthFailureLeg(client, recorder, bearer, writeOnlyBearer) {
  const noBearer = await client.read("/conversations", null);
  const noBearerFailures = [];
  if (noBearer.status !== 401) noBearerFailures.push(`answered ${noBearer.status}, expected 401`);
  noBearerFailures.push(...checkEnvelope(noBearer.json, { kind: "error", code: "unauthorized" }));
  recorder.expect("reads.no-bearer", noBearerFailures);

  const garbage = await client.read("/conversations", "not-a-real-bearer");
  const garbageFailures = [];
  if (garbage.status !== 401) garbageFailures.push(`answered ${garbage.status}, expected 401`);
  garbageFailures.push(...checkEnvelope(garbage.json, { kind: "error", code: "unauthorized" }));
  recorder.expect("reads.unknown-bearer", garbageFailures);

  // A credential in the query string must not work — the doc says header only,
  // and a credential in a URL survives in logs and Referer headers.
  const inQuery = await client.read(`/conversations?bearer=${bearer}`, null);
  recorder.expect(
    "reads.bearer-not-accepted-in-query",
    inQuery.status === 400 || inQuery.status === 401
      ? []
      : [`a bearer in the query string answered ${inQuery.status}, expected a refusal`],
  );

  const scopeDenied = await client.read("/conversations", writeOnlyBearer);
  const scopeFailures = [];
  if (scopeDenied.status !== 403) scopeFailures.push(`answered ${scopeDenied.status}, expected 403`);
  scopeFailures.push(...checkEnvelope(scopeDenied.json, { kind: "error", code: "scope_denied" }));
  recorder.expect("reads.scope-denied", scopeFailures, "a credential without chat:read");
}

async function runFamiliarsLeg(client, recorder, bearer) {
  const response = await client.read("/familiars", bearer);
  const failures = [];
  if (response.status !== 200) failures.push(`answered ${response.status}, expected 200`);
  failures.push(...checkEnvelope(response.json, { kind: "success" }));
  const familiars = response.json?.data?.familiars ?? [];
  const ids = familiars.map((entry) => entry.id);
  const expected = FIXTURE_ROSTER.map((entry) => entry.id).sort();
  if (ids.join(",") !== expected.join(",")) {
    failures.push(`served [${ids}] in that order, expected the id-ascending [${expected}]`);
  }
  for (const familiar of familiars) {
    failures.push(...checkRecordShape(familiar, RECORD_SHAPES.familiar, `familiar ${familiar.id}`));
  }
  const archivist = familiars.find((entry) => entry.id === "archivist");
  if (archivist?.lastSeenAt !== "not-an-instant") {
    failures.push("lastSeenAt was not passed through verbatim from the daemon");
  }
  if (archivist?.activeSessions !== 2) failures.push("activeSessions was not projected");
  recorder.expect("reads.familiars", failures, "against a loopback fixture daemon, not the production daemon");

  const paged = await walk(client, "/familiars", bearer, "familiars", 2);
  recorder.expect(
    "reads.familiars-paging",
    checkPageWalk(paged, { limit: 2, expectedIds: expected }),
  );
}

async function runProjectsLeg(client, recorder, bearer, caveHomeDir) {
  const projects = fixtureProjects();
  // createdAt descending, id descending on a tie.
  const expectedIds = [...projects]
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0))
    .map((project) => project.id);

  const single = await client.read("/projects?limit=100", bearer);
  const shapeFailures = [];
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const project of single.json?.data?.projects ?? []) {
    shapeFailures.push(...checkRecordShape(project, RECORD_SHAPES.project, `project ${project.id}`));
    // Values as well as keys: a projection serving `root: project.id` keeps
    // every key and was measured passing a whole run.
    const seeded = byId.get(project.id);
    if (!seeded) shapeFailures.push(`project ${project.id} is not one this run seeded`);
    else {
      shapeFailures.push(
        ...checkRecordValues(
          project,
          {
            name: seeded.name,
            root: seeded.root,
            createdAt: seeded.createdAt,
            updatedAt: seeded.updatedAt,
            ...(seeded.color === undefined ? {} : { color: seeded.color }),
          },
          `project ${project.id}`,
        ),
      );
    }
  }
  if ((single.json?.data?.projects ?? []).length !== projects.length) {
    shapeFailures.push(`limit=100 served ${single.json?.data?.projects?.length} of ${projects.length} rows`);
  }
  if ("cursor" in (single.json ?? {}) && single.json.cursor?.hasMore !== false) {
    shapeFailures.push("a first page holding the whole set reported hasMore true");
  }
  recorder.expect("reads.projects-shape", shapeFailures);

  // 7 rows at limit 3 → 3 / 3 / 1: a partial final page.
  const partial = await walk(client, "/projects", bearer, "projects", 3);
  recorder.expect(
    "reads.projects-paging-partial-final-page",
    checkPageWalk(partial, { limit: 3, expectedIds }),
    `${partial.length} pages of at most 3 over ${projects.length} rows`,
  );

  // Re-sending a cursor returns the same page rather than advancing.
  if (partial[0]?.next) {
    const first = await client.read(`/projects?limit=3&cursor=${encodeURIComponent(partial[0].next)}`, bearer);
    const second = await client.read(`/projects?limit=3&cursor=${encodeURIComponent(partial[0].next)}`, bearer);
    const ids = (page) => (page.json?.data?.projects ?? []).map((project) => project.id).join(",");
    recorder.expect(
      "reads.cursor-replay-is-stable",
      ids(first) === ids(second) && ids(first) === partial[1]?.ids.join(",")
        ? []
        : [`replaying one cursor served [${ids(first)}] then [${ids(second)}], expected [${partial[1]?.ids}] both times`],
    );
    recorder.expect(
      "reads.cursor-current-echoes-the-token",
      first.json?.cursor?.current === partial[0].next
        ? []
        : [`cursor.current is ${JSON.stringify(first.json?.cursor?.current)}, expected the token that was sent`],
    );
  } else {
    // These need a first-page token to open a cursor with. Recorded as skips
    // rather than left out: a leg that vanishes from the record is worse than
    // one that says it did not run, and the run has to remain readable as a
    // fixed set of ids. See the coverage guard in main().
    for (const id of ["reads.cursor-replay-is-stable", "reads.cursor-current-echoes-the-token"]) {
      recorder.skip(id, "the projects walk published no first-page cursor to replay");
    }
  }

  // The cursor names a position in the ordering, not an index, so deleting the
  // record it names must not strand the walk.
  if (partial[0]?.next) {
    const strandedToken = partial[0].next;
    const deletedId = partial[0].ids[partial[0].ids.length - 1];
    await writeProjects(caveHomeDir, projects.filter((project) => project.id !== deletedId));
    const resumed = await client.read(`/projects?limit=3&cursor=${encodeURIComponent(strandedToken)}`, bearer);
    const resumedIds = (resumed.json?.data?.projects ?? []).map((project) => project.id);
    recorder.expect(
      "reads.cursor-survives-deletion",
      resumed.status === 200 && resumedIds.join(",") === partial[1]?.ids.join(",")
        ? []
        : [`after deleting ${deletedId} (the row the cursor names) the walk served [${resumedIds}], expected [${partial[1]?.ids}]`],
      "the token records a position in the ordering, not an index",
    );
    await writeProjects(caveHomeDir, projects);
  } else {
    recorder.skip("reads.cursor-survives-deletion", "the projects walk published no first-page cursor to strand");
  }

  // 6 of 7 at limit 3 is an exact multiple: the final full page must report
  // hasMore false rather than publishing a token to an empty page.
  await writeProjects(caveHomeDir, projects.slice(0, 6));
  const exact = await walk(client, "/projects", bearer, "projects", 3);
  const exactExpected = expectedIds.filter((id) => projects.slice(0, 6).some((project) => project.id === id));
  recorder.expect(
    "reads.projects-paging-exact-multiple",
    [
      ...checkPageWalk(exact, { limit: 3, expectedIds: exactExpected }),
      ...(exact.length === 2 ? [] : [`walked ${exact.length} pages over 6 rows at limit 3, expected exactly 2`]),
    ],
  );
  await writeProjects(caveHomeDir, projects);
}

async function runQueryRefusalLeg(client, recorder, bearer) {
  const refusals = [
    ["limit-zero", "/projects?limit=0"],
    ["limit-over-ceiling", `/projects?limit=${MAX_PAGE_SIZE + 1}`],
    ["limit-leading-zero", "/projects?limit=01"],
    ["limit-exponent", "/projects?limit=1e2"],
    ["limit-signed", "/projects?limit=%2B5"],
    ["limit-repeated", "/projects?limit=1&limit=2"],
    ["unsupported-parameter", "/projects?limt=5"],
    ["offset", "/projects?offset=1"],
    ["cursor-outside-alphabet", "/projects?cursor=not*base64url"],
    ["cursor-not-canonical", "/projects?cursor=eyJ2IjoxfQ=="],
  ];
  for (const [id, target] of refusals) {
    const response = await client.read(target, bearer);
    const failures = [];
    if (response.status !== 400) failures.push(`answered ${response.status}, expected 400`);
    failures.push(...checkEnvelope(response.json, { kind: "error", code: "invalid_request" }));
    recorder.expect(`reads.refuses.${id}`, failures, target);
  }

  const ceiling = await client.read(`/projects?limit=${MAX_PAGE_SIZE}`, bearer);
  recorder.expect(
    "reads.limit-ceiling-is-served",
    ceiling.status === 200 ? [] : [`limit=${MAX_PAGE_SIZE} answered ${ceiling.status}, expected 200`],
  );

  const defaulted = await client.read("/projects", bearer);
  recorder.expect(
    "reads.default-page-size",
    (defaulted.json?.data?.projects ?? []).length <= DEFAULT_PAGE_SIZE
      ? []
      : [`an unqualified read served more than the ${DEFAULT_PAGE_SIZE} default`],
  );
}

/**
 * Walk `/conversations` at limit 2, mutate the ledger with the cursor OPEN, and
 * follow that cursor to exhaustion.
 *
 * The mutation happens between the first page and the first resumed page, which
 * is the only window in which a client is exposed to the store moving. `mutate`
 * receives the ids already served and the id the open cursor names, so a leg can
 * aim at a served row, an unserved row, or the cursor's own row without
 * hard-coding the fixture's ordering.
 *
 * Returns the whole walk rather than the page after the touch. That distinction
 * is the entire reason cave-fhjlu was misdiagnosed as a repeat for two PRs: a
 * row that comes back three pages later is a repeat, a row that never comes back
 * is a skip, and a single-page probe cannot tell them apart.
 */
async function walkConversationsAcross(client, bearer, mutate) {
  const first = await client.read("/conversations?limit=2", bearer);
  const firstIds = (first.json?.data?.conversations ?? []).map((row) => row.id);
  const token0 = first.json?.cursor?.next ?? null;
  await mutate({ served: firstIds, cursorNames: firstIds[firstIds.length - 1] });

  // Prove the mutation actually reached the server before asserting anything
  // about how the walk survived it. listConversations caches a summary against
  // the file's (mtime, ctime, size), so a rewrite that changed nothing else
  // could be served from cache — and every case below would then pass for the
  // wrong reason, which is the exact "green against a broken server" failure
  // this harness exists to avoid. The probe is a separate read at limit 100; it
  // does not consume the open cursor, because a page is a pure function of
  // (set, cursor, limit).
  const probe = await client.read("/conversations?limit=100", bearer);
  const observed = new Map(
    (probe.json?.data?.conversations ?? []).map((row) => [row.id, row]),
  );

  const remainder = [];
  let status = first.status;
  let token = token0;
  for (let page = 0; page < 50 && token; page += 1) {
    const resumed = await client.read(
      `/conversations?limit=2&cursor=${encodeURIComponent(token)}`,
      bearer,
    );
    status = resumed.status;
    if (resumed.status !== 200) break;
    remainder.push(...(resumed.json?.data?.conversations ?? []).map((row) => row.id));
    token = resumed.json?.cursor?.next ?? null;
  }
  return {
    firstIds,
    remainder,
    served: [...firstIds, ...remainder],
    status,
    opened: token0 !== null,
    observed,
  };
}

/** The mutation has to be visible to the server, or the walk survived nothing. */
function checkTouchLanded(walk, sessionId) {
  const row = walk.observed.get(sessionId);
  if (!row) return [`${sessionId} was not in the ledger after the touch, so nothing was touched`];
  if (row.updatedAt !== TOUCHED_AT) {
    return [
      `${sessionId} still reads updatedAt ${JSON.stringify(row.updatedAt)} after the touch — the` +
      " ledger did not move, so this walk proves nothing",
    ];
  }
  return [];
}

/**
 * The chat write has to have reached the ledger, AND it has to have left the
 * row keyless — those are two different claims and a walk proves neither.
 *
 * `saveConversation` stamps `updatedAt` on every write and the appended turn
 * changes the file's size, so the (mtime, ctime, size) summary cache cannot
 * answer the probe from a stale entry: if `updatedAt` still reads the seeded
 * value, nothing was written and the walk below survived nothing. The second
 * check is the fix stated directly — a row that came back carrying a
 * `createdAt` was stamped, which is the defect whatever the walk then did.
 */
function checkChatWriteLanded(response, walk, sessionId, seededUpdatedAt) {
  const failures = [];
  if (!response || response.status !== 200) {
    failures.push(
      `POST /api/chat/conversation/${sessionId} answered ${response?.status ?? "nothing"}` +
      `${response?.text ? `: ${response.text.slice(0, 160)}` : ""} — nothing was written`,
    );
  }
  const row = walk.observed.get(sessionId);
  if (!row) {
    failures.push(`${sessionId} was not in the ledger after the write, so nothing was written`);
    return failures;
  }
  if (row.updatedAt === seededUpdatedAt) {
    failures.push(
      `${sessionId} still reads updatedAt ${JSON.stringify(row.updatedAt)} after the write — the` +
      " ledger did not move, so this walk proves nothing",
    );
  }
  if ("createdAt" in row) {
    failures.push(
      `${sessionId} had no createdAt and was written; it now reads` +
      ` ${JSON.stringify(row.createdAt)}, so the write path stamped it`,
    );
  }
  return failures;
}

/**
 * The readability flip has to have reached the ledger too.
 *
 * A file Cave cannot parse projects as `fallbackConversationSummary`, whose
 * `familiarId` is the empty string — the one field that says, over the wire,
 * which of the two rows a walk is looking at. Without this probe both cases
 * below pass against a Cave that never noticed the file changed at all.
 */
function checkFallbackRow(walk, sessionId, expectFallback) {
  const row = walk.observed.get(sessionId);
  if (!row) return [`${sessionId} left the ledger entirely, which is neither state under test`];
  const isFallback = row.familiarId === "";
  if (isFallback === expectFallback) return [];
  return [
    expectFallback
      ? `${sessionId} still reads familiarId ${JSON.stringify(row.familiarId)}, so Cave never saw the` +
        " file become unreadable and this walk proves nothing"
      : `${sessionId} still projects as the unreadable-file fallback, so Cave never saw the file` +
        " recover and this walk proves nothing",
  ];
}

/**
 * The whole walk, as an ORDERED sequence against what the ledger should have
 * produced — not as a set, and not as a "did it contain the touched row".
 *
 * A set comparison would pass a build that served the right rows in an order no
 * cursor could resume, which is the weakness this file's own review found in an
 * earlier assertion: it compared key sets and never values.
 */
function checkConversationWalk(walk, expected) {
  const failures = [];
  if (walk.status !== 200) failures.push(`the walk answered ${walk.status}, expected 200`);
  if (walk.served.join(",") !== expected.join(",")) {
    failures.push(`the whole walk served [${walk.served}], expected [${expected}]`);
  }
  const repeated = walk.served.filter((id, index) => walk.served.indexOf(id) !== index);
  if (repeated.length > 0) failures.push(`the walk served [${repeated}] more than once`);
  return failures;
}

async function runConversationsLeg(client, recorder, bearer, caveHomeDir) {
  const conversations = fixtureConversations();
  const expectedIds = expectedConversationOrder(conversations);
  const updatedAtOrder = [...conversations]
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0))
    .map((conversation) => conversation.sessionId);
  const restore = async () => {
    for (const conversation of conversations) await writeConversation(caveHomeDir, conversation);
  };

  const listed = await client.read("/conversations?limit=100", bearer);
  const failures = [];
  if (listed.status !== 200) failures.push(`answered ${listed.status}, expected 200`);
  const rows = listed.json?.data?.conversations ?? [];
  const seededById = new Map(conversations.map((conversation) => [conversation.sessionId, conversation]));
  for (const row of rows) {
    failures.push(...checkRecordShape(row, RECORD_SHAPES.conversation, `conversation ${row.id}`));
    // `harness` and `harnessSessionId` are adjacent fields, one published and
    // one withheld. A projection that read the wrong one keeps every key, so
    // only a value check sees it — measured passing a whole run.
    const seeded = seededById.get(row.id);
    if (!seeded) failures.push(`conversation ${row.id} is not one this run seeded`);
    else {
      failures.push(
        ...checkRecordValues(
          row,
          {
            familiarId: seeded.familiarId,
            harness: seeded.harness,
            createdAt: seeded.createdAt,
            updatedAt: seeded.updatedAt,
          },
          `conversation ${row.id}`,
        ),
      );
    }
  }
  const servedOrder = rows.map((row) => row.id).join(",");
  if (servedOrder !== expectedIds.join(",")) {
    failures.push(
      servedOrder === updatedAtOrder.join(",")
        ? `served the updatedAt-descending [${updatedAtOrder}]; /conversations pages by createdAt, expected [${expectedIds}]`
        : `served [${rows.map((row) => row.id)}], expected the createdAt-descending [${expectedIds}]`,
    );
  }
  recorder.expect("reads.conversations-shape", failures);

  // 6 rows at limit 3 is an exact multiple.
  const paged = await walk(client, "/conversations", bearer, "conversations", 3);
  recorder.expect(
    "reads.conversations-paging",
    checkPageWalk(paged, { limit: 3, expectedIds }),
  );

  // The one-record route: same projection, no query parameters at all.
  const one = await client.read(`/conversations/${expectedIds[0]}`, bearer);
  const oneFailures = [];
  if (one.status !== 200) oneFailures.push(`answered ${one.status}, expected 200`);
  oneFailures.push(...checkRecordShape(one.json?.data?.conversation, RECORD_SHAPES.conversation, "single conversation"));
  const fromList = rows.find((row) => row.id === expectedIds[0]);
  if (JSON.stringify(one.json?.data?.conversation) !== JSON.stringify(fromList)) {
    oneFailures.push("the single-record route and the list route disagree about the same conversation");
  }
  recorder.expect("reads.conversation-by-id", oneFailures);

  for (const [id, parameter] of [["limit", "limit=5"], ["cursor", "cursor=x"]]) {
    const response = await client.read(`/conversations/${expectedIds[0]}?${parameter}`, bearer);
    const queryFailures = [];
    if (response.status !== 400) queryFailures.push(`answered ${response.status}, expected 400`);
    queryFailures.push(...checkEnvelope(response.json, { kind: "error", code: "invalid_request" }));
    recorder.expect(`reads.conversation-by-id-refuses-${id}`, queryFailures);
  }

  const absent = await client.read("/conversations/no-such-conversation", bearer);
  const absentFailures = [];
  if (absent.status !== 404) absentFailures.push(`answered ${absent.status}, expected 404`);
  absentFailures.push(...checkEnvelope(absent.json, { kind: "error", code: "not_found" }));
  recorder.expect("reads.conversation-by-id-not-found", absentFailures);

  // ── the page key under a ledger that moves mid-walk (cave-fhjlu) ──
  //
  // `/conversations` used to key on `updatedAt`. That field only ever rises and
  // the ordering is descending, so a conversation touched while a client paged
  // jumped ABOVE the open cursor and — if it had not been served yet — was never
  // served by the rest of the walk. Silent data loss in a read this surface
  // calls canonical. Measured here on 2026-08-22: first page `[06, 05]`, touch
  // the unserved `01`, remainder `[04, 03, 02]`, and no repeat anywhere.
  //
  // The key is now `createdAt`, which nothing rewrites, so the six cases below
  // all reduce to one claim: **the set a walk serves is decided when the walk
  // starts, and nothing but a deletion changes it.** Each one is a separate
  // assertion rather than a loop because each fails for a different reason and a
  // reader of the record has to be able to tell which.
  const byId = new Map(conversations.map((conversation) => [conversation.sessionId, conversation]));
  // The touch lengthens a WITHHELD field as well as raising updatedAt. Both
  // timestamps are the same width, so a rewrite that only moved updatedAt left
  // the file's size unchanged and could be answered from listConversations'
  // (mtime, ctime, size) cache within the same millisecond. Changing the size
  // makes the cache miss deterministic; checkTouchLanded still verifies it.
  const touch = (sessionId) =>
    writeConversation(caveHomeDir, {
      ...byId.get(sessionId),
      harnessSessionId: `${byId.get(sessionId).harnessSessionId}-touched-mid-walk`,
      updatedAt: TOUCHED_AT,
    });

  // 1. A row the walk has NOT reached. This is the case that lost data.
  let touchedUnserved = null;
  const unserved = await walkConversationsAcross(client, bearer, async ({ served }) => {
    touchedUnserved = expectedIds.filter((id) => !served.includes(id)).at(-1);
    await touch(touchedUnserved);
  });
  recorder.expect(
    "reads.conversations-touch-unserved-row-is-still-served",
    unserved.opened
      ? [...checkTouchLanded(unserved, touchedUnserved), ...checkConversationWalk(unserved, expectedIds)]
      : ["the ledger did not page at limit 2, so no cursor was open across the touch"],
    `touched the unserved ${touchedUnserved}; the whole walk served [${unserved.served}]`,
  );
  await restore();

  // 2. A row the walk has ALREADY served. Under the old key this one was
  //    harmless — it moved above a cursor it was already above — but a key that
  //    moved the other way would repeat it, and only a whole-walk check sees it.
  let touchedServed = null;
  const served = await walkConversationsAcross(client, bearer, async (state) => {
    touchedServed = state.served[0];
    await touch(touchedServed);
  });
  recorder.expect(
    "reads.conversations-touch-served-row-is-not-repeated",
    served.opened
      ? [...checkTouchLanded(served, touchedServed), ...checkConversationWalk(served, expectedIds)]
      : ["the ledger did not page at limit 2, so no cursor was open across the touch"],
    `touched the already-served ${touchedServed}; the whole walk served [${served.served}]`,
  );
  await restore();

  // 3. The row the open cursor NAMES. The token carries that row's sort key, so
  //    if the key can move, the cursor is left pointing at a position the
  //    ordering no longer has.
  let touchedAtCursor = null;
  const atCursor = await walkConversationsAcross(client, bearer, async ({ cursorNames }) => {
    touchedAtCursor = cursorNames;
    await touch(touchedAtCursor);
  });
  recorder.expect(
    "reads.conversations-touch-cursor-row-keeps-the-position",
    atCursor.opened
      ? [...checkTouchLanded(atCursor, touchedAtCursor), ...checkConversationWalk(atCursor, expectedIds)]
      : ["the ledger did not page at limit 2, so no cursor was open across the touch"],
    `touched ${touchedAtCursor}, the row the cursor names; the whole walk served [${atCursor.served}]`,
  );
  await restore();

  // 4. A conversation CREATED mid-walk. Its createdAt is the newest in the
  //    ledger, so it sorts above every open cursor and this walk does not serve
  //    it — which is what the reference tells a client to expect, and is not the
  //    same failure as losing a row that already existed.
  const created = await walkConversationsAcross(client, bearer, async () => {
    await writeConversation(caveHomeDir, {
      ...byId.get("conversation-01"),
      sessionId: "conversation-new",
      createdAt: "2026-12-31T00:00:00.000Z",
      updatedAt: "2026-12-31T00:00:00.000Z",
    });
  });
  recorder.expect(
    "reads.conversations-row-created-mid-walk-is-not-served",
    created.opened
      ? [
          ...(created.observed.has("conversation-new")
            ? []
            : ["conversation-new never reached the ledger, so nothing was inserted mid-walk"]),
          ...checkConversationWalk(created, expectedIds),
        ]
      : ["the ledger did not page at limit 2, so no cursor was open across the insert"],
    "a row created above the cursor is left for the next read from the top",
  );
  await removeConversation(caveHomeDir, "conversation-new");
  await restore();

  // 5. A row DELETED mid-walk, and an unserved one, so the walk has to notice.
  //    The cursor names a position in the ordering rather than an index, so the
  //    remainder is simply the rest without it.
  let deletedId = null;
  const deleted = await walkConversationsAcross(client, bearer, async ({ served: alreadyServed }) => {
    deletedId = expectedIds.filter((id) => !alreadyServed.includes(id))[0];
    await removeConversation(caveHomeDir, deletedId);
  });
  recorder.expect(
    "reads.conversations-row-deleted-mid-walk-does-not-strand",
    deleted.opened
      ? [
          ...(deleted.observed.has(deletedId)
            ? [`${deletedId} was still in the ledger after the deletion, so nothing was deleted`]
            : []),
          ...checkConversationWalk(deleted, expectedIds.filter((id) => id !== deletedId)),
        ]
      : ["the ledger did not page at limit 2, so no cursor was open across the deletion"],
    `deleted the unserved ${deletedId}; the whole walk served [${deleted.served}]`,
  );
  await restore();

  // 6. Two rows sharing a createdAt, walked at limit 1 so a page boundary lands
  //    between every adjacent pair — including theirs. Without the id tiebreak
  //    the boundary either repeats both or skips both.
  const tiedKey = conversations.find((conversation) =>
    conversations.some((other) =>
      other.sessionId !== conversation.sessionId && other.createdAt === conversation.createdAt))?.createdAt;
  const tied = conversations
    .filter((conversation) => conversation.createdAt === tiedKey)
    .map((conversation) => conversation.sessionId)
    .sort()
    .reverse();
  const singles = await walk(client, "/conversations", bearer, "conversations", 1);
  const tieFailures = tied.length === 2
    ? checkPageWalk(singles, { limit: 1, expectedIds })
    : ["the fixture no longer ties two conversations on createdAt, so the tiebreak is unexercised"];
  const walkedTie = singles.flatMap((page) => page.ids).filter((id) => tied.includes(id)).join(",");
  if (tied.length === 2 && walkedTie !== tied.join(",")) {
    tieFailures.push(`the tied rows were served as [${walkedTie}], expected id-descending [${tied}]`);
  }
  recorder.expect(
    "reads.conversations-tied-sort-key-breaks-on-id",
    tieFailures,
    `${tied.join(" and ")} share ${tiedKey}`,
  );

  // 7. A row carrying NO createdAt at all — a transcript written before the
  //    field existed, or the fallback row a corrupt file produces. Keying on an
  //    optional field is only safe because these are served rather than
  //    stranded: they sort as the empty string, which is below every instant, so
  //    a descending walk reaches them at the tail and reaches them THROUGH a
  //    cursor rather than on the first page.
  const { createdAt: _dropped, ...keyless } = byId.get("conversation-01");
  await writeConversation(caveHomeDir, { ...keyless, sessionId: "conversation-keyless" });
  const withKeyless = await walk(client, "/conversations", bearer, "conversations", 2);
  const keylessExpected = [...expectedIds, "conversation-keyless"];
  const keylessFailures = checkPageWalk(withKeyless, { limit: 2, expectedIds: keylessExpected });
  const keylessRow = withKeyless
    .flatMap((page) => page.items ?? [])
    .find((row) => row.id === "conversation-keyless");
  if (!keylessRow) keylessFailures.push("the row with no createdAt was never served");
  else if ("createdAt" in keylessRow) {
    keylessFailures.push(`the row with no createdAt was served with createdAt ${JSON.stringify(keylessRow.createdAt)}`);
  }
  if (withKeyless[0]?.ids.includes("conversation-keyless")) {
    keylessFailures.push("the row with no createdAt was served on the first page, so no cursor had to reach it");
  }
  recorder.expect(
    "reads.conversations-without-created-at-are-served-last",
    keylessFailures,
    "an optional page key is only safe if the rows that lack it are served, not stranded",
  );
  await removeConversation(caveHomeDir, "conversation-keyless");
  await restore();

  // ── the keyless tail block, under writes (cave-wbxcu) ────────────────────
  //
  // Case 7 proves the rows with no `createdAt` are SERVED. That is only half of
  // what keying on an optional field needs: the block also has to be STABLE,
  // because a row that leaves it mid-walk sorts above every open cursor and is
  // then skipped by the rest of the walk — cave-fhjlu again, on exactly the rows
  // the sentinel exists to protect.
  //
  // One writer could move a row out of it: `buildConversation` on POST/PUT
  // /api/chat/conversation/:id composed `args.existing?.createdAt ?? now`, so a
  // legacy transcript that never had the field was STAMPED with `now` on its
  // next turn and jumped to the head of the ordering. The three cases below
  // drive that real route over the socket rather than rewriting the file,
  // because the file is not where the defect lived.
  const keylessSeed = (sessionId) => ({ ...keyless, sessionId });
  const keylessIds = ["conversation-keyless-written", "conversation-keyless-quiet"];
  const seedKeyless = async () => {
    for (const sessionId of keylessIds) await writeConversation(caveHomeDir, keylessSeed(sessionId));
  };
  const dropKeyless = async () => {
    for (const sessionId of keylessIds) await removeConversation(caveHomeDir, sessionId);
  };
  const keylessOrder = expectedConversationOrder([
    ...conversations,
    ...keylessIds.map((sessionId) => keylessSeed(sessionId)),
  ]);

  // 8. A keyless row WRITTEN mid-walk, through the route that used to stamp it,
  //    walked alongside a keyless row that is not written at all. The quiet row
  //    is the control: if the walk lost both, the ledger moved for some reason
  //    other than the write.
  await seedKeyless();
  let chatWrite = null;
  const written = await walkConversationsAcross(client, bearer, async () => {
    chatWrite = await appendChatTurn(client, "conversation-keyless-written");
  });
  const writtenFailures = written.opened
    ? [
        ...checkChatWriteLanded(chatWrite, written, "conversation-keyless-written", keyless.updatedAt),
        ...checkConversationWalk(written, keylessOrder),
      ]
    : ["the ledger did not page at limit 2, so no cursor was open across the write"];
  recorder.expect(
    "reads.conversations-keyless-row-written-mid-walk-is-still-served",
    writtenFailures,
    `wrote a turn to the unserved conversation-keyless-written; the whole walk served [${written.served}]`,
  );

  // 9. The two keyless rows share the empty-string sort key, so a page boundary
  //    at limit 1 lands between them. Case 6 covers a tie between two real
  //    instants; this covers a tie between two sentinels, which is a different
  //    pair of values reaching the same comparator. Re-seeded first: case 8
  //    leaves the ledger in whatever state its write produced, and a tie
  //    assertion that inherits a stamped row is asserting case 8 again.
  await seedKeyless();
  const keylessSingles = await walk(client, "/conversations", bearer, "conversations", 1);
  const keylessTie = [...keylessIds].sort().reverse();
  const tiedKeylessFailures = checkPageWalk(keylessSingles, { limit: 1, expectedIds: keylessOrder });
  const walkedKeylessTie = keylessSingles
    .flatMap((page) => page.ids)
    .filter((id) => keylessIds.includes(id))
    .join(",");
  if (walkedKeylessTie !== keylessTie.join(",")) {
    tiedKeylessFailures.push(
      `the tied keyless rows were served as [${walkedKeylessTie}], expected id-descending [${keylessTie}]`,
    );
  }
  recorder.expect(
    "reads.conversations-keyless-rows-tie-on-the-id-tiebreak",
    tiedKeylessFailures,
    "two rows with no createdAt share the sentinel, so only the id makes their order total",
  );

  // 10. A keyless row that acquires a `createdAt` BETWEEN two walks. Nothing in
  //     Cave does this any more, but an external writer can, and the promise is
  //     scoped to one walk: the second walk sees a consistent ledger and serves
  //     the row exactly once at its new position. If this ever fails while 8
  //     passes, the ordering — not the write path — is what moved.
  const keyedAt = "2026-03-05T12:00:00.000Z";
  await writeConversation(caveHomeDir, {
    ...keylessSeed("conversation-keyless-written"),
    createdAt: keyedAt,
  });
  const afterKeyed = await walk(client, "/conversations", bearer, "conversations", 2);
  const keyedOrder = expectedConversationOrder([
    ...conversations,
    { ...keylessSeed("conversation-keyless-written"), createdAt: keyedAt },
    keylessSeed("conversation-keyless-quiet"),
  ]);
  recorder.expect(
    "reads.conversations-keyless-row-keyed-between-walks-moves-once",
    checkPageWalk(afterKeyed, { limit: 2, expectedIds: keyedOrder }),
    `conversation-keyless-written acquired ${keyedAt} between two walks and the next walk placed it`,
  );
  await dropKeyless();
  await restore();

  // ── the fallback row a file Cave cannot read produces (cave-wbxcu) ───────
  //
  // `fallbackConversationSummary` is the row `listConversations` substitutes for
  // a transcript it cannot read or parse. It carried no `createdAt`, so a file
  // that flipped between readable and unreadable moved a row into and out of the
  // tail block under an open cursor — the same skip as case 8, reached without
  // any writer at all, and recurring every time the flip happens.
  //
  // The transcript's real `createdAt` is immutable, so the last one Cave read is
  // still true for a file it cannot read this time. That is what these two cases
  // pin: an unreadable scan does not move the row, and neither does the scan
  // that recovers it.
  // The two directions need rows in different PLACES, which is the detail that
  // makes one of them prove anything at all. A walk at limit 2 opens its cursor
  // after the two newest rows, so:
  //
  //   - falling out of the ledger's middle into the tail is visible as a
  //     reordering, whichever side of the cursor it happens on;
  //   - rising out of the tail is only a SKIP if the row's real position is
  //     ABOVE the open cursor. A recovering row whose createdAt is older than
  //     the cursor rises to a position the walk has not passed yet and is still
  //     served — measured, and it passed against the unfixed build, which is
  //     exactly the vacuous assertion this harness exists to refuse.
  const flaky = { ...byId.get("conversation-01"), sessionId: "conversation-flaky" };
  const recovering = {
    ...byId.get("conversation-01"),
    sessionId: "conversation-recovering",
    createdAt: "2026-03-07T00:00:00.000Z",
  };

  // 11. Readable at the start of the walk, unreadable mid-walk. Its createdAt
  //     ties conversation-01's, so it sits sixth of seven and the fall to the
  //     tail is a reordering the whole walk can see.
  await writeConversation(caveHomeDir, flaky);
  await client.read("/conversations?limit=100", bearer); // Cave reads it once, while it can.
  const corrupted = await walkConversationsAcross(client, bearer, () =>
    writeCorruptConversation(caveHomeDir, "conversation-flaky"));
  recorder.expect(
    "reads.conversations-unreadable-row-keeps-its-position-mid-walk",
    corrupted.opened
      ? [
          ...checkFallbackRow(corrupted, "conversation-flaky", true),
          ...checkConversationWalk(corrupted, expectedConversationOrder([...conversations, flaky])),
        ]
      : ["the ledger did not page at limit 2, so no cursor was open across the corruption"],
    `conversation-flaky became unreadable mid-walk; the whole walk served [${corrupted.served}]`,
  );
  await removeConversation(caveHomeDir, "conversation-flaky");

  // 12. Unreadable at the start of the walk, readable again mid-walk — the torn
  //     write a later atomic replace completes, or the sharing violation that
  //     clears. Its createdAt is the newest in the ledger, so recovering puts it
  //     above the open cursor: this is the direction that SKIPS.
  await writeConversation(caveHomeDir, recovering);
  await client.read("/conversations?limit=100", bearer); // Cave reads it once, while it can.
  await writeCorruptConversation(caveHomeDir, "conversation-recovering");
  const recovered = await walkConversationsAcross(client, bearer, async () => {
    await writeConversation(caveHomeDir, recovering);
  });
  recorder.expect(
    "reads.conversations-recovering-row-keeps-its-position-mid-walk",
    recovered.opened
      ? [
          ...checkFallbackRow(recovered, "conversation-recovering", false),
          ...checkConversationWalk(
            recovered,
            expectedConversationOrder([...conversations, recovering]),
          ),
        ]
      : ["the ledger did not page at limit 2, so no cursor was open across the recovery"],
    `conversation-recovering became readable again mid-walk; the whole walk served [${recovered.served}]`,
  );
  await removeConversation(caveHomeDir, "conversation-recovering");
  await restore();
}

async function runMessagesLeg(client, recorder, bearer, caveHomeDir) {
  const conversation = fixtureBranchedConversation();
  await writeConversation(caveHomeDir, conversation);

  const all = await client.read("/conversations/branched/messages?limit=100", bearer);
  const failures = [];
  if (all.status !== 200) failures.push(`answered ${all.status}, expected 200`);
  const messages = all.json?.data?.messages ?? [];
  if (messages.map((message) => message.id).join(",") !== BRANCHED_ACTIVE_SEQUENCE.join(",")) {
    failures.push(`served [${messages.map((message) => message.id)}], expected the active branch [${BRANCHED_ACTIVE_SEQUENCE}]`);
  }
  const expectedMessages = expectedBranchedMessages();
  for (const message of messages) {
    failures.push(...checkRecordShape(message, RECORD_SHAPES.message, `message ${message.id}`));
    if (message.conversationId !== "branched") {
      failures.push(`message ${message.id} carries conversationId ${JSON.stringify(message.conversationId)}`);
    }
  }
  if (messages[0]?.parentId !== null) failures.push("the root turn's parentId is not null");
  recorder.expect("reads.messages-active-branch", failures, "the abandoned branch turn b-x1 must be absent");

  // Values, not just keys. `b-a1` carries reasoning, two tool calls (one of
  // them pointed at a private key), an attachment, usage and a cost, so the
  // withheld list above has something real to withhold and the counts below
  // have a non-zero right answer.
  const valueFailures = [];
  for (const expected of expectedMessages) {
    const served = messages.find((message) => message.id === expected.id);
    if (!served) {
      valueFailures.push(`message ${expected.id} was not served`);
      continue;
    }
    valueFailures.push(...checkRecordValues(served, expected, `message ${expected.id}`));
  }
  recorder.expect(
    "reads.messages-values",
    valueFailures,
    "text, role, parentId, createdAt and both counts, field by field against the fixture",
  );

  const paged = await walk(client, "/conversations/branched/messages", bearer, "messages", 2);
  recorder.expect(
    "reads.messages-paging",
    checkPageWalk(paged, { limit: 2, expectedIds: BRANCHED_ACTIVE_SEQUENCE }),
  );

  // Counts, not contents — and the count has to be RIGHT, which needs a turn
  // that really carries some. `b-a1` has two tools and one attachment, so a
  // projection that hardcoded either count to zero fails here rather than
  // agreeing with an all-zero fixture.
  const countFailures = [];
  const counted = messages.find((message) => message.id === "b-a1");
  if (!counted) countFailures.push("the turn carrying tools and attachments was not served");
  else {
    if (counted.toolCount !== 2) countFailures.push(`b-a1 toolCount is ${JSON.stringify(counted.toolCount)}, expected 2`);
    if (counted.attachmentCount !== 1) {
      countFailures.push(`b-a1 attachmentCount is ${JSON.stringify(counted.attachmentCount)}, expected 1`);
    }
  }
  for (const message of messages) {
    if (typeof message.attachmentCount !== "number" || typeof message.toolCount !== "number") {
      countFailures.push(`message ${message.id} does not carry both counts as numbers`);
    }
  }
  recorder.expect(
    "reads.messages-counts-not-contents",
    countFailures,
    "b-a1 carries two tool calls and one attachment; the counts must say so and the contents must not appear",
  );

  // ── the branch moving under an open cursor ──
  const openToken = paged[0]?.next;
  if (openToken) {
    await writeConversation(caveHomeDir, { ...conversation, activeLeafId: "b-x1" });
    const reconcile = await client.read(
      `/conversations/branched/messages?limit=2&cursor=${encodeURIComponent(openToken)}`,
      bearer,
    );
    const reconcileFailures = [];
    if (reconcile.status !== 409) reconcileFailures.push(`answered ${reconcile.status}, expected 409`);
    reconcileFailures.push(
      ...checkEnvelope(reconcile.json, {
        kind: "error",
        code: "reconcile_required",
        retryable: false,
        reason: "resume_from_canonical_state",
      }),
    );
    recorder.expect(
      "reads.messages-reconcile-required",
      reconcileFailures,
      "activeLeafId moved to the abandoned branch, so the cursor names a turn that is no longer on it",
    );

    // Restarting the read from the top must succeed on the new branch.
    const restarted = await client.read("/conversations/branched/messages?limit=100", bearer);
    const restartedIds = (restarted.json?.data?.messages ?? []).map((message) => message.id);
    recorder.expect(
      "reads.messages-restart-after-reconcile",
      restarted.status === 200 && restartedIds.join(",") === "b-r1,b-x1"
        ? []
        : [`restarting served [${restartedIds}] (status ${restarted.status}), expected [b-r1,b-x1]`],
    );
    await writeConversation(caveHomeDir, conversation);
  } else {
    for (const id of ["reads.messages-reconcile-required", "reads.messages-restart-after-reconcile"]) {
      recorder.skip(id, "the transcript did not page at limit 2");
    }
  }

  const absent = await client.read("/conversations/no-such-conversation/messages", bearer);
  const absentFailures = [];
  if (absent.status !== 404) absentFailures.push(`answered ${absent.status}, expected 404`);
  absentFailures.push(...checkEnvelope(absent.json, { kind: "error", code: "not_found" }));
  recorder.expect("reads.messages-not-found", absentFailures);

  // A conversation resolves to a FILE, so on a case-insensitive filesystem a
  // differently-spelled id answers — with the transcript's own id, never the
  // spelling that was asked for. Conditional because the answer depends on the
  // filesystem this runs on, and a skip states that honestly.
  const mixedCase = await client.read("/conversations/BRANCHED/messages?limit=1", bearer);
  if (mixedCase.status === 200) {
    recorder.expect(
      "reads.messages-canonical-conversation-id",
      mixedCase.json?.data?.messages?.[0]?.conversationId === "branched"
        ? []
        : [`conversationId is ${JSON.stringify(mixedCase.json?.data?.messages?.[0]?.conversationId)}, expected the transcript's own "branched"`],
    );
  } else {
    recorder.skip(
      "reads.messages-canonical-conversation-id",
      `this filesystem is case-sensitive: /conversations/BRANCHED/messages answered ${mixedCase.status}`,
    );
  }
}

// ── the run ──────────────────────────────────────────────────────────────────

/**
 * The commit the run drove, or null.
 *
 * A conformance record is a claim about *which bytes* answered, so it has to
 * name them — the same discipline docs/workflows/release-acceptance.md applies
 * to artifact digests. Null rather than a throw when git cannot answer: a
 * checkout-less environment is a reason for a record to say "unknown", not a
 * reason for the run to fail after it has already done the work.
 */
export function currentCommit(cwd = repositoryRoot) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

export function renderConformanceRecord(entries, context) {
  const summary = summarizeConformance(entries);
  return {
    harness: "scripts/client-v1-conformance.mjs",
    issues: ["OpenCoven/coven-cave#4832", "OpenCoven/coven-cave#4838"],
    scope: "cave-only",
    ranAt: context.ranAt,
    caveVersion: context.caveVersion,
    commit: context.commit,
    platform: context.platform,
    nodeVersion: process.version,
    includeTtl: context.includeTtl,
    authorityTakeover: context.authorityTakeover,
    notCovered: context.notCovered,
    findings: context.findings,
    summary,
    assertions: entries,
  };
}

export function recordAuthorityTakeoverResult(
  recorder,
  { included, result = null, error = null },
) {
  const emptyContext = {
    authorityMode: null,
    discoveryVersion: null,
    mechanism: null,
  };
  if (!included) {
    recorder.skip(
      AUTHORITY_TAKEOVER_SKIP_ID,
      "operator did not pass --include-authority-takeover",
    );
    return emptyContext;
  }

  const complete =
    result
    && Array.isArray(result.assertions)
    && result.assertions.length
      === AUTHORITY_TAKEOVER_ASSERTION_IDS.length
    && AUTHORITY_TAKEOVER_ASSERTION_IDS.every(
      (id, index) => result.assertions[index] === id,
    )
    && result.context?.authorityMode === "enforce"
    && result.context?.discoveryVersion === 2
    && result.context?.mechanism === "hpke-bound-v1";
  if (complete) {
    for (const id of AUTHORITY_TAKEOVER_ASSERTION_IDS) {
      recorder.pass(id);
    }
    return {
      authorityMode: result.context.authorityMode,
      discoveryVersion: result.context.discoveryVersion,
      mechanism: result.context.mechanism,
    };
  }

  const failedId =
    error
    && typeof error === "object"
    && AUTHORITY_TAKEOVER_ASSERTION_IDS.includes(error.assertionId)
      ? error.assertionId
      : AUTHORITY_TAKEOVER_ASSERTION_IDS[0];
  for (const id of AUTHORITY_TAKEOVER_ASSERTION_IDS) {
    if (id === failedId) {
      recorder.fail(id, "focused authority takeover proof failed");
    } else {
      recorder.skip(
        id,
        "focused authority takeover proof did not complete",
      );
    }
  }
  return emptyContext;
}

async function main(argv) {
  const options = parseConformanceArgs(argv);
  const recorder = createRecorder();
  let authorityTakeover;

  if (!existsSync(path.join(repositoryRoot, "server.mjs")) || !existsSync(path.join(repositoryRoot, ".next", "BUILD_ID"))) {
    throw new Error("no release build found; run `pnpm build` first (this run must drive the assembled artifact, not a dev server)");
  }
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "cave-client-v1-conformance-"));
  const covenHomeDir = path.join(fixtureRoot, "coven");
  const caveHomeDir = path.join(covenHomeDir, "cave");
  const adminToken = `conformance-${randomUUID()}`;
  const daemon = await startFixtureDaemon(FIXTURE_ROSTER);
  let server = null;
  let port = 0;

  try {
    await seedFixture({ caveHomeDir, covenHomeDir, daemonUrl: daemon.url });

    // ── phase A: no COVEN_CAVE_AUTH_TOKEN ──
    port = await freePort();
    server = await startCave({ port, caveHomeDir, covenHomeDir, adminToken: null });
    console.log(`client-v1-conformance: phase A (no admin token) on ${server.origin}`);
    await runUnconfiguredAdminLeg(createClient(server.origin), recorder);
    await stopCave(server, port);
    server = null;

    // ── phase B: a configured Cave ──
    port = await freePort();
    server = await startCave({ port, caveHomeDir, covenHomeDir, adminToken });
    console.log(`client-v1-conformance: phase B (admin token configured) on ${server.origin}`);
    const client = createClient(server.origin);

    await runHealthLeg(client, recorder, caveHomeDir);
    await runIngressLeg(client, recorder, adminToken);
    await runAdminAuthLeg(client, recorder, adminToken);

    const paired = await runPairingLeg(client, recorder, adminToken, options);

    // The read legs need their own credential: the pairing leg's is about to be
    // revoked, and a read failing because of that would be indistinguishable
    // from a read failing on its own.
    const reader = await pairApproved(client, adminToken, "conformance-reader", ["chat:read"]);
    const writer = await pairApproved(client, adminToken, "conformance-writer", ["chat:write"]);

    await runEmptyReadsLeg(client, recorder, reader.bearer);
    await runAuthFailureLeg(client, recorder, reader.bearer, writer.bearer);
    await runFamiliarsLeg(client, recorder, reader.bearer);

    await writeProjects(caveHomeDir, fixtureProjects());
    for (const conversation of fixtureConversations()) {
      await writeConversation(caveHomeDir, conversation);
    }

    await runProjectsLeg(client, recorder, reader.bearer, caveHomeDir);
    await runQueryRefusalLeg(client, recorder, reader.bearer);
    await runConversationsLeg(client, recorder, reader.bearer, caveHomeDir);
    await runMessagesLeg(client, recorder, reader.bearer, caveHomeDir);

    await runRevocationLeg(client, recorder, adminToken, paired.credentialId, paired.bearer);
  } finally {
    if (server) await stopCave(server, port).catch((error) => console.error(`client-v1-conformance: ${error.message}`));
    await daemon.stop();
    if (!options.keepFixture) await rm(fixtureRoot, { recursive: true, force: true });
    else console.log(`client-v1-conformance: fixture kept at ${fixtureRoot}`);
  }

  let authorityTakeoverResult = null;
  let authorityTakeoverError = null;
  if (options.includeAuthorityTakeover) {
    try {
      const { runAuthorityTakeoverProof } = await import(
        "./client-v1-authority-takeover.mjs"
      );
      authorityTakeoverResult = await runAuthorityTakeoverProof();
    } catch (error) {
      authorityTakeoverError = error;
    }
  }
  authorityTakeover = recordAuthorityTakeoverResult(recorder, {
    included: options.includeAuthorityTakeover,
    result: authorityTakeoverResult,
    error: authorityTakeoverError,
  });

  // Recorded last, and over whatever the legs above managed to produce — a run
  // that lost legs to a failed precondition has to say so in the record itself,
  // not only in a total the reader has to remember.
  recorder.expect(
    COVERAGE_ASSERTION_ID,
    checkAssertionCoverage(
      recorder.entries,
      expectedAssertionIds(
        options.includeTtl,
        options.includeAuthorityTakeover,
      ),
    ),
    `every declared assertion recorded exactly once (--include-ttl ${options.includeTtl}, --include-authority-takeover ${options.includeAuthorityTakeover})`,
  );

  for (const entry of recorder.entries) {
    const mark = entry.result === "pass" ? "ok" : entry.result === "skip" ? "skip" : "FAIL";
    console.log(`${mark} ${entry.id}${entry.detail ? ` — ${entry.detail}` : ""}`);
  }
  const summary = summarizeConformance(recorder.entries);
  console.log(
    `client-v1-conformance: ${summary.status} (${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped)`,
  );

  if (options.out) {
    const record = renderConformanceRecord(recorder.entries, {
      ranAt: new Date().toISOString(),
      caveVersion: manifest.version,
      commit: currentCommit(),
      platform: `${process.platform}-${process.arch}`,
      includeTtl: options.includeTtl,
      authorityTakeover,
      notCovered: NOT_COVERED,
      findings: FINDINGS,
    });
    await mkdir(path.dirname(path.resolve(repositoryRoot, options.out)), { recursive: true });
    await writeFile(path.resolve(repositoryRoot, options.out), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`client-v1-conformance: evidence written to ${options.out}`);
  }

  return summary.failed > 0 ? 1 : 0;
}

/**
 * What a green run does NOT mean. Carried into the evidence record so the file
 * cannot be read as broader coverage than it is.
 */
export const FINDINGS = [
  {
    id: "backslash-refusal-is-unreachable",
    where: "docs/api/client-v1.md — Reaching the API at all",
    says: 'a malformed/noncanonical escaped target, backslash target, or escaped non-conversation target is answered 400 {"ok":false,"error":"invalid client v1 path"}',
    measured: 'the "%" half holds; a "\\" is normalised to "/" by Next and answered 308 to the normalised target before proxy.ts runs, and that target is then refused 401 by the ordinary gate',
    severity: "documentation",
    why: "no handler is reached and nothing is served, so the gate still holds; the doc describes an answer no client will observe",
  },
  {
    id: "admin-unauthorized-envelope-is-unreachable",
    where: "docs/api/client-v1.md — Administrator routes, Authentication",
    says: "a mismatched or absent x-coven-cave-token is 401 unauthorized from requireClientV1Admin",
    measured: 'the proxy\'s sidecar-token gate answers first, so the wire carries 401 {"ok":false,"error":"unauthorized"} and requireClientV1Admin\'s envelope is never produced on a Cave with a token configured',
    severity: "documentation",
    why: "the refusal is correct and same-status; only its body differs from the documented one, which a handler-level test cannot see",
  },
];

export const NOT_COVERED = [
  "The SDK and Chat halves of #4838. Both live in other repositories; this run is the Cave half only.",
  "The production Coven daemon. /familiars is served from a loopback fixture daemon in hub mode.",
  "A genuinely remote peer. Off-machine ingress is exercised by making the listener classify a loopback request as forwarded.",
  "The write scopes. Nothing enforces them yet — there are no write routes on this surface.",
  "OAuth-backed flows and the desktop consent UI. Approval is driven through the admin HTTP route.",
  "Cross-process pairing state. The pairing store is in-memory and process-local by contract.",
];

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`client-v1-conformance: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
