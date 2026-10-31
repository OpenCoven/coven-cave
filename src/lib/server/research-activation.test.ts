import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resolveResearchCapability } from '../research-capability.ts';
import {
  RESEARCH_STOP_UNSUPPORTED,
  researchActivation,
  startOptionalResearch,
  stopOptionalResearch,
  stopOptionalResearchForShutdown,
} from './research-activation.ts';
import { dispatchResearchRequest, fetchOptionalGithubRepoView } from './research-package.ts';
import { coordinateStartupWorkerShutdown, registerStartupWorker } from './startup-worker-shutdown.ts';

type Owners = { __caveResearchActivation?: unknown; __caveStartupWorkerShutdown?: unknown };
const enabled = resolveResearchCapability(true);
const localRequest = () => new Request('http://localhost/api/research/missions', { headers: { host: 'localhost' } });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

function runtime(options: { stop?: () => Promise<void>; start?: () => Promise<void> } = {}) {
  const counts = { loads: 0, starts: 0, stops: 0, dispatches: 0 };
  const module = {
    researchHostContractVersion: 2,
    startResearchRuntime: async () => { counts.starts++; await options.start?.(); },
    fetchGithubRepoSnapshot: async () => ({ ok: false as const }),
    dispatchResearchRequest: async () => { counts.dispatches++; return Response.json({ ok: true }); },
    ...(options.stop ? { stopResearchRuntime: async () => { counts.stops++; await options.stop!(); } } : {}),
  };
  const load = async () => { counts.loads++; return module; };
  return { counts, load };
}

beforeEach(() => {
  delete (globalThis as Owners).__caveResearchActivation;
  delete (globalThis as Owners).__caveStartupWorkerShutdown;
});

test('a stop before any start closes admission without loading the package', async () => {
  const { counts, load } = runtime();
  assert.deepEqual(await stopOptionalResearch(), { status: 'inactive' });
  assert.equal(researchActivation().state, 'disabled');
  const response = await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'research-disabled');
  assert.deepEqual(await fetchOptionalGithubRepoView({ owner: 'OpenCoven', repo: 'coven-cave', token: null }, enabled, load), { ok: false });
  assert.equal(counts.loads, 0);
});

test('a runtime with a stop drains once; reactivation starts one new owner', async () => {
  const { counts, load } = runtime({ stop: async () => undefined });
  await Promise.all([startOptionalResearch(enabled, load), startOptionalResearch(enabled, load)]);
  assert.equal(researchActivation().state, 'active');
  assert.equal(counts.starts, 1, 'concurrent starts join one owner');
  assert.equal((await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load)).status, 200);

  assert.deepEqual(await stopOptionalResearch(), { status: 'drained' });
  assert.equal(counts.stops, 1);
  assert.deepEqual(researchActivation(), { state: 'disabled', lastTeardown: { status: 'drained' } });
  const refused = await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load);
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).code, 'research-disabled');
  assert.equal(counts.dispatches, 1, 'nothing reaches the package after the stop');

  await startOptionalResearch(enabled, load);
  assert.equal(researchActivation().state, 'active');
  assert.equal(counts.starts, 2);
  assert.equal((await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load)).status, 200);
});

test('the v0.2.0 package shape reports unsupported and still closes admission', async () => {
  const { counts, load } = runtime();
  await startOptionalResearch(enabled, load);
  const outcome = await stopOptionalResearch();
  assert.deepEqual(outcome, { status: 'unsupported', error: RESEARCH_STOP_UNSUPPORTED });
  assert.match(RESEARCH_STOP_UNSUPPORTED, /restart/i);
  assert.equal(researchActivation().state, 'disabled');
  const refused = await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load);
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).code, 'research-disabled');
  assert.equal(counts.loads, 1, 'no second load attempt and no retry');
  assert.equal(counts.starts, 1, 'admitted work is neither cancelled nor replayed');
});

test('a stop that lands before the package starts fences the start: nothing to stop, nothing started', async () => {
  const { counts, load } = runtime({ stop: async () => undefined });
  const starting = startOptionalResearch(enabled, load);
  const stopping = stopOptionalResearch();
  assert.equal(researchActivation().state, 'stopping');
  await starting;
  assert.deepEqual(await stopping, { status: 'inactive' });
  assert.equal(counts.starts, 0, 'the fenced start never reaches the package');
  assert.equal(counts.stops, 0);
  assert.equal(researchActivation().state, 'disabled');
});

test('a stop during an in-flight start waits for it, then stops it, with no double start', async () => {
  const held = gate();
  const entered = gate();
  const { counts, load } = runtime({ stop: async () => undefined, start: () => { entered.release(); return held.promise; } });
  const starting = startOptionalResearch(enabled, load);
  await entered.promise;
  const stopping = stopOptionalResearch();
  assert.equal(researchActivation().state, 'stopping', 'admission closes synchronously');
  const refused = await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load);
  assert.equal(refused.status, 503);
  let stopped = false;
  void stopping.then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stopped, false, 'the stop does not race the start it fences');
  assert.equal(counts.stops, 0);
  held.release();
  await starting;
  assert.deepEqual(await stopping, { status: 'drained' });
  assert.equal(counts.starts, 1);
  assert.equal(counts.stops, 1);
  assert.equal(researchActivation().state, 'disabled');
});

test('a rejecting stop reports failed, keeps admission closed and is not retried', async () => {
  const { counts, load } = runtime({ stop: async () => { throw new Error('synthetic stop failure /private/profile'); } });
  await startOptionalResearch(enabled, load);
  const outcome = await stopOptionalResearch();
  assert.equal(outcome.status, 'failed');
  assert.match(String((outcome as { error: string }).error), /synthetic stop failure/);
  assert.equal(counts.stops, 1);
  assert.equal(researchActivation().state, 'disabled');
  assert.equal((await dispatchResearchRequest('research/missions', 'GET', localRequest(), undefined, enabled, load)).status, 503);
  assert.deepEqual(await stopOptionalResearch(), outcome, 'a second stop returns the retained outcome without calling the package again');
  assert.equal(counts.stops, 1);
});

test('a failed start leaves Research inactive and a later start may try again', async () => {
  let fail = true;
  const { counts, load } = runtime({ start: async () => { if (fail) throw new Error('synthetic start failure'); } });
  await assert.rejects(startOptionalResearch(enabled, load), /synthetic start failure/);
  assert.equal(researchActivation().state, 'inactive');
  fail = false;
  await startOptionalResearch(enabled, load);
  assert.equal(researchActivation().state, 'active');
  assert.equal(counts.starts, 2);
});

test('an env-disabled or absent capability never touches the activation owner', async () => {
  const { counts, load } = runtime();
  await startOptionalResearch(resolveResearchCapability(true, '0'), load);
  await startOptionalResearch(resolveResearchCapability(false), load);
  assert.equal(researchActivation().state, 'inactive');
  assert.equal(counts.loads, 0);
});

test('process shutdown drains Research beside the other workers; an unstoppable runtime is logged, a rejecting one is failed', async () => {
  const stoppable = runtime({ stop: async () => undefined });
  await startOptionalResearch(enabled, stoppable.load);
  registerStartupWorker('research', stopOptionalResearchForShutdown);
  const result = await coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 100 });
  assert.deepEqual(result.workers.research, { status: 'drained' });
  assert.equal(stoppable.counts.stops, 1);
  assert.equal(await startOptionalResearch(enabled, stoppable.load), undefined);
  assert.equal(researchActivation().state, 'disabled', 'no restart after coordinated shutdown');

  delete (globalThis as Owners).__caveResearchActivation;
  delete (globalThis as Owners).__caveStartupWorkerShutdown;
  const unstoppable = runtime();
  await startOptionalResearch(enabled, unstoppable.load);
  registerStartupWorker('research', stopOptionalResearchForShutdown);
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  let reported;
  try {
    reported = await coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 100 });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(reported.workers.research, { status: 'drained' }, 'admission closed; the quit is not failed for a package limitation');
  assert.equal(warnings.length, 1, 'the undrained package is logged once');
  assert.match(String(warnings[0][0]), /media jobs were not drained/);
  assert.equal(warnings[0][1], RESEARCH_STOP_UNSUPPORTED);
  assert.deepEqual(researchActivation(), { state: 'disabled', lastTeardown: { status: 'unsupported', error: RESEARCH_STOP_UNSUPPORTED } });

  delete (globalThis as Owners).__caveResearchActivation;
  delete (globalThis as Owners).__caveStartupWorkerShutdown;
  const rejecting = runtime({ stop: async () => { throw new Error('synthetic package stop failure'); } });
  await startOptionalResearch(enabled, rejecting.load);
  registerStartupWorker('research', stopOptionalResearchForShutdown);
  const failed = await coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 100 });
  assert.deepEqual(failed.workers.research, { status: 'failed', error: 'synthetic package stop failure' });
});

test('an inactive Research drains cleanly at shutdown', async () => {
  registerStartupWorker('research', stopOptionalResearchForShutdown);
  const result = await coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 100 });
  assert.deepEqual(result.workers.research, { status: 'drained' });
});
