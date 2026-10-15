import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';

const root = await mkdtemp(path.join(tmpdir(), 'schedule-api-'));
const savedEnv = { ...process.env };
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, 'cave');
process.env.NEXT_PHASE = 'phase-production-build'; // No background timers in this route fixture.
const { saveConversation } = await import('../../../../lib/cave-conversations.ts');
const { POST, GET, DELETE } = await import('./route.ts');
after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await rm(root, { recursive: true, force: true });
});
const now = new Date().toISOString();
await saveConversation({ sessionId: 'chat-1', familiarId: 'sage', harness: 'codex', createdAt: now, updatedAt: now, turns: [] });
const value = { id: 'schedule-1', sendAt: new Date(Date.now() + 86_400_000).toISOString(), message: { familiarId: 'sage', sessionId: 'chat-1', prompt: 'Later' } };
const post = (body: unknown) => POST(new Request('http://localhost/api/chat/scheduled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
test('API persists one schedule on retries, lists by chat, and cancels idempotently', async () => {
  assert.equal((await post(value)).status, 200);
  assert.equal((await post(value)).status, 200);
  const list = await (await GET(new Request('http://localhost/api/chat/scheduled?sessionId=chat-1'))).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].message.prompt, 'Later');
  assert.deepEqual((await (await GET(new Request('http://localhost/api/chat/scheduled?sessionId=another'))).json()).items, []);
  for (let i = 0; i < 2; i++) assert.equal((await DELETE(new Request('http://localhost/api/chat/scheduled?sessionId=chat-1&id=schedule-1', { method: 'DELETE' }))).status, 200);
});
test('API rejects malformed input, past time, and a different familiar or missing chat', async () => {
  for (const input of [null, [], { ...value, sendAt: 'invalid' }]) assert.equal((await post(input)).status, 400);
  assert.equal((await post({ ...value, id: 'past', sendAt: '2000-01-01T00:00:00Z' })).status, 400);
  assert.equal((await post({ ...value, message: { ...value.message, familiarId: 'kitty' } })).status, 404);
  assert.equal((await post({ ...value, message: { ...value.message, sessionId: 'missing' } })).status, 404);
  assert.equal((await POST(new Request('http://localhost/api/chat/scheduled', { method: 'POST', body: '{broken' }))).status, 400);
});
