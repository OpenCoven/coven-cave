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
};
const scratchRoot = path.join(process.cwd(), `.slct-${process.pid}`);
const covenHome = path.join(scratchRoot, "h");
const projectRoot = path.join(scratchRoot, "p");
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
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T11:00:00.000Z",
  turns: [
    {
      id: "u1",
      role: "user",
      text: "Anything left?",
      createdAt: "2026-08-01T10:00:00.000Z",
      parentId: null,
    },
    {
      id: "a1",
      role: "assistant",
      text: "No.",
      createdAt: "2026-08-01T11:00:00.000Z",
      parentId: "u1",
    },
  ],
  activeLeafId: "a1",
};

const realNow = Date.now;
try {
  process.env.COVEN_HOME = covenHome;
  delete process.env.COVEN_SOCKET;
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;

  const { computeSessionsList } = await import("./sessions-list.ts");
  const { loadState } = await import("../cave-config.ts");
  const { saveConversation, clearConversationListMetadataCache } = await import(
    "../cave-conversations.ts"
  );

  async function reset() {
    await rm(scratchRoot, { recursive: true, force: true });
    await mkdir(covenHome, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    clearConversationListMetadataCache();
    await saveConversation({ ...STALE, runtime: `local:${projectRoot}` });
    // saveConversation stamps `updatedAt` with the wall clock, so the row it
    // produces is always zero days idle and would never be due for the sweep.
    // Rewriting the file is how the sibling route test ages a fixture, and it
    // is what makes the positive control below actually exercise the sweep.
    const convPath = path.join(covenHome, "cave", "conversations", `${STALE.sessionId}.json`);
    const saved = JSON.parse(await readFile(convPath, "utf8"));
    await writeFile(
      convPath,
      JSON.stringify({ ...saved, updatedAt: STALE.updatedAt }),
    );
    clearConversationListMetadataCache();
  }

  /** sessionIds cave state currently records as archived. */
  async function archivedIds() {
    const state = await loadState();
    return Object.keys(state.sessionArchived ?? {}).sort();
  }

  Date.now = () => Date.parse("2026-08-23T12:00:00.000Z");

  const daemonUrl = await startDaemon([]);

  // --- read-only: the sweep must not run --------------------------------
  await reset();
  await writeConfig(daemonUrl);
  const before = await archivedIds();

  const readOnly = await computeSessionsList(false, null, false, {
    sweepArchives: false,
    enrichGit: false,
  });
  assert.equal(readOnly.payload.ok, true, "the read-only compute still returns a list");

  assert.deepEqual(
    await archivedIds(),
    before,
    "computeSessionsList with sweepArchives:false archived a session — a dashboard GET must never mutate cave state",
  );

  // --- default: the sweep still runs ------------------------------------
  await reset();
  await writeConfig(daemonUrl);

  const swept = await computeSessionsList(true, null, false);
  assert.equal(swept.payload.ok, true);

  const afterDefault = await archivedIds();
  assert.ok(
    afterDefault.includes("stale-chat"),
    "the default compute must still perform the idle sweep the session poll is the only driver of; " +
      `archived ids were ${JSON.stringify(afterDefault)}`,
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
