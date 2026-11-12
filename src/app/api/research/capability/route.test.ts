import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { GET, POST } from './route.ts';

const ENV = ['COVEN_RESEARCH_PACKAGE_AVAILABLE', 'COVEN_RESEARCH_ENABLED'] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

function local(init: RequestInit = {}): Request {
  return new Request('http://127.0.0.1:3000/api/research/capability', {
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    ...init,
  });
}
const json = (body: unknown) => local({ method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  for (const key of ENV) { saved[key] = process.env[key]; delete process.env[key]; }
  delete (globalThis as { __caveResearchActivation?: unknown }).__caveResearchActivation;
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  delete (globalThis as { __caveResearchActivation?: unknown }).__caveResearchActivation;
});

test('activation changes refuse remote origins and malformed bodies before touching the owner', async () => {
  const remote = await POST(new Request('http://localhost:3000/api/research/capability', {
    method: 'POST', headers: { host: 'localhost:3000', origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: JSON.stringify({ active: false }),
  }));
  assert.equal(remote.status, 403);
  assert.equal((await POST(json({ active: 'no' }))).status, 400);
  assert.equal((await POST(local({ method: 'POST', body: '{', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' } }))).status, 400);
  assert.equal((await GET(local())).ok, true);
  assert.equal((await (await GET(local())).json()).activation.state, 'inactive');
});

test('a hot disable closes admission and the capability read reflects it without a restart', async () => {
  process.env.COVEN_RESEARCH_PACKAGE_AVAILABLE = '1';
  const before = await (await GET(local())).json();
  assert.equal(before.enabled, true);
  const disabled = await POST(json({ active: false }));
  assert.equal(disabled.status, 200);
  const body = await disabled.json();
  assert.equal(body.enabled, false);
  assert.equal(body.reason, 'disabled');
  assert.equal(body.available, true);
  assert.deepEqual(body.teardown, { status: 'inactive' });
  assert.deepEqual(body.activation, { state: 'disabled', lastTeardown: { status: 'inactive' } });
  const after = await (await GET(local())).json();
  assert.equal(after.enabled, false);
  assert.equal(after.reason, 'disabled');
  assert.equal(after.activation.state, 'disabled');
});

test('reactivation keeps the build and environment gates with their own codes', async () => {
  const absent = await POST(json({ active: true }));
  assert.equal(absent.status, 503);
  assert.equal((await absent.json()).code, 'research-not-installed');
  process.env.COVEN_RESEARCH_PACKAGE_AVAILABLE = '1';
  process.env.COVEN_RESEARCH_ENABLED = '0';
  const envDisabled = await POST(json({ active: true }));
  assert.equal(envDisabled.status, 503);
  assert.equal((await envDisabled.json()).code, 'research-disabled');
  assert.equal((await (await GET(local())).json()).activation.state, 'inactive', 'a refused activation does not move the owner');
});
