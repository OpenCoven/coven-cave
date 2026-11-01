/**
 * The anomaly matrix every upstream caller is driven through (#6359).
 *
 * A case names the upstream, how to invoke the code under test, what the
 * healthy answer looks like, and what each degraded answer must look like.
 * The runner then proves three things per anomaly, as node:test subtests:
 *
 *   1. the caller answers instead of crashing — a structured response or
 *      value, never an uncaught throw (unless the case opts into `mayThrow`
 *      for a library whose contract is a typed error);
 *   2. no credential appears in the answer, the thrown error, or either's
 *      message;
 *   3. the moment the upstream heals, the very next call reaches it again and
 *      answers the healthy contract — no poisoned cache, no stuck breaker.
 */

import assert from "node:assert/strict";
import type { TestContext } from "node:test";

import {
  STANDARD_UPSTREAM_ANOMALIES,
  assertNoSecretLeak,
  type NamedAnomaly,
  type StandardAnomalyName,
  type UpstreamAnomaly,
  type UpstreamAnomalyHarness,
} from "./upstream-anomaly-fetch.ts";
import type { UpstreamApiId } from "../server/upstream-api-registry.ts";

export type MatrixOutcome = {
  /** What `invoke` resolved to (undefined when it threw). */
  value: unknown;
  /** `value` when it is a Response, else null. */
  response: Response | null;
  status: number | null;
  /** The response body as text, or a JSON rendering of a non-Response value. */
  text: string;
  /** The parsed JSON body (undefined when the body was not JSON). */
  body: unknown;
  /** The error `invoke` threw, if any. */
  threw: unknown;
};

export type DegradedExpectation = (outcome: MatrixOutcome, anomaly: UpstreamAnomaly) => void | Promise<void>;

export type UpstreamMatrixCase = {
  harness: UpstreamAnomalyHarness;
  id: UpstreamApiId;
  /** Drive the code under test once. */
  invoke: () => Promise<unknown>;
  /** The healthy contract; asserted before the matrix and after every heal. */
  healthy: (outcome: MatrixOutcome) => void | Promise<void>;
  /** Per-anomaly expectations; `default` covers the rest. Every degraded
   *  outcome is still held to "did not throw" and "no credential leaked". */
  degraded?: Partial<Record<StandardAnomalyName, DegradedExpectation>> & { default?: DegradedExpectation };
  /** The anomalies to run (default: the standard nine). */
  anomalies?: readonly NamedAnomaly[];
  /** Credentials that must never appear in any answer. */
  secrets?: readonly string[];
  /** Runs before every invocation — clear a module cache, step a clock. */
  beforeEach?: () => void | Promise<void>;
  /** Runs after the degraded call and before the upstream heals — step past
   *  a documented backoff so the healed call is reachable. */
  beforeHeal?: (anomaly: StandardAnomalyName) => void | Promise<void>;
  /** The code under test surfaces upstream failure by throwing a typed error. */
  mayThrow?: boolean;
  /** The degraded call must have reached the upstream (default true; set
   *  false when a legitimate cache answers without a call). */
  expectUpstreamCall?: boolean;
};

function describeError(error: unknown): string {
  if (error === undefined) return "";
  if (error instanceof Error) return `${error.name}: ${error.message}${error.cause ? ` (cause: ${String((error.cause as Error).message ?? error.cause)})` : ""}`;
  return String(error);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export async function captureOutcome(invoke: () => Promise<unknown>): Promise<MatrixOutcome> {
  let value: unknown;
  try {
    value = await invoke();
  } catch (threw) {
    return { value: undefined, response: null, status: null, text: describeError(threw), body: undefined, threw };
  }
  if (value instanceof Response) {
    const text = await value.clone().text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = undefined;
    }
    return { value, response: value, status: value.status, text, body, threw: undefined };
  }
  return { value, response: null, status: null, text: safeStringify(value), body: value, threw: undefined };
}

export async function runUpstreamAnomalyMatrix(t: TestContext, matrixCase: UpstreamMatrixCase): Promise<void> {
  const { harness, id } = matrixCase;
  const anomalies = matrixCase.anomalies ?? STANDARD_UPSTREAM_ANOMALIES;
  const expectUpstreamCall = matrixCase.expectUpstreamCall ?? true;

  await t.test("healthy upstream: the caller answers its contract", async () => {
    await matrixCase.beforeEach?.();
    harness.heal(id);
    harness.reset();
    const outcome = await captureOutcome(matrixCase.invoke);
    assert.equal(outcome.threw, undefined, `healthy: the caller threw: ${describeError(outcome.threw)}`);
    assertNoSecretLeak(outcome.text, matrixCase.secrets, "healthy");
    await matrixCase.healthy(outcome);
    harness.assertAllDeclared();
  });

  for (const { name, anomaly } of anomalies) {
    await t.test(`${name}: degrades without crashing, then heals on the next call`, async () => {
      await matrixCase.beforeEach?.();
      harness.reset();
      harness.inject(id, anomaly);
      const degraded = await captureOutcome(matrixCase.invoke);
      if (!matrixCase.mayThrow) {
        assert.equal(degraded.threw, undefined, `${name}: the caller threw instead of answering: ${describeError(degraded.threw)}`);
      }
      assertNoSecretLeak(degraded.text, matrixCase.secrets, name);
      if (expectUpstreamCall) {
        assert.ok(harness.calls(id).length >= 1, `${name}: the caller never reached the upstream while it was degraded`);
      }
      const expectation = matrixCase.degraded?.[name] ?? matrixCase.degraded?.default;
      if (expectation) await expectation(degraded, anomaly);

      await matrixCase.beforeHeal?.(name);
      harness.heal(id);
      harness.reset();
      await matrixCase.beforeEach?.();
      const healed = await captureOutcome(matrixCase.invoke);
      assert.equal(healed.threw, undefined, `${name}: after the upstream healed the caller still threw: ${describeError(healed.threw)}`);
      assertNoSecretLeak(healed.text, matrixCase.secrets, `${name} (healed)`);
      await matrixCase.healthy(healed);
      assert.ok(
        harness.calls(id).length >= 1,
        `${name}: after the upstream healed the caller never contacted it again — a failure is being remembered past the outage`,
      );
      harness.assertAllDeclared();
    });
  }
}

/** Shorthand for "a JSON error answer with this status": no throw, the status
 *  matches, and the body is an object whose `ok` is not true. */
export function expectErrorStatus(status: number | readonly number[]): DegradedExpectation {
  const allowed = typeof status === "number" ? [status] : [...status];
  return (outcome) => {
    assert.ok(outcome.response, "expected a Response");
    assert.ok(allowed.includes(outcome.status ?? -1), `expected HTTP ${allowed.join("|")}, got ${outcome.status}: ${outcome.text.slice(0, 200)}`);
    const body = outcome.body as { ok?: unknown } | undefined;
    assert.notEqual(body?.ok, true, "a degraded answer must not claim ok: true");
  };
}
