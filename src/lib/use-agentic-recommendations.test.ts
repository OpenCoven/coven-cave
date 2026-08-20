import assert from "node:assert/strict";
import {
  contextFingerprint,
  isAutoApplyAllowed,
  type AgenticRecommendation,
} from "./agentic-recommendations.ts";
import { parsePromptEnhancementRecommendationOutput } from "./prompt-enhancer.ts";
import {
  createAgenticRecommendationsLifecycle,
  type AgenticRecommendationGenerator,
} from "./use-agentic-recommendations.ts";
import type { AgenticDiagnosticEvent } from "./agentic-diagnostics.ts";

type Context = {
  cardId: string;
  title: string;
  rawDraft?: string;
};

type Timer = {
  callback: () => void;
  delay: number;
};

function createClock() {
  let nextTimer = 0;
  const timers = new Map<number, Timer>();

  return {
    setTimeout(callback: () => void, delay: number) {
      const timer = nextTimer++;
      timers.set(timer, { callback, delay });
      return timer;
    },
    clearTimeout(timer: number) {
      timers.delete(timer);
    },
    runNext() {
      const next = timers.entries().next();
      assert.equal(next.done, false, "a contextual debounce should be queued");
      const [timer, scheduled] = next.value!;
      timers.delete(timer);
      scheduled.callback();
      return scheduled.delay;
    },
    size() {
      return timers.size;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function recommendation(context: Context, id = "rec-1"): AgenticRecommendation {
  return {
    id,
    surface: "board",
    kind: "action",
    payload: { targetId: context.cardId },
    rationale: "The card needs a reviewable next action.",
    inferredGoal: "Complete the current work safely.",
    rankReasons: ["matches the active card"],
    evidenceRefs: [{ id: context.cardId, kind: "task", label: context.title }],
    contextFingerprint: contextFingerprint(context),
    verification: { status: "proposal", checks: [] },
    application: { mode: "review", requiresApproval: true, reversible: true },
  };
}

function output(...recommendations: AgenticRecommendation[]) {
  return JSON.stringify({
    recommendations: recommendations.map(({ verification: _verification, application: _application, ...model }) => model),
  });
}

function meaningfulContextKey({ cardId, title }: Context) {
  return `${cardId}:${title}`;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// Manual recommendation surfaces (Chat Enhance) retain the latest context but
// make no request until their existing explicit control calls refresh().
{
  const clock = createClock();
  const context = { cardId: "chat-turn-1", title: "Clarify the prompt", rawDraft: "Draft one" };
  let calls = 0;
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    autoGenerate: false,
    clock,
    createRunId: () => "manual-chat-run",
    meaningfulContextKey,
    generate: async (request) => {
      calls += 1;
      return output(recommendation(request.context, "chat-recommendation"));
    },
    apply: async () => ({ revert: async () => {} }),
  });

  lifecycle.update(context);
  lifecycle.update({ ...context, rawDraft: "Draft two" });
  assert.equal(clock.size(), 0, "draft changes never generate a manual recommendation");
  assert.equal(calls, 0, "no request runs before the explicit Enhance action");
  lifecycle.refresh();
  clock.runNext();
  await flush();
  assert.equal(calls, 1, "manual refresh starts one shared recommendation run");
  assert.equal(lifecycle.getState().phase, "review");
}

// The debounce is keyed to durable meaning, not the full context fingerprint.
// A changed raw draft cannot auto-request, while a deliberate refresh uses its
// latest value.
{
  const clock = createClock();
  const context = { cardId: "card-1", title: "Ship lifecycle", rawDraft: "" };
  const calls: Parameters<AgenticRecommendationGenerator<Context>>[0][] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    debounceMs: 9_999,
    clock,
    createRunId: () => "run-1",
    meaningfulContextKey,
    generate: async (request) => {
      calls.push(request);
      return output(recommendation(request.context));
    },
    apply: async () => ({ revert: async () => {} }),
  });

  lifecycle.update(context);
  assert.equal(lifecycle.getState().phase, "debouncing");
  assert.equal(clock.runNext(), 1_000, "the debounce duration is bounded");
  await flush();

  lifecycle.update({ ...context, rawDraft: "Ship it before lunch" });
  assert.equal(clock.size(), 0, "a raw-draft fingerprint change cannot auto-request");
  assert.equal(lifecycle.getState().phase, "idle");
  assert.equal(calls.length, 1, "the raw-draft update did not generate");

  lifecycle.refresh();
  assert.equal(clock.runNext(), 1_000, "manual refresh remains debounced");
  await flush();

  assert.equal(calls.length, 2, "manual refresh is the explicit request path");
  assert.equal(calls[1]?.context.rawDraft, "Ship it before lunch");
  assert.equal(calls[0]?.runId, "run-1");
  assert.equal(lifecycle.getState().phase, "review");
}

// A replacement context cancels the exact active run ID. Late output from the
// old context cannot overwrite the newer review state.
{
  const clock = createClock();
  const first = deferred<string>();
  const second = deferred<string>();
  const cancelled: string[] = [];
  const contexts = [
    { cardId: "card-1", title: "First context" },
    { cardId: "card-2", title: "Second context" },
  ];
  let calls = 0;
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: () => `run-${++calls}`,
    meaningfulContextKey,
    cancelRun: async (runId) => {
      cancelled.push(runId);
    },
    generate: async () => (calls === 1 ? first.promise : second.promise),
    apply: async () => ({ revert: async () => {} }),
  });

  lifecycle.update(contexts[0]!);
  clock.runNext();
  lifecycle.update(contexts[1]!);
  assert.deepEqual(cancelled, ["run-1"], "the active request is stopped by its run ID");
  clock.runNext();

  second.resolve(output(recommendation(contexts[1]!, "rec-current")));
  await flush();
  first.resolve(output(recommendation(contexts[0]!, "rec-stale")));
  await flush();

  assert.equal(lifecycle.getState().phase, "review");
  assert.deepEqual(
    lifecycle.getState().items.map((item) => item.recommendation.id),
    ["rec-current"],
    "a stale completion is discarded by context fingerprint",
  );
}

// Strict parsing gets one retry for malformed model output. A second malformed
// response is an explicit error rather than a local or silent fallback.
{
  const clock = createClock();
  const context = { cardId: "card-3", title: "Validate output" };
  const attempts: number[] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: () => "run-retry",
    meaningfulContextKey,
    generate: async ({ attempt }) => {
      attempts.push(attempt);
      return attempt === 0 ? "not a recommendation envelope" : output(recommendation(context));
    },
    apply: async () => ({ revert: async () => {} }),
  });

  lifecycle.update(context);
  clock.runNext();
  await flush();

  assert.deepEqual(attempts, [0, 1], "exactly one malformed-output retry is allowed");
  assert.equal(lifecycle.getState().phase, "review");

  const exhaustedClock = createClock();
  const exhausted = createAgenticRecommendationsLifecycle<Context>({
    clock: exhaustedClock,
    createRunId: () => "run-error",
    meaningfulContextKey,
    generate: async () => "still malformed",
    apply: async () => ({ revert: async () => {} }),
  });
  exhausted.update(context);
  exhaustedClock.runNext();
  await flush();
  assert.equal(exhausted.getState().phase, "error");
  assert.match(exhausted.getState().error?.message ?? "", /could not be validated/i);
}

// A surface parser retains that same retry boundary. Chat uses this for a
// complete `<enhanced>` frame, so tagless or unterminated output cannot become
// a code-authored fallback recommendation.
{
  const clock = createClock();
  const attempts: number[] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: () => "prompt-frame-retry",
    meaningfulContextKey,
    parseOutput: parsePromptEnhancementRecommendationOutput,
    generate: async ({ attempt }) => {
      attempts.push(attempt);
      return "{}";
    },
    apply: async () => ({ revert: async () => {} }),
  });
  lifecycle.update({ cardId: "chat-turn-1", title: "Require an enhanced frame" });
  clock.runNext();
  await flush();
  assert.deepEqual(attempts, [0, 1], "the prompt parser receives exactly one malformed-output retry");
  assert.equal(lifecycle.getState().phase, "error", "the second malformed prompt result preserves the draft and reports an error");
}

// Review items move through apply, dismiss, and revert without ever applying
// automatically. A failed apply remains an explicit item error.
{
  const clock = createClock();
  const context = { cardId: "card-4", title: "Apply deliberately" };
  const applied: string[] = [];
  const reverted: string[] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: () => "run-apply",
    meaningfulContextKey,
    generate: async () => output(recommendation(context), recommendation(context, "rec-dismiss")),
    apply: async (candidate) => {
      applied.push(candidate.id);
      return {
        revert: async () => {
          reverted.push(candidate.id);
        },
      };
    },
  });

  lifecycle.update(context);
  clock.runNext();
  await flush();
  assert.deepEqual(lifecycle.getState().items.map((item) => item.phase), ["review", "review"]);

  await lifecycle.apply("rec-1");
  assert.deepEqual(applied, ["rec-1"]);
  assert.equal(lifecycle.getState().items[0]?.phase, "applied");

  lifecycle.dismiss("rec-dismiss");
  assert.equal(lifecycle.getState().items[1]?.phase, "dismissed");

  await lifecycle.revert("rec-1");
  assert.deepEqual(reverted, ["rec-1"]);
  assert.equal(lifecycle.getState().items[0]?.phase, "review");
}

// A persisted or otherwise reconstructed recommendation can look verified, but
// it lacks the private in-process auto-apply stamp. The lifecycle must refuse
// it before the surface mutation callback runs; review-mode recommendations
// above remain explicitly applicable.
{
  const clock = createClock();
  const context = { cardId: "card-4-auto", title: "Guard automatic mutation" };
  const applied: string[] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: () => "run-auto-apply",
    meaningfulContextKey,
    generate: async (request) => output(recommendation(request.context)),
    apply: async (candidate) => {
      applied.push(candidate.id);
      return { revert: async () => {} };
    },
  });

  lifecycle.update(context);
  clock.runNext();
  await flush();

  const item = lifecycle.getState().items[0]!;
  const verifiedLookingClone: AgenticRecommendation = {
    ...item.recommendation,
    verification: {
      status: "verified",
      checks: [{ id: "forged", state: "passed", detail: "Persisted data cannot carry the private stamp." }],
    },
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
  };
  item.recommendation = verifiedLookingClone;
  assert.equal(isAutoApplyAllowed(verifiedLookingClone), false);

  await lifecycle.apply(verifiedLookingClone.id);
  assert.deepEqual(applied, [], "an unstamped auto-apply clone cannot reach the surface mutation");
  assert.equal(lifecycle.getState().items[0]?.phase, "error");
  assert.match(
    lifecycle.getState().items[0]?.error ?? "",
    /not trusted for automatic application/i,
  );
}

// Both synchronous stop failures and rejected stop promises remain visible
// cancellation errors. Neither can escape the caller or disappear quietly.
{
  const context = { cardId: "card-5", title: "Cancel safely" };
  const syncClock = createClock();
  const syncGeneration = deferred<string>();
  const syncLifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock: syncClock,
    createRunId: () => "run-sync-cancel",
    meaningfulContextKey,
    cancelRun: () => {
      throw new Error("transport unavailable");
    },
    generate: () => syncGeneration.promise,
    apply: async () => ({ revert: async () => {} }),
  });

  syncLifecycle.update(context);
  syncClock.runNext();
  assert.doesNotThrow(() => syncLifecycle.update({ ...context, title: "New meaning" }));
  assert.equal(syncLifecycle.getState().phase, "error");
  assert.equal(syncLifecycle.getState().error?.code, "cancellation");

  const asyncClock = createClock();
  const cancellation = deferred<void>();
  const asyncGeneration = deferred<string>();
  const asyncLifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock: asyncClock,
    createRunId: () => "run-async-cancel",
    meaningfulContextKey,
    cancelRun: () => cancellation.promise,
    generate: () => asyncGeneration.promise,
    apply: async () => ({ revert: async () => {} }),
  });

  asyncLifecycle.update(context);
  asyncClock.runNext();
  assert.equal(asyncLifecycle.cancel("run-async-cancel"), true);
  cancellation.reject(new Error("stop endpoint rejected"));
  await flush();
  assert.equal(asyncLifecycle.getState().phase, "error");
  assert.equal(asyncLifecycle.getState().error?.code, "cancellation");
}

// A successful external apply keeps its reverter through a new context and
// through the in-flight completion. The user can still undo the actual side
// effect after the refreshed recommendations arrive.
{
  const clock = createClock();
  const firstContext = { cardId: "card-6", title: "First context" };
  const nextContext = { cardId: "card-7", title: "Next context" };
  const applying = deferred<{ revert: () => Promise<void> }>();
  const reverted: string[] = [];
  const lifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock,
    createRunId: (() => {
      let run = 0;
      return () => `run-revert-${++run}`;
    })(),
    meaningfulContextKey,
    generate: async (request) => output(recommendation(request.context, `rec-${request.context.cardId}`)),
    apply: async () => applying.promise,
  });

  lifecycle.update(firstContext);
  clock.runNext();
  await flush();
  const applyPromise = lifecycle.apply("rec-card-6");
  assert.equal(lifecycle.getState().items[0]?.phase, "applying");

  lifecycle.update(nextContext);
  applying.resolve({
    revert: async () => {
      reverted.push("rec-card-6");
    },
  });
  await applyPromise;
  assert.equal(
    lifecycle.getState().items.find((item) => item.recommendation.id === "rec-card-6")?.phase,
    "applied",
    "an in-flight apply stores its revert callback after context replacement",
  );

  clock.runNext();
  await flush();
  await lifecycle.revert("rec-card-6");
  assert.deepEqual(reverted, ["rec-card-6"]);
  assert.equal(
    lifecycle.getState().items.find((item) => item.recommendation.id === "rec-card-6")?.phase,
    "review",
    "the preserved apply result remains reversible after refresh",
  );
}

// The shared lifecycle can publish bounded metadata through an injected sink
// without surfacing model output or changing its visible validation/cancel flow.
{
  const context = { cardId: "card-diagnostics", title: "Record safe lifecycle outcomes" };
  const validationClock = createClock();
  const validationDiagnostics: AgenticDiagnosticEvent[] = [];
  const validationLifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock: validationClock,
    createRunId: () => "run-diagnostics-validation",
    meaningfulContextKey,
    diagnosticSurface: "research",
    diagnostics: (event) => validationDiagnostics.push(event),
    generate: async () => "malformed",
    apply: async () => ({ revert: async () => {} }),
  });

  validationLifecycle.update(context);
  validationClock.runNext();
  await flush();
  assert.equal(validationLifecycle.getState().phase, "error");
  assert.deepEqual(
    validationDiagnostics.map((event) => [event.surface, event.code, event.counts?.attempts]),
    [["research", "generation_validation_failed", 2]],
  );

  const cancellationClock = createClock();
  const cancellationDiagnostics: AgenticDiagnosticEvent[] = [];
  const waiting = deferred<string>();
  const cancellationLifecycle = createAgenticRecommendationsLifecycle<Context>({
    clock: cancellationClock,
    createRunId: () => "run-diagnostics-cancel",
    meaningfulContextKey,
    diagnosticSurface: "board",
    diagnostics: (event) => cancellationDiagnostics.push(event),
    generate: () => waiting.promise,
    apply: async () => ({ revert: async () => {} }),
  });
  cancellationLifecycle.update(context);
  cancellationClock.runNext();
  assert.equal(cancellationLifecycle.cancel("run-diagnostics-cancel"), true);
  assert.deepEqual(
    cancellationDiagnostics.map((event) => [event.surface, event.code]),
    [["board", "cancelled"]],
  );
}

console.log("use-agentic-recommendations.test.ts passed");
