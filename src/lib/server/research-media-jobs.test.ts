import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

import type { ResearchGeneration } from "../research-generations.ts";
import type {
  ResearchMediaJobDefinition,
  ResearchMediaJobFactory,
  MediaGenerationContent,
} from "./research-media-job-contract.ts";

const execFileAsync = promisify(execFile);

const tmp = await mkdtemp(path.join(tmpdir(), "cave-research-media-jobs-"));
const originalGenerationsDir = process.env.COVEN_RESEARCH_GENERATIONS_DIR;
const originalMediaDir = process.env.COVEN_RESEARCH_MEDIA_DIR;
process.env.COVEN_RESEARCH_GENERATIONS_DIR = path.join(tmp, "research-generations");
process.env.COVEN_RESEARCH_MEDIA_DIR = path.join(tmp, "research-media");

const {
  cancelResearchMediaJob,
  queueResearchMediaGeneration,
  startResearchMediaJobs,
} = await import("./research-media-jobs.ts");
const {
  listResearchGenerations,
  researchGenerationsPath,
  transitionResearchGeneration,
} =
  await import("./research-generations.ts");
const {
  readResearchGenerationMediaBytes,
  writeResearchGenerationMedia,
} = await import("./research-media-store.ts");

after(async () => {
  if (originalGenerationsDir === undefined) delete process.env.COVEN_RESEARCH_GENERATIONS_DIR;
  else process.env.COVEN_RESEARCH_GENERATIONS_DIR = originalGenerationsDir;
  if (originalMediaDir === undefined) delete process.env.COVEN_RESEARCH_MEDIA_DIR;
  else process.env.COVEN_RESEARCH_MEDIA_DIR = originalMediaDir;
  await rm(tmp, { recursive: true, force: true });
});

const podcastContent = {
  kind: "podcast" as const,
  script: [{ id: "segment-1", text: "Source-grounded narration" }],
};

const podcastReadyContent: MediaGenerationContent = {
  ...podcastContent,
  audio: {
    key: "episode.wav",
    mimeType: "audio/wav",
    sizeBytes: 4,
    provider: "local",
    voice: "piper-lessac-medium",
  },
};

function generation(
  familiarId: string,
  id: string,
  overrides: Partial<ResearchGeneration> = {},
): ResearchGeneration {
  return {
    version: 2,
    id,
    familiarId,
    kind: "podcast",
    sourceMissionId: "mission-1",
    sourceTitle: "Mission",
    status: "draft",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    content: podcastContent,
    ...overrides,
  };
}

async function seed(familiarId: string, generations: unknown[]) {
  await mkdir(path.dirname(researchGenerationsPath(familiarId)), { recursive: true });
  await writeFile(
    researchGenerationsPath(familiarId),
    JSON.stringify({ version: 2, generations }),
    "utf8",
  );
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForStatus(
  familiarId: string,
  generationId: string,
  status: ResearchGeneration["status"],
): Promise<ResearchGeneration> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await listResearchGenerations(familiarId)).find(
      (item) => item.id === generationId,
    );
    if (current?.status === status) return current;
    await nextTurn();
  }
  assert.fail(`generation ${generationId} never reached ${status}`);
}

async function waitForStarts(starts: string[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (starts.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`runner only started ${starts.length} of ${count} expected jobs`);
}

async function waitForRelease(
  releases: Map<string, () => void>,
  generationId: string,
): Promise<() => void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const release = releases.get(generationId);
    if (release) return release;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`runner never created a release for ${generationId}`);
}

function blockingFactory(
  releases: Map<string, () => void>,
  starts: string[],
  kills: Map<string, number> = new Map(),
): ResearchMediaJobFactory {
  return (queued): ResearchMediaJobDefinition => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.set(queued.id, release);
    return {
      familiarId: queued.familiarId,
      generationId: queued.id,
      kill: () => {
        kills.set(queued.id, (kills.get(queued.id) ?? 0) + 1);
      },
      run: async () => {
        starts.push(queued.id);
        await blocked;
        return { content: podcastReadyContent };
      },
    };
  };
}

test("persisted FIFO runs one generation per familiar and drains after completion", async () => {
  const familiarId = "runner-fifo";
  await seed(familiarId, [
    generation(familiarId, "first", {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    generation(familiarId, "second", {
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    }),
  ]);
  const releases = new Map<string, () => void>();
  const starts: string[] = [];
  const factory = blockingFactory(releases, starts);

  const first = await queueResearchMediaGeneration(familiarId, "first", factory);
  const second = await queueResearchMediaGeneration(familiarId, "second", factory);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  await waitForStatus(familiarId, "first", "rendering");
  await waitForStarts(starts, 1);
  const queueRows = await listResearchGenerations(familiarId);
  assert.equal(queueRows.find((row) => row.id === "first")?.status, "rendering");
  assert.equal(queueRows.find((row) => row.id === "second")?.status, "queued");
  assert.deepEqual(starts, ["first"]);

  releases.get("first")?.();
  await first.done;
  await waitForStatus(familiarId, "second", "rendering");
  await waitForStarts(starts, 2);
  assert.deepEqual(starts, ["first", "second"]);
  releases.get("second")?.();
  await second.done;
  assert.equal((await waitForStatus(familiarId, "first", "ready")).status, "ready");
  assert.equal((await waitForStatus(familiarId, "second", "ready")).status, "ready");
});

test("simultaneous render requests use draft compare-and-set exactly once", async () => {
  const familiarId = "runner-cas";
  await seed(familiarId, [generation(familiarId, "generation-cas")]);
  const releases = new Map<string, () => void>();
  const factory = blockingFactory(releases, []);

  const outcomes = await Promise.all([
    queueResearchMediaGeneration(familiarId, "generation-cas", factory),
    queueResearchMediaGeneration(familiarId, "generation-cas", factory),
  ]);
  assert.equal(outcomes.filter((result) => result.ok).length, 1);
  assert.equal(
    outcomes.filter((result) => !result.ok && result.code === "invalid-state").length,
    1,
  );
  await waitForStatus(familiarId, "generation-cas", "rendering");
  (await waitForRelease(releases, "generation-cas"))();
  const winner = outcomes.find((result) => result.ok);
  if (winner?.ok) await winner.done;
});

test("cancelling queued work never starts it and the active job drains normally", async () => {
  const familiarId = "runner-cancel-queued";
  await seed(familiarId, [
    generation(familiarId, "active", {
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    generation(familiarId, "cancelled-before-start", {
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
  ]);
  const releases = new Map<string, () => void>();
  const starts: string[] = [];
  const factory = blockingFactory(releases, starts);
  const active = await queueResearchMediaGeneration(familiarId, "active", factory);
  const queued = await queueResearchMediaGeneration(
    familiarId,
    "cancelled-before-start",
    factory,
  );
  assert.equal(active.ok, true);
  assert.equal(queued.ok, true);
  if (!active.ok || !queued.ok) return;
  await waitForStatus(familiarId, "active", "rendering");

  const cancelledBeforeStart = await cancelResearchMediaJob(
    familiarId,
    "cancelled-before-start",
  );
  assert.equal(cancelledBeforeStart.ok, true);
  if (cancelledBeforeStart.ok) {
    assert.equal(cancelledBeforeStart.generation.status, "cancelled");
  }
  await queued.done;
  assert.equal(
    (await waitForStatus(familiarId, "cancelled-before-start", "cancelled")).status,
    "cancelled",
  );
  await waitForStarts(starts, 1);
  assert.deepEqual(starts, ["active"]);

  releases.get("active")?.();
  await active.done;
  assert.equal((await waitForStatus(familiarId, "active", "ready")).status, "ready");
  assert.deepEqual(starts, ["active"]);
});

test("active cancellation kills once and a late result cannot overwrite terminal state", async () => {
  const familiarId = "runner-cancel-active";
  await seed(familiarId, [generation(familiarId, "generation-cancel")]);
  const releases = new Map<string, () => void>();
  const kills = new Map<string, number>();
  const factory = blockingFactory(releases, [], kills);
  const queued = await queueResearchMediaGeneration(
    familiarId,
    "generation-cancel",
    factory,
  );
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  await waitForStatus(familiarId, "generation-cancel", "rendering");

  const cancelledOnce = await cancelResearchMediaJob(
    familiarId,
    "generation-cancel",
  );
  assert.equal(cancelledOnce.ok, true);
  if (cancelledOnce.ok) {
    assert.equal(cancelledOnce.generation.status, "cancelled");
  }
  const cancelledTwice = await cancelResearchMediaJob(
    familiarId,
    "generation-cancel",
  );
  assert.equal(cancelledTwice.ok, false);
  if (!cancelledTwice.ok) {
    assert.equal(cancelledTwice.code, "invalid-state");
    assert.equal(cancelledTwice.generation?.status, "cancelled");
  }
  assert.equal(kills.get("generation-cancel"), 1);
  releases.get("generation-cancel")?.();
  await queued.done;
  const cancelled = await waitForStatus(
    familiarId,
    "generation-cancel",
    "cancelled",
  );
  assert.equal(cancelled.content?.kind, "podcast", "reviewable draft survives cancellation");
});

test("a cancellation CAS after publication removes the losing media file", async () => {
  const familiarId = "runner-cancel-after-publish";
  const generationId = "generation-published-before-cancel";
  await seed(familiarId, [generation(familiarId, generationId)]);
  let release!: () => void;
  let published!: () => void;
  const publishedPromise = new Promise<void>((resolve) => {
    published = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const factory: ResearchMediaJobFactory = (queued) => ({
    familiarId: queued.familiarId,
    generationId: queued.id,
    run: async () => {
      const audio = await writeResearchGenerationMedia({
        familiarId,
        generationId,
        key: "episode.wav",
        mimeType: "audio/wav",
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      published();
      await blocked;
      return {
        content: {
          ...podcastContent,
          audio: {
            ...audio,
            provider: "local",
            voice: "piper-lessac-medium",
          },
        },
      };
    },
  });

  const queued = await queueResearchMediaGeneration(
    familiarId,
    generationId,
    factory,
  );
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  await publishedPromise;
  const cancelled = await transitionResearchGeneration(
    familiarId,
    generationId,
    ["rendering"],
    { status: "cancelled", stage: null, progress: null },
  );
  assert.equal(cancelled.ok, true);
  release();
  await queued.done;

  assert.equal(
    (await waitForStatus(familiarId, generationId, "cancelled")).status,
    "cancelled",
  );
  await assert.rejects(
    () =>
      readResearchGenerationMediaBytes(
        familiarId,
        generationId,
        "episode.wav",
      ),
    /not found/,
  );
});

test("invalid old WIP drafts are readable but rejected before queueing", async () => {
  const familiarId = "runner-invalid-draft";
  await seed(familiarId, [
    generation(familiarId, "missing-config", {
      renderConfig: undefined,
    }),
  ]);
  const result = await queueResearchMediaGeneration(
    familiarId,
    "missing-config",
    blockingFactory(new Map(), []),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-draft");
  assert.equal(
    (await listResearchGenerations(familiarId))[0].status,
    "draft",
    "failed validation does not mint a queued record",
  );
});

test("startup fails old rendering rows, preserves FIFO queue, and is idempotent", async () => {
  const familiarId = "runner-startup";
  await seed(familiarId, [
    generation(familiarId, "interrupted", {
      status: "rendering",
      stage: "encoding",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    generation(familiarId, "resume-first", {
      status: "queued",
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
    generation(familiarId, "resume-second", {
      status: "queued",
      createdAt: "2026-01-01T00:00:02.000Z",
    }),
  ]);
  const releases = new Map<string, () => void>();
  const starts: string[] = [];
  const factory = blockingFactory(releases, starts);

  await startResearchMediaJobs(factory);
  await startResearchMediaJobs(factory);
  await waitForStarts(starts, 1);
  const afterFirstStart = await listResearchGenerations(familiarId);
  const interrupted = afterFirstStart.find((row) => row.id === "interrupted");
  assert.ok(interrupted);
  assert.equal(interrupted.status, "failed");
  assert.equal(interrupted.error, "interrupted by runner ownership loss");
  assert.equal(interrupted.stage, undefined);
  assert.equal(
    afterFirstStart.find((row) => row.id === "resume-first")?.status,
    "rendering",
  );
  assert.equal(
    afterFirstStart.find((row) => row.id === "resume-second")?.status,
    "queued",
  );
  assert.deepEqual(starts, ["resume-first"]);

  releases.get("resume-first")?.();
  await waitForStarts(starts, 2);
  assert.equal(
    (await listResearchGenerations(familiarId)).find(
      (row) => row.id === "resume-second",
    )?.status,
    "rendering",
  );
  releases.get("resume-second")?.();
  await waitForStatus(familiarId, "resume-second", "ready");
  assert.deepEqual(starts, ["resume-first", "resume-second"]);
});

test("separate Cave processes hold one durable runner lease per familiar", async () => {
  const familiarId = "runner-cross-process";
  const generationIds = ["cross-process-first", "cross-process-second"];
  await seed(
    familiarId,
    generationIds.map((id, index) =>
      generation(familiarId, id, {
        status: "queued",
        createdAt: `2026-01-01T00:00:0${index}.000Z`,
        updatedAt: `2026-01-01T00:00:0${index}.000Z`,
      }),
    ),
  );
  const eventsPath = path.join(tmp, "runner-events.log");
  const jobsUrl = new URL("./research-media-jobs.ts", import.meta.url).href;
  const storeUrl = new URL("./research-generations.ts", import.meta.url).href;
  const childSource = [
    `process.env.COVEN_RESEARCH_GENERATIONS_DIR = ${JSON.stringify(process.env.COVEN_RESEARCH_GENERATIONS_DIR)};`,
    `process.env.COVEN_RESEARCH_MEDIA_DIR = ${JSON.stringify(process.env.COVEN_RESEARCH_MEDIA_DIR)};`,
    `const { appendFile, readFile } = await import("node:fs/promises");`,
    `const jobs = await import(${JSON.stringify(jobsUrl)});`,
    `const store = await import(${JSON.stringify(storeUrl)});`,
    `const familiarId = ${JSON.stringify(familiarId)};`,
    `const eventsPath = ${JSON.stringify(eventsPath)};`,
    `const factory = (generation) => ({ familiarId, generationId: generation.id, run: async () => {`,
    `  await appendFile(eventsPath, "start " + process.pid + " " + generation.id + "\\n");`,
    `  await new Promise((resolve) => setTimeout(resolve, 120));`,
    `  await appendFile(eventsPath, "end " + process.pid + " " + generation.id + "\\n");`,
    `  return { content: { ...generation.content, audio: { key: "episode.wav", mimeType: "audio/wav", sizeBytes: 4, provider: "local", voice: generation.renderConfig.voice } } };`,
    `} });`,
    `await jobs.startResearchMediaJobs(factory);`,
    `const deadline = Date.now() + 5_000;`,
    `while (Date.now() < deadline) {`,
    `  const rows = await store.listResearchGenerations(familiarId);`,
    `  if (rows.every((row) => row.status === "ready" || row.status === "failed" || row.status === "cancelled")) process.exit(0);`,
    `  await new Promise((resolve) => setTimeout(resolve, 20));`,
    `}`,
    `throw new Error("cross-process runner timed out");`,
  ].join("\n");

  await Promise.all(
    [1, 2].map(() =>
      execFileAsync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "--eval",
          childSource,
        ],
        { timeout: 10_000 },
      ),
    ),
  );

  const events = (await readFile(eventsPath, "utf8")).trim().split("\n");
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];
  for (const event of events) {
    const [kind, , generationId] = event.split(" ");
    if (kind === "start") {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(generationId);
    } else {
      active -= 1;
    }
  }
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  assert.deepEqual(started, generationIds);
});

test("cancellation in another process aborts the durable lease owner's job", async () => {
  const familiarId = "runner-cross-process-cancel";
  const generationId = "cross-process-cancelled";
  await seed(familiarId, [
    generation(familiarId, generationId, { status: "queued" }),
  ]);
  const eventsPath = path.join(tmp, "runner-cancel-events.log");
  const jobsUrl = new URL("./research-media-jobs.ts", import.meta.url).href;
  const storeUrl = new URL("./research-generations.ts", import.meta.url).href;
  const childSource = [
    `process.env.COVEN_RESEARCH_GENERATIONS_DIR = ${JSON.stringify(process.env.COVEN_RESEARCH_GENERATIONS_DIR)};`,
    `process.env.COVEN_RESEARCH_MEDIA_DIR = ${JSON.stringify(process.env.COVEN_RESEARCH_MEDIA_DIR)};`,
    `const { appendFile, readFile } = await import("node:fs/promises");`,
    `const jobs = await import(${JSON.stringify(jobsUrl)});`,
    `const store = await import(${JSON.stringify(storeUrl)});`,
    `const familiarId = ${JSON.stringify(familiarId)};`,
    `const generationId = ${JSON.stringify(generationId)};`,
    `const eventsPath = ${JSON.stringify(eventsPath)};`,
    `const factory = () => ({ familiarId, generationId, run: async ({ signal }) => {`,
    `  await appendFile(eventsPath, "started\\n");`,
    `  await new Promise((resolve, reject) => { signal.addEventListener("abort", () => { void appendFile(eventsPath, "aborted\\n").finally(() => reject(new Error("aborted"))); }, { once: true }); });`,
    `  throw new Error("unreachable");`,
    `} });`,
    `await jobs.startResearchMediaJobs(factory);`,
    `const deadline = Date.now() + 5_000;`,
    `while (Date.now() < deadline) {`,
    `  const row = (await store.listResearchGenerations(familiarId)).find((candidate) => candidate.id === generationId);`,
    `  const events = await readFile(eventsPath, "utf8").catch(() => "");`,
    `  if (row?.status === "cancelled" && events.includes("aborted")) { await appendFile(eventsPath, "observed-cancelled\\n"); process.exit(0); }`,
    `  await new Promise((resolve) => setTimeout(resolve, 20));`,
    `}`,
    `throw new Error("cross-process cancellation timed out");`,
  ].join("\n");
  const child = execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      childSource,
    ],
    { timeout: 10_000 },
  );
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const started = await readFile(eventsPath, "utf8").catch(() => "");
    if (started.includes("started")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (attempt === 199) assert.fail("child runner never started");
  }

  const cancelled = await cancelResearchMediaJob(familiarId, generationId);
  assert.equal(cancelled.ok, true);
  await child;
  assert.match(
    await readFile(eventsPath, "utf8"),
    /aborted[\s\S]*observed-cancelled/,
  );
  assert.equal(
    (await listResearchGenerations(familiarId)).find(
      (candidate) => candidate.id === generationId,
    )?.status,
    "cancelled",
  );
});

test("a transient terminal write failure is reconciled after storage recovers", async () => {
  const familiarId = "runner-terminal-reconcile";
  const generationId = "terminal-write-failure";
  await seed(familiarId, [generation(familiarId, generationId)]);
  const target = researchGenerationsPath(familiarId);
  const backup = `${target}.temporary-backup`;
  let restored!: () => void;
  let restoreFailure: unknown;
  const restoredPromise = new Promise<void>((resolve) => {
    restored = resolve;
  });
  const factory: ResearchMediaJobFactory = () => ({
    familiarId,
    generationId,
    run: async () => {
      await rename(target, backup);
      await mkdir(target);
      setTimeout(() => {
        void rm(target, { recursive: true, force: true })
          .then(() => rename(backup, target))
          .catch((error) => {
            restoreFailure = error;
          })
          .finally(restored);
      }, 200);
      throw new Error("renderer failed while storage was unavailable");
    },
  });
  const queued = await queueResearchMediaGeneration(
    familiarId,
    generationId,
    factory,
  );
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  await queued.done;
  await restoredPromise;
  assert.equal(restoreFailure, undefined);

  let failed: ResearchGeneration | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    failed = (await listResearchGenerations(familiarId)).find(
      (candidate) => candidate.id === generationId,
    );
    if (failed?.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "interrupted by runner ownership loss");
});
