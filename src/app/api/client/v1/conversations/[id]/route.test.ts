// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import crypto from "node:crypto";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-conversation-detail-"));
const covenHome = path.join(workdir, "home");
await mkdir(covenHome, { recursive: true });

process.env.COVEN_HOME = covenHome;
delete process.env.COVEN_SOCKET;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = path.join(covenHome, "cave", "chat-attachments");
process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = path.join(covenHome, "cave", "client-v1-attachments.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(workdir, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(workdir, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(workdir, "permission-config.json");

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { GET, PATCH, DELETE } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { saveConversation, loadConversation, clearConversationListMetadataCache, CONV_DIR } = await import(
  "@/lib/cave-conversations.ts"
);
const { sessionsListCache } = await import("@/lib/server/sessions-list-cache.ts");
const { loadState } = await import("@/lib/cave-config.ts");
const { encodeMessageCursor } = await import("@/lib/server/client-v1/read-model.ts");
const {
  parseClientAttachmentForm,
  resolveAndBindClientAttachments,
  saveUploadedClientAttachments,
} = await import("@/lib/server/client-v1/attachment-service.ts");

let stopDaemon = async () => {};
const attachmentRoot = process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR!;
const attachmentIndexPath = process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH!;
const attachmentOwner = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const attachmentBytes = Buffer.from("conversation route bound attachment\n", "utf8");

after(async () => {
  await stopDaemon();
  await rm(workdir, { recursive: true, force: true });
});

async function startDaemon(rows: unknown[] = []) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/sessions") {
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
  stopDaemon = async () =>
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return `http://127.0.0.1:${address.port}`;
}

async function writeHubConfig(url: string, familiars: Record<string, unknown> = {}) {
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(
    path.join(covenHome, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars,
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

function requestWith(id: string, opts: { marker?: string | null; bearer?: string | null; query?: string } = {}) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", `Bearer ${opts.bearer}`);
  const url = `http://127.0.0.1/api/client/v1/conversations/${encodeURIComponent(id)}${opts.query ?? ""}`;
  return { req: new Request(url, { headers }), ctx: { params: Promise.resolve({ id }) } };
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
  const { token } = await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

async function resetFixtures() {
  await stopDaemon();
  stopDaemon = async () => {};
  clearConversationListMetadataCache();
  sessionsListCache.clear();
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(attachmentIndexPath, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3`, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3-shm`, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3-wal`, { force: true });
  await rm(attachmentRoot, { recursive: true, force: true });
  await mkdir(attachmentRoot, { recursive: true });
}

function mutationRequestWith(
  id: string,
  opts: {
    marker?: string | null;
    bearer?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    body?: unknown;
    rawBody?: string;
    method?: string;
  } = {},
) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) {
    headers.set("authorization", "Bearer " + opts.bearer);
  }
  if (opts.idempotencyKey !== null) headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  headers.set("content-type", "application/json");
  const url = `http://127.0.0.1/api/client/v1/conversations/${encodeURIComponent(id)}${opts.query ?? ""}`;
  const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  // `Request` rejects a body on GET/HEAD; the actual HTTP method here is
  // otherwise irrelevant since these tests call `PATCH`/`DELETE` directly as
  // plain functions rather than going through Next's method-based routing.
  const method = opts.method ?? (body !== undefined ? "PATCH" : "DELETE");
  return { req: new Request(url, { method, headers, body }), ctx: { params: Promise.resolve({ id }) } };
}

async function seedConversation(sessionId: string, overrides: Partial<Record<string, unknown>> = {}) {
  await saveConversation({
    sessionId,
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Original title",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
    ...overrides,
  });
}

async function seedBoundAttachment(conversationId: string) {
  const form = new FormData();
  form.append("files", new File([attachmentBytes], "notes.txt", { type: "text/plain" }));
  const parsed = await parseClientAttachmentForm(form);
  const [uploaded] = await saveUploadedClientAttachments(parsed, attachmentOwner, crypto.randomUUID(), 10);
  await resolveAndBindClientAttachments([uploaded.id], attachmentOwner, conversationId);
  return uploaded;
}

test("an absent internal marker returns 403 unauthorized before params are read", async () => {
  resetRateLimitsForTest();
  const { req, ctx } = requestWith("some-id", { marker: null });
  const response = await GET(req, ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("a verified marker with no bearer returns 401 unauthorized", async () => {
  resetRateLimitsForTest();
  const { req, ctx } = requestWith("some-id");
  const response = await GET(req, ctx);
  assert.equal(response.status, 401);
});

test("a credential missing chat:read is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:write"]);
  const { req, ctx } = requestWith("some-id", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("an unsafe id (path traversal shape) 404s rather than touching the filesystem", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const { req, ctx } = requestWith("../../etc/passwd", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("an unknown conversation id 404s", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  const { req, ctx } = requestWith("does-not-exist", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("returns the full conversation detail, with bounded/paginated messages and an ETag equal to its revision", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "detail-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Detail me",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "t1", role: "user", text: "hello", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t2", role: "assistant", text: "hi there", createdAt: "2026-08-04T17:00:01.000Z", parentId: "t1" },
    ],
    activeLeafId: "t2",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  const { req, ctx } = requestWith("detail-conv", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.conversation.id, "detail-conv");
  assert.equal(body.conversation.turns, undefined, "the raw unbounded turns array never crosses the wire");
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.messages[0], {
    id: "t1",
    role: "user",
    text: "hello",
    createdAt: "2026-08-04T17:00:00.000Z",
    attachments: [],
  });
  assert.equal(body.nextCursor, null, "a conversation shorter than the default page size has no next cursor");
  assert.equal(response.headers.get("etag"), body.conversation.revision);
  assert.equal(body.degraded, false, "a healthy detail response reports degraded: false");
});

test("paginates messages with a validated limit and an opaque cursor, and rejects a malformed one", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "paged-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Paged",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "t1", role: "user", text: "one", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t2", role: "assistant", text: "two", createdAt: "2026-08-04T17:00:01.000Z", parentId: "t1" },
      { id: "t3", role: "user", text: "three", createdAt: "2026-08-04T17:00:02.000Z", parentId: "t2" },
    ],
    activeLeafId: "t3",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();

  const page1Req = requestWith("paged-conv", { bearer: token, query: "?limit=2" });
  const page1 = await GET(page1Req.req, page1Req.ctx);
  assert.equal(page1.status, 200, await page1.clone().text());
  const page1Body = await page1.json();
  assert.deepEqual(page1Body.messages.map((m) => m.id), ["t1", "t2"]);
  assert.ok(page1Body.nextCursor);

  const page2Req = requestWith("paged-conv", {
    bearer: token,
    query: `?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
  });
  const page2 = await GET(page2Req.req, page2Req.ctx);
  const page2Body = await page2.json();
  assert.deepEqual(page2Body.messages.map((m) => m.id), ["t3"]);
  assert.equal(page2Body.nextCursor, null, "the last page has no next cursor");

  const badCursorReq = requestWith("paged-conv", { bearer: token, query: "?cursor=not-a-valid-cursor" });
  const badCursor = await GET(badCursorReq.req, badCursorReq.ctx);
  assert.equal(badCursor.status, 400);
  assert.equal((await badCursor.json()).error.code, "invalid_request");

  for (const limit of ["0", "-1", "abc", "201", "1.5"]) {
    const badLimitReq = requestWith("paged-conv", { bearer: token, query: `?limit=${limit}` });
    const badLimit = await GET(badLimitReq.req, badLimitReq.ctx);
    assert.equal(badLimit.status, 400, `limit=${limit} should be rejected`);
  }
});

test("a stable, ID-based cursor continues correctly after an earlier turn is inserted (never index-based)", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "shifted-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Shifted",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "t1", role: "user", text: "one", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t2", role: "assistant", text: "two", createdAt: "2026-08-04T17:00:01.000Z", parentId: "t1" },
    ],
    activeLeafId: "t2",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();

  const page1Req = requestWith("shifted-conv", { bearer: token, query: "?limit=1" });
  const page1 = await GET(page1Req.req, page1Req.ctx);
  const page1Body = await page1.json();
  assert.deepEqual(page1Body.messages.map((m) => m.id), ["t1"]);
  const cursor = page1Body.nextCursor;
  assert.ok(cursor);

  // Simulate an orphan system turn woven in EARLIER than "t1" by
  // `resolveActivePath` (ordered by createdAt ahead of the cursor's turn) —
  // append it with an earlier createdAt so the active path's array order
  // shifts underneath the already-issued cursor.
  await saveConversation({
    sessionId: "shifted-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Shifted",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:02.000Z",
    turns: [
      { id: "sys-early", role: "system", text: "system note", createdAt: "2026-08-04T16:00:00.000Z", parentId: null },
      { id: "t1", role: "user", text: "one", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t2", role: "assistant", text: "two", createdAt: "2026-08-04T17:00:01.000Z", parentId: "t1" },
    ],
    activeLeafId: "t2",
  });
  sessionsListCache.clear();
  clearConversationListMetadataCache();

  const page2Req = requestWith("shifted-conv", {
    bearer: token,
    query: `?limit=2&cursor=${encodeURIComponent(cursor)}`,
  });
  const page2 = await GET(page2Req.req, page2Req.ctx);
  assert.equal(page2.status, 200, await page2.clone().text());
  const page2Body = await page2.json();
  // The id-based cursor still resolves "t1"'s new position and continues
  // correctly from just after it — "sys-early" (now ahead of "t1") is never
  // re-served, and "t2" (after "t1") is.
  assert.deepEqual(page2Body.messages.map((m) => m.id), ["t2"]);
});

test("a cursor whose turn is no longer on the active path (branch change) is rejected with a stable 409 conflict, never a silent empty/wrong page", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "branch-changed-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Branch changed",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "t1", role: "user", text: "one", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t2", role: "assistant", text: "two", createdAt: "2026-08-04T17:00:01.000Z", parentId: "t1" },
    ],
    activeLeafId: "t2",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();

  // A cursor claiming to have last seen "t2" — but "t2" no longer exists on
  // the conversation's (re-saved) active path at all, simulating a branch
  // switch that dropped it entirely.
  const staleCursor = encodeMessageCursor({ id: "t2" });
  await saveConversation({
    sessionId: "branch-changed-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Branch changed",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:02.000Z",
    turns: [
      { id: "t1", role: "user", text: "one", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      { id: "t3", role: "assistant", text: "a different branch", createdAt: "2026-08-04T17:00:03.000Z", parentId: "t1" },
    ],
    activeLeafId: "t3",
  });
  sessionsListCache.clear();
  clearConversationListMetadataCache();

  const req = requestWith("branch-changed-conv", {
    bearer: token,
    query: `?cursor=${encodeURIComponent(staleCursor)}`,
  });
  const response = await GET(req.req, req.ctx);
  assert.equal(response.status, 409, await response.clone().text());
  const body = await response.json();
  assert.equal(body.error.code, "conflict");
});

test("a conversation outside the caller's familiar/project grants 404s exactly like an unknown id", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const projectRoot = path.join(workdir, "ungranted-root");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-y", name: "Y", root: projectRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "conversation-detail-project",
    }),
  );
  await saveConversation({
    sessionId: "scoped-conv",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: `local:${projectRoot}`,
    title: "Scoped",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  // No grant is created for "granted-fam" -> "proj-y", so the familiar-scoped
  // read must not be able to see this conversation.
  const { req, ctx } = requestWith("scoped-conv", { bearer: token, query: "?familiarId=granted-fam" });
  const response = await GET(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("a rootless conversation belonging to a different familiar 404s exactly like an unknown id, even with no project grant to check", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "rootless-other-familiar",
    familiarId: "owner-fam",
    harness: "claude",
    runtime: "local:",
    title: "Owner's rootless chat",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  // A rootless conversation carries no project grant to check at all, so a
  // pre-fix project-only scope would let ANY familiar through — ownership
  // must be enforced directly against the row's own familiarId.
  const { req, ctx } = requestWith("rootless-other-familiar", { bearer: token, query: "?familiarId=other-fam" });
  const response = await GET(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("returns only the active branch's turns/messages, never turns from an inactive sibling branch", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "branched-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Branched",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      { id: "root", role: "user", text: "root message", createdAt: "2026-08-04T17:00:00.000Z", parentId: null },
      {
        id: "abandoned-reply",
        role: "assistant",
        text: "an abandoned reply on a sibling branch",
        createdAt: "2026-08-04T17:00:01.000Z",
        parentId: "root",
      },
      {
        id: "active-reply",
        role: "assistant",
        text: "the active branch reply",
        createdAt: "2026-08-04T17:00:02.000Z",
        parentId: "root",
      },
    ],
    activeLeafId: "active-reply",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  const { req, ctx } = requestWith("branched-conv", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const ids = body.messages.map((m) => m.id);
  assert.deepEqual(ids, ["root", "active-reply"], "only the active branch's turns are returned");
  assert.equal(ids.includes("abandoned-reply"), false, "the inactive sibling branch's turn must never leak");
});

test("an invalid familiarId query is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const { req, ctx } = requestWith("some-id", { bearer: token, query: "?familiarId=" + encodeURIComponent("bad id") });
  const response = await GET(req, ctx);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("when the daemon is unreachable, a locally-visible conversation still 200s with degraded: true and no raw daemon error", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "degraded-detail",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Detail during outage",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  // Never start a daemon; point the hub at an address nothing listens on so
  // the canonical merge falls back to its local-only degraded path.
  await writeHubConfig("http://127.0.0.1:9");
  const token = await issue();
  const { req, ctx } = requestWith("degraded-detail", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.degraded, true, "the client-v1 detail response signals degraded state");
  assert.equal(body.conversation.id, "degraded-detail");
  const raw = JSON.stringify(body);
  assert.equal(
    /ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(raw),
    false,
    "no raw daemon error text crosses the client-v1 wire boundary",
  );
});

test("when the daemon is unreachable, an unknown id still 404s but carries the degraded signal in error details", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  // Never start a daemon; point the hub at an address nothing listens on so
  // the canonical merge falls back to its local-only degraded path, with no
  // local conversations at all.
  await writeHubConfig("http://127.0.0.1:9");
  const token = await issue();
  const { req, ctx } = requestWith("does-not-exist-degraded", { bearer: token });
  const response = await GET(req, ctx);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.message, "Conversation not found.", "the not-found message stays byte-identical to the healthy case");
  assert.equal(
    body.error.details?.degraded,
    true,
    "a 404 under a degraded merge still signals the partial-state ambiguity via details",
  );
  const raw = JSON.stringify(body);
  assert.equal(
    /ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(raw),
    false,
    "no raw daemon error text crosses the client-v1 wire boundary",
  );
});

console.log("client/v1/conversations/[id] route.test.ts: ok");

// ── PATCH (Task 7: canonical conversation mutations) ────────────────────────

test("PATCH: an absent internal marker returns 403 before the Idempotency-Key, params, or body are read", async () => {
  resetRateLimitsForTest();
  const { req, ctx } = mutationRequestWith("some-id", { marker: null, idempotencyKey: null, rawBody: "not json" });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("PATCH: a credential missing conversations:write is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:read"]);
  const { req, ctx } = mutationRequestWith("some-id", { bearer: token, idempotencyKey: null, rawBody: "not json" });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("PATCH: a missing Idempotency-Key is rejected with 400 before params or body are read", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("../../etc/passwd", {
    bearer: token,
    idempotencyKey: null,
    rawBody: "not json",
  });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("PATCH: an unsafe id (path traversal shape) 404s rather than touching the filesystem", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("../../etc/passwd", { bearer: token, body: { pinned: true } });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("PATCH: malformed JSON is rejected with 400 invalid_request", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("some-id", { bearer: token, rawBody: "{not json" });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("PATCH: an empty body is rejected with 400 invalid_request", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("some-id", { bearer: token, body: {} });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("PATCH: extra keys are rejected with 400 invalid_request — a client cannot mutate familiarId/turns/status/revision", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  for (const body of [
    { pinned: true, familiarId: "charm" },
    { turns: [] },
    { status: "completed" },
    { revision: "abc" },
    { projectRoot: "/tmp" },
  ]) {
    const { req, ctx } = mutationRequestWith("some-id", { bearer: token, body });
    const response = await PATCH(req, ctx);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error.code, "invalid_request");
  }
});

test("PATCH: an unknown conversation id 404s", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("does-not-exist", { bearer: token, body: { pinned: true } });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("PATCH: renames, pins, and archives/unarchives a conversation, with an ETag equal to its new revision", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("patch-route-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);

  const renamed = await PATCH(
    ...Object.values(mutationRequestWith("patch-route-conv", { bearer: token, body: { title: "Renamed" } })),
  );
  assert.equal(renamed.status, 200, await renamed.clone().text());
  const renamedBody = await renamed.json();
  assert.equal(renamedBody.conversation.title, "Renamed");
  assert.equal(renamed.headers.get("etag"), renamedBody.conversation.revision);

  const pinned = await PATCH(
    ...Object.values(mutationRequestWith("patch-route-conv", { bearer: token, body: { pinned: true } })),
  );
  assert.equal(pinned.status, 200);
  assert.equal((await pinned.json()).conversation.pinned, true);

  const archived = await PATCH(
    ...Object.values(mutationRequestWith("patch-route-conv", { bearer: token, body: { archived: true } })),
  );
  assert.equal(archived.status, 200);
  assert.ok((await archived.json()).conversation.archivedAt);

  const unarchived = await PATCH(
    ...Object.values(mutationRequestWith("patch-route-conv", { bearer: token, body: { archived: false } })),
  );
  assert.equal(unarchived.status, 200);
  assert.equal((await unarchived.json()).conversation.archivedAt, null);
});

test("PATCH: a conversation whose owning familiar lacks its project's grant 404s exactly like an unknown id, and never mutates it", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const projectRoot = path.join(workdir, "patch-hidden-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-patch-hidden", name: "H", root: projectRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "conversation-patch-hidden-project",
    }),
  );
  await seedConversation("patch-hidden-conv", { familiarId: "ungranted-fam", runtime: `local:${projectRoot}` });
  const daemonUrl = await startDaemon([]);
  // "ungranted-fam" exists (isolating this from the separate
  // familiar-does-not-exist case) but holds no grant for its own
  // conversation's project root — authorization is derived entirely from the
  // conversation's OWN canonical familiarId/project root, never from any
  // caller-supplied scope (there is none anymore; a caller-selectable
  // `?familiarId=` scope was the spec-review finding this replaces).
  await writeHubConfig(daemonUrl, { "ungranted-fam": { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("patch-hidden-conv", {
    bearer: token,
    body: { pinned: true },
  });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
  const state = await loadState();
  assert.equal(state.sessionPinned["patch-hidden-conv"], undefined);
});

test("PATCH: a conversation whose owning familiar no longer exists 404s, even though the conversation itself is real", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("patch-ghost-owner", { familiarId: "ghost-fam" });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } }); // "ghost-fam" is NOT registered
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("patch-ghost-owner", { bearer: token, body: { pinned: true } });
  const response = await PATCH(req, ctx);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("PATCH: replaying the exact same Idempotency-Key and body returns the identical response without re-mutating", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("patch-replay-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();
  const body = { pinned: true };

  const first = await PATCH(
    ...Object.values(mutationRequestWith("patch-replay-conv", { bearer: token, idempotencyKey: key, body })),
  );
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  const second = await PATCH(
    ...Object.values(mutationRequestWith("patch-replay-conv", { bearer: token, idempotencyKey: key, body })),
  );
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.deepEqual(firstBody, secondBody);
});

test("PATCH: the same Idempotency-Key with a different body conflicts with 409", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("patch-conflict-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();

  const first = await PATCH(
    ...Object.values(
      mutationRequestWith("patch-conflict-conv", { bearer: token, idempotencyKey: key, body: { pinned: true } }),
    ),
  );
  assert.equal(first.status, 200);

  const second = await PATCH(
    ...Object.values(
      mutationRequestWith("patch-conflict-conv", { bearer: token, idempotencyKey: key, body: { pinned: false } }),
    ),
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "conflict");
});

test("PATCH: a rename on a conversation with a huge transcript/attachments never leaks secret prompt/attachment content — in the response OR the persisted idempotency ledger file", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const secretText = "SECRET_PROMPT_MARKER_" + "y".repeat(3000);
  const hugeTurns = Array.from({ length: 300 }, (_, i) => ({
    id: `turn-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: secretText,
    createdAt: "2026-08-04T17:00:00.000Z",
    parentId: i === 0 ? null : `turn-${i - 1}`,
    attachments: [
      {
        name: "route-level-secret-attachment.txt",
        text: "ROUTE_LEVEL_SECRET_ATTACHMENT_CONTENT",
        mimeType: "text/plain",
      },
    ],
  }));
  await saveConversation({
    sessionId: "huge-transcript-route-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Original title",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: hugeTurns,
    activeLeafId: "turn-299",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);

  const response = await PATCH(
    ...Object.values(
      mutationRequestWith("huge-transcript-route-conv", { bearer: token, body: { title: "Renamed huge" } }),
    ),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const rawResponseText = await response.clone().text();
  assert.equal(rawResponseText.includes("SECRET_PROMPT_MARKER"), false, "the HTTP response must never carry turn text");
  assert.equal(
    rawResponseText.includes("route-level-secret-attachment.txt"),
    false,
    "the HTTP response must never carry an attachment filename",
  );
  assert.equal(
    rawResponseText.includes("ROUTE_LEVEL_SECRET_ATTACHMENT_CONTENT"),
    false,
    "the HTTP response must never carry attachment content",
  );
  assert.ok(
    rawResponseText.length < 4096,
    `the response body must stay small/bounded; was ${rawResponseText.length} bytes`,
  );

  // The critical assertion: read the ACTUAL on-disk idempotency ledger file
  // this mutation was just persisted into (Task 6's operation store) and
  // prove none of the secret transcript/attachment content ever reached it —
  // the ledger only ever stores the bounded receipt this response returned,
  // never the full conversation object.
  const ledgerRaw = await readFile(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, "utf8");
  assert.equal(ledgerRaw.includes("SECRET_PROMPT_MARKER"), false, "the idempotency ledger file must never carry turn text");
  assert.equal(
    ledgerRaw.includes("route-level-secret-attachment.txt"),
    false,
    "the idempotency ledger file must never carry an attachment filename",
  );
  assert.equal(
    ledgerRaw.includes("ROUTE_LEVEL_SECRET_ATTACHMENT_CONTENT"),
    false,
    "the idempotency ledger file must never carry attachment content or any filesystem attachment path",
  );
});

// ── DELETE (Task 7: canonical conversation mutations) ───────────────────────

test("DELETE: an absent internal marker returns 403 before the Idempotency-Key or params are read", async () => {
  resetRateLimitsForTest();
  const { req, ctx } = mutationRequestWith("some-id", { marker: null, idempotencyKey: null });
  const response = await DELETE(req, ctx);
  assert.equal(response.status, 403);
});

test("DELETE: a credential missing conversations:write is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:read"]);
  const { req, ctx } = mutationRequestWith("some-id", { bearer: token, idempotencyKey: null });
  const response = await DELETE(req, ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("DELETE: a missing or invalid Idempotency-Key is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const missing = mutationRequestWith("some-id", { bearer: token, idempotencyKey: null });
  const missingResponse = await DELETE(missing.req, missing.ctx);
  assert.equal(missingResponse.status, 400);

  const invalid = mutationRequestWith("some-id", { bearer: token, idempotencyKey: "not-a-uuid" });
  const invalidResponse = await DELETE(invalid.req, invalid.ctx);
  assert.equal(invalidResponse.status, 400);
});

test("DELETE: removes the conversation and is idempotent (a second, distinct delete 404s)", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("delete-route-conv");
  const uploaded = await seedBoundAttachment("delete-route-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);

  const first = await DELETE(
    ...Object.values(mutationRequestWith("delete-route-conv", { bearer: token })),
  );
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).deleted, true);
  assert.equal(await loadConversation("delete-route-conv"), null);
  assert.deepEqual(await readdir(attachmentRoot), [], "bound attachment files/sidecars are removed with the conversation");
  const attachmentIndex = JSON.parse(await readFile(attachmentIndexPath, "utf8"));
  assert.equal(
    attachmentIndex.attachments.some((record: { attachmentId: string }) => record.attachmentId === uploaded.id),
    false,
    "the bound attachment record is removed from the ownership index too",
  );

  const second = await DELETE(
    ...Object.values(mutationRequestWith("delete-route-conv", { bearer: token })),
  );
  assert.equal(second.status, 404, "a distinct second delete attempt sees the conversation is already gone");
});

test("DELETE: replaying the exact same Idempotency-Key returns the identical response without a second cleanup pass", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("delete-replay-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();

  const first = await DELETE(
    ...Object.values(mutationRequestWith("delete-replay-conv", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(first.status, 200);

  const second = await DELETE(
    ...Object.values(mutationRequestWith("delete-replay-conv", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
});

test("DELETE: a conversation whose owning familiar lacks its project's grant 404s and is never actually deleted", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const projectRoot = path.join(workdir, "delete-hidden-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-delete-hidden", name: "H", root: projectRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "conversation-delete-hidden-project",
    }),
  );
  await seedConversation("delete-hidden-conv", { familiarId: "ungranted-fam-2", runtime: `local:${projectRoot}` });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { "ungranted-fam-2": { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("delete-hidden-conv", { bearer: token });
  const response = await DELETE(req, ctx);
  assert.equal(response.status, 404);
  assert.ok(await loadConversation("delete-hidden-conv"), "a hidden conversation must never actually be deleted");
});

test("DELETE: a conversation whose owning familiar no longer exists 404s and is never actually deleted", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("delete-ghost-owner", { familiarId: "ghost-fam" });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } }); // "ghost-fam" is NOT registered
  const token = await issue(["conversations:write"]);
  const { req, ctx } = mutationRequestWith("delete-ghost-owner", { bearer: token });
  const response = await DELETE(req, ctx);
  assert.equal(response.status, 404);
  assert.ok(await loadConversation("delete-ghost-owner"), "a conversation with a vanished owner must never be deleted");
});

test("DELETE: the same Idempotency-Key against a different conversation id conflicts with 409 rather than deleting the second one", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("delete-conflict-a");
  await seedConversation("delete-conflict-b");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();

  const first = await DELETE(
    ...Object.values(mutationRequestWith("delete-conflict-a", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(first.status, 200);

  const second = await DELETE(
    ...Object.values(mutationRequestWith("delete-conflict-b", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "conflict");
  assert.ok(await loadConversation("delete-conflict-b"), "the conflicting second target must never actually be deleted");
});

test("DELETE: a transient deleteConversation() failure returns a retryable >= 500 that the idempotent wrapper never completes/caches — the SAME key stays pending, and a retry after claim expiry (ledger repaired) actually deletes it", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await seedConversation("delete-transient-conv");
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();

  // Force deleteConversation()'s real unlink to fail by revoking write
  // permission on the conversations directory itself (unlink needs write
  // access to the containing directory, not the file) — same technique
  // chat-service.test.ts uses to force this exact transient failure
  // deterministically without any new test-only hook.
  await chmod(CONV_DIR, 0o555);
  let firstResponse: Response;
  try {
    firstResponse = await DELETE(
      ...Object.values(mutationRequestWith("delete-transient-conv", { bearer: token, idempotencyKey: key })),
    );
  } finally {
    // Leave permissions blocked a little longer — the retry below must still
    // 409 as "pending" (not reclaim yet) while the first claim is still live.
  }
  assert.equal(firstResponse.status, 503, await firstResponse.clone().text());
  const firstBody = await firstResponse.json();
  assert.equal(firstBody.ok, false);
  assert.equal(firstBody.error.code, "service_unavailable");
  assert.equal(firstBody.error.retryable, true);
  assert.ok(
    await loadConversation("delete-transient-conv"),
    "a delete response that the idempotent wrapper could not confirm as durably completed must never have actually removed the conversation",
  );

  // An IMMEDIATE retry under the SAME Idempotency-Key, while the first
  // attempt's claim is still live (not yet expired), must see a live
  // pending claim — a >= 500 outcome is never persisted/cached as a
  // replayable "completed" result, so this can never silently return the
  // stale 503 verbatim either; it is a fresh 409 "still pending" signal.
  const pendingRetry = await DELETE(
    ...Object.values(mutationRequestWith("delete-transient-conv", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(pendingRetry.status, 409, await pendingRetry.clone().text());
  assert.equal((await pendingRetry.json()).error.code, "conflict");
  await chmod(CONV_DIR, 0o755);
  assert.ok(
    await loadConversation("delete-transient-conv"),
    "the conversation must still exist after the live-pending-claim retry — no 409 for an incomplete delete was ever persisted as a completion",
  );

  // Simulate the claim's abandonment window elapsing (ledger repaired /
  // claim reclaimable) by directly rewriting the on-disk operation ledger's
  // `claimedAt`/`updatedAt`/`expiresAt` fields for this exact composite
  // identity into the past — the same effect a real ~10 minute wait would
  // have, without actually waiting.
  const storePath = process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!;
  const store = JSON.parse(await readFile(storePath, "utf8"));
  const entry = store.operations.find(
    (op: { key: string; route: string }) => op.key === key && op.route === "conversations-delete",
  );
  assert.ok(entry, "the failed first attempt must have left exactly one live claim in the ledger");
  assert.equal(entry.state, "in_progress", "a >= 500 outcome must never mark the ledger entry completed");
  const longAgo = Date.now() - 11 * 60_000;
  entry.claimedAt = longAgo;
  entry.updatedAt = longAgo;
  entry.expiresAt = longAgo + 10 * 60_000; // PENDING_CLAIM_RETRY_MS, now already in the past
  await writeFile(storePath, JSON.stringify(store), "utf8");

  // Retry the SAME Idempotency-Key again — permissions are restored, so the
  // reclaimed attempt's real cleanup + delete now succeeds outright.
  const reclaimedRetry = await DELETE(
    ...Object.values(mutationRequestWith("delete-transient-conv", { bearer: token, idempotencyKey: key })),
  );
  assert.equal(reclaimedRetry.status, 200, await reclaimedRetry.clone().text());
  assert.equal((await reclaimedRetry.json()).deleted, true);
  assert.equal(
    await loadConversation("delete-transient-conv"),
    null,
    "the reclaimed retry must have actually deleted the conversation this time",
  );
});

console.log("client/v1/conversations/[id] route.test.ts (PATCH/DELETE): ok");
