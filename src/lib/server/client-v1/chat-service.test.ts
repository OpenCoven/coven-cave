// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { after, test } from "node:test";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-chat-service-"));
const covenHome = path.join(workdir, "home");
await mkdir(covenHome, { recursive: true });

// Every module this test touches (chat-service.ts -> cave-config.ts,
// cave-conversations.ts, project-permissions.ts, read-model.ts et al.)
// resolves its on-disk paths from these env vars at MODULE-LOAD time, so they
// must be set before the very first import below.
process.env.COVEN_HOME = covenHome;
delete process.env.COVEN_SOCKET;
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(workdir, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(workdir, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(workdir, "permission-config.json");
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = path.join(covenHome, "cave", "chat-attachments");
process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = path.join(covenHome, "cave", "client-attachments", "client-v1-attachments.json");

const {
  createClientConversation,
  deleteClientConversation,
  parseCreateConversationInput,
  parsePatchConversationInput,
  patchClientConversation,
} = await import("./chat-service.ts");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions.ts");
const { loadState, loadConfig } = await import("@/lib/cave-config.ts");
const { loadConversation, listConversations, saveConversation, withConversationLock, clearConversationListMetadataCache, CONV_DIR } = await import(
  "@/lib/cave-conversations.ts"
);
const { runIdempotentMutation } = await import("./idempotent-mutation.ts");
const {
  hashNormalizedRequest,
  isIdempotencyStoreIntegrityError,
} = await import("./idempotency-store.ts");
const { sessionsListCache } = await import("@/lib/server/sessions-list-cache.ts");
const { canonicalSessionListCacheKey } = await import("@/lib/server/client-v1/read-model.ts");
const { caveHome } = await import("@/lib/coven-paths.ts");
const {
  parseClientAttachmentForm,
  resolveAndBindClientAttachments,
  saveUploadedClientAttachments,
} = await import("./attachment-service.ts");
const { setCredentialLockDbPathForTest } = await import("./credential-transaction-lock.ts");

let stopDaemon = async () => {};
const attachmentRoot = process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR!;
const attachmentIndexPath = process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH!;
const attachmentLockDbPath = path.join(workdir, "attachment-index.lock.sqlite3");
const attachmentOwner = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const attachmentBytes = Buffer.from("conversation-bound attachment\n", "utf8");
setCredentialLockDbPathForTest(() => attachmentLockDbPath);

after(async () => {
  await stopDaemon();
  setCredentialLockDbPathForTest(null);
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

async function writeConfig(opts: { hubUrl: string; familiars?: Record<string, unknown> }) {
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(
    path.join(covenHome, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: opts.familiars ?? {},
      roles: [],
      addons: { github: false, code: false, browser: false, flow: false, journal: false, docs: false },
      marketplace: { installed: {} },
      multiHost: { mode: "hub", hubUrl: opts.hubUrl, executorUrls: [] },
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

async function resetFixtures() {
  await stopDaemon();
  stopDaemon = async () => {};
  clearConversationListMetadataCache();
  sessionsListCache.clear();
  await rm(attachmentIndexPath, { force: true });
  await rm(attachmentLockDbPath, { force: true });
  await rm(`${attachmentLockDbPath}-shm`, { force: true });
  await rm(`${attachmentLockDbPath}-wal`, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3`, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3-shm`, { force: true });
  await rm(`${attachmentIndexPath}.lock.sqlite3-wal`, { force: true });
  await rm(attachmentRoot, { recursive: true, force: true });
  await mkdir(attachmentRoot, { recursive: true });
}

async function setupDaemonAndConfig(familiars: Record<string, unknown> = { charm: { harness: "claude" } }) {
  const daemonUrl = await startDaemon([]);
  await writeConfig({ hubUrl: daemonUrl, familiars });
  return daemonUrl;
}

async function seedBoundAttachment(conversationId: string) {
  const form = new FormData();
  form.append("files", new File([attachmentBytes], "notes.txt", { type: "text/plain" }));
  const parsed = await parseClientAttachmentForm(form);
  const [uploaded] = await saveUploadedClientAttachments(parsed, attachmentOwner, crypto.randomUUID(), 10);
  await resolveAndBindClientAttachments([uploaded.id], attachmentOwner, conversationId);
  return uploaded;
}

// ── parseCreateConversationInput ────────────────────────────────────────────

test("parseCreateConversationInput rejects a non-object body", () => {
  assert.throws(() => parseCreateConversationInput(null));
  assert.throws(() => parseCreateConversationInput("nope"));
  assert.throws(() => parseCreateConversationInput([]));
});

test("parseCreateConversationInput rejects extra keys", () => {
  assert.throws(() =>
    parseCreateConversationInput({ familiarId: "charm", projectRoot: null, extra: true }),
  );
});

test("parseCreateConversationInput requires both keys (projectRoot must be explicit)", () => {
  assert.throws(() => parseCreateConversationInput({ familiarId: "charm" }));
  assert.throws(() => parseCreateConversationInput({ projectRoot: null }));
});

test("parseCreateConversationInput rejects a malformed familiarId", () => {
  assert.throws(() => parseCreateConversationInput({ familiarId: "bad id", projectRoot: null }));
  assert.throws(() => parseCreateConversationInput({ familiarId: "", projectRoot: null }));
  assert.throws(() => parseCreateConversationInput({ familiarId: 42, projectRoot: null }));
});

test("parseCreateConversationInput rejects a non-string, non-null projectRoot", () => {
  assert.throws(() => parseCreateConversationInput({ familiarId: "charm", projectRoot: 1 }));
  assert.throws(() => parseCreateConversationInput({ familiarId: "charm", projectRoot: "" }));
  assert.throws(() =>
    parseCreateConversationInput({ familiarId: "charm", projectRoot: "x".repeat(4097) }),
  );
});

test("parseCreateConversationInput accepts a valid null projectRoot", () => {
  assert.deepEqual(parseCreateConversationInput({ familiarId: "charm", projectRoot: null }), {
    familiarId: "charm",
    projectRoot: null,
  });
});

test("parseCreateConversationInput accepts and trims a valid string projectRoot", () => {
  assert.deepEqual(
    parseCreateConversationInput({ familiarId: "charm", projectRoot: " /tmp/proj " }),
    { familiarId: "charm", projectRoot: "/tmp/proj" },
  );
});

test("create fails closed on a corrupt project registry and never creates a conversation", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await rm(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!, { force: true });
  await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE!, '{"version":1,"projects":[', "utf8");
  await assert.rejects(() =>
    createClientConversation(
      { familiarId: "charm", projectRoot: null },
      "corrupt-registry-create",
    ));
  assert.equal(await loadConversation("corrupt-registry-create"), null);
  await rm(process.env.CAVE_PROJECTS_PATH_OVERRIDE!, { force: true });
});

test("PATCH fails closed on corrupt permissions without applying metadata", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await rm(process.env.CAVE_PROJECTS_PATH_OVERRIDE!, { force: true });
  await rm(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!, { force: true });
  await seedConversation("corrupt-permissions-patch");
  await writeFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!, '{"version":2,', "utf8");
  await assert.rejects(() =>
    patchClientConversation("corrupt-permissions-patch", { title: "Must not land" }));
  const state = await loadState();
  assert.equal(state.sessionTitles["corrupt-permissions-patch"], undefined);
  await rm(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!, { force: true });
});

// ── parsePatchConversationInput ──────────────────────────────────────────────

test("parsePatchConversationInput rejects an empty body", () => {
  assert.throws(() => parsePatchConversationInput({}));
});

test("parsePatchConversationInput rejects extra keys", () => {
  assert.throws(() => parsePatchConversationInput({ title: "Hi", familiarId: "charm" }));
  assert.throws(() => parsePatchConversationInput({ turns: [] }));
  assert.throws(() => parsePatchConversationInput({ status: "completed" }));
  assert.throws(() => parsePatchConversationInput({ revision: "abc" }));
});

test("parsePatchConversationInput rejects wrong-typed fields", () => {
  assert.throws(() => parsePatchConversationInput({ title: 5 }));
  assert.throws(() => parsePatchConversationInput({ pinned: "yes" }));
  assert.throws(() => parsePatchConversationInput({ archived: "yes" }));
});

test("parsePatchConversationInput rejects an empty or oversized title", () => {
  assert.throws(() => parsePatchConversationInput({ title: "   " }));
  assert.throws(() => parsePatchConversationInput({ title: "x".repeat(121) }));
});

test("parsePatchConversationInput rejects a title with control characters", () => {
  assert.throws(() => parsePatchConversationInput({ title: "bad\u0000title" }));
});

test("parsePatchConversationInput accepts a single field", () => {
  assert.deepEqual(parsePatchConversationInput({ pinned: true }), { pinned: true });
});

test("parsePatchConversationInput accepts and trims all three fields together", () => {
  assert.deepEqual(parsePatchConversationInput({ title: "  Renamed  ", pinned: true, archived: false }), {
    title: "Renamed",
    pinned: true,
    archived: false,
  });
});

// ── createClientConversation ────────────────────────────────────────────────

test("create: an unknown familiar returns 404 not_found before any project work", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({});
  const result = await createClientConversation({ familiarId: "ghost", projectRoot: null });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
});

test("create: projectRoot: null creates an empty, projectless conversation", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const result = await createClientConversation({ familiarId: "charm", projectRoot: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.familiarId, "charm");
  assert.equal(result.conversation.projectRoot, null);
  assert.equal((await loadConversation(result.conversation.id))?.projectRoot, null);
  assert.equal(
    result.conversation.turns,
    undefined,
    "the bounded mutation receipt never carries a turns array (spec-review finding)",
  );
  const stored = await loadConversation(result.conversation.id);
  assert.ok(stored, "the conversation was actually persisted");
  assert.equal(stored.runtime, undefined, "no project means no runtime cwd stamp");
});

test("create: a registered project the familiar has no grant for is denied as 403 forbidden", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "ungranted-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "ungranted-fixture",
      projects: [{ id: "proj-z", name: "Z", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  const result = await createClientConversation({ familiarId: "charm", projectRoot });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "forbidden");
});

test("create: an unregistered project root is rejected as 400 invalid_request", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "unregistered-proj");
  await mkdir(projectRoot, { recursive: true });
  const result = await createClientConversation({ familiarId: "charm", projectRoot });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, "invalid_request");
});

test("create: a granted, registered project mints a conversation with that runtime cwd", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "granted-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "granted-fixture",
      projects: [{ id: "proj-g", name: "G", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  await grantProjectToFamiliar({ familiarId: "charm", projectId: "proj-g", source: "human", access: "read" });

  const result = await createClientConversation({ familiarId: "charm", projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.projectRoot, projectRoot);
  const stored = await loadConversation(result.conversation.id);
  assert.equal(stored!.runtime, `local:${projectRoot}`);
  assert.equal(stored!.projectRoot, projectRoot);
  const summary = (await listConversations()).find((row) => row.sessionId === result.conversation.id);
  assert.equal(summary?.projectRoot, projectRoot, "canonical summary retains authoritative project provenance");
});

test("create: the deterministic effectId parameter mints the conversation at exactly that id (mintSessionId seam)", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const effectId = crypto.randomUUID();
  const result = await createClientConversation({ familiarId: "charm", projectRoot: null }, effectId);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.id, effectId);
  const stored = await loadConversation(effectId);
  assert.ok(stored, "the conversation must be persisted at the deterministic effectId");
});

test("create: a same-effectId retry (completion-unconfirmed reclaim) returns the SAME conversation, never a second one", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const effectId = crypto.randomUUID();
  const first = await createClientConversation({ familiarId: "charm", projectRoot: null }, effectId);
  assert.equal(first.ok, true, JSON.stringify(first));

  // Same identity (same familiarId/projectRoot) at the SAME effectId — this
  // is exactly what a same-Idempotency-Key retry after a completion-
  // unconfirmed failure (or claim reclaim) looks like from the effect's
  // point of view. It must reconcile to the existing conversation rather
  // than minting a second one.
  const second = await createClientConversation({ familiarId: "charm", projectRoot: null }, effectId);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.conversation.id, first.conversation.id);
  assert.equal(second.conversation.revision, first.conversation.revision);

  const entries = await readdir(CONV_DIR);
  const matching = entries.filter((name) => name.startsWith(effectId));
  assert.equal(matching.length, 1, "exactly one conversation must exist on disk for this effectId, never two");
});

test("create: completion-unconfirmed then explicit delete and reclaimed claim never resurrects the deterministic effect", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const request = {
    idempotencyKey: crypto.randomUUID(),
    credentialId: crypto.randomUUID(),
    route: "conversations-create",
    identity: {
      method: "POST",
      input: { familiarId: "charm", projectRoot: null },
    },
  };
  let completionAttempt = 0;
  let effectId = "";
  const deps = {
    claimOperation: async () => ({ kind: "claimed", claimId: crypto.randomUUID() }),
    completeOperation: async (_claim, completed) => {
      completionAttempt += 1;
      if (completionAttempt === 1) throw new Error("simulated lost completion");
      return { kind: "completed", response: completed };
    },
    hashNormalizedRequest,
    isIdempotencyStoreIntegrityError,
  };
  const execute = async (ctx) => {
    effectId = ctx.effectId;
    const result = await createClientConversation(
      { familiarId: "charm", projectRoot: null },
      ctx.effectId,
    );
    return Response.json(result.ok
      ? { ok: true, conversation: result.conversation }
      : { ok: false, error: { code: result.code, message: result.message } }, {
      status: result.ok ? 201 : result.status,
    });
  };

  const first = await runIdempotentMutation(request, execute, deps);
  assert.equal(first.status, 503, "the first effect happened but ledger completion was unconfirmed");
  assert.ok(effectId);
  assert.ok(await loadConversation(effectId), "the deterministic effect is live before deletion");

  const deleted = await deleteClientConversation(effectId);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(await loadConversation(effectId), null);

  const reclaimed = await runIdempotentMutation(request, execute, deps);
  assert.equal(reclaimed.status, 409, "a repaired/reclaimed claim completes with stable conflict");
  assert.equal((await reclaimed.json()).error.code, "conflict");
  assert.equal(await loadConversation(effectId), null, "same-key retry never recreates the sacrificed file");
});

function conversationBarrier(id: string) {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = withConversationLock(id, async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  return { ready, held, release: () => release() };
}

async function nextTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("create/delete barrier: retry wins first, reconciles live effect, then delete removes and sacrifices it", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const effectId = crypto.randomUUID();
  const input = { familiarId: "charm", projectRoot: null };
  assert.equal((await createClientConversation(input, effectId)).ok, true);

  const barrier = conversationBarrier(effectId);
  await barrier.ready;
  const retry = createClientConversation(input, effectId);
  await nextTurn();
  const deletion = deleteClientConversation(effectId);
  barrier.release();
  await barrier.held;

  assert.equal((await retry).ok, true, "create retry reconciles while the live effect exists");
  assert.equal((await deletion).ok, true, "queued delete then removes the reconciled effect");
  assert.equal(await loadConversation(effectId), null);
  assert.ok((await loadState()).sessionSacrificed[effectId]);
});

test("create/delete barrier: delete wins first and sacrificed tombstone denies queued same-key retry", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const effectId = crypto.randomUUID();
  const input = { familiarId: "charm", projectRoot: null };
  assert.equal((await createClientConversation(input, effectId)).ok, true);

  const barrier = conversationBarrier(effectId);
  await barrier.ready;
  const deletion = deleteClientConversation(effectId);
  await nextTurn();
  const retry = createClientConversation(input, effectId);
  barrier.release();
  await barrier.held;

  assert.equal((await deletion).ok, true);
  const denied = await retry;
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 409);
  assert.equal(await loadConversation(effectId), null);
});

test("create: a same-effectId retry with a DIFFERENT familiar/project fails closed as 409 conflict, never overwriting the original", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({ charm: { harness: "claude" }, sage: { harness: "claude" } });
  const effectId = crypto.randomUUID();
  const first = await createClientConversation({ familiarId: "charm", projectRoot: null }, effectId);
  assert.equal(first.ok, true, JSON.stringify(first));

  const mismatched = await createClientConversation({ familiarId: "sage", projectRoot: null }, effectId);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.code, "conflict");

  // The original conversation must be completely untouched by the
  // mismatched, fail-closed attempt.
  const stored = await loadConversation(effectId);
  assert.ok(stored);
  assert.equal(stored!.familiarId, "charm");
});

test("create: a same-effectId retry with a matching familiar but a DIFFERENT project fails closed as 409 conflict", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "granted-proj-2");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "granted-2-fixture",
      projects: [{ id: "proj-h", name: "H", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  await grantProjectToFamiliar({ familiarId: "charm", projectId: "proj-h", source: "human", access: "read" });

  const effectId = crypto.randomUUID();
  const first = await createClientConversation({ familiarId: "charm", projectRoot: null }, effectId);
  assert.equal(first.ok, true, JSON.stringify(first));

  const mismatched = await createClientConversation({ familiarId: "charm", projectRoot }, effectId);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.code, "conflict");
});

// ── patchClientConversation ──────────────────────────────────────────────────

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

test("patch: an unknown conversation id returns 404 not_found", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const result = await patchClientConversation("does-not-exist", { pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
});

test("patch: rename sets a manually-owned title", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-rename");
  const result = await patchClientConversation("patch-rename", { title: "New title" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.title, "New title");
  const state = await loadState();
  assert.equal(state.sessionTitles["patch-rename"], "New title");
  assert.equal(state.sessionTitleManual["patch-rename"], true, "an explicit client-v1 rename is always manual");
});

test("patch: pinned toggles independent of other fields", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-pin");
  const pinned = await patchClientConversation("patch-pin", { pinned: true });
  assert.equal(pinned.ok, true);
  assert.equal(pinned.conversation.pinned, true);

  const unpinned = await patchClientConversation("patch-pin", { pinned: false });
  assert.equal(unpinned.ok, true);
  assert.equal(unpinned.conversation.pinned, false);
});

test("patch: archived sets an archive timestamp; unarchived clears it", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-archive");
  const archived = await patchClientConversation("patch-archive", { archived: true });
  assert.equal(archived.ok, true);
  assert.ok(archived.conversation.archivedAt, "archiving stamps a timestamp");

  const unarchived = await patchClientConversation("patch-archive", { archived: false });
  assert.equal(unarchived.ok, true);
  assert.equal(unarchived.conversation.archivedAt, null, "unarchiving clears the timestamp");
});

test("patch: all three fields apply atomically in one call", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-all");
  const result = await patchClientConversation("patch-all", {
    title: "All at once",
    pinned: true,
    archived: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.title, "All at once");
  assert.equal(result.conversation.pinned, true);
  assert.ok(result.conversation.archivedAt);
});

test("patch: advances the conversation's own canonical on-disk updatedAt/revision as its persistence checkpoint", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-freshness");
  const before = await loadConversation("patch-freshness");

  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await patchClientConversation("patch-freshness", { pinned: true });
  assert.equal(result.ok, true, JSON.stringify(result));

  const after = await loadConversation("patch-freshness");
  assert.ok(
    after.updatedAt > before.updatedAt,
    "the canonical file's own updatedAt must advance past the patch, not just cave-config.ts state",
  );
  assert.equal(
    result.conversation.updatedAt,
    after.updatedAt,
    "the receipt's updatedAt must match the freshly saved on-disk file",
  );
  assert.ok(result.conversation.revision, "the receipt must carry a revision computed from the fresh updatedAt");

  // A second, later patch advances updatedAt again — proving this is a real
  // per-call persistence checkpoint, not a one-time fixture artifact.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await patchClientConversation("patch-freshness", { pinned: false });
  assert.equal(second.ok, true, JSON.stringify(second));
  const afterSecond = await loadConversation("patch-freshness");
  assert.ok(
    afterSecond.updatedAt >= after.updatedAt,
    "a subsequent patch must never regress the canonical updatedAt",
  );
  assert.notEqual(
    second.conversation.revision,
    result.conversation.revision,
    "a subsequent patch must yield a distinct revision digest",
  );
});

test("patch: a canonical save failure propagates as a thrown error, never a false success completion", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("patch-save-failure");
  const before = await loadConversation("patch-save-failure");
  // Revoke write permission on the conversations/ directory itself so
  // `saveConversation`'s atomic-write temp file can never be created — the
  // metadata helper (setSessionPinnedLocal, which writes cave-state.json
  // elsewhere) still succeeds, isolating the failure to this patch's own
  // persistence checkpoint.
  await chmod(CONV_DIR, 0o555);
  try {
    await assert.rejects(
      () => patchClientConversation("patch-save-failure", { pinned: true }),
      undefined,
      "a canonical save failure must surface as a rejection, never a silently-incomplete success",
    );
  } finally {
    await chmod(CONV_DIR, 0o755);
  }
  const after = await loadConversation("patch-save-failure");
  assert.equal(
    after.updatedAt,
    before.updatedAt,
    "a failed save must never partially advance the on-disk updatedAt",
  );
});

test("patch: a rename reuses the SAME title-ownership primitive the internal route uses, and invalidates the shared sessions-list cache", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("cache-invalidation-conv");

  const cacheKey = canonicalSessionListCacheKey(false, null, false);
  await sessionsListCache.get(cacheKey, async () => ({
    payload: { ok: true, sessions: [] },
  }));

  const result = await patchClientConversation("cache-invalidation-conv", { title: "Cache buster" });
  assert.equal(result.ok, true, JSON.stringify(result));

  let recomputed = false;
  await sessionsListCache.get(cacheKey, async () => {
    recomputed = true;
    return { payload: { ok: true, sessions: [] } };
  });
  assert.equal(
    recomputed,
    true,
    "a title/pinned/archived mutation must invalidate the shared sessions-list cache so the next read recomputes rather than serving a stale pre-mutation view",
  );

  const state = await loadState();
  assert.equal(state.sessionTitles["cache-invalidation-conv"], "Cache buster");
  assert.equal(
    state.sessionTitleManual["cache-invalidation-conv"],
    true,
    "an explicit client-v1 rename must go through the SAME manual-ownership setter the internal route uses",
  );
});

test("patch/create: the bounded mutation receipt never carries turns/messages/attachments regardless of transcript size, and stays well under MAX_RESPONSE_BODY_BYTES", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const secretText = "SECRET_PROMPT_MARKER_" + "x".repeat(2000);
  const hugeTurns = Array.from({ length: 200 }, (_, i) => ({
    id: `turn-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: secretText,
    createdAt: "2026-08-04T17:00:00.000Z",
    parentId: i === 0 ? null : `turn-${i - 1}`,
    attachments: [
      {
        name: "super-secret-attachment-name.txt",
        text: "SECRET_ATTACHMENT_CONTENT_MARKER",
        mimeType: "text/plain",
      },
    ],
  }));
  await saveConversation({
    sessionId: "huge-transcript-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Original title",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: hugeTurns,
    activeLeafId: `turn-199`,
  });

  const result = await patchClientConversation("huge-transcript-conv", { title: "Renamed huge transcript" });
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 200));
  const serialized = JSON.stringify(result.conversation);
  assert.ok(serialized.length < 2048, `receipt must be tiny; was ${serialized.length} bytes`);
  assert.equal(result.conversation.turns, undefined);
  assert.equal(serialized.includes("SECRET_PROMPT_MARKER"), false, "the receipt must never carry turn text");
  assert.equal(
    serialized.includes("super-secret-attachment-name.txt"),
    false,
    "the receipt must never carry an attachment filename",
  );
  assert.equal(
    serialized.includes("SECRET_ATTACHMENT_CONTENT_MARKER"),
    false,
    "the receipt must never carry attachment content",
  );
});

test("patch: a conversation whose owning familiar no longer holds its project grant 404s exactly like an unknown id, and never mutates it", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "hidden-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "hidden-fixture",
      projects: [{ id: "proj-hidden", name: "Hidden", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  // The conversation's OWN canonical familiarId ("granted-fam") holds no
  // grant for its OWN project root — authorization is derived entirely from
  // these two fields, never from any caller-supplied scope (there is none
  // anymore; a caller-selectable `?familiarId=` scope was the spec-review
  // finding this replaces).
  await seedConversation("hidden-conv", { familiarId: "granted-fam", runtime: `local:${projectRoot}` });
  const result = await patchClientConversation("hidden-conv", { pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
  const state = await loadState();
  assert.equal(
    state.sessionPinned["hidden-conv"],
    undefined,
    "a conversation whose owning familiar lacks its project grant must never be mutated",
  );
});

test("patch/delete: SSH execution with authoritative projectRoot enforces the registered familiar grant", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "authoritative-ssh-project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "authoritative-ssh",
      projects: [{ id: "proj-authoritative-ssh", name: "SSH", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  await grantProjectToFamiliar({
    familiarId: "charm",
    projectId: "proj-authoritative-ssh",
    source: "human",
    access: "write",
  });
  await seedConversation("authoritative-ssh-conv", {
    runtime: "ssh:build:/srv/repo",
    projectRoot,
  });

  const patched = await patchClientConversation("authoritative-ssh-conv", { title: "Authorized SSH" });
  assert.equal(patched.ok, true, JSON.stringify(patched));
  assert.equal(patched.conversation.projectRoot, projectRoot);

  const deleted = await deleteClientConversation("authoritative-ssh-conv");
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(await loadConversation("authoritative-ssh-conv"), null);
});

test("patch/delete: legacy SSH runtime without authoritative project identity fails closed", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("legacy-ssh-conv", {
    runtime: "ssh:build:/srv/repo",
  });

  const patched = await patchClientConversation("legacy-ssh-conv", { pinned: true });
  assert.equal(patched.ok, false);
  assert.equal(patched.status, 404);
  const deleted = await deleteClientConversation("legacy-ssh-conv");
  assert.equal(deleted.ok, false);
  assert.equal(deleted.status, 404);
  assert.ok(await loadConversation("legacy-ssh-conv"), "denied legacy SSH record remains intact");
});

test("patch: legacy local runtime root continues to derive authority safely", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "legacy-local-project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "legacy-local",
      projects: [{ id: "proj-legacy-local", name: "Local", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  await grantProjectToFamiliar({
    familiarId: "charm",
    projectId: "proj-legacy-local",
    source: "human",
    access: "write",
  });
  await seedConversation("legacy-local-conv", {
    runtime: `local:${projectRoot}`,
  });

  const result = await patchClientConversation("legacy-local-conv", { pinned: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conversation.projectRoot, projectRoot);
});

test("patch: a conversation whose owning familiar no longer exists 404s, even though the conversation itself is real", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({ charm: { harness: "claude" } }); // "ghost-fam" is NOT registered
  await seedConversation("orphaned-conv", { familiarId: "ghost-fam", runtime: "local:" });
  const result = await patchClientConversation("orphaned-conv", { pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
  const state = await loadState();
  assert.equal(
    state.sessionPinned["orphaned-conv"],
    undefined,
    "a conversation whose owning familiar no longer exists must never be mutated",
  );
});

test("patch: a rootless conversation is still owner-scoped — its owning familiar's non-existence still 404s", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({ charm: { harness: "claude" } });
  // Rootless (runtime has no "local:<cwd>" project root) — there is no
  // project grant to check, but the owning familiar must still exist. A
  // rootless conversation is never treated as universally mutable just
  // because there is no project.
  await seedConversation("rootless-orphan", { familiarId: "ghost-fam-2", runtime: undefined });
  const result = await patchClientConversation("rootless-orphan", { pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
});

test("patch: a conversation with ambiguous/missing ownership (empty familiarId) fails closed to 404", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("ambiguous-owner", { familiarId: "" });
  const result = await patchClientConversation("ambiguous-owner", { pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "not_found");
});

// ── deleteClientConversation ─────────────────────────────────────────────────

test("delete: removes the conversation, sacrifices the session id, unlinks board cards, and drops bound attachment records/files", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("delete-me");
  const uploaded = await seedBoundAttachment("delete-me");
  const result = await deleteClientConversation("delete-me");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.id, "delete-me");
  assert.equal(result.deleted, true);
  assert.equal(await loadConversation("delete-me"), null);
  assert.deepEqual(await readdir(attachmentRoot), [], "the canonical attachment file and immutable sidecar are removed");
  const attachmentIndex = JSON.parse(await readFile(attachmentIndexPath, "utf8"));
  assert.equal(
    attachmentIndex.attachments.some((record: { attachmentId: string }) => record.attachmentId === uploaded.id),
    false,
    "the ownership index record is removed too",
  );
  const state = await loadState();
  assert.ok(state.sessionSacrificed["delete-me"], "delete sacrifices the session id so it cannot resurrect");
});

test("delete: is idempotent — deleting an already-deleted conversation 404s deterministically", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("delete-twice");
  const first = await deleteClientConversation("delete-twice");
  assert.equal(first.ok, true);
  const second = await deleteClientConversation("delete-twice");
  assert.equal(second.ok, false);
  assert.equal(second.status, 404);
  assert.equal(second.code, "not_found");
});

test("delete: a conversation whose owning familiar no longer holds its project grant 404s and never deletes it", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const projectRoot = path.join(workdir, "hidden-proj-2");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "hidden-2-fixture",
      projects: [{ id: "proj-hidden-2", name: "Hidden2", root: projectRoot, createdAt: "now", updatedAt: "now" }],
    }),
  );
  await seedConversation("hidden-conv-2", { familiarId: "granted-fam", runtime: `local:${projectRoot}` });
  const result = await deleteClientConversation("hidden-conv-2");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.ok(await loadConversation("hidden-conv-2"), "a hidden conversation must never actually be deleted");
});

test("delete: a conversation whose owning familiar no longer exists 404s and never deletes it", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({ charm: { harness: "claude" } });
  await seedConversation("ghost-owner-conv", { familiarId: "ghost-fam-3" });
  const result = await deleteClientConversation("ghost-owner-conv");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.ok(await loadConversation("ghost-owner-conv"), "a conversation with no existing owner must never actually be deleted");
});

test("delete: a rootless conversation is still owner-scoped — a non-existent owning familiar still 404s", async () => {
  await resetFixtures();
  await setupDaemonAndConfig({ charm: { harness: "claude" } });
  await seedConversation("rootless-delete-orphan", { familiarId: "ghost-fam-4", runtime: undefined });
  const result = await deleteClientConversation("rootless-delete-orphan");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.ok(await loadConversation("rootless-delete-orphan"));
});

test("delete: deleteConversation() returning false is a TRANSIENT failure — surfaced as a retryable >= 500, never a cacheable 409/2xx", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("delete-false-conv");
  // Block unlink from succeeding by revoking write permission on the
  // conversation directory itself (unlink needs write access to the
  // containing directory, not the file) — this is the only way to force
  // `deleteConversation`'s real unlink to fail deterministically without any
  // new test hook on cave-conversations.ts.
  await chmod(CONV_DIR, 0o555);
  try {
    const result = await deleteClientConversation("delete-false-conv");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.status, 503);
    assert.equal(result.code, "service_unavailable");
    assert.equal(result.retryable, true);
  } finally {
    await chmod(CONV_DIR, 0o755);
  }
  assert.ok(
    await loadConversation("delete-false-conv"),
    "a delete that deleteConversation() itself reports as false must never actually remove the file's canonical record",
  );
});

test("delete: a daemon/session cleanup failure (sacrificeSessionLocal) surfaces as a thrown error, leaves the conversation loadable for a retry, and that retry then deletes cleanly", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("cleanup-failure-conv");
  // Revoke write permission on the cave/ directory itself (NOT the sibling
  // conversations/ subdirectory) — this blocks sacrificeSessionLocal's
  // cave-state.json write (a new temp file directly inside cave/) while
  // leaving the conversations/ directory (a separate directory whose own
  // permissions are untouched) free. Cleanup now runs BEFORE
  // deleteConversation (see chat-service.ts's delete reordering), so this
  // failure fires before the conversation file is ever touched — proving
  // both that cleanup failures propagate rather than being swallowed into
  // an incomplete "success", AND that the canonical conversation survives
  // fully intact for a same-Idempotency-Key retry.
  await chmod(caveHome(), 0o555);
  try {
    await assert.rejects(
      () => deleteClientConversation("cleanup-failure-conv"),
      undefined,
      "a cleanup-step failure must surface as a rejection, never a silently-incomplete success",
    );
  } finally {
    await chmod(caveHome(), 0o755);
  }

  const stillThere = await loadConversation("cleanup-failure-conv");
  assert.ok(
    stillThere,
    "a cleanup failure must leave the canonical conversation file fully intact so the same request can retry safely",
  );

  // Retrying (permission restored) re-runs both cleanup steps — safe even
  // though sacrificeSessionLocal never got to run last time, and safe for
  // unlinkSessionFromCards even when no daemon-side session/card ever
  // existed — then actually deletes the file this time. No orphaned or
  // partially-deleted state survives the retry.
  const retry = await deleteClientConversation("cleanup-failure-conv");
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.deleted, true);
  assert.equal(
    await loadConversation("cleanup-failure-conv"),
    null,
    "the retry must actually delete the conversation once cleanup can complete",
  );
  const state = await loadState();
  assert.ok(
    state.sessionSacrificed["cleanup-failure-conv"],
    "the retry's cleanup must run to completion, sacrificing the session id",
  );
});

test("delete: an attachment-index rewrite failure after canonical file cleanup leaves the conversation loadable for a retry, and that retry then removes the lingering record", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("attachment-cleanup-failure");
  const uploaded = await seedBoundAttachment("attachment-cleanup-failure");
  const indexBefore = JSON.parse(await readFile(attachmentIndexPath, "utf8"));
  assert.equal(indexBefore.attachments.length, 1);

  // The attachment cleanup deletes canonical files FIRST and rewrites the
  // ownership index LAST. Make the index directory read-only (with the lock db
  // already relocated to a writable sibling path above) so the file delete
  // succeeds but the subsequent index rewrite fails. The conversation must
  // remain fully loadable for a retry, and the retained index row is what lets
  // that retry finish.
  await chmod(path.dirname(attachmentIndexPath), 0o500);
  try {
    await assert.rejects(
      () => deleteClientConversation("attachment-cleanup-failure"),
      undefined,
      "a post-file-delete index rewrite failure must surface as a rejection, never a false success",
    );
  } finally {
    await chmod(path.dirname(attachmentIndexPath), 0o700);
  }

  assert.ok(
    await loadConversation("attachment-cleanup-failure"),
    "the conversation file stays intact so the same delete can retry safely",
  );
  const stateAfterFailure = await loadState();
  assert.equal(
    stateAfterFailure.sessionSacrificed["attachment-cleanup-failure"],
    undefined,
    "attachment cleanup failures happen before sacrifice, so no later cleanup step may have landed",
  );
  assert.deepEqual(
    await readdir(attachmentRoot),
    [],
    "the canonical file cleanup already landed before the index rewrite failed",
  );
  const indexAfterFailure = JSON.parse(await readFile(attachmentIndexPath, "utf8"));
  assert.equal(
    indexAfterFailure.attachments.some((record: { attachmentId: string }) => record.attachmentId === uploaded.id),
    true,
    "the retained index row is what makes the retry discover and finish the same attachment cleanup",
  );

  const retry = await deleteClientConversation("attachment-cleanup-failure");
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.deleted, true);
  assert.equal(await loadConversation("attachment-cleanup-failure"), null);
  const finalIndex = JSON.parse(await readFile(attachmentIndexPath, "utf8"));
  assert.equal(finalIndex.attachments.length, 0, "the retry removes the retained ownership record");
  assert.deepEqual(await readdir(attachmentRoot), [], "no orphan canonical files or sidecars remain after the retry");
});

test("delete: an unsafe id (path traversal shape) 404s rather than touching the filesystem", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  const result = await deleteClientConversation("../../etc/passwd");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

// ── concurrency: delete racing patch (no resurrection) ──────────────────────

test("concurrency: a delete that wins the conversation lock leaves a racing patch 404ing, never resurrecting local state", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("race-me");

  // Fired back-to-back in the same synchronous tick: `deleteClientConversation`
  // registers its `withConversationLock` queue entry synchronously (before its
  // first `await`), so it is guaranteed to acquire the per-conversation lock
  // before the patch call below even starts its own queue registration.
  const deletePromise = deleteClientConversation("race-me");
  const patchPromise = patchClientConversation("race-me", { pinned: true, title: "Should never land" });

  const [deleteResult, patchResult] = await Promise.all([deletePromise, patchPromise]);
  assert.equal(deleteResult.ok, true, JSON.stringify(deleteResult));
  assert.equal(patchResult.ok, false, JSON.stringify(patchResult));
  assert.equal(patchResult.status, 404);

  const state = await loadState();
  assert.equal(
    state.sessionPinned["race-me"],
    undefined,
    "the patch that lost the race must never write pinned state for a deleted conversation",
  );
  assert.equal(
    state.sessionTitles["race-me"],
    undefined,
    "the patch that lost the race must never write title state for a deleted conversation",
  );
});

test("concurrency: two different patches on the same conversation serialize through the conversation lock", async () => {
  await resetFixtures();
  await setupDaemonAndConfig();
  await seedConversation("race-patches");

  const first = patchClientConversation("race-patches", { title: "First" });
  const second = patchClientConversation("race-patches", { title: "Second" });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);

  // Whichever ran last (lock-serialized, not interleaved) determines the
  // final title — both patches must fully apply, never a torn mix of the two.
  const state = await loadState();
  assert.ok(
    state.sessionTitles["race-patches"] === "First" || state.sessionTitles["race-patches"] === "Second",
    "the final title must be exactly one of the two whole patches, never a partial write",
  );
});

console.log("client-v1/chat-service.test.ts: ok");
