// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import { CLIENT_V1_ADMIN_HEADER, CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const ROOT = path.join(process.cwd(), ".test-tmp", "client-v1-contract-snapshot");
const COVEN_HOME = path.join(ROOT, "home");
const PROJECT_ROOT = path.join(ROOT, "workspace", "project-alpha");
const FIXTURE_PATH = path.join(process.cwd(), "docs", "generated", "client-v1-contract-fixture.json");
const CHAT_FIXTURE_EXPORT_ENV = "COVEN_CLIENT_V1_CHAT_FIXTURE_PATH";
const UPDATE_FIXTURE = process.env.COVEN_UPDATE_CLIENT_V1_CONTRACT_FIXTURE === "1";

const LOCAL_SECRET = "client-v1-contract-fixture-secret";
const INSTANCE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INSTALLATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREDENTIAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "client-v1-contract-fixture-token";
const CONVERSATION_ID = "fixture-conversation";
const PROJECT_ID = "project-alpha";
const PROJECT_REPO_URL = "https://github.com/OpenCoven/example";
const PROJECT_TIMESTAMP = "2026-08-10T00:00:00.000Z";
const CONVERSATION_CREATED_AT = "2026-08-11T00:00:00.000Z";
const CONVERSATION_UPDATED_AT = "2026-08-11T00:00:05.000Z";
const ALL_SCOPES = [
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
];

process.env.COVEN_HOME = COVEN_HOME;
delete process.env.COVEN_SOCKET;
process.env.COVEN_CAVE_CLIENT_INSTANCE_ID_PATH = path.join(ROOT, "instance-id");
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(ROOT, "client-v1-credentials.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(ROOT, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(ROOT, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(ROOT, "permission-config.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_SECRET;

const { GET: healthGET } = await import("./health/route.ts");
const { GET: adminCredentialsGET } = await import("./admin/credentials/route.ts");
const { GET: familiarsGET } = await import("./familiars/route.ts");
const { GET: projectsGET } = await import("./projects/route.ts");
const { GET: conversationsGET } = await import("./conversations/route.ts");
const { GET: conversationGET } = await import("./conversations/[id]/route.ts");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions.ts");
const {
  CONV_DIR,
  clearConversationListMetadataCache,
} = await import("@/lib/cave-conversations.ts");
const { sessionsListCache } = await import("@/lib/server/sessions-list-cache.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const {
  classifyInitialChatResponse,
  createClientStreamTranslator,
} = await import("@/lib/server/client-v1/sse.ts");

let stopDaemon = async () => {};

after(async () => {
  await stopDaemon();
  await rm(ROOT, { recursive: true, force: true });
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function startDaemon() {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/familiars") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([
        {
          id: "charm",
          display_name: "Charm",
          role: "Companion",
          description: "Keeps the contract honest.",
          pronouns: "she/her",
          status: "online",
          emoji: "✨",
        },
      ]));
      return;
    }
    if (req.url === "/api/v1/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([]));
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

async function writeConfig(daemonUrl: string) {
  await mkdir(path.join(COVEN_HOME, "cave"), { recursive: true });
  await writeFile(
    path.join(COVEN_HOME, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "claude", model: "openai/gpt-5.6-sol" },
      familiars: { charm: { harness: "claude" } },
      roles: [],
      addons: {
        github: false,
        code: false,
        browser: false,
        flow: false,
        journal: false,
        docs: false,
      },
      marketplace: { installed: {} },
      multiHost: { mode: "hub", hubUrl: daemonUrl, executorUrls: [] },
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
    "utf8",
  );
}

async function writeProjects() {
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: PROJECT_ID,
          name: "Project Alpha",
          root: PROJECT_ROOT,
          repoUrl: PROJECT_REPO_URL,
          createdAt: PROJECT_TIMESTAMP,
          updatedAt: PROJECT_TIMESTAMP,
        },
      ],
      visibilityGeneration: "client-v1-contract-fixture",
    }),
    "utf8",
  );
}

async function seedCredential() {
  await writeFile(
    process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!,
    JSON.stringify({
      version: 1,
      credentials: [
        {
          id: CREDENTIAL_ID,
          appName: "OpenCoven Chat",
          installationId: INSTALLATION_ID,
          tokenHash: hashToken(TOKEN),
          scopes: ALL_SCOPES,
          createdAt: 1_723_241_600_000,
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    }),
    "utf8",
  );
}

async function writeConversationFixture() {
  await mkdir(CONV_DIR, { recursive: true });
  await writeFile(
    path.join(CONV_DIR, `${CONVERSATION_ID}.json`),
    JSON.stringify({
      sessionId: CONVERSATION_ID,
      familiarId: "charm",
      harness: "claude",
      runtime: "local:",
      title: "Lock the client contract",
      createdAt: CONVERSATION_CREATED_AT,
      updatedAt: CONVERSATION_UPDATED_AT,
      turns: [
        {
          id: "turn-1",
          role: "user",
          text: "Please lock the Cave client contract.",
          createdAt: "2026-08-11T00:00:01.000Z",
          parentId: null,
          attachments: [
            {
              storedId: "attachment-brief",
              name: "brief.txt",
              mimeType: "text/plain",
              size: 27,
            },
          ],
        },
        {
          id: "turn-2",
          role: "assistant",
          text: "The Cave client contract is locked and documented.",
          createdAt: "2026-08-11T00:00:02.000Z",
          parentId: "turn-1",
        },
      ],
      activeLeafId: "turn-2",
    }),
    "utf8",
  );
}

function localHeaders(token?: string | null): Headers {
  const headers = new Headers({ [CLIENT_V1_LOCAL_HEADER]: LOCAL_SECRET });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function localRequest(url: string, token?: string | null): Request {
  return new Request(url, { headers: localHeaders(token) });
}

function adminRequest(url: string): Request {
  return new Request(url, {
    headers: { [CLIENT_V1_ADMIN_HEADER]: LOCAL_SECRET },
  });
}

async function snapshotResponse(response: Response) {
  const body = await response.json();
  const etag = response.headers.get("etag");
  return {
    status: response.status,
    ...(etag ? { headers: { etag } } : {}),
    body,
  };
}

function normalizePaths(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/");
    const fixtureRoot = ROOT.replaceAll("\\", "/");
    return normalized.includes(fixtureRoot)
      ? normalized.split(fixtureRoot).join("<fixture-root>")
      : normalized;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizePaths(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizePaths(entry)]),
    );
  }
  return value;
}

async function resolveExplicitFixtureExportPath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const explicitExportPath = env[CHAT_FIXTURE_EXPORT_ENV]?.trim();
  if (!explicitExportPath) return null;
  if (!path.isAbsolute(explicitExportPath) || explicitExportPath.endsWith(path.sep) || !path.parse(explicitExportPath).base) {
    throw new Error(`${CHAT_FIXTURE_EXPORT_ENV} must be an absolute file path.`);
  }
  const parentDirectory = path.dirname(explicitExportPath);
  const parentInfo = await stat(parentDirectory).catch(() => null);
  if (!parentInfo?.isDirectory()) {
    throw new Error(`${CHAT_FIXTURE_EXPORT_ENV} parent directory must already exist.`);
  }
  return explicitExportPath;
}

async function writeFixtureCopies(value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, serialized, "utf8");
  const explicitExportPath = await resolveExplicitFixtureExportPath();
  if (explicitExportPath) await writeFile(explicitExportPath, serialized, "utf8");
}

function buildStreamSamples() {
  const context = {
    runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    conversationId: CONVERSATION_ID,
  };
  const successTranslator = createClientStreamTranslator(context);
  const successFrames: Array<{ id: number; data: unknown }> = [];
  let nextId = 1;
  for (const upstream of [
    { kind: "session", sessionId: "session-fixture" },
    { kind: "assistant_chunk", text: "Contract " },
    { kind: "assistant_replace", text: "Contract locked." },
    {
      kind: "progress",
      id: "progress-1",
      label: "Pairing approved",
      detail: "Waiting for exchange.",
      status: "running",
    },
    {
      kind: "tool_use",
      id: "tool-1",
      name: "shell",
      status: "completed",
      input: { command: "pnpm test:api" },
      output: { exitCode: 0 },
      durationMs: 1200,
    },
    { kind: "done", isError: false },
  ]) {
    const translated = successTranslator.translate(upstream);
    if (translated.event) {
      successFrames.push({ id: nextId++, data: translated.event });
    }
  }

  const reconcileTranslator = createClientStreamTranslator(context);
  reconcileTranslator.translate({ kind: "assistant_chunk", text: "Hello" });
  const reconcileRequired = reconcileTranslator.translate({
    kind: "assistant_replace",
    text: "Different branch",
  }).event;

  const failure = createClientStreamTranslator(context).translate({
    kind: "error",
    code: "service_unavailable",
    terminal: true,
  }).event;

  return {
    success: successFrames,
    reconcileRequired: { id: nextId++, data: reconcileRequired },
    runFailed: { id: nextId, data: failure },
  };
}

async function buildFixture() {
  await stopDaemon();
  stopDaemon = async () => {};
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(PROJECT_ROOT, { recursive: true });
  clearConversationListMetadataCache();
  sessionsListCache.clear();
  resetRateLimitsForTest();

  await writeFile(process.env.COVEN_CAVE_CLIENT_INSTANCE_ID_PATH!, `${INSTANCE_ID}\n`, "utf8");
  const daemonUrl = await startDaemon();
  await writeConfig(daemonUrl);
  await writeProjects();
  await grantProjectToFamiliar({
    familiarId: "charm",
    projectId: PROJECT_ID,
    access: "write",
    source: "human",
  });
  await seedCredential();
  await writeConversationFixture();

  const health = await snapshotResponse(
    await healthGET(localRequest("http://127.0.0.1/api/client/v1/health")),
  );
  const error = await snapshotResponse(
    await familiarsGET(localRequest("http://127.0.0.1/api/client/v1/familiars")),
  );
  const credentials = await snapshotResponse(
    await adminCredentialsGET(
      adminRequest("http://127.0.0.1/api/client/v1/admin/credentials"),
    ),
  );
  const familiars = await snapshotResponse(
    await familiarsGET(localRequest("http://127.0.0.1/api/client/v1/familiars", TOKEN)),
  );
  const projects = await snapshotResponse(
    await projectsGET(
      localRequest(`http://127.0.0.1/api/client/v1/projects?familiarId=charm`, TOKEN),
    ),
  );
  const conversations = await snapshotResponse(
    await conversationsGET(localRequest("http://127.0.0.1/api/client/v1/conversations", TOKEN)),
  );
  const conversation = await snapshotResponse(
    await conversationGET(
      localRequest(`http://127.0.0.1/api/client/v1/conversations/${CONVERSATION_ID}`, TOKEN),
      { params: Promise.resolve({ id: CONVERSATION_ID }) },
    ),
  );
  const unsupported = classifyInitialChatResponse(
    new Response(null, { status: 501, headers: { "content-type": "application/json" } }),
  );
  assert.equal(unsupported.kind, "prelaunch_failure");

  return normalizePaths({
    health,
    error,
    credentials,
    familiars,
    projects,
    conversations,
    conversation,
    unsupported: await snapshotResponse(unsupported.response),
    streamEvents: buildStreamSamples(),
  });
}

async function readFixture() {
  try {
    return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  } catch (error) {
    const message =
      error && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ? `Missing ${FIXTURE_PATH}. Re-run this test with COVEN_UPDATE_CLIENT_V1_CONTRACT_FIXTURE=1 to generate it.`
        : `Could not read ${FIXTURE_PATH}.`;
    throw new Error(message);
  }
}

test("client-v1 public contract fixture stays locked to the live route shapes", async () => {
  const actual = await buildFixture();
  if (UPDATE_FIXTURE) {
    await writeFixtureCopies(actual);
  }
  const expected = await readFixture();
  assert.deepEqual(actual, expected);
});

test("client-v1 fixture export path requires an absolute file path whose parent already exists", async () => {
  await assert.rejects(
    () => resolveExplicitFixtureExportPath({ [CHAT_FIXTURE_EXPORT_ENV]: "relative/contract-fixture.json" }),
    /absolute file path/,
  );
  await assert.rejects(
    () => resolveExplicitFixtureExportPath({
      [CHAT_FIXTURE_EXPORT_ENV]: path.join(ROOT, "missing", "contract-fixture.json"),
    }),
    /parent directory must already exist/,
  );
});

console.log("client-v1-contract.snapshot.test.ts: ok");
