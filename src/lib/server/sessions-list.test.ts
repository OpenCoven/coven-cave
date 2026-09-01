// @ts-nocheck
/**
 * The read-only contract of the extracted session-list compute.
 *
 * `computeSessionsList` is named like a read and is not one by default: the
 * auto-archive sweeps it runs WRITE cave state. The dashboard read calls it with
 * `sweepArchives: false`, and this file proves that flag actually suppresses the
 * write rather than merely being threaded through — asserted against the state
 * file on disk, because a source-text check ("the flag is passed") would pass
 * against an implementation that passed it and ignored it.
 *
 * The complementary direction is asserted too: with the default options the
 * sweep still happens, so the extraction cannot silently disable the archiving
 * that `/api/sessions/list`'s 4-second poll is the only thing driving.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const previousEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
};
const scratchRoot = path.join(process.cwd(), `.slct-${process.pid}`);
const covenHome = path.join(scratchRoot, "h");
const projectsPath = path.join(scratchRoot, "projects.json");
const permissionsPath = path.join(scratchRoot, "project-permissions.json");
const projectRoot = path.join(scratchRoot, "p");
const familiarRootProject = path.join(covenHome, "workspaces", "familiars", "nova");
const familiarNestedProject = path.join(familiarRootProject, "notes");
const relocatedProjectRoot = path.join(scratchRoot, "relocated-nova");
const normalProjectRoot = path.join(scratchRoot, "repo");
const rootlessCwd = path.join(scratchRoot, "scratch");
const configPath = path.join(covenHome, "cave", "config.json");

let stopDaemon = async () => {};

async function startDaemon(rows) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  stopDaemon = async () =>
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return `http://127.0.0.1:${port}`;
}

async function writeConfig(url) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: {},
      roles: [],
      addons: {},
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
      // Idle sweep on, aggressive enough that the seeded stale chat is due.
      chatAutoArchive: {
        enabled: true,
        archiveOnTaskCompletion: false,
        archiveOnReflection: false,
        archiveOnPrMerge: false,
        externalAfterDays: 0,
        idleAfterDays: 1,
      },
    }),
  );
}

const STALE = {
  sessionId: "stale-chat",
  familiarId: "charm",
  harness: "claude",
  runtime: null,
  title: "Stale chat",
  createdAt: "2000-08-01T10:00:00.000Z",
  updatedAt: "2000-08-01T11:00:00.000Z",
  turns: [
    {
      id: "u1",
      role: "user",
      text: "Anything left?",
      createdAt: "2000-08-01T10:00:00.000Z",
      parentId: null,
    },
    {
      id: "a1",
      role: "assistant",
      text: "No.",
      createdAt: "2000-08-01T11:00:00.000Z",
      parentId: "u1",
    },
  ],
  activeLeafId: "a1",
};

function chat(sessionId, runtime, updatedAt) {
  return {
    sessionId,
    familiarId: "charm",
    harness: "claude",
    runtime,
    title: sessionId,
    createdAt: updatedAt,
    updatedAt,
    turns: [
      {
        id: `${sessionId}-u`,
        role: "user",
        text: "Anything left?",
        createdAt: updatedAt,
        parentId: null,
      },
      {
        id: `${sessionId}-a`,
        role: "assistant",
        text: "No.",
        createdAt: updatedAt,
        parentId: `${sessionId}-u`,
      },
    ],
    activeLeafId: `${sessionId}-a`,
  };
}

async function saveFixtureConversation(saveConversation, clearConversationListMetadataCache, conversation) {
  const createdAt = conversation.createdAt;
  const updatedAt = conversation.updatedAt;
  await saveConversation(conversation);
  const convPath = path.join(covenHome, "cave", "conversations", `${conversation.sessionId}.json`);
  const saved = JSON.parse(await readFile(convPath, "utf8"));
  await writeFile(
    convPath,
    JSON.stringify({ ...saved, createdAt, updatedAt }),
  );
  clearConversationListMetadataCache();
}

async function writeProjects(clearCaveStoreReadCache) {
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: "familiar-root",
          name: "Familiar Root",
          root: familiarRootProject,
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "familiar-nested",
          name: "Familiar Nested",
          root: familiarNestedProject,
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "relocated",
          name: "Relocated Familiar",
          root: relocatedProjectRoot,
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "normal",
          name: "Normal Project",
          root: normalProjectRoot,
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "stale",
          name: "Stale Project",
          root: projectRoot,
          createdAt: "2000-08-01T00:00:00.000Z",
          updatedAt: "2000-08-01T00:00:00.000Z",
        },
      ],
    }),
  );
  clearCaveStoreReadCache();
}

async function writeFamiliarsToml(clearCaveStoreReadCache) {
  await writeFile(
    path.join(covenHome, "familiars.toml"),
    `[[familiar]]
id = "nova"
workspace = "${relocatedProjectRoot}"
`,
  );
  clearCaveStoreReadCache();
}

async function writePermissions() {
  await writeFile(
    permissionsPath,
    JSON.stringify({
      version: 2,
      projectGrants: [
        {
          familiarId: "nova",
          projectId: "relocated",
          access: "write",
          source: "human",
          grantedAt: "2026-08-23T00:00:00.000Z",
        },
      ],
      accessGroups: [],
      grantProposals: [],
      permissionAudit: [],
      grantAudit: [],
      repairAudit: [],
    }),
  );
}

const realNow = Date.now;
try {
  process.env.COVEN_HOME = covenHome;
  delete process.env.COVEN_SOCKET;
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = permissionsPath;

  const { computeSessionsList } = await import("./sessions-list.ts");
  const { loadState } = await import("../cave-config.ts");
  const { saveConversation, clearConversationListMetadataCache } = await import(
    "../cave-conversations.ts"
  );
  const { clearCaveStoreReadCache } = await import("./store-read-cache.ts");

  async function reset() {
    await rm(scratchRoot, { recursive: true, force: true });
    await mkdir(covenHome, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await mkdir(familiarRootProject, { recursive: true });
    await mkdir(familiarNestedProject, { recursive: true });
    await mkdir(relocatedProjectRoot, { recursive: true });
    await mkdir(normalProjectRoot, { recursive: true });
    await mkdir(rootlessCwd, { recursive: true });
    await mkdir(path.dirname(projectsPath), { recursive: true });
    await writeProjects(clearCaveStoreReadCache);
    await writeFamiliarsToml(clearCaveStoreReadCache);
    await writePermissions();
    clearConversationListMetadataCache();
    clearCaveStoreReadCache();
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      { ...STALE, runtime: `local:${projectRoot}` },
    );
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      chat("familiar-root", `local:${familiarRootProject}`, "2099-08-23T11:00:00.000Z"),
    );
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      chat("familiar-nested", `local:${familiarNestedProject}`, "2099-08-23T11:05:00.000Z"),
    );
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      chat("familiar-relocated", `local:${relocatedProjectRoot}`, "2099-08-23T11:10:00.000Z"),
    );
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      chat("normal-project", `local:${normalProjectRoot}`, "2099-08-23T11:15:00.000Z"),
    );
    await saveFixtureConversation(
      saveConversation,
      clearConversationListMetadataCache,
      chat("rootless", `local:${rootlessCwd}`, "2099-08-23T11:20:00.000Z"),
    );
  }

  /** sessionIds cave state currently records as archived. */
  async function archivedIds() {
    const state = await loadState();
    return Object.keys(state.sessionArchived ?? {}).sort();
  }

  Date.now = () => Date.parse("2026-08-23T12:00:00.000Z");

  let daemonUrl = await startDaemon([]);

  // --- read-only: the sweep must not run --------------------------------
  await reset();
  await writeConfig(daemonUrl);
  const before = await archivedIds();

  const readOnly = await computeSessionsList(false, null, false, {
    sweepArchives: false,
    enrichGit: false,
  });
  assert.equal(readOnly.payload.ok, true, "the read-only compute still returns a list");
  const readOnlyIds = readOnly.payload.sessions.map((row) => row.id);
  assert.deepEqual(
    readOnlyIds,
    [
      "rootless",
      "normal-project",
      "familiar-relocated",
      "familiar-nested",
      "familiar-root",
      "stale-chat",
    ],
    "read-only classification-off compute keeps the same session membership",
  );
  for (const row of readOnly.payload.sessions) {
    assert.equal(
      row.familiarWorkspace,
      undefined,
      "classification remains absent unless explicitly requested",
    );
  }

  assert.deepEqual(
    await archivedIds(),
    before,
    "computeSessionsList with sweepArchives:false archived a session — a dashboard GET must never mutate cave state",
  );

  const classified = await computeSessionsList(false, null, false, {
    sweepArchives: false,
    enrichGit: false,
    classifyFamiliarWorkspace: true,
  });
  assert.equal(classified.payload.ok, true, "opt-in classification returns a list");
  assert.deepEqual(
    classified.payload.sessions.map((row) => row.id),
    readOnlyIds,
    "trusted familiar-workspace classification is metadata-only and does not change result membership",
  );
  const classifiedById = new Map(classified.payload.sessions.map((row) => [row.id, row]));
  assert.equal(classifiedById.get("familiar-root")?.familiarWorkspace, true);
  assert.equal(classifiedById.get("familiar-nested")?.familiarWorkspace, true);
  assert.equal(classifiedById.get("familiar-relocated")?.familiarWorkspace, true);
  assert.equal(classifiedById.get("normal-project")?.familiarWorkspace, false);
  assert.equal(classifiedById.get("rootless")?.familiarWorkspace, false);
  assert.equal(classifiedById.get("stale-chat")?.familiarWorkspace, false);
  assert.deepEqual(
    await archivedIds(),
    before,
    "computeSessionsList classification archived a session despite sweepArchives:false",
  );

  await stopDaemon();
  stopDaemon = async () => {};
  const beforeDegraded = await archivedIds();
  const degradedClassified = await computeSessionsList(false, null, false, {
    sweepArchives: false,
    enrichGit: false,
    classifyFamiliarWorkspace: true,
  });
  assert.equal(degradedClassified.payload.ok, true, "degraded compute still returns local rows");
  assert.equal(degradedClassified.payload.degraded, true);
  assert.deepEqual(
    degradedClassified.payload.sessions.map((row) => row.id),
    readOnlyIds,
    "degraded classification keeps the same session membership",
  );
  const degradedById = new Map(degradedClassified.payload.sessions.map((row) => [row.id, row]));
  assert.equal(degradedById.get("familiar-root")?.familiarWorkspace, true);
  assert.equal(degradedById.get("familiar-nested")?.familiarWorkspace, true);
  assert.equal(degradedById.get("familiar-relocated")?.familiarWorkspace, true);
  assert.equal(degradedById.get("normal-project")?.familiarWorkspace, false);
  assert.equal(degradedById.get("rootless")?.familiarWorkspace, false);
  assert.equal(degradedById.get("stale-chat")?.familiarWorkspace, false);
  assert.deepEqual(
    await archivedIds(),
    beforeDegraded,
    "degraded computeSessionsList classification archived a session despite sweepArchives:false",
  );

  // --- default: the sweep still runs ------------------------------------
  await reset();
  daemonUrl = await startDaemon([]);
  await writeConfig(daemonUrl);

  const swept = await computeSessionsList(true, null, false);
  assert.equal(swept.payload.ok, true);

  const afterDefault = await archivedIds();
  assert.ok(
    afterDefault.includes("stale-chat"),
    "the default compute must still perform the idle sweep the session poll is the only driver of; " +
      `archived ids were ${JSON.stringify(afterDefault)}`,
  );

  await reset();
  await writeConfig(daemonUrl);
  const scopedClassified = await computeSessionsList(false, "nova", false, {
    classifyFamiliarWorkspace: true,
  });
  assert.equal(scopedClassified.payload.ok, true, "scoped classified compute still returns a list");
  assert.deepEqual(
    scopedClassified.payload.sessions.map((row) => row.id),
    ["rootless", "familiar-relocated"],
    "familiar-scoped classification keeps only granted and rootless rows while preserving familiar-workspace metadata",
  );
  const scopedClassifiedById = new Map(
    scopedClassified.payload.sessions.map((row) => [row.id, row]),
  );
  assert.equal(scopedClassifiedById.get("familiar-relocated")?.familiarWorkspace, true);
  assert.equal(scopedClassifiedById.get("rootless")?.familiarWorkspace, false);
  assert.ok(
    (await archivedIds()).includes("stale-chat"),
    "the explicit scoped classified compute still preserves the default idle sweep",
  );

  // The positive control above is what makes the negative one meaningful: if
  // the fixture were simply never due for archiving, the read-only assertion
  // would pass against an implementation that ignored the flag entirely.

  // --- and the PRODUCTION wiring, not just the option -------------------
  //
  // The two cases above prove the flag works. They say nothing about whether
  // the dashboard actually passes it: dropping the options bag from
  // familiarDashboardDependencies() leaves every assertion above green while
  // making a dashboard GET archive the operator's chats again. So the real
  // dependency object is exercised here, against the same aged fixture.
  await reset();
  await writeConfig(daemonUrl);
  const beforeProduction = await archivedIds();

  const { familiarDashboardDependencies } = await import("./familiar-dashboard-data.ts");
  const sessions = await familiarDashboardDependencies().loadSessions("charm");
  assert.ok(Array.isArray(sessions.sessions), "the production loader returns a session list");

  assert.deepEqual(
    await archivedIds(),
    beforeProduction,
    "familiarDashboardDependencies().loadSessions archived a session — the dashboard's read-only opt-out is not wired through",
  );
} finally {
  Date.now = realNow;
  await stopDaemon();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("sessions-list.test.ts: ok");
