import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduledChatResult } from './scheduled-chat-dispatch.ts';
const sse = (...events: object[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
test('only explicit done without errors confirms delivery', async () => {
  assert.equal((await scheduledChatResult(sse({ kind: 'done' }))).status, 'sent');
  assert.equal((await scheduledChatResult(sse({ kind: 'assistant', text: 'partial' }))).status, 'uncertain');
  assert.equal((await scheduledChatResult(sse({ kind: 'error', message: 'failed' }, { kind: 'done' }))).status, 'failed');
  assert.equal((await scheduledChatResult(sse({ kind: 'done', isError: true }))).status, 'failed');
});
test('only chat_run_active rejection permits an automatic retry', async () => {
  assert.equal((await scheduledChatResult(Response.json({ code: 'chat_run_active' }, { status: 409 }))).status, 'scheduled');
  assert.equal((await scheduledChatResult(Response.json({ error: 'denied' }, { status: 403 }))).status, 'failed');
  assert.equal((await scheduledChatResult(new Response('internal', { status: 500 }))).status, 'uncertain');
  assert.equal((await scheduledChatResult(Response.json({ ok: true }))).status, 'uncertain');
});
