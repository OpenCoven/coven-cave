import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveResearchCapability } from '../research-capability.ts';
import { dispatchResearchRequest, fetchOptionalGithubRepoView, startOptionalResearch } from './research-package.ts';

for (const [name, capability] of [
  ['absent', resolveResearchCapability(false)],
  ['disabled', resolveResearchCapability(true, '0')],
] as const) {
  test(`${name} Research never imports workers or route implementations`, async () => {
    let loads = 0;
    const load = async () => { loads++; throw new Error('Optional code was loaded'); };
    await startOptionalResearch(capability, load);
    assert.deepEqual(await fetchOptionalGithubRepoView({ owner: "OpenCoven", repo: "coven-cave", token: null }, capability, load), { ok: false });
    const response = await dispatchResearchRequest('research/missions', 'GET', new Request('http://localhost/api/research/missions', { headers: { host: 'localhost' } }), undefined, capability, load);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, name === 'absent' ? 'research-not-installed' : 'research-disabled');
    assert.equal(loads, 0);
  });
}

test('unauthorized requests cannot load even enabled Research', async () => {
  let loads = 0;
  const response = await dispatchResearchRequest('research/missions', 'GET', new Request('https://evil.example/api/research/missions', { headers: { host: 'evil.example' } }), undefined, resolveResearchCapability(true), async () => { loads++; throw new Error('Unexpected load'); });
  assert.equal(response.status, 403);
  assert.equal(loads, 0);
});

test('enabled Research receives the original request and context and starts explicitly', async () => {
  const request = new Request('http://localhost/api/research/missions', { headers: { host: 'localhost' } });
  const context = { params: Promise.resolve({ id: 'mission' }) };
  let starts = 0;
  const load = async () => ({
    researchHostContractVersion: 2,
    startResearchRuntime: async () => { starts++; },
    fetchGithubRepoSnapshot: async () => ({ ok: false as const }),
    dispatchResearchRequest: async (route: string, method: string, received: Request, receivedContext?: unknown) => {
      assert.equal(route, 'research/missions');
      assert.equal(method, 'GET');
      assert.equal(received, request);
      assert.equal(receivedContext, context);
      return Response.json({ ok: true });
    },
  });
  await startOptionalResearch(resolveResearchCapability(true), load);
  assert.equal(starts, 1);
  assert.equal((await dispatchResearchRequest('research/missions', 'GET', request, context, resolveResearchCapability(true), load)).status, 200);
});

for (const failure of ['load', 'incompatible'] as const) {
  test(`${failure} Research returns an actionable private failure before dispatch`, async () => {
    let loads = 0;
    let operations = 0;
    const load = async () => {
      loads++;
      if (failure === 'load') throw new Error('private-loader-sentinel /private/profile');
      return {
        researchHostContractVersion: 1,
        startResearchRuntime: async () => { operations++; },
        fetchGithubRepoSnapshot: async () => { operations++; return { ok: false as const }; },
        dispatchResearchRequest: async () => { operations++; return Response.json({ ok: true }); },
      };
    };
    for (const method of ['GET', 'POST']) {
      const request = new Request('http://localhost/api/research/missions', {
        method, headers: { host: 'localhost' },
      });
      const response = await dispatchResearchRequest('research/missions', method, request,
        undefined, resolveResearchCapability(true), load);
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.code, failure === 'load' ? 'research-runtime-unavailable' : 'research-incompatible');
      assert.match(payload.error, failure === 'load' ? /repair or reinstall Research/i : /update Cave and Research/i);
      assert.match(payload.error, /restart Cave/i);
      assert.doesNotMatch(JSON.stringify(payload), /private-loader-sentinel|\/private\/profile/);
    }
    assert.equal(loads, 2, 'one load attempt per request, with no automatic retry');
    assert.equal(operations, 0, 'unavailable code must not run');

    await assert.rejects(startOptionalResearch(resolveResearchCapability(true), load), (error: Error) => {
      assert.match(error.message, /Research/);
      assert.match(error.message, /restart Cave/i);
      assert.doesNotMatch(String(error), /private-loader-sentinel|\/private\/profile/);
      return true;
    });
    assert.deepEqual(await fetchOptionalGithubRepoView(
      { owner: 'OpenCoven', repo: 'coven-cave', token: null },
      resolveResearchCapability(true), load,
    ), { ok: false });
    assert.equal(loads, 4);
    assert.equal(operations, 0);
  });
}

test('compatible runtime operation errors are not reclassified or replayed', async () => {
  const failure = new Error('operation outcome must remain visible');
  let mutations = 0;
  const load = async () => ({
    researchHostContractVersion: 2,
    startResearchRuntime: async () => { throw failure; },
    fetchGithubRepoSnapshot: async (): Promise<never> => { throw failure; },
    dispatchResearchRequest: async (): Promise<Response> => { mutations++; throw failure; },
  });
  const request = new Request('http://localhost/api/research/missions', {
    method: 'POST', headers: { host: 'localhost' },
  });
  await assert.rejects(dispatchResearchRequest('research/missions', 'POST', request,
    undefined, resolveResearchCapability(true), load), (error: unknown) => error === failure);
  assert.equal(mutations, 1);
  await assert.rejects(startOptionalResearch(resolveResearchCapability(true), load),
    (error: unknown) => error === failure);
  await assert.rejects(fetchOptionalGithubRepoView(
    { owner: 'OpenCoven', repo: 'coven-cave', token: null }, resolveResearchCapability(true), load,
  ), (error: unknown) => error === failure);
});

test('compatible runtime response identity and stream pass through unchanged', async () => {
  const response = new Response('event: failure\ndata: unavailable\n\n', {
    status: 409, headers: { 'content-type': 'text/event-stream', 'x-runtime-receipt': 'synthetic' },
  });
  const load = async () => ({
    researchHostContractVersion: 2,
    startResearchRuntime: async () => {},
    fetchGithubRepoSnapshot: async () => ({ ok: false as const }),
    dispatchResearchRequest: async () => response,
  });
  const actual = await dispatchResearchRequest('research/missions', 'GET',
    new Request('http://localhost/api/research/missions', { headers: { host: 'localhost' } }),
    undefined, resolveResearchCapability(true), load);
  assert.equal(actual, response);
  assert.equal(actual.bodyUsed, false);
  assert.equal(await actual.text(), 'event: failure\ndata: unavailable\n\n');
});

test('dispatch preserves native media tickets without granting other routes or methods', async () => {
  const { signResearchMediaTicket } = await import('../research-media-ticket.ts');
  const previous = process.env.COVEN_CAVE_AUTH_TOKEN;
  process.env.COVEN_CAVE_AUTH_TOKEN = 'synthetic-media-sidecar-secret';
  try {
    const ticket = await signResearchMediaTicket({ secret: process.env.COVEN_CAVE_AUTH_TOKEN, familiarId: 'salem', generationId: 'gen_1' });
    const url = new URL('http://127.0.0.1:3000/api/research/generations/media');
    url.searchParams.set('familiarId', 'salem');
    url.searchParams.set('id', 'gen_1');
    url.searchParams.set('mediaTicket', ticket);
    let loads = 0;
    const load = async () => {
      loads++;
      return { researchHostContractVersion: 2, startResearchRuntime: async () => {}, fetchGithubRepoSnapshot: async () => ({ ok: false as const }), dispatchResearchRequest: async () => Response.json({ ok: true }) };
    };
    const request = () => new Request(url, { headers: { host: url.host } });
    const call = (route: string, method = 'GET', enabled = true) => dispatchResearchRequest(route, method, request(), undefined, resolveResearchCapability(true, enabled ? '1' : '0'), load);
    assert.equal((await call('research/generations/media')).status, 200);
    assert.equal(loads, 1);
    assert.equal((await call('research/generations/media', 'GET', false)).status, 503);
    assert.equal((await call('research/generations/media', 'POST')).status, 403);
    assert.equal((await call('research/missions')).status, 403);
    url.searchParams.set('id', 'another-generation');
    assert.equal((await call('research/generations/media')).status, 403);
    assert.equal(loads, 1);
  } finally {
    if (previous === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
    else process.env.COVEN_CAVE_AUTH_TOKEN = previous;
  }
});

test('dispatch preserves validated stream credentials only for the run stream GET', async () => {
  const { VALIDATED_SIDECAR_QUERY_HEADER, MOBILE_ACCESS_HEADER } = await import('../../proxy-helpers.ts');
  const previous = process.env.COVEN_CAVE_AUTH_TOKEN;
  process.env.COVEN_CAVE_AUTH_TOKEN = 'synthetic-stream-sidecar-secret';
  try {
    let loads = 0;
    const load = async () => {
      loads++;
      return { researchHostContractVersion: 2, startResearchRuntime: async () => {}, fetchGithubRepoSnapshot: async () => ({ ok: false as const }), dispatchResearchRequest: async () => Response.json({ ok: true }) };
    };
    const request = (extra: Record<string, string> = {}) => new Request('http://localhost/api/research/runs/run_1/stream', {
      headers: { host: 'localhost', [VALIDATED_SIDECAR_QUERY_HEADER]: '1', ...extra },
    });
    const call = (route: string, method = 'GET', extra: Record<string, string> = {}) => dispatchResearchRequest(route, method, request(extra), undefined, resolveResearchCapability(true), load);
    assert.equal((await call('research/runs/[id]/stream')).status, 200);
    assert.equal((await call('research/runs/[id]/stream', 'POST')).status, 403);
    assert.equal((await call('research/runs/[id]')).status, 403);
    assert.equal((await call('research/runs/[id]/stream', 'GET', { [MOBILE_ACCESS_HEADER]: '1' })).status, 403);
    assert.equal((await call('research/runs/[id]/stream', 'GET', { origin: 'https://evil.example' })).status, 403);
    assert.equal(loads, 1);
  } finally {
    if (previous === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
    else process.env.COVEN_CAVE_AUTH_TOKEN = previous;
  }
});
