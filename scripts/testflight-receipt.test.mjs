import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  appleClient, appleUrl, ReceiptError, receiptSummary, runReceipt, selectors, tokenSigner,
} from "./testflight-receipt.mjs";

const env = { TESTFLIGHT_MARKETING_VERSION: "0.4.2", TESTFLIGHT_BUILD_NUMBER: "2026090912" };
const relation = (type, id) => ({ data: { type, id } });
const resource = (type, id, attributes = {}, relationships = {}) => ({ type, id, attributes, relationships });

function fixture() {
  const data = {
    apps: [resource("apps", "app-1", { bundleId: "ai.opencoven.cave" })],
    preReleaseVersions: [resource("preReleaseVersions", "version-1", { version: "0.4.2", platform: "IOS" },
      { app: relation("apps", "app-1") })],
    builds: [resource("builds", "build-1", {
      version: "2026090912", processingState: "VALID", expired: false,
      expirationDate: new Date(Date.now() + 86_400_000).toISOString(),
    }, { app: relation("apps", "app-1"), preReleaseVersion: relation("preReleaseVersions", "version-1") })],
    buildBetaDetail: resource("buildBetaDetails", "detail-1", {
      internalBuildState: "IN_BETA_TESTING", externalBuildState: "READY_FOR_BETA_SUBMISSION",
    }, { build: relation("builds", "build-1") }),
    buildBetaDetailLinkage: { type: "buildBetaDetails", id: "detail-1" },
    betaGroups: [resource("betaGroups", "group-1", { isInternalGroup: true, name: "PRIVATE GROUP NAME" },
      { app: relation("apps", "app-1") })],
    betaTesters: [{ type: "betaTesters", id: "private-tester-id" }],
  };
  const calls = [];
  const api = appleClient(() => "private-token", {
    fetchImpl: async (value, options) => {
      const url = new URL(value);
      calls.push({ url, options });
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      const key = url.pathname.endsWith("/relationships/buildBetaDetail")
        ? "buildBetaDetailLinkage" : url.pathname.split("/").at(-1);
      assert.ok(Object.hasOwn(data, key), `Unexpected endpoint ${key}`);
      return Response.json({ data: data[key], links: { next: null } });
    },
    pause: async () => {},
  });
  return { data, calls, api };
}

test("JWTs are P-256 ES256, short-lived and GET-scoped for individual and team keys", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const base = {
    APPLE_API_KEY: "TESTKEY123",
    APPLE_API_KEY_BASE64: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
    APPLE_API_ISSUER: "12345678-1234-1234-1234-123456789abc",
  };
  for (const subject of ["", "user"]) {
    const token = tokenSigner({ ...base, APPLE_API_KEY_SUBJECT: subject })("/v1/apps?limit=200", 1000);
    const [header, payload, signature] = token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: base.APPLE_API_KEY, typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.aud, "appstoreconnect-v1");
    assert.equal(claims.iat, 1000);
    assert.equal(claims.exp, 1300);
    assert.deepEqual(claims.scope, ["GET /v1/apps?limit=200"]);
    assert.equal(claims.sub, subject ? "user" : undefined);
    assert.equal(claims.iss, subject ? undefined : base.APPLE_API_ISSUER);
    assert.equal(Buffer.from(signature, "base64url").length, 64);
    assert.ok(verify("sha256", Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  }
  assert.throws(() => tokenSigner({ ...base, APPLE_API_KEY_SUBJECT: "other" }), /INVALID_KEY_SUBJECT/);
  assert.throws(() => tokenSigner({ ...base, APPLE_API_ISSUER: "" }), /INVALID_TEAM_ISSUER/);
  assert.doesNotThrow(() => tokenSigner({ ...base, APPLE_API_KEY_SUBJECT: "user", APPLE_API_ISSUER: "" }));
  assert.throws(() => tokenSigner({ ...base, APPLE_API_KEY_BASE64: "invalid" }), /INVALID_PRIVATE_KEY/);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(() => tokenSigner({ ...base,
    APPLE_API_KEY_BASE64: Buffer.from(rsa.export({ type: "pkcs8", format: "pem" })).toString("base64"),
  }), /INVALID_PRIVATE_KEY/);
});

test("exact input validation does not echo arbitrary inputs", async () => {
  assert.equal(selectors("0.4.2", "2026090912").bundleId, "ai.opencoven.cave");
  for (const [version, build] of [["secret\nvalue", "1"], ["0.4.2", "1,2"], ["0.4.2", "$(write)"]]) {
    const receipt = await runReceipt({ TESTFLIGHT_MARKETING_VERSION: version, TESTFLIGHT_BUILD_NUMBER: build });
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.equal(receipt.target, null);
    assert.ok(receipt.error);
    assert.ok(!JSON.stringify(receipt).includes("secret"));
  }
});

test("key IDs are bounded identifiers, not restricted to Apple's example length", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const base = {
    APPLE_API_KEY_SUBJECT: "user",
    APPLE_API_KEY_BASE64: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
  };
  for (const keyId of ["TESTKEY123", "TESTKEY12345", "Test_Key-123", "A".repeat(128)]) {
    const token = tokenSigner({ ...base, APPLE_API_KEY: keyId })("/v1/apps?limit=200", 1000);
    const [header, payload, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url")).kid, keyId);
    assert.ok(verify("sha256", Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  }
  for (const keyId of [
    undefined, null, 123, "", "A".repeat(129), "PRIVATE KEY", "PRIVATE\nKEY",
    "PRIVATE\n", "PRIVATE\r\n", "PRIVATE\u0000", "PRIVATE\u2028", "\"PRIVATE\"",
  ]) {
    const receipt = await runReceipt({ ...env, ...base, APPLE_API_KEY: keyId });
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.equal(receipt.error.code, "INVALID_KEY_ID");
    assert.equal(receipt.error.httpStatus, null);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/);
  }
});

test("availability requires exact identity, matching beta lane and populated assigned group", async () => {
  const f = fixture();
  const receipt = await runReceipt(env, { api: f.api });
  assert.equal(receipt.verdict, "TESTER_AVAILABLE");
  assert.equal(receipt.buildId, "build-1");
  assert.equal(receipt.processingState, "VALID");
  assert.equal(receipt.buildBetaDetailId, "detail-1");
  assert.equal(receipt.buildBetaDetailHasBuildLinkage, true);
  assert.deepEqual(receipt.groups, [{
    id: "group-1", isInternalGroup: true, buildState: "IN_BETA_TESTING", testerCount: 1, testerAvailable: true,
  }]);
  const builds = f.calls.find(({ url }) => url.pathname === "/v1/builds").url;
  assert.equal(builds.searchParams.get("filter[app]"), "app-1");
  assert.equal(builds.searchParams.get("filter[preReleaseVersion]"), "version-1");
  assert.equal(builds.searchParams.get("filter[version]"), "2026090912");
  const groups = f.calls.find(({ url }) => url.pathname === "/v1/betaGroups").url;
  assert.equal(groups.searchParams.get("filter[app]"), "app-1");
  assert.equal(groups.searchParams.get("filter[builds]"), "build-1");
  assert.ok(f.calls.some(({ url }) => url.pathname === "/v1/betaGroups/group-1/relationships/betaTesters"));
  assert.ok(f.calls.some(({ url }) => url.pathname === "/v1/builds/build-1/relationships/buildBetaDetail"));
  assert.doesNotMatch(receiptSummary(receipt), /PRIVATE GROUP NAME|private-tester-id|private-token/);
});

test("beta details bind to the exact build when inverse linkage is omitted or empty", async () => {
  for (const relationships of [undefined, {}, { build: { data: null } },
    { build: { links: { related: "https://example.test/unused" } } }]) {
    const f = fixture();
    f.data.buildBetaDetail.relationships = relationships;
    const receipt = await runReceipt(env, { api: f.api });
    assert.equal(receipt.verdict, "TESTER_AVAILABLE");
    assert.equal(receipt.buildBetaDetailId, "detail-1");
    assert.equal(receipt.buildBetaDetailHasBuildLinkage, false);
    assert.equal(receipt.buildBetaDetailBuildLinkageState,
      relationships?.build?.data === null ? "empty" : "omitted");
    assert.equal(f.calls.filter(({ url }) => url.pathname.endsWith("/relationships/buildBetaDetail")).length, 1);
  }
});

test("missing, malformed or conflicting forward beta-detail linkage fails closed", async () => {
  for (const linkage of [undefined, null, {}, [], { type: "builds", id: "detail-1" },
    { type: "buildBetaDetails", id: "other-detail" }, { type: "buildBetaDetails", id: "PRIVATE\nID" }]) {
    const f = fixture();
    f.data.buildBetaDetailLinkage = linkage;
    delete f.data.buildBetaDetail.relationships;
    const receipt = await runReceipt(env, { api: f.api });
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.ok(receipt.error);
    if (linkage === undefined) assert.equal(receipt.error.code, "MISSING_RELATIONSHIP_DATA");
    if (linkage === null) assert.equal(receipt.error.code, "INVALID_RESOURCE_TYPE");
    assert.deepEqual(receipt.groups, []);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/);
  }
  for (const inverse of [{ type: "apps", id: "build-1" }, {}, [], "PRIVATE"]) {
    const f = fixture();
    f.data.buildBetaDetail.relationships.build.data = inverse;
    const receipt = await runReceipt(env, { api: f.api });
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.equal(receipt.error.code, "INVALID_RESOURCE_TYPE");
    assert.equal(receipt.buildBetaDetailBuildLinkageState, "present");
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/);
  }
});

test("processing, absent, blocked, unknown and merely ready states are not success", async () => {
  const cases = [
    ["PROCESSING_PENDING", (d) => { d.builds[0].attributes.processingState = "PROCESSING"; }],
    ["BLOCKED", (d) => { d.builds[0].attributes.processingState = "INVALID"; }],
    ["BLOCKED", (d) => { d.builds[0].attributes.expired = true; }],
    ["BLOCKED", (d) => { d.builds[0].attributes.expirationDate = "2000-01-01T00:00:00Z"; }],
    ["BLOCKED", (d) => { d.buildBetaDetail.attributes.internalBuildState = "MISSING_EXPORT_COMPLIANCE"; }],
    ["UNKNOWN", (d) => { d.buildBetaDetail.attributes.internalBuildState = "NEW_STATE_WITH_PII"; }],
    ["UNKNOWN", (d) => { delete d.builds[0].attributes.expired; }],
    ["UNKNOWN", (d) => { d.builds[0].attributes.processingState = "SOMETHING_NEW"; }],
    ["VALID_NOT_AVAILABLE", (d) => { d.buildBetaDetail.attributes.internalBuildState = "READY_FOR_BETA_TESTING"; }],
    ["VALID_NOT_AVAILABLE", (d) => { d.betaGroups = []; }],
    ["VALID_NOT_AVAILABLE", (d) => { d.betaTesters = []; }],
    ["VALID_NOT_AVAILABLE", (d) => { d.betaGroups[0].attributes.isInternalGroup = false; }],
    ["TESTER_AVAILABLE", (d) => {
      d.betaGroups[0].attributes.isInternalGroup = false;
      d.buildBetaDetail.attributes.externalBuildState = "IN_BETA_TESTING";
    }],
    ...["apps", "preReleaseVersions", "builds"].map((key) => ["ABSENT", (d) => { d[key] = []; }]),
  ];
  for (const [expected, change] of cases) {
    const f = fixture();
    change(f.data);
    const receipt = await runReceipt(env, { api: f.api });
    assert.equal(receipt.verdict, expected, change.toString());
    assert.doesNotMatch(JSON.stringify(receipt), /NEW_STATE_WITH_PII/);
  }
});

test("wrong app, marketing version, build, platform or linkage fails closed", async () => {
  const mutations = [
    (d) => { d.apps[0].attributes.bundleId = "wrong.bundle"; },
    (d) => { d.preReleaseVersions[0].attributes.platform = "MAC_OS"; },
    (d) => { d.preReleaseVersions[0].attributes.version = "0.4.1"; },
    (d) => { d.preReleaseVersions[0].relationships.app.data.id = "wrong"; },
    (d) => { d.builds[0].attributes.version = "other"; },
    (d) => { d.builds[0].relationships.app.data.id = "wrong"; },
    (d) => { d.builds[0].relationships.preReleaseVersion.data.id = "wrong"; },
    (d) => { d.buildBetaDetail.relationships.build.data.id = "wrong"; },
    (d) => { d.betaGroups[0].relationships.app.data.id = "wrong"; },
    (d) => { d.betaGroups[0].attributes.isInternalGroup = "true"; },
    (d) => { d.builds.push(d.builds[0]); },
  ];
  for (const change of mutations) {
    const f = fixture();
    change(f.data);
    const receipt = await runReceipt(env, { api: f.api });
    assert.equal(receipt.verdict, "UNKNOWN", change.toString());
    assert.ok(receipt.error);
  }
});

test("pagination collects tester counts without leaking identifiers", async () => {
  let page = 0;
  const client = appleClient(() => "token", {
    fetchImpl: async () => Response.json({
      data: [{ type: "betaTesters", id: `tester-${++page}` }],
      links: { next: page === 1
        ? "https://api.appstoreconnect.apple.com/v1/betaGroups/g/relationships/betaTesters?limit=200&cursor=next"
        : null },
    }),
  });
  assert.equal((await client.list("/v1/betaGroups/g/relationships/betaTesters")).length, 2);
});

test("requests refuse foreign origins, redirects and unsafe or unbounded pagination", async () => {
  for (const url of [
    "https://attacker.example/v1/apps", "http://api.appstoreconnect.apple.com/v1/apps",
    "//attacker.example/v1/apps", "https://user:pass@api.appstoreconnect.apple.com/v1/apps",
    "https://api.appstoreconnect.apple.com:444/v1/apps", "/v1/apps#fragment", "/v1/users",
    "/v1/apps/app-1/relationships/buildBetaDetail",
    "/v1/builds/build-1/relationships/other",
  ]) assert.throws(() => appleUrl(url), /UNSAFE_API_URL/);
  for (const next of [
    "https://attacker.example/v1/apps?limit=200",
    "/v1/builds?limit=200", "/v1/apps?filter[bundleId]=other",
    "/v1/apps?limit=200",
  ]) {
    let calls = 0;
    const api = appleClient(() => "token", {
      fetchImpl: async () => { calls += 1; return Response.json({ data: [], links: { next } }); },
    });
    await assert.rejects(api.list("/v1/apps"), ReceiptError);
    assert.equal(calls, 1);
  }
  let pages = 0;
  const api = appleClient(() => "token", {
    fetchImpl: async () => Response.json({ data: [],
      links: { next: `/v1/apps?limit=200&cursor=${++pages}` } }),
  });
  await assert.rejects(api.list("/v1/apps"), /PAGINATION_LIMIT/);
  assert.equal(pages, 10);
  const redirect = appleClient(() => "token", { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "error");
    return new Response(null, { status: 302, headers: { Location: "https://attacker.example" } });
  } });
  await assert.rejects(redirect.get("/v1/apps"), /APPLE_HTTP_ERROR/);
});

test("401/403 never retry and failures never expose response bodies or thrown secrets", async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const api = appleClient(() => "private-token", {
      fetchImpl: async () => { calls += 1; return new Response("SECRET email@example.test", { status }); },
      pause: async () => {},
    });
    const receipt = await runReceipt(env, { api });
    assert.equal(calls, status === 401 || status === 403 ? 1 : 3);
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.equal(receipt.error.httpStatus, status);
    assert.doesNotMatch(receiptSummary(receipt), /SECRET|email@example|private-token/);
  }
  for (const fetchImpl of [
    async () => { throw new Error("PRIVATE KEY SECRET"); },
    async () => new Response("PRIVATE KEY SECRET"),
    async () => new Response("x".repeat(1_048_577)),
    async () => Response.json({ data: "not-a-list" }),
  ]) {
    const receipt = await runReceipt(env, { api: appleClient(() => "token", { fetchImpl }) });
    assert.equal(receipt.verdict, "UNKNOWN");
    assert.ok(receipt.error);
    assert.doesNotMatch(receiptSummary(receipt), /PRIVATE KEY SECRET/);
  }
});

test("retry recovery, total request budget and wall-clock deadline are bounded", async () => {
  let requests = 0;
  const api = appleClient(() => "token", { fetchImpl: async () => {
    requests += 1;
    return requests === 1 ? new Response(null, { status: 429 }) : Response.json({ data: [] });
  }, pause: async () => {} });
  assert.deepEqual(await api.list("/v1/apps"), []);
  for (let i = 0; i < 98; i += 1) await api.get("/v1/apps");
  await assert.rejects(api.get("/v1/apps"), /REQUEST_BUDGET_EXCEEDED/);
  assert.equal(requests, 100);
  let now = 0;
  const timed = appleClient(() => "token", { now: () => now,
    fetchImpl: async () => { throw new Error("must not request after deadline"); } });
  now = 240_001;
  await assert.rejects(timed.get("/v1/apps"), /REQUEST_BUDGET_EXCEEDED/);
});

test("CLI persists sanitized failure receipt and summary with a nonzero exit", () => {
  const directory = mkdtempSync(join(process.cwd(), ".testflight-receipt-test-"));
  try {
    const summary = join(directory, "summary.txt");
    const result = spawnSync(process.execPath, [resolve("scripts/testflight-receipt.mjs")], {
      cwd: directory, encoding: "utf8",
      env: { TESTFLIGHT_MARKETING_VERSION: "secret", TESTFLIGHT_BUILD_NUMBER: "1",
        APPLE_API_KEY_BASE64: "SECRET CREDENTIAL", GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, 1);
    const json = readFileSync(join(directory, "testflight-receipt.json"), "utf8");
    assert.equal(JSON.parse(json).error.code, "INVALID_MARKETING_VERSION");
    assert.doesNotMatch(json + readFileSync(summary, "utf8") + result.stdout + result.stderr, /SECRET CREDENTIAL|secret/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("workflow is main-only, manual, read-only, pinned and artifacts only sanitized JSON", () => {
  const workflow = readFileSync(new URL("../.github/workflows/testflight-receipt.yml", import.meta.url), "utf8");
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /: write|persist-credentials: true|continue-on-error/);
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
  assert.equal(actions.length, 3);
  for (const action of actions) {
    assert.match(action, /@[a-f0-9]{40}$/);
    assert.ok(release.includes(action), action);
  }
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: testflight-receipt\.json/);
  assert.match(workflow, /if-no-files-found: error/);
  for (const run of workflow.matchAll(/run: (.+)/g)) assert.doesNotMatch(run[1], /\$\{\{/);
  assert.match(workflow, /APPLE_API_KEY_SUBJECT: \$\{\{ vars.APPLE_API_KEY_SUBJECT \}\}/);
});
