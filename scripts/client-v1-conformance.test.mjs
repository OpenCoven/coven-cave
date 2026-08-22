import assert from "node:assert/strict";
import test from "node:test";

import {
  BRANCHED_ACTIVE_SEQUENCE,
  FINDINGS,
  FIXTURE_ROSTER,
  NOT_COVERED,
  RECORD_SHAPES,
  checkEmptyFirstPage,
  checkEnvelope,
  checkPageWalk,
  checkRecordShape,
  createRecorder,
  fixtureBranchedConversation,
  fixtureConversations,
  fixtureProjects,
  parseConformanceArgs,
  parseRawResponse,
  renderConformanceRecord,
  summarizeConformance,
} from "./client-v1-conformance.mjs";

// The conformance run itself needs a release build, a spare port and a couple
// of minutes, so it is operator-invoked (see
// docs/workflows/client-v1-conformance.md). What CI can and must keep honest is
// everything that decides whether that run PASSES: an assertion helper that
// cannot fail turns a green record into a lie, and nothing else in the suite
// would notice. So every test below is a negative one — it feeds the helper the
// exact broken server behaviour the run exists to catch and demands a failure.

// ── argument parsing ─────────────────────────────────────────────────────────

test("parseConformanceArgs defaults to the fast, evidence-free run", () => {
  assert.deepEqual(parseConformanceArgs([]), { out: null, includeTtl: false, keepFixture: false });
});

test("parseConformanceArgs reads every flag", () => {
  assert.deepEqual(parseConformanceArgs(["--include-ttl", "--keep-fixture", "--out", "docs/x.json"]), {
    out: "docs/x.json",
    includeTtl: true,
    keepFixture: true,
  });
});

test("parseConformanceArgs refuses an unknown flag rather than ignoring it", () => {
  // A silently dropped `--include-tll` is how a run that was asked for the slow
  // leg reports a clean pass without ever having run it.
  assert.throws(() => parseConformanceArgs(["--include-tll"]), /unknown option/);
});

test("parseConformanceArgs refuses --out without a value", () => {
  assert.throws(() => parseConformanceArgs(["--out"]), /--out requires a path/);
  assert.throws(() => parseConformanceArgs(["--out", "--include-ttl"]), /--out requires a path/);
});

// ── the envelope ─────────────────────────────────────────────────────────────

const successEnvelope = {
  apiVersion: "1.0",
  minimumClientVersion: "0.1.0",
  capabilities: ["pairing"],
  data: { ok: true },
};

test("checkEnvelope accepts a well-formed success envelope", () => {
  assert.deepEqual(checkEnvelope(successEnvelope, { kind: "success" }), []);
});

test("checkEnvelope catches a route that dropped the shared envelope fields", () => {
  for (const field of ["apiVersion", "minimumClientVersion", "capabilities"]) {
    const broken = { ...successEnvelope };
    delete broken[field];
    const failures = checkEnvelope(broken, { kind: "success" });
    assert.equal(failures.length, 1, `${field} produced ${JSON.stringify(failures)}`);
    assert.match(failures[0], new RegExp(field));
  }
});

test("checkEnvelope catches an empty capability list", () => {
  // Empty is the shape a client reads as "this Cave can do nothing", which is
  // never true and is not distinguishable from a broken build without this.
  assert.deepEqual(checkEnvelope({ ...successEnvelope, capabilities: [] }, { kind: "success" }), [
    "capabilities is missing or empty",
  ]);
});

test("checkEnvelope catches a success that carries an error, and vice versa", () => {
  assert.deepEqual(
    checkEnvelope({ ...successEnvelope, error: { code: "not_found" } }, { kind: "success" }),
    ["success envelope carries an error"],
  );
  assert.deepEqual(checkEnvelope({ ...successEnvelope, data: undefined }, { kind: "success" }), [
    "success envelope carries no data record",
  ]);
});

test("checkEnvelope catches the wrong error code, a lying retryable, and a missing details.reason", () => {
  const envelope = {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: ["pairing"],
    error: { code: "conflict", message: "nope", retryable: true, details: { reason: "something_else" } },
  };
  const failures = checkEnvelope(envelope, {
    kind: "error",
    code: "reconcile_required",
    retryable: false,
    reason: "resume_from_canonical_state",
  });
  assert.equal(failures.length, 3);
  assert.match(failures.join("|"), /error\.code is "conflict"/);
  assert.match(failures.join("|"), /error\.retryable is true, expected false/);
  assert.match(failures.join("|"), /resume_from_canonical_state/);
});

test("checkEnvelope refuses a non-object body", () => {
  // The proxy's refusals are a different shape from the envelope, so a helper
  // that shrugged at a string would pass a route serving Next's error page.
  assert.deepEqual(checkEnvelope("not json", { kind: "success" }), ["response body is not a JSON object"]);
  assert.deepEqual(checkEnvelope(null, { kind: "success" }), ["response body is not a JSON object"]);
  assert.deepEqual(checkEnvelope([successEnvelope], { kind: "success" }), ["response body is not a JSON object"]);
});

// ── projections ──────────────────────────────────────────────────────────────

test("checkRecordShape accepts a record carrying only required and optional fields", () => {
  assert.deepEqual(
    checkRecordShape({ id: "a", displayName: "A", role: "R" }, RECORD_SHAPES.familiar, "familiar"),
    [],
  );
});

test("checkRecordShape names a withheld field as a leak, not as drift", () => {
  // The whole reason the message projection exists is that `reasoning` and
  // `tools` are the harness's scratchpad and whatever a tool was pointed at.
  const failures = checkRecordShape(
    {
      id: "t1",
      conversationId: "c1",
      parentId: null,
      role: "assistant",
      text: "hi",
      createdAt: "2026-01-01T00:00:00.000Z",
      attachmentCount: 0,
      toolCount: 0,
      reasoning: "private",
      tools: [],
    },
    RECORD_SHAPES.message,
    "message t1",
  );
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.sort(), [
    'message t1 leaks withheld field "reasoning"',
    'message t1 leaks withheld field "tools"',
  ]);
});

test("checkRecordShape catches a bearerHash reaching an admin listing", () => {
  const failures = checkRecordShape(
    {
      id: "c",
      appName: "a",
      installationId: "i",
      scopes: [],
      createdAt: 1,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
      bearerHash: "deadbeef",
    },
    RECORD_SHAPES.credential,
    "credential",
  );
  assert.deepEqual(failures, ['credential leaks withheld field "bearerHash"']);
});

test("checkRecordShape catches a missing required field and an unexpected one", () => {
  const failures = checkRecordShape({ id: "p", name: "n", root: "/r", createdAt: "x", surprise: 1 }, RECORD_SHAPES.project, "project");
  assert.deepEqual(failures.sort(), [
    'project carries unexpected field "surprise"',
    'project is missing required "updatedAt"',
  ]);
});

test("RECORD_SHAPES withholds every field the reference says is withheld", () => {
  // A shape spec that quietly dropped one of these would pass a leaking server.
  assert.ok(RECORD_SHAPES.conversation.forbidden.includes("harnessSessionId"));
  assert.ok(RECORD_SHAPES.conversation.forbidden.includes("branch"));
  assert.ok(RECORD_SHAPES.conversation.forbidden.includes("prUrl"));
  assert.ok(RECORD_SHAPES.project.forbidden.includes("legacyRoot"));
  assert.ok(RECORD_SHAPES.project.forbidden.includes("access"));
  assert.ok(RECORD_SHAPES.message.forbidden.includes("usage"));
  assert.ok(RECORD_SHAPES.message.forbidden.includes("costUsd"));
  assert.ok(RECORD_SHAPES.pairingStatus.forbidden.includes("scopes"));
});

// ── paged walks ──────────────────────────────────────────────────────────────

const page = (ids, hasMore, next) => ({ ids, hasMore, ...(next === undefined ? {} : { next }) });

test("checkPageWalk accepts a partial final page", () => {
  const walk = [page(["a", "b"], true, "t1"), page(["c"], false)];
  assert.deepEqual(checkPageWalk(walk, { limit: 2, expectedIds: ["a", "b", "c"] }), []);
});

test("checkPageWalk accepts an exact-multiple walk whose last full page ends it", () => {
  // The classic boundary: 4 rows at limit 2 must be two pages, not two plus an
  // empty third, and the second must report hasMore false.
  const walk = [page(["a", "b"], true, "t1"), page(["c", "d"], false)];
  assert.deepEqual(checkPageWalk(walk, { limit: 2, expectedIds: ["a", "b", "c", "d"] }), []);
});

test("checkPageWalk catches a repeated record across a boundary", () => {
  const walk = [page(["a", "b"], true, "t1"), page(["b", "c"], false)];
  const failures = checkPageWalk(walk, { limit: 2 });
  assert.ok(failures.some((failure) => failure.includes('id "b" was served twice')), failures.join("|"));
});

test("checkPageWalk catches a skipped record", () => {
  const walk = [page(["a", "b"], true, "t1"), page(["d"], false)];
  const failures = checkPageWalk(walk, { limit: 2, expectedIds: ["a", "b", "c", "d"] });
  assert.ok(failures.some((failure) => failure.includes("walk served [a,b,d]")), failures.join("|"));
});

test("checkPageWalk catches hasMore lying in both directions", () => {
  const understated = checkPageWalk([page(["a"], false, "t1"), page(["b"], false)], { limit: 1 });
  assert.ok(understated.some((failure) => failure.includes("reported hasMore false with a page after it")), understated.join("|"));

  const overstated = checkPageWalk([page(["a"], true, "t1"), page(["b"], true, "t2")], { limit: 1 });
  assert.ok(overstated.some((failure) => failure.includes("the final page reported hasMore true")), overstated.join("|"));
  assert.ok(overstated.some((failure) => failure.includes("the final page published a next token")), overstated.join("|"));
});

test("checkPageWalk catches a page above the requested limit", () => {
  // The over-fetched row is evidence for hasMore and must never be served: a
  // page of limit+1 breaks the ceiling the contract publishes.
  const failures = checkPageWalk([page(["a", "b", "c"], false)], { limit: 2 });
  assert.ok(failures.some((failure) => failure.includes("above the requested limit 2")), failures.join("|"));
});

test("checkPageWalk catches a short non-final page", () => {
  const failures = checkPageWalk([page(["a"], true, "t1"), page(["b", "c"], false)], { limit: 2 });
  assert.ok(failures.some((failure) => failure.includes("served 1 of 2 rows")), failures.join("|"));
});

test("checkPageWalk catches a non-final page that published no token to follow", () => {
  const failures = checkPageWalk([page(["a"], true), page(["b"], false)], { limit: 1 });
  assert.ok(failures.some((failure) => failure.includes("published no next token")), failures.join("|"));
});

test("checkEmptyFirstPage requires the cursor field to be absent, not false", () => {
  assert.deepEqual(checkEmptyFirstPage({ data: { projects: [] } }, "projects"), []);
  assert.deepEqual(
    checkEmptyFirstPage({ data: { projects: [] }, cursor: { hasMore: false } }, "projects"),
    ["an empty first page published a cursor; the contract omits the field when there is no token"],
  );
  assert.deepEqual(checkEmptyFirstPage({ data: { projects: [{ id: "a" }] } }, "projects"), [
    "data.projects served 1 rows, expected none",
  ]);
});

// ── recording and reporting ──────────────────────────────────────────────────

test("a skipped leg is never counted as a pass", () => {
  // The honest-partial rule: a leg that says out loud it did not run must not
  // inflate the coverage the record claims.
  const recorder = createRecorder();
  recorder.pass("a");
  recorder.skip("b", "no clock seam");
  recorder.fail("c", "broken");
  assert.deepEqual(summarizeConformance(recorder.entries), {
    total: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    status: "failed",
  });
});

test("a run with skips but no failures still passes", () => {
  const recorder = createRecorder();
  recorder.pass("a");
  recorder.skip("b", "operator did not ask for the slow leg");
  assert.equal(summarizeConformance(recorder.entries).status, "passed");
});

test("recorder.expect turns an empty failure list into a pass and a non-empty one into a failure", () => {
  const recorder = createRecorder();
  recorder.expect("clean", []);
  recorder.expect("dirty", ["one", "two"]);
  assert.equal(recorder.entries[0].result, "pass");
  assert.equal(recorder.entries[1].result, "fail");
  assert.equal(recorder.entries[1].detail, "one; two");
});

test("the evidence record carries the scope limits and the findings, not just a verdict", () => {
  const record = renderConformanceRecord([{ id: "a", result: "pass", detail: "" }], {
    ranAt: "2026-08-22T00:00:00.000Z",
    caveVersion: "0.3.9",
    commit: null,
    platform: "win32-x64",
    includeTtl: false,
    notCovered: NOT_COVERED,
    findings: FINDINGS,
  });
  assert.equal(record.scope, "cave-only");
  assert.deepEqual(record.issues, ["OpenCoven/coven-cave#4832", "OpenCoven/coven-cave#4838"]);
  assert.ok(record.notCovered.length > 0);
  assert.ok(record.findings.length > 0);
  assert.equal(record.summary.status, "passed");
});

test("NOT_COVERED states the cross-repo boundary the issues span", () => {
  // #4838 names Cave, the SDK and Chat. Only one of those is in this
  // repository, and a record that did not say so would read as full coverage.
  assert.ok(NOT_COVERED.some((entry) => /SDK and Chat/.test(entry)));
  assert.ok(NOT_COVERED.some((entry) => /fixture daemon/.test(entry)));
});

// ── the raw response reader ──────────────────────────────────────────────────

test("parseRawResponse reads a chunked proxy refusal", () => {
  const raw = [
    "HTTP/1.1 411 Length Required",
    "content-type: application/json",
    "Connection: close",
    "",
    "2e",
    '{"ok":false,"error":"content-length required"}',
    "0",
    "",
    "",
  ].join("\r\n");
  const response = parseRawResponse(raw);
  assert.equal(response.status, 411);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(response.json, { ok: false, error: "content-length required" });
});

test("parseRawResponse reads a redirect's location and reports no JSON body", () => {
  const raw = "HTTP/1.1 308 Permanent Redirect\r\nlocation: /api/client/v1/pairing/requests/a/b\r\n\r\n";
  const response = parseRawResponse(raw);
  assert.equal(response.status, 308);
  assert.equal(response.headers.location, "/api/client/v1/pairing/requests/a/b");
  assert.equal(response.json, null);
});

test("parseRawResponse reports status 0 for a response that never arrived", () => {
  // A silent zero that read as a 2xx would turn a dead server into a pass.
  assert.equal(parseRawResponse("").status, 0);
});

// ── the fixtures the run asserts against ─────────────────────────────────────

test("the fixture project set exercises a partial final page at limit 3", () => {
  const projects = fixtureProjects();
  assert.equal(projects.length, 7);
  assert.notEqual(projects.length % 3, 0);
  assert.equal(new Set(projects.map((project) => project.createdAt)).size, projects.length);
  assert.equal(new Set(projects.map((project) => project.root)).size, projects.length);
});

test("the fixture conversation set exercises an exact multiple at limit 3", () => {
  const conversations = fixtureConversations();
  assert.equal(conversations.length, 6);
  assert.equal(conversations.length % 3, 0);
  assert.equal(new Set(conversations.map((conversation) => conversation.updatedAt)).size, conversations.length);
  // Each carries the three withheld fields, so the projection has something to
  // withhold. A shape assertion over a record that never held the field proves
  // nothing about the projection.
  for (const conversation of conversations) {
    assert.ok(conversation.harnessSessionId);
    assert.ok(conversation.branch);
    assert.ok(conversation.prUrl);
  }
});

test("the branched fixture's active path is the declared sequence and omits the abandoned branch", () => {
  const conversation = fixtureBranchedConversation();
  const byId = new Map(conversation.turns.map((turn) => [turn.id, turn]));
  const chain = [];
  let current = byId.get(conversation.activeLeafId);
  while (current) {
    chain.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  assert.deepEqual(chain, BRANCHED_ACTIVE_SEQUENCE);
  assert.ok(conversation.turns.some((turn) => turn.id === "b-x1"));
  assert.ok(!BRANCHED_ACTIVE_SEQUENCE.includes("b-x1"));
  // resolveActivePath splices parentless SYSTEM turns back into the chain by
  // timestamp, so a system turn here would make the expected sequence depend on
  // that splice rather than on the branch.
  assert.ok(conversation.turns.every((turn) => turn.role !== "system"));
});

test("the branched fixture pages at limit 2 so the reconcile leg has an open cursor", () => {
  assert.ok(BRANCHED_ACTIVE_SEQUENCE.length > 2);
});

test("the fixture roster covers the optional familiar fields and enough rows to page", () => {
  assert.ok(FIXTURE_ROSTER.length > 2);
  const rich = FIXTURE_ROSTER.find((entry) => entry.id === "archivist");
  assert.equal(rich.last_seen, "not-an-instant", "lastSeenAt is passed through verbatim and is deliberately not an instant");
  assert.equal(rich.active_sessions, 2);
  const sparse = FIXTURE_ROSTER.find((entry) => entry.id === "brewer");
  assert.deepEqual(Object.keys(sparse).sort(), ["display_name", "id", "role"]);
});
