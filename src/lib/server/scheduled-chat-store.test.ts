import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScheduledChatStore } from './scheduled-chat-store.ts';

const now = Date.parse('2026-10-12T15:00:00Z');
const input = (id = 'reply-1') => ({ id, sendAt: new Date(now + 60_000).toISOString(), message: {
  familiarId: 'sage', sessionId: 'chat-1', prompt: 'Follow up tomorrow',
  modelOverride: 'model-a', permissionMode: 'read', modelControls: { thinking: 'high' },
} });
async function fixture(fn: (file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'scheduled-chat-'));
  try { await fn(path.join(dir, 'scheduled.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('schedules persist, capture context, reject early dispatch, and catch up after restart', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  await store.add(input(), now);
  const restarted = createScheduledChatStore(file);
  let sends = 0;
  const dispatch = async (message: Record<string, unknown>) => {
    sends++;
    assert.equal(message.modelOverride, 'model-a');
    assert.equal(message.permissionMode, 'read');
    assert.deepEqual(message.modelControls, { thinking: 'high' });
    return { status: 'sent' as const };
  };
  await restarted.tick(dispatch, now);
  assert.equal(sends, 0);
  await restarted.tick(dispatch, now + 120_000);
  await restarted.tick(dispatch, now + 180_000);
  assert.equal(sends, 1);
  assert.equal((await restarted.list('chat-1'))[0].status, 'sent');
}));
test('creation retries are idempotent, conflicting reuse is rejected, and cancelled replies never send', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  await Promise.all([store.add(input(), now), store.add(input(), now)]);
  assert.equal((await store.list('chat-1')).length, 1);
  await assert.rejects(store.add({ ...input(), message: { ...input().message, prompt: 'different' } }, now));
  await store.cancel('reply-1', 'chat-1');
  await store.cancel('reply-1', 'chat-1');
  await store.tick(async () => { assert.fail('cancelled message sent'); }, now + 120_000);
}));
test('concurrent scheduler instances claim once; cancellation cannot race a dispatch', () => fixture(async file => {
  const a = createScheduledChatStore(file), b = createScheduledChatStore(file);
  await a.add(input(), now);
  let sends = 0;
  await Promise.all([a, b].map(store => store.tick(async () => {
    sends++;
    await assert.rejects(b.cancel('reply-1', 'chat-1'));
    return { status: 'sent' as const };
  }, now + 120_000)));
  assert.equal(sends, 1);
}));
test('an uncertain dispatch is never automatically replayed', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  await store.add(input(), now);
  await store.tick(async () => { throw new Error('lost acknowledgement'); }, now + 120_000);
  assert.equal((await store.list('chat-1'))[0].status, 'uncertain');
  await createScheduledChatStore(file).tick(async () => { assert.fail('replayed'); }, now + 180_000);
}));
test('only an explicit busy rejection returns to the schedule', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  await store.add(input(), now);
  await store.tick(async () => ({ status: 'scheduled' }), now + 120_000);
  assert.equal((await store.list('chat-1'))[0].status, 'scheduled');
  await store.tick(async () => ({ status: 'failed', error: 'Access revoked' }), now + 180_000);
  assert.equal((await store.list('chat-1'))[0].status, 'failed');
}));
test('validation rejects past/ambiguous dates and invalid context; corrupt storage is not erased', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  for (const sendAt of ['invalid', '2026-10-12T16:00', new Date(now).toISOString()]) {
    await assert.rejects(store.add({ ...input(), sendAt }, now));
  }
  await assert.rejects(store.add({ ...input(), message: { ...input().message, sessionId: '../escape' } }, now));
  await assert.rejects(store.add({ ...input(), message: { ...input().message, prompt: '' } }, now));
  await assert.rejects(store.add({ ...input(), message: { ...input().message, startNewConversation: true } }, now));
  await writeFile(file, '{broken');
  await assert.rejects(store.add(input(), now));
  assert.equal(await readFile(file, 'utf8'), '{broken');
}));
test('an unrelated due chat can send while an earlier stream is still open', () => fixture(async file => {
  const store = createScheduledChatStore(file);
  await store.add(input(), now);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(r => { release = r; });
  const entered = new Promise<void>(r => { started = r; });
  const first = store.tick(async () => { started(); await pending; return { status: 'sent' }; }, now + 120_000);
  await entered;
  await store.add({ ...input('reply-2'), message: { ...input().message, sessionId: 'chat-2' } }, now);
  let secondSent = false;
  try {
    await store.tick(async () => { secondSent = true; return { status: 'sent' }; }, now + 120_000);
    assert.equal(secondSent, true);
  } finally { release(); await first; }
}));
test('different scheduler instances cannot dispatch different replies to the same chat concurrently', () => fixture(async file => {
  const a = createScheduledChatStore(file), b = createScheduledChatStore(file);
  await a.add(input(), now);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const started = new Promise<void>(r => { entered = r; });
  const first = a.tick(async () => { entered(); await gate; return { status: 'sent' }; }, now + 120_000);
  await started;
  await b.add(input('reply-2'), now);
  let overlapping = false;
  try { await b.tick(async () => { overlapping = true; return { status: 'sent' }; }, now + 120_000); }
  finally { release(); await first; }
  assert.equal(overlapping, false);
}));
test('catch-up preserves chronological order within a chat across scheduler instances', () => fixture(async file => {
  const a = createScheduledChatStore(file), b = createScheduledChatStore(file);
  for (let i = 0; i < 8; i++) await a.add({ ...input(`reply-${i}`), sendAt: new Date(now + (i + 1) * 1_000).toISOString() }, now);
  const sent: string[] = [];
  const dispatch = async (_message: unknown, runId: string) => { sent.push(runId); return { status: 'sent' as const }; };
  const expected = Array.from({ length: 8 }, (_, i) => `scheduled-reply-${i}`);
  // A tick may skip a contended session when its lock deadline expires.
  // Assert order on every batch, and allow later ticks to finish catch-up.
  const deadline = performance.now() + 10_000;
  while (sent.length < expected.length && performance.now() < deadline) {
    await Promise.all([a.tick(dispatch, now + 120_000), b.tick(dispatch, now + 120_000)]);
    assert.deepEqual(sent, expected.slice(0, sent.length));
  }
  assert.deepEqual(sent, expected);
}));
