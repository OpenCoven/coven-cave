// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /collapseFamiliarWorkspace\s*=\s*\n?\s*url\.searchParams\.get\("collapseFamiliarWorkspace"\)\s*===\s*"1"/,
  "the list route parses the opt-in collapseFamiliarWorkspace query param",
);

assert.match(
  source,
  /cacheKey\s*=[\s\S]{0,160}collapseFamiliarWorkspace\s*\?\s*"collapse"\s*:\s*"full"/,
  "the cache key varies by collapse mode so full and collapsed views never alias",
);

assert.match(
  source,
  /computeSessionsList\(includeArchived,\s*familiarId,\s*collapseFamiliarWorkspace\)/,
  "the collapse flag is threaded into computeSessionsList",
);

assert.match(
  source,
  /if \(!collapseFamiliarWorkspace\) return sessions;/,
  "the collapse helper is a no-op (and skips the FS read) when the flag is off",
);

assert.equal(
  (source.match(/applyFamiliarWorkspaceCollapse\(/g) || []).length,
  3,
  "applyFamiliarWorkspaceCollapse is defined once and called in BOTH the happy and degraded paths",
);

assert.match(
  source,
  /if \(hasActiveChatRun\(conv\.sessionId\)\) return \{ \.\.\.conv, status: "running", exitCode: 0 \};\s*\n\s*if \(conv\.pending\) return \{ \.\.\.conv, status: "failed", exitCode: 1 \};\s*\n\s*return conv;/,
  "all active conversations resolve running via the live-run registry while inactive pending stubs fail",
);
assert.match(
  source,
  /import \{ hasActiveChatRun \} from "@\/lib\/server\/chat-stop-registry"/,
  "the liveness probe comes from the in-process chat run registry",
);
assert.match(
  source,
  /mergeSessionRows\(\{[\s\S]*?\}\)\.map\(\(session\) =>\s*\n?\s*hasActiveChatRun\(session\.id\)\s*\n?\s*\? \{ \.\.\.session, status: "running", exit_code: 0, attention: NO_CHAT_ATTENTION \}\s*\n?\s*: session\s*\)/,
  "registry liveness overrides merged daemon status and stale attention",
);

const previousEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};
const scratchRoot = path.join(process.cwd(), `.slrt-${process.pid}`);
const covenHome = path.join(scratchRoot, "h");
const projectRoot = path.join(scratchRoot, "p");
const configPath = path.join(covenHome, "cave", "config.json");

let stopDaemon = async () => {};
let daemonBaseUrl = "http://127.0.0.1:9";

function request(url = "http://127.0.0.1/api/sessions/list") {
  return new Request(url, { headers: { host: "127.0.0.1" } });
}

function daemonRow(id: string, updatedAt: string) {
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

try {
  process.env.COVEN_HOME = covenHome;
  delete process.env.COVEN_SOCKET;
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;

  const route = await import("./route.ts");
  const {
    clearConversationListMetadataCache,
    getConversationListMetrics,
    saveConversation,
  } = await import("../../../../lib/cave-conversations.ts");
  const {
    registerChatRun,
    unregisterChatRun,
  } = await import("../../../../lib/server/chat-stop-registry.ts");
  const { sessionsListCache } = await import("../../../../lib/server/sessions-list-cache.ts");

  async function resetFixtures() {
    await stopDaemon();
    stopDaemon = async () => {};
    await rm(scratchRoot, { recursive: true, force: true });
    await mkdir(covenHome, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    clearConversationListMetadataCache();
    sessionsListCache.clear();
  }

  async function writeHubConfig(
    url: string,
    chatAutoArchive?: {
      enabled?: boolean;
      archiveOnTaskCompletion?: boolean;
      archiveOnReflection?: boolean;
      archiveOnPrMerge?: boolean;
      externalAfterDays?: number;
      idleAfterDays?: number;
    },
  ) {
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
        ...(chatAutoArchive ? { chatAutoArchive } : {}),
      }),
    );
  }

  async function seedConversations() {
    await saveConversation({
      sessionId: "route-valid",
      familiarId: "charm",
      harness: "claude",
      runtime: `local:${projectRoot}`,
      title: "Route valid",
      createdAt: "2026-08-04T17:00:00.000Z",
      updatedAt: "2026-08-04T18:00:00.000Z",
      turns: [
        {
          id: "valid-user",
          role: "user",
          text: "Should I ship it?",
          attentionClearOperationId: "run-route-valid",
          createdAt: "2026-08-04T17:00:00.000Z",
          parentId: null,
        },
        {
          id: "valid-assistant",
          role: "assistant",
          text: "I need your approval.",
          createdAt: "2026-08-04T18:00:00.000Z",
          parentId: "valid-user",
          responseMetadata: {
            familiarId: "charm",
            harness: "claude",
            model: "anthropic/claude-sonnet-4.6",
            runtime: `local:${projectRoot}`,
            attentionRequest: {
              sessionId: "route-valid",
              turnId: "valid-assistant",
              requestedAt: "2026-08-04T18:00:00.000Z",
              reason: "approval",
            },
          },
        },
      ],
      activeLeafId: "valid-assistant",
    });

    await saveConversation({
      sessionId: "route-malformed",
      familiarId: "charm",
      harness: "claude",
      runtime: `local:${projectRoot}`,
      title: "Route malformed",
      createdAt: "2026-08-04T17:05:00.000Z",
      updatedAt: "2026-08-04T18:05:00.000Z",
      turns: [
        {
          id: "malformed-user",
          role: "user",
          text: "Need anything else?",
          createdAt: "2026-08-04T17:05:00.000Z",
          parentId: null,
        },
        {
          id: "malformed-assistant",
          role: "assistant",
          text: "The marker is corrupt.",
          createdAt: "2026-08-04T18:05:00.000Z",
          parentId: "malformed-user",
          responseMetadata: {
            familiarId: "charm",
            harness: "claude",
            model: "anthropic/claude-sonnet-4.6",
            runtime: `local:${projectRoot}`,
            attentionRequest: {
              sessionId: "route-malformed",
              turnId: "malformed-assistant",
              requestedAt: "not-a-date",
              reason: "approval",
            },
          },
        },
      ],
      activeLeafId: "malformed-assistant",
    });

    await saveConversation({
      sessionId: "route-replay-primary",
      familiarId: "charm",
      harness: "codex",
      runtime: `local:${projectRoot}`,
      title: "Replay primary",
      createdAt: "2026-08-04T17:15:00.000Z",
      updatedAt: "2026-08-04T19:33:00.000Z",
      harnessSessionId: "codex-thread-route-replay",
      replaySessions: [
        {
          sessionId: "route-replay-old",
          conversationId: "codex-thread-route-replay",
          createdAt: "2026-08-04T17:20:00.000Z",
          updatedAt: "2026-08-04T17:25:00.000Z",
        },
        {
          sessionId: "route-replay-new",
          conversationId: "codex-thread-route-replay",
          createdAt: "2026-08-04T19:20:00.000Z",
          updatedAt: "2026-08-04T19:33:00.000Z",
        },
      ],
      turns: [
        {
          id: "route-replay-user",
          role: "user",
          text: "Replay this when I'm back online.",
          createdAt: "2026-08-04T17:15:00.000Z",
          parentId: null,
        },
      ],
      activeLeafId: "route-replay-user",
    });

    await saveConversation({
      sessionId: "route-multi-root",
      familiarId: "charm",
      harness: "claude",
      runtime: `local:${projectRoot}`,
      title: "Route multi-root",
      createdAt: "2026-08-04T17:10:00.000Z",
      updatedAt: "2026-08-04T18:10:00.000Z",
      turns: [
        {
          id: "route-multi-root-request-user",
          role: "user",
          text: "Do you need approval?",
          createdAt: "2026-08-04T17:10:00.000Z",
          parentId: null,
        },
        {
          id: "route-multi-root-request-assistant",
          role: "assistant",
          text: "I need your approval.",
          createdAt: "2026-08-04T17:11:00.000Z",
          parentId: "route-multi-root-request-user",
          responseMetadata: {
            familiarId: "charm",
            harness: "claude",
            model: "anthropic/claude-sonnet-4.6",
            runtime: `local:${projectRoot}`,
            attentionRequest: {
              sessionId: "route-multi-root",
              turnId: "route-multi-root-request-assistant",
              requestedAt: "2026-08-04T17:11:00.000Z",
              reason: "approval",
            },
          },
        },
        {
          id: "route-multi-root-active-user",
          role: "user",
          text: "Actually, just summarize it.",
          createdAt: "2026-08-04T17:12:00.000Z",
          parentId: null,
        },
        {
          id: "route-multi-root-active-assistant",
          role: "assistant",
          text: "Here is the summary.",
          createdAt: "2026-08-04T18:10:00.000Z",
          parentId: "route-multi-root-active-user",
        },
      ],
      activeLeafId: "route-multi-root-active-assistant",
    });

    const sweptConversation = {
      sessionId: "route-swept",
      familiarId: "charm",
      harness: "claude",
      runtime: `local:${projectRoot}`,
      title: "Route swept",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T11:00:00.000Z",
      turns: [
        {
          id: "swept-user",
          role: "user",
          text: "Still need approval?",
          createdAt: "2026-08-01T10:00:00.000Z",
          parentId: null,
        },
        {
          id: "swept-assistant",
          role: "assistant",
          text: "Yes, please approve it.",
          createdAt: "2026-08-01T11:00:00.000Z",
          parentId: "swept-user",
          responseMetadata: {
            familiarId: "charm",
            harness: "claude",
            model: "anthropic/claude-sonnet-4.6",
            runtime: `local:${projectRoot}`,
            attentionRequest: {
              sessionId: "route-swept",
              turnId: "swept-assistant",
              requestedAt: "2026-08-01T11:00:00.000Z",
              reason: "approval",
            },
          },
        },
      ],
      activeLeafId: "swept-assistant",
    };
    await saveConversation(sweptConversation);
    await writeFile(
      path.join(covenHome, "cave", "conversations", "route-swept.json"),
      JSON.stringify({ ...sweptConversation, updatedAt: "2026-08-01T11:00:00.000Z" }),
    );
  }

  async function startDaemon(rows: unknown[]) {
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
    daemonBaseUrl = `http://127.0.0.1:${address.port}`;
    stopDaemon = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }

  async function fetchSessions(url?: string) {
    const response = await route.GET(request(url));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }

  const realNow = Date.now;
  Date.now = () => Date.parse("2026-08-04T20:00:00.000Z");
  try {
    await resetFixtures();
    await seedConversations();
    await startDaemon([
      daemonRow("route-valid", "2026-08-04T19:30:00.000Z"),
      daemonRow("route-malformed", "2026-08-04T19:31:00.000Z"),
      daemonRow("route-multi-root", "2026-08-04T19:32:00.000Z"),
      { ...daemonRow("route-replay-old", "2026-08-04T17:25:00.000Z"), conversation_id: "codex-thread-route-replay" },
      { ...daemonRow("route-replay-new", "2026-08-04T19:33:00.000Z"), conversation_id: "codex-thread-route-replay" },
    ]);
    await writeHubConfig(daemonBaseUrl);

    clearConversationListMetadataCache();
    sessionsListCache.clear();
    const healthyBefore = getConversationListMetrics().scanCount;
    const healthy = await fetchSessions();
    assert.equal(healthy.ok, true);
    assert.equal(healthy.degraded, undefined);
    assert.equal(
      getConversationListMetrics().scanCount,
      healthyBefore + 1,
      "healthy path scans the transcript cache once before mergeSessionRows reuses the summaries",
    );
    const healthyById = new Map(healthy.sessions.map((row) => [row.id, row]));
    assert.deepEqual(healthyById.get("route-valid")?.attention, {
      state: "awaiting-human",
      since: "2026-08-04T18:00:00.000Z",
      reason: "approval",
    });
    assert.equal(
      healthyById.get("route-valid")?.attentionAfterOperationId,
      "run-route-valid",
      "healthy rows project the active human send's causal identity",
    );
    assert.equal(
      healthyById.get("route-malformed")?.attentionAfterOperationId,
      null,
      "legacy rows without causal evidence remain explicitly unknown",
    );
    assert.deepEqual(
      healthyById.get("route-malformed")?.attention,
      {
        state: "none",
        since: null,
        reason: null,
      },
      "malformed attention evidence fails quiet without dropping the daemon-backed row",
    );
    assert.deepEqual(
      healthyById.get("route-multi-root")?.attention,
      {
        state: "none",
        since: null,
        reason: null,
      },
      "an explicit active leaf ignores an inactive root sibling's request; its own request-free branch reports none in the merged route response",
    );
    assert.equal(
      healthy.sessions.filter((row) => row.id === "route-replay-primary").length,
      1,
      "the canonical replay conversation stays a single sidebar row",
    );
    assert.equal(
      healthyById.get("route-replay-primary")?.daemonSessionId,
      "route-replay-new",
      "the list serializes the newest replay daemon id on the canonical conversation row",
    );
    assert.equal(
      healthyById.get("route-replay-old")?.daemonSessionId,
      "route-replay-old",
      "older replay history rows keep their own daemon trace ids",
    );
    assert.equal(
      "daemonSessionId" in (healthyById.get("route-malformed") ?? {}),
      true,
      "daemon-backed rows may serialize their explicit daemon id consistently",
    );

    const activeHandle = registerChatRun(["route-valid"], () => {});
    const active = await fetchSessions();
    const activeRow = new Map(active.sessions.map((row) => [row.id, row])).get("route-valid");
    assert.equal(activeRow?.status, "running", "an in-flight follow-up marks an existing chat running");
    assert.deepEqual(
      activeRow?.attention,
      { state: "none", since: null, reason: null },
      "an in-flight follow-up suppresses the prior assistant request",
    );
    unregisterChatRun(activeHandle);
    const settled = await fetchSessions();
    assert.deepEqual(
      new Map(settled.sessions.map((row) => [row.id, row])).get("route-valid")?.attention,
      {
        state: "awaiting-human",
        since: "2026-08-04T18:00:00.000Z",
        reason: "approval",
      },
      "settling the run invalidates the cached running row and restores canonical attention",
    );

    await stopDaemon();
    stopDaemon = async () => {};
    clearConversationListMetadataCache();
    sessionsListCache.clear();
    const degradedBefore = getConversationListMetrics().scanCount;
    const degraded = await fetchSessions();
    assert.equal(degraded.ok, true);
    assert.equal(degraded.degraded, true);
    assert.equal(
      getConversationListMetrics().scanCount,
      degradedBefore + 1,
      "degraded path still scans local transcripts once and threads those summaries into the local fallback rows",
    );
    const degradedById = new Map(degraded.sessions.map((row) => [row.id, row]));
    assert.deepEqual(degradedById.get("route-valid")?.attention, {
      state: "awaiting-human",
      since: "2026-08-04T18:00:00.000Z",
      reason: "approval",
    });
    assert.equal(
      degradedById.get("route-valid")?.attentionAfterOperationId,
      "run-route-valid",
      "daemon-degraded rows preserve the same stable transcript evidence",
    );
    assert.deepEqual(degradedById.get("route-malformed")?.attention, {
      state: "none",
      since: null,
      reason: null,
    });
    assert.deepEqual(degradedById.get("route-multi-root")?.attention, {
      state: "none",
      since: null,
      reason: null,
    });

    await writeHubConfig(daemonBaseUrl, {
      enabled: true,
      archiveOnTaskCompletion: false,
      archiveOnReflection: false,
      archiveOnPrMerge: false,
      externalAfterDays: 0,
      idleAfterDays: 1,
    });
    clearConversationListMetadataCache();
    sessionsListCache.clear();
    const sweptArchived = await fetchSessions("http://127.0.0.1/api/sessions/list?includeArchived=1");
    const sweptRow = new Map(sweptArchived.sessions.map((row) => [row.id, row])).get("route-swept");
    assert.ok(sweptRow?.archived_at, "the stale row is stamped archived by the sweep");
    assert.deepEqual(
      sweptRow?.attention,
      {
        state: "none",
        since: null,
        reason: null,
      },
      "a row archived by the sweep drops any pre-sweep attention in the same response",
    );
  } finally {
    Date.now = realNow;
  }
} finally {
  await stopDaemon();
  if (previousEnv.COVEN_HOME === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousEnv.COVEN_HOME;
  if (previousEnv.COVEN_SOCKET === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = previousEnv.COVEN_SOCKET;
  if (previousEnv.CAVE_PROJECTS_PATH_OVERRIDE === undefined) {
    delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  } else {
    process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousEnv.CAVE_PROJECTS_PATH_OVERRIDE;
  }
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("sessions list route.test.ts: ok");
