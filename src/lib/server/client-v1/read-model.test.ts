// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// Every module this test touches (read-model.ts -> cave-config.ts et al.)
// resolves its on-disk paths from `process.env.COVEN_HOME`/`CAVE_PROJECTS_PATH_OVERRIDE`
// etc. at MODULE-LOAD time (top-level `const CONFIG_PATH = path.join(caveHome(), ...)`),
// not lazily per-call. Node caches ES modules by URL, so these env vars must
// be set BEFORE the very first `import("./read-model.ts")` anywhere in this
// file — including the pure-projection section below — or the cached module
// bakes in the wrong (real-homedir) paths for the rest of the file.
const previousEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
  CAVE_PERMISSION_CONFIG_PATH_OVERRIDE: process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE,
};
const scratchRoot = path.join(process.cwd(), `.rmrt-${process.pid}`);
const covenHome = path.join(scratchRoot, "h");
const projectRootA = path.join(scratchRoot, "proj-a");
const projectRootB = path.join(scratchRoot, "proj-b");
const configPath = path.join(covenHome, "cave", "config.json");
const projectsPath = path.join(scratchRoot, "projects.json");

process.env.COVEN_HOME = covenHome;
delete process.env.COVEN_SOCKET;
process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(scratchRoot, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(scratchRoot, "permission-config.json");

// ── Pure projection/pagination tests (no IO) ───────────────────────────────
{
  const {
    compareConversationSummaries,
    computeCanonicalSessionList: _unused1,
    decodeConversationCursor,
    encodeConversationCursor,
    paginateConversationSummaries,
    toClientConversationSummary,
    UnprojectableSessionRowError,
    decodeMessageCursor,
    encodeMessageCursor,
    paginateConversationMessages,
  } = await import("./read-model.ts");
  void _unused1;

  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "s1",
      project_root: "/home/me/app",
      harness: "claude",
      title: "Ship the release",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-08-04T17:00:00.000Z",
      updated_at: "2026-08-04T18:00:00.000Z",
      attention: { state: "none", since: null, reason: null },
      familiarId: "charm",
      pinned: false,
      ...overrides,
    };
  }

  const projects = [{ id: "proj-a", root: "/home/me/app" }];

  test("toClientConversationSummary projects only the stable client-safe fields", () => {
    const summary = toClientConversationSummary(row(), projects);
    assert.deepEqual(Object.keys(summary).sort(), [
      "archivedAt",
      "createdAt",
      "familiarId",
      "id",
      "pinned",
      "preview",
      "projectId",
      "projectRoot",
      "revision",
      "revisionTime",
      "status",
      "title",
      "updatedAt",
    ]);
    assert.equal(summary.id, "s1");
    assert.equal(summary.familiarId, "charm");
    assert.equal(summary.projectId, "proj-a");
    assert.equal(summary.projectRoot, "/home/me/app");
    assert.equal(summary.status, "idle");
    assert.equal(summary.revisionTime, Date.parse("2026-08-04T18:00:00.000Z"));
    assert.match(summary.revision, /^[0-9a-f]{64}$/);
  });

  test("status maps running/attention/failed correctly, running wins over attention", () => {
    assert.equal(toClientConversationSummary(row({ status: "running" }), projects).status, "running");
    assert.equal(
      toClientConversationSummary(
        row({ status: "running", attention: { state: "awaiting-human", since: "x", reason: "approval" } }),
        projects,
      ).status,
      "running",
      "a live run always reports running even with pending attention",
    );
    assert.equal(
      toClientConversationSummary(
        row({ attention: { state: "awaiting-human", since: "x", reason: "approval" } }),
        projects,
      ).status,
      "attention",
    );
    assert.equal(toClientConversationSummary(row({ status: "failed" }), projects).status, "failed");
    assert.equal(
      toClientConversationSummary(row({ status: "orphaned" }), projects).status,
      "failed",
      "orphaned uses the canonical sessionStatusTone bucketing, which treats it as failed",
    );
    assert.equal(
      toClientConversationSummary(
        row({ status: "error", attention: { state: "awaiting-human", since: "x", reason: "approval" } }),
        projects,
      ).status,
      "attention",
      "attention wins over a failed-tone status (running > attention > failed > idle)",
    );
  });

  test("toClientStatus uses the canonical sessionStatusTone bucketing for every open daemon/local status string", () => {
    for (const status of ["error", "killed", "orphaned", "failed"]) {
      assert.equal(
        toClientConversationSummary(row({ status }), projects).status,
        "failed",
        `status "${status}" must project to failed`,
      );
    }
    for (const status of ["starting", "working", "running"]) {
      assert.equal(
        toClientConversationSummary(row({ status }), projects).status,
        "running",
        `status "${status}" must project to running`,
      );
    }
    for (const status of ["completed", "complete", "done"]) {
      assert.equal(
        toClientConversationSummary(row({ status }), projects).status,
        "idle",
        `status "${status}" (canonical "done" tone) has no attention pending and no dedicated client bucket, so it projects to idle`,
      );
    }
    assert.equal(
      toClientConversationSummary(row({ status: "some-unrecognized-status" }), projects).status,
      "idle",
      "an unrecognized status falls through to idle, same as the canonical tone's own default",
    );
  });

  test("a session with no project root projects null projectId/projectRoot", () => {
    const summary = toClientConversationSummary(row({ project_root: "" }), projects);
    assert.equal(summary.projectId, null);
    assert.equal(summary.projectRoot, null);
  });

  test("an unresolvable project root keeps projectRoot but leaves projectId null", () => {
    const summary = toClientConversationSummary(row({ project_root: "/nowhere/known" }), projects);
    assert.equal(summary.projectId, null);
    assert.equal(summary.projectRoot, "/nowhere/known");
  });

  test("revision is deterministic for identical input and changes when any visible field changes", () => {
    const a = toClientConversationSummary(row(), projects);
    const b = toClientConversationSummary(row(), projects);
    assert.equal(a.revision, b.revision, "identical rows produce byte-identical revisions");
    const renamed = toClientConversationSummary(row({ title: "Ship it faster" }), projects);
    assert.notEqual(a.revision, renamed.revision, "a rename changes the revision");
    const pinned = toClientConversationSummary(row({ pinned: true }), projects);
    assert.notEqual(a.revision, pinned.revision, "pinning changes the revision");
  });

  test("an invalid updatedAt fails the projection instead of emitting NaN revisionTime", () => {
    assert.throws(
      () => toClientConversationSummary(row({ updated_at: "not-a-date" }), projects),
      UnprojectableSessionRowError,
    );
  });

  test("cursor encode/decode round-trips and rejects anything not produced by the encoder", () => {
    const cursor = { updatedAt: "2026-08-04T18:00:00.000Z", id: "s1" };
    const token = encodeConversationCursor(cursor);
    assert.deepEqual(decodeConversationCursor(token), cursor);

    for (const bad of [
      "not-base64url-json-at-all!!",
      Buffer.from("not json", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify(["only-one-field"]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify(["not-a-date", "s1"]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify(["2026-08-04T18:00:00.000Z", ""]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([1, "s1"]), "utf8").toString("base64url"),
    ]) {
      assert.equal(decodeConversationCursor(bad), null, `expected null for: ${bad}`);
    }
  });

  test("compareConversationSummaries sorts updatedAt desc, id asc on ties", () => {
    const older = toClientConversationSummary(row({ id: "a", updated_at: "2026-08-04T10:00:00.000Z" }), projects);
    const newer = toClientConversationSummary(row({ id: "b", updated_at: "2026-08-04T11:00:00.000Z" }), projects);
    const tieA = toClientConversationSummary(row({ id: "tie-a", updated_at: "2026-08-04T12:00:00.000Z" }), projects);
    const tieB = toClientConversationSummary(row({ id: "tie-b", updated_at: "2026-08-04T12:00:00.000Z" }), projects);
    const sorted = [older, newer, tieB, tieA].sort(compareConversationSummaries);
    assert.deepEqual(sorted.map((s) => s.id), ["tie-a", "tie-b", "b", "a"]);
  });

  test("paginateConversationSummaries pages without duplicates or skips across stable data", async () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      toClientConversationSummary(
        row({ id: `s${i}`, updated_at: `2026-08-04T1${i}:00:00.000Z` }),
        projects,
      ),
    );
    const page1 = paginateConversationSummaries(summaries, { cursor: null, limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.deepEqual(page1.items.map((s) => s.id), ["s4", "s3"]);
    assert.ok(page1.nextCursor);

    const cursor = decodeConversationCursor(page1.nextCursor);
    const page2 = paginateConversationSummaries(summaries, { cursor, limit: 2 });
    assert.deepEqual(page2.items.map((s) => s.id), ["s2", "s1"]);
    assert.ok(page2.nextCursor);

    const page3 = paginateConversationSummaries(summaries, {
      cursor: decodeConversationCursor(page2.nextCursor),
      limit: 2,
    });
    assert.deepEqual(page3.items.map((s) => s.id), ["s0"]);
    assert.equal(page3.nextCursor, null, "the last page reports no next cursor");

    const seen = [...page1.items, ...page2.items, ...page3.items].map((s) => s.id);
    assert.deepEqual(seen, ["s4", "s3", "s2", "s1", "s0"], "every row appears exactly once, in order");
  });

  test("paginateConversationSummaries with a cursor past the end returns an empty page", () => {
    const summaries = [toClientConversationSummary(row({ id: "only" }), projects)];
    const page = paginateConversationSummaries(summaries, {
      cursor: { updatedAt: summaries[0].updatedAt, id: summaries[0].id },
      limit: 10,
    });
    assert.deepEqual(page.items, []);
    assert.equal(page.nextCursor, null);
  });

  // ── Message-cursor pagination (Task 5 spec-review finding #4) ────────────
  function turn(id: string, text = `text-${id}`) {
    return { id, role: "user" as const, text, createdAt: "2026-08-04T17:00:00.000Z", attachments: [] };
  }

  test("message cursor encode/decode round-trips and rejects anything not produced by the encoder", () => {
    const cursor = { id: "t3" };
    const token = encodeMessageCursor(cursor);
    assert.deepEqual(decodeMessageCursor(token), cursor);

    for (const bad of [
      "not-base64url-json-at-all!!",
      Buffer.from("not json", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify(["t3", "extra"]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([""]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([4]), "utf8").toString("base64url"),
      // A structurally-plausible but hand-tampered token (never produced by
      // the encoder itself) must still be rejected by the round-trip check.
      Buffer.from(JSON.stringify(["t3-tampered"]), "utf8").toString("base64url") + "x",
      "a".repeat(600), // exceeds the bounded raw-token length
    ]) {
      assert.equal(decodeMessageCursor(bad), null, `expected null for: ${bad}`);
    }
  });

  test("paginateConversationMessages pages forward without duplicates or skips", () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(`t${i}`));
    const page1 = paginateConversationMessages(turns, { cursor: null, limit: 2 });
    assert.ok(page1.ok);
    if (!page1.ok) return;
    assert.deepEqual(page1.items.map((t) => t.id), ["t0", "t1"]);
    assert.ok(page1.nextCursor);

    const page2 = paginateConversationMessages(turns, { cursor: decodeMessageCursor(page1.nextCursor), limit: 2 });
    assert.ok(page2.ok);
    if (!page2.ok) return;
    assert.deepEqual(page2.items.map((t) => t.id), ["t2", "t3"]);
    assert.ok(page2.nextCursor);

    const page3 = paginateConversationMessages(turns, { cursor: decodeMessageCursor(page2.nextCursor), limit: 2 });
    assert.ok(page3.ok);
    if (!page3.ok) return;
    assert.deepEqual(page3.items.map((t) => t.id), ["t4"]);
    assert.equal(page3.nextCursor, null, "the last page reports no next cursor");

    const seen = [...page1.items, ...page2.items, ...page3.items].map((t) => t.id);
    assert.deepEqual(seen, ["t0", "t1", "t2", "t3", "t4"], "every message appears exactly once, in order");
  });

  test("paginateConversationMessages continues correctly when a turn is inserted EARLIER than the cursor's remembered position (id-based, never index-based)", () => {
    // Cursor issued against the ORIGINAL 3-turn array, pointing at "t1"
    // (originally index 1).
    const original = [turn("t0"), turn("t1"), turn("t2")];
    const page1 = paginateConversationMessages(original, { cursor: null, limit: 2 });
    assert.ok(page1.ok);
    if (!page1.ok) return;
    assert.deepEqual(page1.items.map((t) => t.id), ["t0", "t1"]);
    const cursor = decodeMessageCursor(page1.nextCursor!);

    // The active path is RE-RESOLVED and now has an extra turn ("t-early")
    // woven in ahead of "t1" (e.g. an orphan system turn ordered earlier by
    // createdAt) — "t1" is now at index 2, not the index the old {index,id}
    // scheme would have remembered.
    const shifted = [turn("t0"), turn("t-early"), turn("t1"), turn("t2")];
    const page2 = paginateConversationMessages(shifted, { cursor, limit: 10 });
    assert.ok(page2.ok, "an id-based cursor must still resolve after an earlier insertion");
    if (!page2.ok) return;
    // Continues correctly from just after "t1" in the NEW array — "t-early"
    // (which sits BEFORE "t1") is never re-served, and "t2" (after "t1") is.
    assert.deepEqual(page2.items.map((t) => t.id), ["t2"]);
  });

  test("paginateConversationMessages fails closed with stale_cursor when the cursor's turn is no longer on the active path (branch change)", () => {
    const turns = Array.from({ length: 3 }, (_, i) => turn(`t${i}`));
    // The cursor's turn ("t-not-really-there") no longer exists anywhere in
    // the CURRENT active-path array — e.g. the caller switched to a sibling
    // branch that never contained it. This must fail CLOSED with an
    // explicit, distinguishable result — never a silent empty page and
    // never a wrong/truncated position.
    const page = paginateConversationMessages(turns, { cursor: { id: "t-not-really-there" }, limit: 10 });
    assert.deepEqual(page, { ok: false, reason: "stale_cursor" });
  });

  test("paginateConversationMessages with a cursor past the end returns an empty (but still ok) page", () => {
    const turns = [turn("only")];
    const page = paginateConversationMessages(turns, { cursor: { id: "only" }, limit: 10 });
    assert.ok(page.ok);
    if (!page.ok) return;
    assert.deepEqual(page.items, []);
    assert.equal(page.nextCursor, null);
  });
}

// ── canonicalSessionListCacheKey: collision-free encoding (Task5 quality
// finding — cache key alias) — no IO ────────────────────────────────────────
{
  const { canonicalSessionListCacheKey } = await import("./read-model.ts");

  test('the unscoped (null) familiarId cache key never equals a familiar literally named "all"', () => {
    assert.notEqual(
      canonicalSessionListCacheKey(false, null, false),
      canonicalSessionListCacheKey(false, "all", false),
      'a valid familiar id of "all" must produce a DIFFERENT cache key than the unscoped (null) view — ' +
        "the old string-templated sentinel (`familiarId ?? \"all\"`) aliased the two, letting an " +
        '"all"-scoped read serve (or stale-populate) the fully unscoped payload',
    );
  });

  test("no valid-but-adversarial familiarId (including ones matching the OLD sentinel tokens) collides with any other (includeArchived, familiarId, collapse) tuple's key", () => {
    // Every id below is alphanumeric-plus-`_`/`-`, so every one is a VALID
    // familiar id under isValidFamiliarId — these are exactly the string
    // tokens the old `${includeArchived ? "archived" : "active"}:${familiarId
    // ?? "all"}:${collapse ? "collapse" : "full"}` template used as
    // delimiters/sentinels, chosen to prove the new encoding doesn't just
    // move the collision risk to a different token.
    const adversarialIds = ["all", "true", "false", "active", "archived", "collapse", "full"];
    const cases: Array<[boolean, string | null, boolean]> = [
      [false, null, false],
      [true, null, false],
      [false, null, true],
      [true, null, true],
      ...adversarialIds.flatMap((id): Array<[boolean, string | null, boolean]> => [
        [false, id, false],
        [true, id, false],
        [false, id, true],
        [true, id, true],
      ]),
    ];
    const seen = new Map<string, [boolean, string | null, boolean]>();
    for (const tuple of cases) {
      const key = canonicalSessionListCacheKey(...tuple);
      const prior = seen.get(key);
      assert.equal(
        prior,
        undefined,
        `cache key for tuple ${JSON.stringify(tuple)} collided with distinct tuple ${JSON.stringify(prior)} ` +
          `— both produced key ${key}`,
      );
      seen.set(key, tuple);
    }
    assert.equal(seen.size, cases.length, "every distinct input tuple must produce a distinct cache key");
  });
}

// ── computeClientSlashCommands: capability gating via injected dependencies
// (no real config IO) — Task 5 spec-review finding #3 ─────────────────────
{
  const { computeClientSlashCommands } = await import("./read-model.ts");
  const { SLASH_COMMANDS } = await import("@/lib/slash-commands");

  test("registry intersection: every returned command is both allowlisted AND a real SLASH_COMMANDS entry", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => "claude",
    });
    const registryNames = new Set(SLASH_COMMANDS.map((c) => c.name));
    const allowlist = new Set([
      "/help", "/clear", "/quit", "/new", "/model", "/skill", "/skills", "/prompt", "/prompts", "/image", "/auto",
    ]);
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.ok(registryNames.has(command.name), `${command.name} must exist in SLASH_COMMANDS`);
      assert.ok(allowlist.has(command.name), `${command.name} must be in the standalone-safe allowlist`);
    }
  });

  test("capability present: a harness with a known model catalog advertises /model", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => "claude",
    });
    assert.ok(commands.some((c) => c.name === "/model"));
  });

  test("capability absent: no resolvable harness omits /model but keeps the rest of the allowlist", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => null,
    });
    const names = commands.map((c) => c.name);
    assert.equal(names.includes("/model"), false);
    assert.ok(names.includes("/help"));
    assert.ok(names.includes("/skill"));
  });

  test("capability absent: an unknown/unregistered harness id omits /model (fails closed, not open)", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => "some-future-harness-cave-does-not-know",
    });
    assert.equal(commands.some((c) => c.name === "/model"), false);
  });

  test("capability degraded: a throwing capability resolver fails closed (no /model), never rejects", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => {
        throw new Error("simulated config read failure");
      },
    });
    const names = commands.map((c) => c.name);
    assert.equal(names.includes("/model"), false, "a resolver failure must never advertise the gated command");
    assert.ok(names.includes("/help"), "ungated allowlisted commands are unaffected by the failure");
  });

  test("deterministic: identical dependencies produce identical, order-stable output", async () => {
    const deps = { resolveDefaultHarness: async () => "claude" };
    const first = await computeClientSlashCommands(deps);
    const second = await computeClientSlashCommands(deps);
    assert.deepEqual(first, second);
  });

  test("no tokens/paths/local-config leak into the client shape regardless of capability outcome", async () => {
    const commands = await computeClientSlashCommands({
      resolveDefaultHarness: async () => "claude",
    });
    for (const command of commands) {
      assert.deepEqual(Object.keys(command).sort(), ["aliases", "argPlaceholder", "description", "hint", "name"]);
    }
  });
}

// ── IO-backed canonical merge / grant / degraded-mode behavior ─────────────
await test("computeCanonicalSessionList merges daemon+local exactly once, filters by familiar project grants, and retains local canonical chats in degraded mode", async () => {
let stopDaemon = async () => {};
let daemonBaseUrl = "http://127.0.0.1:9";

function daemonRow(id: string, projectRoot: string, updatedAt: string) {
  return {
    id,
    project_root: projectRoot,
    harness: "claude",
    title: id,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-04T17:00:00.000Z",
    updated_at: updatedAt,
  };
}

async function startDaemon(rows: unknown[], onRequest?: () => void) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/sessions") {
      onRequest?.();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object" && typeof address.port === "number");
  daemonBaseUrl = `http://127.0.0.1:${address.port}`;
  stopDaemon = async () =>
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function writeHubConfig(url: string) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: {},
      roles: [],
      addons: { github: false, code: false, browser: false, flow: false, journal: false, docs: false },
      marketplace: { installed: {} },
      multiHost: { mode: "hub", hubUrl: url, executorUrls: [] },
      omnigent: {
        enabled: false,
        baseUrl: "",
        defaultAgentId: "",
        defaultHostId: "",
        defaultWorkspace: "",
        hostMap: {},
        hostWorkspaceMap: {},
        exposeHostsInComposer: true,
      },
      remoteHosts: [],
    }),
  );
}

try {
  const {
    canonicalSessionListCacheKey,
    computeCanonicalSessionList,
    getCanonicalSessionList,
    getClientConversationDetail,
    listClientConversations,
    listClientFamiliars,
    searchClientConversations,
  } = await import("./read-model.ts");
  const { saveConversation, clearConversationListMetadataCache } = await import(
    "@/lib/cave-conversations"
  );
  const { invalidateSessionsListCache, sessionsListCache } = await import(
    "@/lib/server/sessions-list-cache"
  );
  const { grantProjectToFamiliar, revokeProjectFromFamiliar } = await import("@/lib/project-permissions");
  const { createProject } = await import("@/lib/cave-projects");

  async function resetFixtures() {
    await stopDaemon();
    stopDaemon = async () => {};
    await rm(scratchRoot, { recursive: true, force: true });
    await mkdir(covenHome, { recursive: true });
    await mkdir(projectRootA, { recursive: true });
    await mkdir(projectRootB, { recursive: true });
    clearConversationListMetadataCache();
    sessionsListCache.clear();
  }

  await resetFixtures();

  // The operator's unscoped list does not read project permissions at all:
  // permissions only affect a familiar-scoped view. A broken permissions
  // store must therefore leave the unscoped view usable, while the scoped
  // legacy route returns its normal controlled JSON failure instead of
  // leaking the filesystem exception.
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);
  const permissionsPath = process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!;
  await mkdir(permissionsPath, { recursive: true });
  const unscopedWithoutPermissions = await getCanonicalSessionList(false, null, false);
  assert.equal(unscopedWithoutPermissions.payload.ok, true);
  const legacyRoute = await import("../../../app/api/sessions/list/route.ts");
  const scopedStorageFailure = await legacyRoute.GET(
    new Request("http://127.0.0.1/api/sessions/list?familiarId=charm", {
      headers: { host: "127.0.0.1" },
    }),
  );
  assert.equal(scopedStorageFailure.status, 503);
  assert.deepEqual(await scopedStorageFailure.json(), {
    ok: false,
    error: "sessions are temporarily unavailable",
    sessions: [],
  });
  await resetFixtures();

  // ── Test: daemon + local conversations merge exactly once ───────────────
  await saveConversation({
    sessionId: "merge-both",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Local title",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:30:00.000Z",
    turns: [],
  });
  let daemonRequestCount = 0;
  await startDaemon(
    [daemonRow("merge-both", projectRootA, "2026-08-04T18:00:00.000Z")],
    () => {
      daemonRequestCount += 1;
    },
  );
  await writeHubConfig(daemonBaseUrl);

  const merged = await computeCanonicalSessionList(false, null, false);
  assert.equal(daemonRequestCount, 1, "the daemon is called exactly once per computation");
  assert.equal(merged.payload.ok, true);
  const mergedIds = merged.payload.sessions.map((s) => s.id);
  assert.deepEqual(
    mergedIds.filter((id) => id === "merge-both"),
    ["merge-both"],
    "a session known to both daemon and local conversations merges into exactly one row, never a duplicate",
  );

  // ── Test: healthy reads report degraded: false, never undefined ─────────
  const listHealthy = await listClientConversations({
    familiarId: null,
    projectId: null,
    includeArchived: false,
    cursor: null,
    limit: 50,
  });
  assert.equal(listHealthy.ok, true);
  assert.equal(listHealthy.ok && listHealthy.degraded, false, "a healthy list read reports degraded: false");

  const detailHealthy = await getClientConversationDetail("merge-both", { familiarId: null });
  assert.equal(detailHealthy.ok, true);
  assert.equal(
    detailHealthy.ok && detailHealthy.degraded,
    false,
    "a healthy detail read reports degraded: false",
  );

  const searchHealthy = await searchClientConversations("xyz-no-match", { familiarId: null, limit: 10 });
  assert.equal(searchHealthy.ok, true);
  assert.equal(
    searchHealthy.ok && searchHealthy.degraded,
    false,
    "a healthy search read reports degraded: false",
  );

  // ── Test: familiar project grants filter rows ────────────────────────────
  await resetFixtures();
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "proj-a", name: "A", root: projectRootA, createdAt: "now", updatedAt: "now" },
        { id: "proj-b", name: "B", root: projectRootB, createdAt: "now", updatedAt: "now" },
      ],
      visibilityGeneration: "read-model-projects",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "granted-fam", projectId: "proj-a", source: "human" });
  await saveConversation({
    sessionId: "grant-a",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "In granted project",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await saveConversation({
    sessionId: "grant-b",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: `local:${projectRootB}`,
    title: "In ungranted project",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await saveConversation({
    sessionId: "grant-rootless",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: "local:",
    title: "No project root",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);
  const scoped = await computeCanonicalSessionList(false, "granted-fam", false);
  assert.equal(scoped.payload.ok, true);
  const scopedIds = new Set(scoped.payload.sessions.map((s) => s.id));
  assert.ok(scopedIds.has("grant-a"), "a session in a granted project is visible");
  assert.equal(scopedIds.has("grant-b"), false, "a session in an ungranted (but known) project is dropped");
  assert.ok(scopedIds.has("grant-rootless"), "a rootless session always passes through");

  // ── Test: Task5 quality finding — cache key alias regression. A familiar
  // literally named "all" (valid under isValidFamiliarId) must never be
  // served the unscoped (null familiarId) cached payload. With the old
  // `familiarId ?? "all"` sentinel, `getCanonicalSessionList(x, null, y)` and
  // `getCanonicalSessionList(x, "all", y)` built the IDENTICAL cache key, so
  // once the unscoped view was warm, an "all"-scoped read (or a stale-window
  // poll) would silently reuse that FULLY UNSCOPED entry instead of
  // recomputing a properly project-scoped one — a permission leak. ─────────
  await resetFixtures();
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-alias", name: "Alias", root: projectRootA, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "read-model-alias-project",
    }),
  );
  await saveConversation({
    sessionId: "alias-check",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Only the unscoped/operator view may see this",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);

  // Warm the unscoped (familiarId: null) entry FIRST — this is exactly the
  // "unscoped cached payload" the finding is concerned with.
  const unscopedFirst = await getCanonicalSessionList(false, null, false);
  assert.equal(unscopedFirst.payload.ok, true);
  assert.ok(
    unscopedFirst.payload.ok && unscopedFirst.payload.sessions.some((s) => s.id === "alias-check"),
    "the unscoped operator view sees the session in a project no familiar has been granted",
  );

  // A subsequent "all"-scoped read for the SAME (includeArchived, collapse)
  // inputs must recompute under its OWN distinct key — "all" has no grant to
  // proj-alias, so it must NOT see "alias-check", and it must NOT reuse the
  // just-warmed unscoped entry.
  const allScoped = await getCanonicalSessionList(false, "all", false);
  assert.equal(allScoped.payload.ok, true);
  assert.equal(
    allScoped.payload.ok && allScoped.payload.sessions.some((s) => s.id === "alias-check"),
    false,
    'an "all"-scoped read must never be satisfied by the unscoped cached payload — it must recompute its own ' +
      "properly project-scoped view and correctly deny visibility into an ungranted project",
  );
  assert.notDeepEqual(
    allScoped.payload,
    unscopedFirst.payload,
    'the "all"-scoped and unscoped payloads must never be byte-identical here — one is fully unscoped, the ' +
      "other is scoped to zero granted projects",
  );

  // ── Test: degraded mode retains local canonical chats ────────────────────
  await resetFixtures();
  await saveConversation({
    sessionId: "degraded-local",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Survives daemon outage",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      {
        id: "t1",
        role: "user",
        text: "unique-degraded-search-phrase-zzzz",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: null,
      },
    ],
    activeLeafId: "t1",
  });
  // Daemon deliberately never started — multiHost hub points at an address
  // nothing listens on, so callDaemon fails and the degraded path runs.
  await writeHubConfig("http://127.0.0.1:9");
  const degraded = await computeCanonicalSessionList(false, null, false);
  assert.equal(degraded.payload.ok, true);
  assert.equal(degraded.payload.degraded, true);
  assert.ok(
    degraded.payload.sessions.some((s) => s.id === "degraded-local"),
    "a local canonical chat remains visible when the daemon is unreachable",
  );

  // ── Test: degraded state propagates through the three client-v1 read
  // orchestrators, as a plain boolean, never the canonical merge's raw
  // daemon error text (host, port, connection-refused message, etc.) ──────
  const listDegraded = await listClientConversations({
    familiarId: null,
    projectId: null,
    includeArchived: false,
    cursor: null,
    limit: 50,
  });
  assert.equal(listDegraded.ok, true);
  assert.equal(listDegraded.ok && listDegraded.degraded, true, "a degraded list read reports degraded: true");
  assert.ok(
    listDegraded.ok && listDegraded.page.items.some((item) => item.id === "degraded-local"),
    "the local-only chat is still returned while degraded",
  );
  const listDegradedText = JSON.stringify(listDegraded);
  assert.equal(/ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(listDegradedText), false,
    "no raw daemon error text leaks through the list result");

  const detailDegraded = await getClientConversationDetail("degraded-local", { familiarId: null });
  assert.equal(detailDegraded.ok, true);
  assert.equal(
    detailDegraded.ok && detailDegraded.degraded,
    true,
    "a degraded detail read for a locally-visible conversation reports degraded: true",
  );
  const detailDegradedText = JSON.stringify(detailDegraded);
  assert.equal(/ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(detailDegradedText), false,
    "no raw daemon error text leaks through the detail result");

  const detailDegradedMissing = await getClientConversationDetail("no-such-session", { familiarId: null });
  assert.equal(detailDegradedMissing.ok, false);
  assert.equal(!detailDegradedMissing.ok && detailDegradedMissing.reason, "not_found");
  assert.equal(
    !detailDegradedMissing.ok && detailDegradedMissing.reason === "not_found" && detailDegradedMissing.degraded,
    true,
    "a 404 under a degraded merge still carries the degraded signal so the ambiguity is visible",
  );

  const searchDegraded = await searchClientConversations("unique-degraded-search-phrase-zzzz", {
    familiarId: null,
    limit: 10,
  });
  assert.equal(searchDegraded.ok, true);
  assert.equal(
    searchDegraded.ok && searchDegraded.degraded,
    true,
    "a degraded search read reports degraded: true",
  );
  assert.ok(
    searchDegraded.ok && searchDegraded.hits.some((hit) => hit.sessionId === "degraded-local"),
    "a locally-visible hit still surfaces while degraded",
  );
  const searchDegradedText = JSON.stringify(searchDegraded);
  assert.equal(/ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(searchDegradedText), false,
    "no raw daemon error text leaks through the search result");

  // ── Test: familiar ownership isolation (spec-review finding #1) — a
  // rootless chat or a chat in a project BOTH familiars are granted must
  // never leak across familiars; ownership is derived from the row's own
  // canonical `familiarId`, never trusted from the caller's query. ────────
  await resetFixtures();
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-shared", name: "Shared", root: projectRootA, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "read-model-shared-project",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "fam-a", projectId: "proj-shared", source: "human" });
  await grantProjectToFamiliar({ familiarId: "fam-b", projectId: "proj-shared", source: "human" });
  await saveConversation({
    sessionId: "shared-a",
    familiarId: "fam-a",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Fam A in shared project",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await saveConversation({
    sessionId: "shared-b",
    familiarId: "fam-b",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Fam B in shared project",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await saveConversation({
    sessionId: "rootless-a",
    familiarId: "fam-a",
    harness: "claude",
    runtime: "local:",
    title: "Fam A rootless",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [{ id: "t1", role: "user", text: "cross-familiar-isolation-marker", createdAt: "2026-08-04T17:00:00.000Z", parentId: null }],
    activeLeafId: "t1",
  });
  await saveConversation({
    sessionId: "rootless-b",
    familiarId: "fam-b",
    harness: "claude",
    runtime: "local:",
    title: "Fam B rootless",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [{ id: "t1", role: "user", text: "cross-familiar-isolation-marker", createdAt: "2026-08-04T17:00:00.000Z", parentId: null }],
    activeLeafId: "t1",
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);

  const isolatedList = await listClientConversations({
    familiarId: "fam-a",
    projectId: null,
    includeArchived: false,
    cursor: null,
    limit: 50,
  });
  assert.equal(isolatedList.ok, true);
  const isolatedListIds = isolatedList.ok ? isolatedList.page.items.map((item) => item.id) : [];
  assert.ok(isolatedListIds.includes("shared-a"), "fam-a sees its own conversation in the shared project");
  assert.ok(isolatedListIds.includes("rootless-a"), "fam-a sees its own rootless conversation");
  assert.equal(
    isolatedListIds.includes("shared-b"),
    false,
    "fam-a must never see fam-b's conversation in a project they both share access to",
  );
  assert.equal(
    isolatedListIds.includes("rootless-b"),
    false,
    "fam-a must never see fam-b's rootless conversation",
  );

  const crossFamiliarSharedDetail = await getClientConversationDetail("shared-b", { familiarId: "fam-a" });
  assert.equal(
    crossFamiliarSharedDetail.ok,
    false,
    "fam-a's detail read for fam-b's shared-project conversation must 404, not merely be scoped by project grant",
  );
  assert.equal(!crossFamiliarSharedDetail.ok && crossFamiliarSharedDetail.reason, "not_found");

  const crossFamiliarRootlessDetail = await getClientConversationDetail("rootless-b", { familiarId: "fam-a" });
  assert.equal(
    crossFamiliarRootlessDetail.ok,
    false,
    "fam-a's detail read for fam-b's rootless conversation must 404 — a rootless chat is never implicitly shared",
  );
  assert.equal(!crossFamiliarRootlessDetail.ok && crossFamiliarRootlessDetail.reason, "not_found");

  // fam-a CAN still read its own conversations under the same query shape.
  const ownDetail = await getClientConversationDetail("shared-a", { familiarId: "fam-a" });
  assert.equal(ownDetail.ok, true, "fam-a can still read its own conversation in the shared project");

  const crossFamiliarSearch = await searchClientConversations("cross-familiar-isolation-marker", {
    familiarId: "fam-a",
    limit: 10,
  });
  assert.equal(crossFamiliarSearch.ok, true);
  const crossFamiliarSearchIds = crossFamiliarSearch.ok ? crossFamiliarSearch.hits.map((hit) => hit.sessionId) : [];
  assert.deepEqual(
    crossFamiliarSearchIds,
    ["rootless-a"],
    "search must exclude fam-b's rootless conversation even though it matches the same query",
  );

  // ── Test: message-content preview derivation (spec-review finding #3) —
  // never a duplicate of the title, derived from the ACTIVE path's last
  // turn, bounded/plain-text, with a safe empty default for no turns. ─────
  await resetFixtures();
  await saveConversation({
    sessionId: "preview-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "A Title That Must Not Reappear As The Preview",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "t1", role: "user", text: "first message", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      {
        id: "t2",
        role: "assistant",
        text: "  the   real\nlast   message   with\nextra   whitespace  ",
        createdAt: "2026-08-04T17:00:01.000Z",
        parentId: "t1",
      },
    ],
    activeLeafId: "t2",
  });
  await saveConversation({
    sessionId: "preview-empty",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Empty conversation",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);

  const previewDetail = await getClientConversationDetail("preview-conv", { familiarId: null });
  assert.equal(previewDetail.ok, true);
  assert.equal(
    previewDetail.ok ? previewDetail.detail.preview : undefined,
    "the real last message with extra whitespace",
    "the preview is derived from the active path's last message, whitespace-collapsed, never the title",
  );
  assert.notEqual(
    previewDetail.ok ? previewDetail.detail.preview : undefined,
    previewDetail.ok ? previewDetail.detail.title : undefined,
    "the preview must never duplicate the title",
  );

  const previewEmptyDetail = await getClientConversationDetail("preview-empty", { familiarId: null });
  assert.equal(previewEmptyDetail.ok, true);
  assert.equal(
    previewEmptyDetail.ok ? previewEmptyDetail.detail.preview : undefined,
    "",
    "an empty conversation gets the safe empty default preview",
  );

  const previewList = await listClientConversations({
    familiarId: null,
    projectId: null,
    includeArchived: false,
    cursor: null,
    limit: 50,
  });
  assert.equal(previewList.ok, true);
  const previewListItem = previewList.ok
    ? previewList.page.items.find((item) => item.id === "preview-conv")
    : undefined;
  assert.equal(
    previewListItem?.preview,
    "the real last message with extra whitespace",
    "the list orchestrator also threads the real message preview through, not just the detail read",
  );

  // ── Test: search ownership/limit ordering — >200 inaccessible hits must
  // never crowd out an accessible hit (spec-review finding #5) ────────────
  await resetFixtures();
  for (let i = 0; i < 210; i++) {
    await saveConversation({
      sessionId: `unauth-${i}`,
      familiarId: "other-fam",
      harness: "claude",
      runtime: "local:",
      title: `Unauthorized ${i}`,
      // Every unauthorized hit is strictly MORE recently updated than the
      // one accessible hit below, so a naive small overfetch cap (the old
      // 200) would truncate the accessible hit away before the visibility
      // filter ever saw it.
      createdAt: "2026-08-04T17:00:00.000Z",
      updatedAt: `2026-08-05T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
      turns: [
        {
          id: "t1",
          role: "user",
          text: "crowding-regression-marker",
          createdAt: "2026-08-04T17:00:00.000Z",
          parentId: null,
        },
      ],
      activeLeafId: "t1",
    });
  }
  await saveConversation({
    sessionId: "accessible-old",
    familiarId: "search-owner",
    harness: "claude",
    runtime: "local:",
    title: "The one accessible hit",
    createdAt: "2026-08-04T17:00:00.000Z",
    // Deliberately OLDER than every unauthorized hit above, so it would sort
    // dead last pre-filter.
    updatedAt: "2026-08-04T00:00:00.000Z",
    turns: [
      {
        id: "t1",
        role: "user",
        text: "crowding-regression-marker",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: null,
      },
    ],
    activeLeafId: "t1",
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);

  const crowdingSearch = await searchClientConversations("crowding-regression-marker", {
    familiarId: "search-owner",
    limit: 10,
  });
  assert.equal(crowdingSearch.ok, true);
  assert.ok(
    crowdingSearch.ok && crowdingSearch.hits.some((hit) => hit.sessionId === "accessible-old"),
    ">200 more-recent unauthorized hits must never crowd out the one accessible (older) hit",
  );
  assert.ok(
    crowdingSearch.ok && crowdingSearch.hits.every((hit) => hit.sessionId === "accessible-old"),
    "no unauthorized hit ever surfaces in the accessible caller's results",
  );
  // Explicit client search DTO (finding #5) — never the internal canonical
  // `ConversationSearchHit` shape verbatim.
  if (crowdingSearch.ok) {
    for (const hit of crowdingSearch.hits) {
      assert.deepEqual(Object.keys(hit).sort(), ["matchCount", "sessionId", "snippet", "title"]);
    }
  }

  // ── Test: generic client boundary errors (Task5 gap #4) — an uncaught
  // exception from the canonical config/state layer must never propagate
  // raw path/hostname/stack text past `listClientConversations`/
  // `listClientFamiliars`. Reproduced with a REAL fs error (not a mock):
  // making `config.json` a directory forces `loadConfigUnlocked`'s
  // `readFile` to throw a genuine `EISDIR` whose `.message` embeds the real
  // absolute path — exactly the secret-bearing exception text this
  // boundary must swallow.
  await resetFixtures();
  await mkdir(configPath, { recursive: true }); // config.json is now a directory, not a file

  let eisdirConfirmed = false;
  try {
    await readFile(configPath, "utf8");
  } catch (error) {
    eisdirConfirmed = (error as NodeJS.ErrnoException).code === "EISDIR";
  }
  assert.ok(eisdirConfirmed, "precondition: config.json as a directory must genuinely throw EISDIR on read");

  const secretLeakList = await listClientConversations({
    familiarId: null,
    projectId: null,
    includeArchived: false,
    cursor: null,
    limit: 50,
  });
  assert.equal(secretLeakList.ok, false, "an uncaught config-load exception must fail closed, never throw");
  if (!secretLeakList.ok) {
    assert.equal(secretLeakList.status, 503);
    assert.doesNotMatch(secretLeakList.error, /EISDIR|config\.json|\.rmrt-|\//, "the raw fs error/path must never surface");
  }

  const secretLeakFamiliars = await listClientFamiliars({ projectId: null });
  assert.equal(secretLeakFamiliars.ok, false, "an uncaught config-load exception must fail closed, never throw");
  if (!secretLeakFamiliars.ok) {
    assert.equal(secretLeakFamiliars.status, 503);
    assert.doesNotMatch(
      secretLeakFamiliars.error,
      /EISDIR|config\.json|\.rmrt-|\//,
      "the raw fs error/path must never surface",
    );
  }

  await rm(configPath, { recursive: true, force: true });

  // ── Test: active-path fail-closed (Task5 gap #2) — a conversation whose
  // stored turns are non-empty but whose branch/leaf metadata can never
  // resolve to one provable active path must 503 as `internal_error`, never
  // present as an empty (or unfiltered) conversation.
  await resetFixtures();
  await saveConversation({
    sessionId: "ambiguous-active-path",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Ambiguous branch",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:30:00.000Z",
    // Two roots (no shared parent), no `activeLeafId` recorded — more than
    // one leaf is resolvable and nothing disambiguates which is active.
    turns: [
      { id: "root-a", role: "user", text: "branch a", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "root-b", role: "user", text: "branch b", createdAt: "2026-08-04T17:01:00.000Z", parentId: null },
    ],
    activeLeafId: null,
  });
  await startDaemon([]);
  await writeHubConfig(daemonBaseUrl);
  const ambiguousDetail = await getClientConversationDetail("ambiguous-active-path", { familiarId: null });
  assert.deepEqual(
    ambiguousDetail,
    { ok: false, reason: "internal_error" },
    "an ambiguous/invalid active path must fail closed to internal_error, never expose turns:[] or every branch",
  );

  // ── Test: Task5 quality finding — client list/detail/search read the
  // canonical session list through `getCanonicalSessionList`, the SAME
  // cached accessor (over the SAME `sessionsListCache` singleton, keyed by
  // the SAME `(includeArchived, familiarId, collapseFamiliarWorkspace)`
  // scheme) the legacy `/api/sessions/list` route uses. Concurrent callers
  // for the same canonical key share one in-flight compute, the legacy
  // route and the client accessor share one cache entry, differing keys
  // never cross-contaminate, and `invalidateSessionsListCache()` busts
  // every one of them. No artificial timing/sleeps — dedupe and cache-hit
  // behavior are asserted purely from daemon call counts, so there is
  // nothing here for real clock drift to make flaky. ────────────────────
  await resetFixtures();
  await saveConversation({
    sessionId: "cache-shared",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRootA}`,
    title: "Cache shared",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      {
        id: "cache-shared-t1",
        role: "user",
        text: "cache-sharing-search-marker",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: null,
      },
    ],
    activeLeafId: "cache-shared-t1",
  });
  let cacheDaemonRequests = 0;
  await startDaemon([], () => {
    cacheDaemonRequests += 1;
  });
  await writeHubConfig(daemonBaseUrl);

  // Concurrent list/detail/search for the SAME canonical key
  // (includeArchived: true, familiarId: null, collapse: false — list's
  // includeArchived is threaded through explicitly here so its key matches
  // detail/search's hardcoded `true`) dedupe to exactly one in-flight
  // compute, never three separate daemon round-trips.
  const [concurrentList, concurrentDetail, concurrentSearch] = await Promise.all([
    listClientConversations({
      familiarId: null,
      projectId: null,
      includeArchived: true,
      cursor: null,
      limit: 50,
    }),
    getClientConversationDetail("cache-shared", { familiarId: null }),
    searchClientConversations("cache-sharing-search-marker", { familiarId: null, limit: 10 }),
  ]);
  assert.equal(
    cacheDaemonRequests,
    1,
    "concurrent list/detail/search reads for the same canonical key share one in-flight compute",
  );
  assert.equal(concurrentList.ok, true);
  assert.equal(concurrentDetail.ok, true);
  assert.equal(concurrentSearch.ok, true);

  // Having just warmed the (includeArchived: true, familiarId: null,
  // collapse: false) key above, a direct getCanonicalSessionList call for the
  // SAME inputs is served from cache — no additional daemon round-trip.
  const sharedEntry = await getCanonicalSessionList(true, null, false);
  assert.equal(
    cacheDaemonRequests,
    1,
    "getCanonicalSessionList for an already-warm key is served from cache, not recomputed",
  );
  assert.equal(sharedEntry.payload.ok, true);

  // The legacy route, invoked with query params that resolve to that SAME
  // key, reads that identical cached entry — proof the route and the
  // client-v1 accessor share one cache, not two independently-warmed ones.
  const routeModule = await import("../../../app/api/sessions/list/route.ts");
  const routeResponse = await routeModule.GET(
    new Request("http://127.0.0.1/api/sessions/list?includeArchived=1", {
      headers: { host: "127.0.0.1" },
    }),
  );
  const routeBody = await routeResponse.json();
  assert.equal(
    cacheDaemonRequests,
    1,
    "the legacy route resolving to the same cache key never triggers its own daemon round-trip",
  );
  assert.deepEqual(
    routeBody,
    sharedEntry.payload,
    "the legacy route and the client accessor return byte-identical payloads from the SAME shared cache entry",
  );

  // Differing familiar/archived/collapse keys never cross-contaminate: each
  // distinct key computes exactly once, independently of the others.
  const beforeKeyVariants = cacheDaemonRequests;
  await getCanonicalSessionList(false, null, false); // includeArchived: false — new key
  await getCanonicalSessionList(true, "charm", false); // familiarId: "charm" — new key
  await getCanonicalSessionList(true, null, true); // collapse: true — new key
  assert.equal(
    cacheDaemonRequests,
    beforeKeyVariants + 3,
    "each distinct (includeArchived, familiarId, collapse) key computes independently of the others",
  );
  // Re-reading every key (including the original) now serves entirely from
  // cache — no additional daemon round-trips, and no key stole another's
  // cached entry.
  await getCanonicalSessionList(true, null, false);
  await getCanonicalSessionList(false, null, false);
  await getCanonicalSessionList(true, "charm", false);
  await getCanonicalSessionList(true, null, true);
  assert.equal(
    cacheDaemonRequests,
    beforeKeyVariants + 3,
    "re-reading every already-warm key serves entirely from cache without cross-contaminating another key's entry",
  );

  // invalidateSessionsListCache() — the SAME hook conversation/session
  // mutators call after a write — busts EVERY one of these cached views,
  // forcing the next read of any of them to recompute.
  invalidateSessionsListCache();
  const beforeInvalidate = cacheDaemonRequests;
  await getCanonicalSessionList(true, null, false);
  assert.equal(
    cacheDaemonRequests,
    beforeInvalidate + 1,
    "invalidateSessionsListCache() forces the next getCanonicalSessionList read to recompute instead of serving the stale entry",
  );
  await getCanonicalSessionList(false, null, false);
  await getCanonicalSessionList(true, "charm", false);
  await getCanonicalSessionList(true, null, true);
  assert.equal(
    cacheDaemonRequests,
    beforeInvalidate + 4,
    "invalidation busts every cached view (not just one key) — every distinct key recomputes exactly once after a single invalidate",
  );

  // ── Test: cross-process cache-visibility generations (cave-client-v1
  // Task 5/7 followup #3) — a project-permission mutation OR a
  // project-registry mutation must select a brand-new cache key for the
  // SAME (includeArchived, familiarId, collapse) tuple on the very next
  // `getCanonicalSessionList` call, WITHOUT this process ever calling
  // `invalidateSessionsListCache()` for it. `grantProjectToFamiliar`/
  // `revokeProjectFromFamiliar`/`createProject` all run in-process here
  // (there is no real second OS process in a unit test), but they mutate
  // the exact same durable JSON stores (`project-permissions.json`,
  // `projects.json`) another process's write would — the mechanism under
  // test is entirely "does the NEXT read pick up the persisted generation
  // nonce", not "is this call itself somehow cross-process". A genuinely
  // separate process racing this lock is proven by
  // `project-authorization-lock.test.ts` / `familiar-lifecycle-lock.test.ts`'s
  // subprocess tests; this test proves the READ SIDE of visibility: no
  // local invalidation call is needed for a revocation/registry change to
  // stop being served stale. ─────────────────────────────────────────────
  {
    // Initialize a valid permissions store before warming the operator view.
    // The following raw nonce edits model a different process's completed
    // write without invoking this process's explicit cache invalidator.
    await grantProjectToFamiliar({
      familiarId: "cross-process-visibility-fam",
      projectId: "cross-process-visibility-project-placeholder",
      source: "human",
      access: "read",
    });

    // Warm the (includeArchived: true, familiarId: null, collapse: false)
    // key explicitly so its daemon-request count is a known baseline.
    await getCanonicalSessionList(true, null, false);
    const warmed = cacheDaemonRequests;
    await getCanonicalSessionList(true, null, false);
    assert.equal(cacheDaemonRequests, warmed, "the key is served from cache before any mutation");

    // A project-PERMISSION mutation does not affect the unscoped operator
    // view, so that view must remain cacheable without opening or keying on
    // the permissions store.
    const permissionFilePath = process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!;
    const rotatePermissionsGeneration = async (generation: string) => {
      const permissions = JSON.parse(await readFile(permissionFilePath, "utf8"));
      permissions.visibilityGeneration = generation;
      await writeFile(permissionFilePath, JSON.stringify(permissions));
    };
    await rotatePermissionsGeneration("cross-process-permissions-grant");
    await getCanonicalSessionList(true, null, false);
    assert.equal(
      cacheDaemonRequests,
      warmed,
      "an unscoped operator read ignores project-permission generation changes",
    );
    await getCanonicalSessionList(true, null, false);
    assert.equal(cacheDaemonRequests, warmed, "the unchanged unscoped key remains cacheable");

    const afterGrant = cacheDaemonRequests;
    // Revocation likewise leaves the unscoped view's key untouched.
    await rotatePermissionsGeneration("cross-process-permissions-revoke");
    await getCanonicalSessionList(true, null, false);
    assert.equal(
      cacheDaemonRequests,
      afterGrant,
      "an unscoped operator read also ignores permission revocations",
    );

    const afterRevoke = cacheDaemonRequests;
    // A project-REGISTRY mutation (createProject) is the OTHER durable
    // store this cache key's visibility generations cover — it must force
    // a recompute independently of the permissions-side generation.
    await createProject({ name: "Cross-process visibility project", root: path.join(scratchRoot, "cross-process-visibility-root") });
    await getCanonicalSessionList(true, null, false);
    assert.equal(
      cacheDaemonRequests,
      afterRevoke + 1,
      "a project-registry mutation (createProject) must also force the very next read to recompute, independent of the permissions generation",
    );
    await getCanonicalSessionList(true, null, false);
    assert.equal(cacheDaemonRequests, afterRevoke + 1, "the post-registry-mutation generation's key is itself served from cache afterward");

    // A DIFFERENT (includeArchived, familiarId, collapse) tuple that was
    // never invalidated independently observes the SAME generation change —
    // proving the generation is folded into every canonical key, not just
    // the one this test happened to poll.
    const beforeOtherKey = cacheDaemonRequests;
    await createProject({ name: "Second cross-process visibility project", root: path.join(scratchRoot, "cross-process-visibility-root-2") });
    await getCanonicalSessionList(false, "charm", true); // a distinct, previously-warmed tuple from earlier in this test
    assert.equal(
      cacheDaemonRequests,
      beforeOtherKey + 1,
      "every canonical tuple's key includes the same visibility generations, so a registry mutation invalidates ALL of them, not just the one tuple under direct test",
    );
  }

  sessionsListCache.clear(); // leave no test entry behind for later test files
} finally {
  await stopDaemon();
  if (previousEnv.COVEN_HOME === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousEnv.COVEN_HOME;
  if (previousEnv.COVEN_SOCKET === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = previousEnv.COVEN_SOCKET;
  for (const key of ["CAVE_PROJECTS_PATH_OVERRIDE", "CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE", "CAVE_PERMISSION_CONFIG_PATH_OVERRIDE"] as const) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key]!;
  }
  await rm(scratchRoot, { recursive: true, force: true });
}
});

console.log("client-v1 read-model.test.ts: ok");
