// cave-v3ajh: BEHAVIOURAL coverage for criterion 4 of #4816 — attached X posts
// are hydrated into a mission run just in time and removed afterward.
//
// Before this feature, attaching was a bookmark on the X-side record only:
// `setXSourceMissionAttached` wrote `x-sources/<familiar>.json` and nothing
// else happened. `runtime/x` appeared nowhere in src/, the runner imported
// nothing from x-sources, and it contained zero `finally` blocks — so a user
// attached a post, was told "X source attached to the mission", and the run
// never saw it.
//
// These tests drive the REAL store, the REAL x-sources ledger and cache, and
// the REAL runner over a temp cave home. They assert what is on disk and what
// the iteration is told, never what a route file's source text says: the audit
// that filed this bead found the X route tests scanning source text, and "a
// regex confirms the calls a file makes and can never see the call it forgot".
//
// No X credentials and no live X call: `fetch` is stubbed for the handful of
// upstream reads under test, and every durable path is redirected into a temp
// directory.
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import type { ConversationFile } from "../cave-conversations.ts";
import type { FlowDoc } from "../flow/flow-doc.ts";
import type { FlowRunRecord } from "../flows.ts";
import type { NormalizedXPost } from "../x-api.ts";
import type { ResearchMission } from "../research-missions.ts";

const root = await mkdtemp(path.join(tmpdir(), "x-mission-hydration-"));
const home = path.join(root, "cave");
const missionsDir = path.join(root, "research-missions");
const cacheDir = path.join(root, "x-cache");
const sourcesDir = path.join(root, "x-sources");
await mkdir(home, { recursive: true });
// Server-side capability grants. `nova` may use X research; `dusk` may not.
await writeFile(
  path.join(home, "config.json"),
  JSON.stringify({
    familiars: {
      nova: { xResearchEnabled: true },
      dusk: { xResearchEnabled: false },
    },
  }),
  "utf8",
);
process.env.COVEN_CAVE_HOME = home;
process.env.COVEN_RESEARCH_MISSIONS_DIR = missionsDir;
process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR = path.join(root, "session-owners");
process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR = path.join(root, "action-locks");
process.env.COVEN_X_SOURCES_DIR = sourcesDir;
process.env.COVEN_X_CACHE_DIR = cacheDir;
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");
// A public client-ID field, never a secret. Without one the X client refuses to
// construct, which would mask every upstream mapping under `not-configured`.
process.env.COVEN_CAVE_X_CLIENT_ID = "synthetic-client-id";

const {
  createResearchMissionWorkspace,
  loadResearchMission,
  researchMissionWorkspacePath,
} = await import("./research-mission-store.ts");
const {
  ResearchMissionXHydrationError,
  dropMissionXRuntime,
  hydrateMissionXSources,
  researchMissionHoldsXRuntime,
  sweepResearchMissionXRuntime,
} = await import("./research-mission-x-runtime.ts");
const {
  cacheNormalizedXPosts,
  listSavedXSources,
  setXSourceMissionAttached,
  upsertSavedXSource,
} = await import("./x-sources.ts");
const { xCredentialService } = await import("./x-credentials.ts");
const { makeResearchMissionRunner } = await import("./research-mission-runner.ts");
type ResearchMissionRunnerDeps =
  import("./research-mission-runner.ts").ResearchMissionRunnerDeps;

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
});

// The X client memoizes ONE production instance and binds `globalThis.fetch`
// at construction, so re-assigning the global between tests would be ignored
// after the first upstream call. Install a stable dispatcher once and swap the
// responder behind it instead.
let respond: () => Promise<Response> = async () => {
  throw new Error("unexpected upstream X request");
};
let upstreamCalls = 0;
globalThis.fetch = (async () => {
  upstreamCalls += 1;
  return respond();
}) as typeof globalThis.fetch;

const POST_TEXT = "Bounded reads are the whole point of a cost-aware client.";
// The mission RECORDS' timestamps, and only those. A mission is loaded back by
// id and none of these instants is ever compared against the real clock, so a
// fixed date is safe here — and deliberate, since it keeps the fixtures stable.
//
// It must NOT be used to seed the X post cache. See `cacheLivePost`.
const NOW = new Date("2026-08-22T12:00:00.000Z");

function post(postId: string, text = POST_TEXT): NormalizedXPost {
  return {
    id: postId,
    canonicalUrl: `https://x.com/opencoven/status/${postId}`,
    text,
    author: { id: "42", username: "opencoven", name: "Open Coven" },
    createdAt: "2026-08-20T09:00:00.000Z",
  };
}

/**
 * Seed the bounded X post cache with an entry that is LIVE right now.
 *
 * Cache freshness is the one thing in this file measured against the real
 * clock: `hydrateMissionXSources` reads through `getCachedXPost`, which
 * defaults its `now` to `new Date()`, and an entry is live for `CACHE_TTL_MS`
 * (24 hours) after the instant it was cached. Seeding at a fixed calendar
 * instant therefore yields an entry that is live only while real time happens
 * to fall within 24h of that instant — so the tests below would pass until
 * that window closed and fail every run afterwards, on a wall clock rather
 * than on anything they mean to assert.
 *
 * Anchoring to the real clock is what makes "this post is already cached" mean
 * what the tests say it means. Never pass `NOW` here.
 */
async function cacheLivePost(postId: string, text = POST_TEXT): Promise<void> {
  await cacheNormalizedXPosts([post(postId, text)]);
}

/** The exact upstream payload `lookupXPost` accepts. */
function lookupResponse(postId: string, text = POST_TEXT): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: postId,
        text,
        author_id: "42",
        created_at: "2026-08-20T09:00:00.000Z",
      },
      includes: { users: [{ id: "42", name: "Open Coven", username: "opencoven" }] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ title: "X error" }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function connectCredentials(): void {
  xCredentialService.replaceBundle({
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ["tweet.read", "users.read"],
    account: { id: "42", username: "opencoven", name: "Open Coven" },
  });
}

let missionSeq = 0;

async function makeMission(
  familiarId = "nova",
  overrides: Partial<ResearchMission> = {},
): Promise<ResearchMission> {
  missionSeq += 1;
  const id = `mission-${missionSeq}`;
  const mission: ResearchMission = {
    version: 1,
    id,
    familiarId,
    title: "X-attached research",
    intent: "Understand a claim made on X",
    mode: "autoresearch",
    modeSource: "user",
    deliverable: "findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 600,
      maxIterations: 5,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "checkpoint",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    iterations: [{
      number: 1,
      status: "checkpoint",
      flowRunId: "run-1",
      sessionId: "session-1",
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      decision: "checkpoint",
      decisionReason: "Review before continuing",
    }],
    artifacts: [{
      key: "primary",
      kind: "findings",
      title: "X-attached research",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: NOW.toISOString(),
    }],
    sources: [],
    ...overrides,
  };
  return createResearchMissionWorkspace(mission);
}

/** Save an X post as a familiar-scoped source and attach it to a mission. */
async function attachSource(
  familiarId: string,
  missionId: string,
  postId: string,
  note = "",
  canonicalUrl = `https://x.com/opencoven/status/${postId}`,
): Promise<string> {
  const saved = await upsertSavedXSource({
    familiarId,
    postId,
    canonicalUrl,
    originalUrl: canonicalUrl,
    note,
    tags: [],
  });
  await setXSourceMissionAttached(familiarId, saved.source.id, missionId);
  return saved.source.id;
}

function runtimeDir(missionId: string): string {
  return path.join(researchMissionWorkspacePath(missionId), "runtime", "x");
}

async function runtimeFiles(missionId: string): Promise<string[]> {
  try {
    return (await readdir(runtimeDir(missionId))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  connectCredentials();
  upstreamCalls = 0;
  respond = async () => {
    throw new Error("unexpected upstream X request");
  };
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

test("hydration writes each attached post into runtime/x and returns identity-only refs", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "1001", "why this thread matters");
  await cacheLivePost("1001");

  const hydration = await hydrateMissionXSources(mission);

  assert.deepEqual(await runtimeFiles(mission.id), ["x-post-1001.md"]);
  const written = await readFile(path.join(runtimeDir(mission.id), "x-post-1001.md"), "utf8");
  assert.ok(written.includes(POST_TEXT), "the iteration must be able to read the post text");
  assert.ok(written.includes("https://x.com/opencoven/status/1001"));
  assert.ok(written.includes("@opencoven"));
  assert.ok(
    written.includes("why this thread matters"),
    "the user's own note travels with the post they attached",
  );

  assert.deepEqual(hydration.files, [{
    postId: "1001",
    canonicalUrl: "https://x.com/opencoven/status/1001",
    authorUsername: "opencoven",
    relativePath: "runtime/x/x-post-1001.md",
  }]);
  assert.deepEqual(hydration.unavailable, []);

  const [ref] = hydration.sources;
  assert.equal(ref!.sourceType, "x-post");
  assert.equal(ref!.provider, "x");
  assert.equal(ref!.externalId, "1001");
  assert.equal(ref!.availability, "available");
  assert.equal(ref!.url, "https://x.com/opencoven/status/1001");
  assert.ok(
    !JSON.stringify(ref).includes(POST_TEXT),
    "the durable ledger ref must never carry the post body",
  );
});

test("a cache miss rehydrates from X just in time and caches the result", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "1002");
  respond = async () => lookupResponse("1002");

  const hydration = await hydrateMissionXSources(mission);

  assert.equal(upstreamCalls, 1, "a source with no live cache entry is fetched exactly once");
  assert.deepEqual(await runtimeFiles(mission.id), ["x-post-1002.md"]);
  assert.equal(hydration.files.length, 1);
  assert.ok(
    (await readdir(cacheDir)).includes("1002.json"),
    "the fetched post joins the bounded cache rather than being re-fetched next launch",
  );
});

test("a saved source not attached to this mission is never hydrated into it", async () => {
  const mission = await makeMission();
  const other = await makeMission();
  await attachSource("nova", other.id, "1003");
  await cacheLivePost("1003");

  const hydration = await hydrateMissionXSources(mission);

  assert.deepEqual(hydration.files, []);
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

test("hydration is familiar-scoped: another familiar's source cannot reach this mission", async () => {
  const mission = await makeMission("nova");
  // `dusk` claims nova's mission id on its own saved source. Only sources saved
  // under the MISSION's familiar are ever read, so the claim goes nowhere.
  await attachSource("dusk", mission.id, "1004");
  await cacheLivePost("1004");

  const hydration = await hydrateMissionXSources(mission);

  assert.deepEqual(hydration.files, []);
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

test("hydration replaces residue from a previous run instead of presenting it as fresh", async () => {
  const mission = await makeMission();
  await mkdir(runtimeDir(mission.id), { recursive: true });
  await writeFile(path.join(runtimeDir(mission.id), "x-post-9999.md"), "stale run residue", "utf8");
  await attachSource("nova", mission.id, "1005");
  await cacheLivePost("1005");

  await hydrateMissionXSources(mission);

  assert.deepEqual(
    await runtimeFiles(mission.id),
    ["x-post-1005.md"],
    "residue from an earlier run must not survive into this one",
  );
});

test("a mission with no attached X sources touches neither X nor the network, and still clears residue", async () => {
  const mission = await makeMission();
  await mkdir(runtimeDir(mission.id), { recursive: true });
  await writeFile(path.join(runtimeDir(mission.id), "x-post-8888.md"), "stale", "utf8");

  // The default responder throws for any upstream call, and no credential or
  // capability lookup may happen either.
  const hydration = await hydrateMissionXSources(mission, {
    requireXResearchCapability: async () => {
      throw new Error("capability must not be consulted with nothing attached");
    },
  });

  assert.deepEqual(hydration.files, []);
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

// ---------------------------------------------------------------------------
// Fail-closed, per failure class
// ---------------------------------------------------------------------------

test("a deleted post is recorded durably, omitted from runtime/x, and reported to the run", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "1006", "keep this note");
  await cacheLivePost("1006");
  // Expire the cache entry so hydration has to ask X, which answers 404.
  await rm(path.join(cacheDir, "1006.json"), { force: true });
  respond = async () => errorResponse(404);

  const hydration = await hydrateMissionXSources(mission);

  assert.deepEqual(hydration.files, [], "a deleted post contributes no runtime file");
  assert.deepEqual(hydration.unavailable, [{
    postId: "1006",
    canonicalUrl: "https://x.com/opencoven/status/1006",
    reason: "deleted",
  }]);
  assert.equal(hydration.sources[0]!.availability, "deleted");
  assert.deepEqual(await runtimeFiles(mission.id), []);

  const durable = (await listSavedXSources("nova")).find((item) => item.postId === "1006");
  assert.equal(
    durable!.availability,
    "deleted",
    "the deletion must survive a reload, not live only in the run's report",
  );
  assert.equal(durable!.note, "keep this note", "Coven-owned data outlives the X post");
});

for (const [label, status, code] of [
  ["a rate limit", 429, "rate-limited"],
  ["billing exhaustion", 402, "billing-unavailable"],
  ["a malformed upstream reply", 200, "invalid-response"],
] as const) {
  test(`${label} refuses the launch instead of running without the attached source`, async () => {
    const mission = await makeMission();
    await attachSource("nova", mission.id, "2000");
    respond = async () => (
      status === 200
        ? new Response("{\"data\":{}}", { status: 200, headers: { "content-type": "application/json" } })
        : errorResponse(status)
    );

    const error = await hydrateMissionXSources(mission).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(
      error instanceof ResearchMissionXHydrationError,
      `${label} must fail closed, not resolve`,
    );
    assert.equal((error as InstanceType<typeof ResearchMissionXHydrationError>).code, code);
    assert.deepEqual(
      await runtimeFiles(mission.id),
      [],
      "a refused hydration leaves nothing on disk for the next reader to trust",
    );
  });
}

test("a disconnected X account refuses the launch rather than running without the source", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "2002");
  xCredentialService.disconnect();

  const error = await hydrateMissionXSources(mission).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ResearchMissionXHydrationError);
  assert.equal(
    (error as InstanceType<typeof ResearchMissionXHydrationError>).code,
    "not-connected",
  );
  assert.equal(upstreamCalls, 0, "a missing connection is refused before any request");
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

test("an authorization X rejects even after one refresh refuses the launch", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "2003");
  // 401 on the lookup, then 401 again on the single refresh the read path
  // allows. The exact error code is the credential service's to decide (see
  // x-credentials.test.ts); what this asserts is that hydration fails CLOSED
  // and writes nothing, rather than proceeding without the attached source.
  respond = async () => errorResponse(401);

  const error = await hydrateMissionXSources(mission).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(
    error instanceof ResearchMissionXHydrationError,
    "an unusable authorization must stop the launch",
  );
  assert.ok(upstreamCalls >= 2, "the read path retries exactly once through a refresh");
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

test("an attached source on a familiar without X research refuses the launch", async () => {
  const mission = await makeMission("dusk");
  await attachSource("dusk", mission.id, "2001");
  await cacheLivePost("2001");

  const error = await hydrateMissionXSources(mission).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof ResearchMissionXHydrationError);
  assert.equal(
    (error as InstanceType<typeof ResearchMissionXHydrationError>).code,
    "capability-disabled",
  );
  assert.deepEqual(await runtimeFiles(mission.id), []);
});

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

test("dropping the runtime removes every hydrated file and is safe to repeat", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "3001");
  await cacheLivePost("3001");
  await hydrateMissionXSources(mission);
  assert.equal((await runtimeFiles(mission.id)).length, 1);

  await dropMissionXRuntime(mission.id);
  assert.equal(await exists(runtimeDir(mission.id)), false);
  await dropMissionXRuntime(mission.id);
  await dropMissionXRuntime("mission-never-created");

  assert.ok(
    await exists(path.join(researchMissionWorkspacePath(mission.id), "mission.json")),
    "removal is scoped to runtime/x and never touches the durable workspace",
  );
});

test("the startup sweep removes crash residue older than 24h and leaves a live run alone", async () => {
  const stale = await makeMission();
  const fresh = await makeMission();
  for (const mission of [stale, fresh]) {
    await mkdir(runtimeDir(mission.id), { recursive: true });
    await writeFile(path.join(runtimeDir(mission.id), "x-post-4001.md"), POST_TEXT, "utf8");
  }
  const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(runtimeDir(stale.id), longAgo, longAgo);

  const swept = await sweepResearchMissionXRuntime();

  assert.ok(swept.includes(stale.id), "residue from a killed process must be swept");
  assert.ok(!swept.includes(fresh.id), "a run that started minutes ago must not be robbed");
  assert.deepEqual(await runtimeFiles(stale.id), []);
  assert.deepEqual(await runtimeFiles(fresh.id), ["x-post-4001.md"]);
});

// ---------------------------------------------------------------------------
// Runner wiring — the part that makes hydration and removal actually happen
// ---------------------------------------------------------------------------

const RUNNING_RUN: FlowRunRecord = {
  id: "run-2",
  flowId: "research-flow",
  flowName: "Research",
  status: "running",
  startedAt: NOW.toISOString(),
  steps: [],
  source: "cave",
  sessionId: "session-2",
};

type RunnerHarness = {
  runner: ReturnType<typeof makeResearchMissionRunner>;
  flows: FlowDoc[];
  runtimeAtLaunch: string[][];
  flowRun: FlowRunRecord | null;
};

function runnerFor(overrides: Partial<ResearchMissionRunnerDeps> = {}): RunnerHarness {
  const harness: RunnerHarness = {
    runner: null as unknown as ReturnType<typeof makeResearchMissionRunner>,
    flows: [],
    runtimeAtLaunch: [],
    flowRun: RUNNING_RUN,
  };
  const deps: ResearchMissionRunnerDeps = {
    createWorkspace: createResearchMissionWorkspace,
    removeWorkspace: async () => {},
    loadMission: loadResearchMission,
    saveMission: async (mission) => {
      const { saveResearchMission } = await import("./research-mission-store.ts");
      await saveResearchMission(mission);
    },
    loadSessionOwner: async () => null,
    recordSessionOwner: async () => {},
    clearSessionOwner: async () => {},
    assertSessionOwnerPrivate: async () => {},
    startFlow: async (flow) => {
      harness.flows.push(flow);
      // What the iteration can actually see AT THE MOMENT it starts. Asserting
      // after the call would pass even if hydration ran too late to matter.
      const missionId = /^research-(.+)-iteration-\d+$/.exec(flow.id)?.[1] ?? "";
      harness.runtimeAtLaunch.push(await runtimeFiles(missionId));
      return { ok: true, run: RUNNING_RUN, sessionId: "session-2", executor: "session" };
    },
    loadFlowRun: async () => harness.flowRun,
    loadConversation: async (): Promise<ConversationFile | null> => null,
    sessionState: async () => "running",
    readSessionTranscript: async () => "",
    readMissionFile: async () => null,
    readSources: async () => [],
    materializeSavedLink: async () => {
      throw new Error("not used");
    },
    // The REAL hydration and removal, over the real store and the real
    // familiar-scoped X ledger. Only startFlow is a stub.
    hydrateXSources: (mission) => hydrateMissionXSources(mission),
    dropXRuntime: (missionId) => dropMissionXRuntime(missionId),
    publishKnowledge: async (entry) => entry,
    killSession: async () => {},
    createAutomation: async (input) => ({ id: "automation-1", status: "PAUSED", rrule: input.rrule }),
    updateAutomation: async (id, patch) => ({ id, status: patch.status ?? "PAUSED", rrule: null }),
    getAutomation: async () => null,
    latestAutomationRun: async () => null,
    readAutomationTranscript: async () => "",
    readAutomationCheckpoint: async () => ({ transcript: "", token: "", at: NOW.toISOString() }),
    fingerprintMission: async () => "fingerprint",
    missionWorkspacePath: researchMissionWorkspacePath,
    resolveProjectRoot: async (candidate) => candidate,
    ensureResearchAccess: async () => {},
    checkFamiliarRootAccess: async () => null,
    now: () => new Date(NOW.getTime() + 60_000),
    randomId: () => "mission-runner",
    ...overrides,
  };
  harness.runner = makeResearchMissionRunner(deps);
  return harness;
}

/**
 * A runner that observes the launched session as finished with a checkpoint
 * decision, so `reconcile` takes the ordinary completed-run path rather than
 * the failed-run one.
 */
function settlingRunner(
  overrides: Partial<ResearchMissionRunnerDeps> = {},
): ReturnType<typeof makeResearchMissionRunner> {
  return runnerFor({
    sessionState: async () => "finished",
    readSessionTranscript: async () => [
      "@@research-control",
      '{"decision":"checkpoint","reason":"More to gather","confidence":0.5}',
      "@@research-artifacts-written",
    ].join("\n"),
    readMissionFile: async (_id, relativePath) => (
      relativePath === "artifacts/primary.md" ? "# Findings\n\nEvidence gathered so far.\n" : null
    ),
    ...overrides,
  }).runner;
}

test("continuing a mission hydrates before the iteration starts and names the files in its prompt", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5001");
  await cacheLivePost("5001");
  const harness = runnerFor();

  const updated = await harness.runner.act(mission.id, { action: "continue" });

  assert.equal(updated.status, "running");
  assert.deepEqual(
    harness.runtimeAtLaunch,
    [["x-post-5001.md"]],
    "the hydrated file must exist when the iteration starts, not merely afterwards",
  );
  const prompt = String(harness.flows[0]!.nodes[1]!.params!.prompt);
  assert.ok(
    prompt.includes("runtime/x/x-post-5001.md"),
    "the iteration must be told where its user-requested X sources are",
  );
  assert.ok(prompt.includes("Attached X sources"));

  const stored = await loadResearchMission(mission.id);
  const ref = stored!.sources.find((item) => item.externalId === "5001");
  assert.equal(ref!.sourceType, "x-post");
  assert.equal(ref!.provider, "x");
  assert.equal(ref!.availability, "available");
  const missionJson = await readFile(
    path.join(researchMissionWorkspacePath(mission.id), "mission.json"),
    "utf8",
  );
  assert.ok(
    !missionJson.includes(POST_TEXT),
    "the durable mission record must never archive the post body",
  );
});

test("the run's post text is removed when the mission settles", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5002");
  await cacheLivePost("5002");
  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });
  assert.equal((await runtimeFiles(mission.id)).length, 1, "hydrated before the settle under test");

  // A failed flow run — a settle path that never reaches reconcileCompletedRun,
  // which is exactly why removal hangs off the mission write rather than off
  // one function's happy path.
  harness.flowRun = { ...RUNNING_RUN, status: "failed", summary: "Research Flow failed" };
  const settled = await harness.runner.reconcile((await loadResearchMission(mission.id))!);

  assert.equal(settled.status, "failed");
  assert.equal(
    await exists(runtimeDir(mission.id)),
    false,
    "temporary post text must not outlive the run that needed it",
  );
});

test("a still-running mission keeps its hydrated post text", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5003");
  await cacheLivePost("5003");
  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });

  const reconciled = await harness.runner.reconcile((await loadResearchMission(mission.id))!);

  assert.equal(reconciled.status, "running");
  assert.deepEqual(
    await runtimeFiles(mission.id),
    ["x-post-5003.md"],
    "removal must be conditional on the run being over, not unconditional",
  );
});

test("cancelling a running mission removes its hydrated post text", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5004");
  await cacheLivePost("5004");
  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });
  assert.equal((await runtimeFiles(mission.id)).length, 1);

  const cancelled = await harness.runner.act(mission.id, { action: "cancel" });

  assert.equal(cancelled.status, "cancelled");
  assert.equal(await exists(runtimeDir(mission.id)), false);
});

test("a source that cannot be hydrated refuses the launch and starts no session", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5005");
  respond = async () => errorResponse(429);
  const harness = runnerFor();

  const updated = await harness.runner.act(mission.id, { action: "continue" });

  assert.equal(harness.flows.length, 0, "no agent session may start without the attached evidence");
  assert.equal(updated.status, "failed");
  assert.match(String(updated.lastError), /could not be retrieved/);
  assert.equal(await exists(runtimeDir(mission.id)), false);
  assert.deepEqual(
    (await loadResearchMission(mission.id))!.iterations.at(-1)!.status,
    "failed",
    "Retry is the recovery, and it re-hydrates",
  );
});

test("a deleted attached post lets the run proceed, visibly short of that source", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "5006");
  respond = async () => errorResponse(404);
  const harness = runnerFor();

  const updated = await harness.runner.act(mission.id, { action: "continue" });

  assert.equal(updated.status, "running", "a permanently gone post must not block research forever");
  const prompt = String(harness.flows[0]!.nodes[1]!.params!.prompt);
  assert.ok(
    prompt.includes("UNAVAILABLE: post 5006"),
    "the iteration must be told the attached source is missing rather than left to guess",
  );
  assert.ok(prompt.includes("Do not cite, infer, or invent its content"));
  const ref = updated.sources.find((item) => item.externalId === "5006");
  assert.equal(ref!.availability, "deleted");
});

// The settle above is a FAILED run. The modal outcome of a research iteration
// is a normal completion into `checkpoint`, and nothing covered it: widening
// the active-status set to include `checkpoint` and `paused` — one line, and
// the obvious shape of a future regression — left all 21 tests green.
test("a normal iteration completion settles to checkpoint and removes the hydrated post text", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "6001");
  await cacheLivePost("6001");
  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });
  assert.equal((await runtimeFiles(mission.id)).length, 1, "hydrated before the settle under test");

  const settled = await settlingRunner().reconcile((await loadResearchMission(mission.id))!);

  assert.equal(settled.status, "checkpoint");
  assert.equal(
    await exists(runtimeDir(mission.id)),
    false,
    "an iteration that ended normally must not leave its post text behind",
  );
});

// The choke point is a single predicate over mission status, so the whole
// removal guarantee reduces to this set being exactly right. Pinned directly
// because the runner tests above can only reach three of the nine statuses,
// and adding `checkpoint` or `paused` to the active set is the cheapest
// possible regression.
test("only an active mission may hold hydrated post text", () => {
  for (const status of ["queued", "planning", "running"] as const) {
    assert.equal(researchMissionHoldsXRuntime(status), true, `${status} is a live run`);
  }
  for (const status of [
    "checkpoint",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "archived",
  ] as const) {
    assert.equal(
      researchMissionHoldsXRuntime(status),
      false,
      `${status} is settled — its post text must be dropped on the same write`,
    );
  }
});

// The agent owns sources.json and its entries displace stored refs wholesale
// (mergeFileSources). The prompt tells the agent to record each attached post
// there, so without an identity carry-forward the entry it writes silently
// drops provider/externalId/availability — and a COMPLETED mission never
// hydrates again, so nothing would ever restore them.
test("an agent's own sources.json entry cannot strip the X identity off an attached post", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "6003");
  await cacheLivePost("6003");
  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });

  const settled = await settlingRunner({
    // Exactly what the iteration prompt asks for: the canonical URL, recorded
    // by the agent with no knowledge of Cave's provider fields.
    readSources: async () => [{
      id: "agent-written-1",
      title: "A post worth citing",
      url: "https://x.com/opencoven/status/6003",
      sourceType: "web",
      status: "used" as const,
    }],
  }).reconcile((await loadResearchMission(mission.id))!);

  const ref = settled.sources.find((item) => item.url === "https://x.com/opencoven/status/6003");
  assert.ok(ref, "the agent's entry survives — it owns the ledger");
  assert.equal(ref!.title, "A post worth citing", "every field the agent owns is the agent's");
  assert.equal(ref!.provider, "x", "but the provider identity is Cave's and must survive");
  assert.equal(ref!.externalId, "6003");
  assert.equal(ref!.availability, "available");
  assert.equal(
    settled.sources.filter((item) => item.externalId === "6003").length,
    1,
    "carrying the identity forward must not also leave the displaced ref behind",
  );
});

// ---------------------------------------------------------------------------
// Redaction — what a DURABLE record may hold
// ---------------------------------------------------------------------------

test("no author display data reaches a durable record, on either surface", async () => {
  // A handle-free canonical URL is the case that separates "derived from the
  // saved source" from "read off the fetched post": the post carries
  // @opencoven / "Open Coven", the stored URL carries neither.
  const mission = await makeMission();
  await attachSource("nova", mission.id, "7001", "", "https://x.com/i/web/status/7001");
  await cacheLivePost("7001");

  const hydration = await hydrateMissionXSources(mission);
  assert.equal(
    hydration.files[0]!.authorUsername,
    null,
    "a handle absent from the stored URL must not be recovered from the fetched post",
  );
  assert.equal(hydration.sources[0]!.title, "X post 7001");

  const harness = runnerFor();
  await harness.runner.act(mission.id, { action: "continue" });

  // The iteration prompt is persisted verbatim as the flow run's flowSnapshot,
  // so it is a durable record too — not just a message.
  const prompt = String(harness.flows[0]!.nodes[1]!.params!.prompt);
  const missionJson = await readFile(
    path.join(researchMissionWorkspacePath(mission.id), "mission.json"),
    "utf8",
  );
  for (const [surface, text] of [["the iteration prompt", prompt], ["mission.json", missionJson]] as const) {
    assert.ok(!text.includes("Open Coven"), `${surface} must not carry the author's display name`);
    assert.ok(!text.includes("opencoven"), `${surface} must not carry a handle the stored URL lacks`);
    assert.ok(!text.includes(POST_TEXT), `${surface} must not carry the post body`);
  }
  assert.ok(prompt.includes("runtime/x/x-post-7001.md"), "the file is still named to the iteration");
});

test("removal leaves no empty runtime/ scaffolding in the workspace", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "7002");
  await cacheLivePost("7002");
  await hydrateMissionXSources(mission);

  await dropMissionXRuntime(mission.id);

  assert.equal(
    await exists(path.join(researchMissionWorkspacePath(mission.id), "runtime")),
    false,
    "the runtime/ parent is removed once it is empty",
  );
});

test("a populated runtime/ directory survives removal of runtime/x", async () => {
  const mission = await makeMission();
  await attachSource("nova", mission.id, "7003");
  await cacheLivePost("7003");
  await hydrateMissionXSources(mission);
  const sibling = path.join(researchMissionWorkspacePath(mission.id), "runtime", "notes.md");
  await writeFile(sibling, "something else is using runtime/", "utf8");

  await dropMissionXRuntime(mission.id);

  assert.equal(await exists(runtimeDir(mission.id)), false);
  assert.equal(await exists(sibling), true, "removal is scoped to runtime/x");
});
