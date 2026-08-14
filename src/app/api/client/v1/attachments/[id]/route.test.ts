// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-attachment-read-route-"));
const caveRoot = path.join(root, "cave");
const attachmentRoot = path.join(caveRoot, "chat-attachments");
process.env.COVEN_CAVE_HOME = caveRoot;
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = attachmentRoot;
process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = path.join(caveRoot, "client-v1-attachments.json");
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(root, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(root, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(root, "permission-config.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-attachment-read-secret";
await mkdir(attachmentRoot, { recursive: true });

const { GET } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const {
  parseClientAttachmentForm,
  resolveAndBindClientAttachments,
  saveUploadedClientAttachments,
} = await import("@/lib/server/client-v1/attachment-service.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { deleteConversation, saveConversation } = await import("@/lib/cave-conversations.ts");

const textBytes = Buffer.from("hello from a canonical attachment\n", "utf8");

after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
  resetRateLimitsForTest();
  await rm(process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH}.lock.sqlite3-wal`, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(process.env.CAVE_PROJECTS_PATH_OVERRIDE!, { force: true });
  await rm(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE!, { force: true });
  await rm(process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE!, { force: true });
  await rm(path.join(caveRoot, "config.json"), { force: true });
  await rm(attachmentRoot, { recursive: true, force: true });
  await mkdir(attachmentRoot, { recursive: true });
});

async function issue(scopes = ["chat:read"]) {
  return issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes,
  });
}

async function uploadForOwner(ownerCredentialId: string) {
  const form = new FormData();
  form.append("files", new File([textBytes], "notes.txt", { type: "text/plain" }));
  const parsed = await parseClientAttachmentForm(form);
  const [stored] = await saveUploadedClientAttachments(
    parsed,
    ownerCredentialId,
    "11111111-2222-4333-8444-555555555555",
    10,
  );
  return stored;
}

async function writeConfig(familiars: Record<string, unknown> = { charm: { harness: "claude" } }) {
  await writeFile(
    path.join(caveRoot, "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars,
      roles: [],
      addons: { github: false, code: false, browser: false, flow: false, journal: false, docs: false },
      marketplace: { installed: {} },
      multiHost: { mode: "hub", hubUrl: "http://127.0.0.1:9", executorUrls: [] },
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

async function seedConversation(sessionId: string, familiarId = "charm") {
  await saveConversation({
    sessionId,
    familiarId,
    harness: "claude",
    runtime: "local:",
    title: "Bound attachment conversation",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
}

function request(
  id: string,
  opts: {
    bearer?: string | null;
    marker?: string | null;
    range?: string;
    download?: boolean;
  } = {},
) {
  const headers = new Headers();
  if (opts.marker !== null) {
    headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  }
  if (opts.bearer !== undefined && opts.bearer !== null) {
    headers.set("authorization", "Bearer " + opts.bearer);
  }
  if (opts.range) headers.set("range", opts.range);
  const url = new URL(`http://localhost/api/client/v1/attachments/${encodeURIComponent(id)}`);
  if (opts.download) url.searchParams.set("download", "1");
  return {
    req: new Request(url, { headers }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

test("download requires the loopback marker and chat:read", async () => {
  const owner = await issue(["attachments:write", "chat:read"]);
  const uploaded = await uploadForOwner(owner.credential.id);

  const noMarker = await GET(...Object.values(request(uploaded.id, {
    bearer: owner.token,
    marker: null,
  })));
  assert.equal(noMarker.status, 403);

  const wrongScope = await issue(["attachments:write"]);
  const denied = await GET(...Object.values(request(uploaded.id, { bearer: wrongScope.token })));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "scope_denied");
});

test("an unbound attachment is owner-private until conversation binding, then becomes conversation-readable", async () => {
  const owner = await issue(["attachments:write", "chat:read"]);
  const other = await issue(["chat:read"]);
  const uploaded = await uploadForOwner(owner.credential.id);
  await writeConfig();
  await seedConversation("conversation-safe");

  const ownResponse = await GET(...Object.values(request(uploaded.id, { bearer: owner.token })));
  assert.equal(ownResponse.status, 200);
  assert.equal(ownResponse.headers.get("content-type"), "text/plain");
  assert.equal(ownResponse.headers.get("accept-ranges"), "bytes");
  assert.equal(ownResponse.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await ownResponse.arrayBuffer()), textBytes);

  const hidden = await GET(...Object.values(request(uploaded.id, { bearer: other.token })));
  assert.equal(hidden.status, 404);
  assert.equal((await hidden.json()).error.code, "not_found");

  await resolveAndBindClientAttachments([uploaded.id], owner.credential.id, "conversation-safe");
  const shared = await GET(...Object.values(request(uploaded.id, { bearer: other.token })));
  assert.equal(shared.status, 200);
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), textBytes);
});

test("download supports byte ranges and safe attachment filenames", async () => {
  const owner = await issue(["attachments:write", "chat:read"]);
  const other = await issue(["chat:read"]);
  const uploaded = await uploadForOwner(owner.credential.id);
  await writeConfig();
  await seedConversation("conversation-safe");
  await resolveAndBindClientAttachments([uploaded.id], owner.credential.id, "conversation-safe");

  const ranged = await GET(...Object.values(request(uploaded.id, {
    bearer: other.token,
    range: "bytes=0-4",
    download: true,
  })));
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 0-4/${textBytes.byteLength}`);
  assert.equal(ranged.headers.get("content-length"), "5");
  assert.match(ranged.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), textBytes.subarray(0, 5));

  const unsatisfiable = await GET(...Object.values(request(uploaded.id, {
    bearer: other.token,
    range: `bytes=${textBytes.byteLength}-`,
  })));
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${textBytes.byteLength}`);
  assert.equal((await unsatisfiable.json()).error.code, "invalid_request");
});

test("a bound attachment 404s once its conversation is deleted", async () => {
  const owner = await issue(["attachments:write", "chat:read"]);
  const other = await issue(["chat:read"]);
  const uploaded = await uploadForOwner(owner.credential.id);
  await writeConfig();
  await seedConversation("conversation-deleted");
  await resolveAndBindClientAttachments([uploaded.id], owner.credential.id, "conversation-deleted");
  await deleteConversation("conversation-deleted");

  const response = await GET(...Object.values(request(uploaded.id, { bearer: other.token })));
  assert.equal(response.status, 404, await response.clone().text());
  assert.equal((await response.json()).error.code, "not_found");
});

test("a bound attachment 404s when its owning conversation is no longer authorized by the canonical familiar/grant gate", async () => {
  const owner = await issue(["attachments:write", "chat:read"]);
  const other = await issue(["chat:read"]);
  const uploaded = await uploadForOwner(owner.credential.id);
  await writeConfig({ charm: { harness: "claude" } });
  await seedConversation("conversation-ghost-owner", "ghost-fam");
  await resolveAndBindClientAttachments([uploaded.id], owner.credential.id, "conversation-ghost-owner");

  const response = await GET(...Object.values(request(uploaded.id, { bearer: other.token })));
  assert.equal(response.status, 404, await response.clone().text());
  assert.equal((await response.json()).error.code, "not_found");
});
