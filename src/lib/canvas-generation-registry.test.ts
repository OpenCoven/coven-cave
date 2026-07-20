import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeCanvasGeneration,
  getCanvasGenerationSnapshot,
  resetCanvasGenerationRegistryForTests,
  startCanvasGeneration,
  stopCanvasGeneration,
  subscribeCanvasGeneration,
  type CanvasGenerationExecutor,
  type CanvasGenerationStart,
} from "./canvas-generation-registry.ts";

const identity = { id: "art-1", createdAt: "2026-07-20T12:00:00.000Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function startInput(runId: string): CanvasGenerationStart {
  return {
    runId,
    identity,
    familiarId: "familiar-1",
    purpose: "create",
    prompt: "A pricing page",
    title: "Pricing page",
    generationPrompt: "Build a pricing page",
    originalIntent: "A pricing page",
  };
}

function terminalResult() {
  const artifact = {
    id: "art-1",
    title: "A pricing page",
    prompt: "A pricing page",
    code: "<html></html>",
    kind: "html" as const,
    createdAt: identity.createdAt,
    updatedAt: "2026-07-20T12:01:00.000Z",
  };
  return { artifact, artifacts: [artifact], savedId: artifact.id };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test.beforeEach(() => resetCanvasGenerationRegistryForTests());

test("generation continues after its only subscriber unsubscribes", async () => {
  const gate = deferred<ReturnType<typeof terminalResult>>();
  const execute: CanvasGenerationExecutor = async ({ progress }) => {
    progress({ phase: "generating", streamChars: 12 });
    return gate.promise;
  };
  const unsubscribe = subscribeCanvasGeneration(() => undefined);
  const started = startCanvasGeneration(startInput("run-1"), execute);
  unsubscribe();

  gate.resolve(terminalResult());
  await gate.promise;
  await flush();

  assert.equal(started.runId, "run-1");
  assert.equal(getCanvasGenerationSnapshot().phase, "complete");
});

test("a returning subscriber reattaches to active progress without aborting", () => {
  const gate = deferred<ReturnType<typeof terminalResult>>();
  let signal: AbortSignal | undefined;
  const execute: CanvasGenerationExecutor = async ({ progress, signal: runSignal }) => {
    signal = runSignal;
    progress({ phase: "repairing", streamChars: 41 });
    return gate.promise;
  };
  const leaveCanvas = subscribeCanvasGeneration(() => undefined);
  startCanvasGeneration(startInput("run-1"), execute);
  leaveCanvas();

  const seen: Array<string | null> = [];
  subscribeCanvasGeneration(() => seen.push(getCanvasGenerationSnapshot().phase));

  assert.equal(signal?.aborted, false);
  assert.equal(getCanvasGenerationSnapshot().phase, "repairing");
  assert.equal(getCanvasGenerationSnapshot().streamChars, 41);
  assert.deepEqual(seen, []);
});

test("terminal result remains replayable until the matching run consumes it", async () => {
  startCanvasGeneration(startInput("run-1"), async () => terminalResult());
  await flush();

  const terminal = getCanvasGenerationSnapshot();
  assert.equal(terminal.phase, "complete");
  assert.equal(terminal.savedId, "art-1");
  assert.equal(consumeCanvasGeneration("other-run"), false);
  assert.equal(getCanvasGenerationSnapshot(), terminal);
  assert.equal(consumeCanvasGeneration("run-1"), true);
  assert.equal(getCanvasGenerationSnapshot().phase, null);
  assert.ok(Object.isFrozen(getCanvasGenerationSnapshot()));
});

test("explicit stop is the only cancellation and ignores stale completion", async () => {
  const gate = deferred<ReturnType<typeof terminalResult>>();
  let signal: AbortSignal | undefined;
  startCanvasGeneration(startInput("run-1"), async (context) => {
    signal = context.signal;
    return gate.promise;
  });

  assert.equal(stopCanvasGeneration("other-run"), false);
  assert.equal(signal?.aborted, false);
  assert.equal(stopCanvasGeneration("run-1"), true);
  assert.equal(signal?.aborted, true);
  assert.equal(getCanvasGenerationSnapshot().phase, "cancelled");

  gate.resolve(terminalResult());
  await gate.promise;
  await flush();
  assert.equal(getCanvasGenerationSnapshot().phase, "cancelled");
});

test("stop during repairing still cancels the active generation", () => {
  let signal: AbortSignal | undefined;
  startCanvasGeneration(startInput("run-1"), async (context) => {
    signal = context.signal;
    context.progress({ phase: "repairing" });
    return deferred<ReturnType<typeof terminalResult>>().promise;
  });

  assert.equal(getCanvasGenerationSnapshot().phase, "repairing");
  assert.equal(stopCanvasGeneration("run-1"), true);
  assert.equal(signal?.aborted, true);
  assert.equal(getCanvasGenerationSnapshot().phase, "cancelled");
});

test("stop during saving is a no-op and cannot discard the committed artifact", async () => {
  const gate = deferred<ReturnType<typeof terminalResult>>();
  let signal: AbortSignal | undefined;
  startCanvasGeneration(startInput("run-1"), async (context) => {
    signal = context.signal;
    context.progress({ phase: "saving", streamChars: 120 });
    return gate.promise;
  });

  assert.equal(getCanvasGenerationSnapshot().phase, "saving");
  assert.equal(stopCanvasGeneration("run-1"), false);
  assert.equal(signal?.aborted, false);
  assert.equal(getCanvasGenerationSnapshot().phase, "saving");

  gate.resolve(terminalResult());
  await gate.promise;
  await flush();

  const committed = getCanvasGenerationSnapshot();
  assert.equal(committed.phase, "complete");
  assert.equal(committed.savedId, "art-1");
  assert.equal(stopCanvasGeneration("run-1"), false);
  assert.equal(getCanvasGenerationSnapshot(), committed);
});

test("a second start cannot replace one active run", () => {
  const gate = deferred<ReturnType<typeof terminalResult>>();
  const execute: CanvasGenerationExecutor = async () => gate.promise;
  const first = startCanvasGeneration(startInput("run-1"), execute);
  const second = startCanvasGeneration(startInput("run-2"), execute);

  assert.equal(first.runId, "run-1");
  assert.equal(second, first);
  assert.equal(getCanvasGenerationSnapshot().runId, "run-1");
});

test("inputs and terminal arrays and objects are cloned and frozen at boundaries", async () => {
  const input = startInput("run-1");
  const result = terminalResult();
  startCanvasGeneration(input, async () => result);
  input.identity.id = "mutated-input";
  await flush();
  result.artifact.code = "mutated-result";
  result.artifacts[0].title = "mutated-title";

  const snapshot = getCanvasGenerationSnapshot();
  assert.equal(snapshot.identity?.id, "art-1");
  assert.equal(snapshot.artifact?.code, "<html></html>");
  assert.equal(snapshot.artifacts?.[0].title, "A pricing page");
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.identity));
  assert.ok(Object.isFrozen(snapshot.artifacts));
  assert.ok(Object.isFrozen(snapshot.artifacts?.[0]));
});

test("executor failure becomes a replayable error with original prompt context", async () => {
  startCanvasGeneration(startInput("run-1"), async () => {
    throw new Error("bridge unavailable");
  });
  await flush();

  const snapshot = getCanvasGenerationSnapshot();
  assert.equal(snapshot.phase, "error");
  assert.equal(snapshot.error, "bridge unavailable");
  assert.equal(snapshot.prompt, "A pricing page");
  assert.equal(snapshot.title, "Pricing page");
  assert.equal(snapshot.originalIntent, "A pricing page");
});
