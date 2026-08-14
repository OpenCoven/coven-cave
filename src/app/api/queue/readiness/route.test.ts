// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "cave-queue-readiness-route-"));
const projectA = { id: "project-a", name: "Project A", root: path.join(temp, "project-a") };
const projectB = { id: "project-b", name: "Project B", root: path.join(temp, "project-b") };
const unrelatedCwd = path.join(temp, "unrelated-cwd");
const previousToken = process.env.COVEN_CAVE_AUTH_TOKEN;
delete process.env.COVEN_CAVE_AUTH_TOKEN;

function request(body: unknown, host = "127.0.0.1") {
  return new Request("http://127.0.0.1/api/queue/readiness", {
    method: "POST",
    headers: { "content-type": "application/json", host },
    body: JSON.stringify(body),
  });
}

try {
  await Promise.all([mkdir(projectA.root), mkdir(projectB.root), mkdir(unrelatedCwd)]);
  execFileSync("git", ["init", "-q"], { cwd: projectA.root });
  execFileSync("git", ["init", "-q"], { cwd: projectB.root });

  const { createQueueReadinessPostHandler } = await import("./route.ts");
  let selected = projectA;
  let initialized = false;
  let readinessCalls = 0;
  let observeSecondGenerateReadiness = false;
  let enteredSecondGenerateReadiness!: () => void;
  let secondGenerateReadinessEntered = new Promise<void>((resolve) => { enteredSecondGenerateReadiness = resolve; });
  let holdSecondReadiness = false;
  let enteredSecondReadiness!: () => void;
  let releaseSecondReadiness!: () => void;
  let secondReadinessEntered = new Promise<void>((resolve) => { enteredSecondReadiness = resolve; });
  let secondReadinessReleased = new Promise<void>((resolve) => { releaseSecondReadiness = resolve; });
  let holdInit = false;
  let leaveWorkspacePartial = false;
  let initStarted!: () => void;
  let releaseInit!: () => void;
  let initHasStarted = new Promise<void>((resolve) => { initStarted = resolve; });
  let initReleased = new Promise<void>((resolve) => { releaseInit = resolve; });
  const initRoots: string[] = [];
  let invalidations = 0;

  const readiness = async () => {
    readinessCalls += 1;
    if (holdSecondReadiness && readinessCalls === 2) {
      enteredSecondReadiness();
      await secondReadinessReleased;
    }
    // The first Generate probes twice (pre-lock and under-lock); call three
    // proves a second caller passed its own pre-lock check before init wins.
    if (observeSecondGenerateReadiness && readinessCalls === 3) enteredSecondGenerateReadiness();
    return {
      ok: initialized,
      code: initialized ? "ready" : "needs-beads",
      message: initialized ? "Queue project is ready." : "Queue needs Beads.",
      project: selected,
      canGenerate: !initialized,
    };
  };

  const POST = createQueueReadinessPostHandler({
    queueProjectReadiness: readiness,
    selectQueueProject: async (projectId: string) => {
      if (projectId === projectA.id) selected = projectA;
      else if (projectId === projectB.id) selected = projectB;
      else return null;
      return selected;
    },
    runBdCommand: async (root: string) => {
      initRoots.push(root);
      if (holdInit) {
        initStarted();
        await initReleased;
      }
      if (!leaveWorkspacePartial) initialized = true;
      return { ok: true, stdout: "initialized", stderr: "" };
    },
    invalidateQueueProjectReadinessCache: () => { invalidations += 1; },
  });

  const malformed = await POST(request(null));
  assert.equal(malformed.status, 400, "the executable handler rejects malformed JSON roots");
  const nonLocal = await POST(request({ action: "generate", projectId: projectA.id }, "example.test"));
  assert.equal(nonLocal.status, 403, "the executable handler keeps the loopback guard");
  const wrongIdentity = await POST(request({ action: "generate", projectId: projectB.id }));
  assert.equal(wrongIdentity.status, 409, "Generate is bound to the project identity displayed in the Queue");
  assert.deepEqual(initRoots, [], "a mismatched project identity never initializes the runtime cwd or another project");

  // A selection changing while Generate waits for its locked re-check cannot
  // initialize the newly selected project.
  readinessCalls = 0;
  holdSecondReadiness = true;
  const changedSelection = POST(request({ action: "generate", projectId: projectA.id }));
  await secondReadinessEntered;
  selected = projectB;
  releaseSecondReadiness();
  const changedSelectionResponse = await changedSelection;
  assert.equal(changedSelectionResponse.status, 409);
  assert.deepEqual(initRoots, [], "a delayed A Generate never runs bd init in B or the unrelated cwd");

  // An init process can return successfully while leaving an unusable partial
  // workspace. The route must return its failed readiness, not a false success.
  selected = projectA;
  initialized = false;
  leaveWorkspacePartial = true;
  holdSecondReadiness = false;
  readinessCalls = 0;
  const partialRepair = await POST(request({ action: "generate", projectId: projectA.id }));
  assert.equal(partialRepair.status, 422, "Generate does not report success until the repaired workspace is ready");
  assert.equal((await partialRepair.json()).readiness.code, "needs-beads");
  leaveWorkspacePartial = false;
  initRoots.length = 0;
  invalidations = 0;

  // Two same-project Generate calls share one serialized init; the second
  // returns the first caller's ready result rather than a misleading conflict.
  selected = projectA;
  initialized = false;
  holdSecondReadiness = false;
  holdInit = true;
  readinessCalls = 0;
  observeSecondGenerateReadiness = true;
  secondGenerateReadinessEntered = new Promise<void>((resolve) => { enteredSecondGenerateReadiness = resolve; });
  initHasStarted = new Promise<void>((resolve) => { initStarted = resolve; });
  initReleased = new Promise<void>((resolve) => { releaseInit = resolve; });
  const first = POST(request({ action: "generate", projectId: projectA.id }));
  await initHasStarted;
  const second = POST(request({ action: "generate", projectId: projectA.id }));
  await secondGenerateReadinessEntered;
  releaseInit();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200, "same-project Generate is idempotent after its lock wait");
  assert.deepEqual(initRoots, [projectA.root], "exactly one init runs, scoped to selected project A");
  assert.equal(invalidations, 1, "only the successful initializer invalidates cached readiness");
} finally {
  if (previousToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = previousToken;
  await rm(temp, { recursive: true, force: true });
}

console.log("queue readiness route.test.ts: ok");
