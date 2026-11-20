import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { startFixtureKeepalive } from './runtime-activity-fixture-keepalive.mjs';

function response() {
  const res = new EventEmitter();
  res.chunks = [];
  res.write = (chunk) => { res.chunks.push(chunk); return true; };
  return res;
}

test('a held human stage gets SSE comments before the transport idle deadline', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = response();
  const stop = startFixtureKeepalive(res);
  for (let elapsed = 0; elapsed < 360_000; elapsed += 15_000) {
    t.mock.timers.tick(15_000);
    assert.ok(res.chunks.length > 0, 'the provider must not stay silent during a human stage');
    assert.match(res.chunks.pop(), /^:[^\n]*\n\n$/, 'keepalive is a comment, never an activity event');
  }
  stop();
  t.mock.timers.tick(30_000);
  assert.deepEqual(res.chunks, []);
});

for (const event of ['close', 'finish']) {
  test(`keepalive stops on response ${event}`, (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const res = response();
    startFixtureKeepalive(res);
    t.mock.timers.tick(15_000);
    assert.equal(res.chunks.length, 1);
    res.emit(event);
    t.mock.timers.tick(60_000);
    assert.equal(res.chunks.length, 1);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('finish'), 0);
  });
}
