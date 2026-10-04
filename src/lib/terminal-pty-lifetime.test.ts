import assert from "node:assert/strict";
import { createTerminalPtyLifetime } from "./terminal-pty-lifetime.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// The same ordering applies to native pty_start and the WS connect handshake.
for (const transport of ["native", "websocket"]) {
  const lifetime = createTerminalPtyLifetime("auth", true);
  const pending = deferred();
  let running = false;
  let stops = 0;
  const start = lifetime.run(async () => { await pending.promise; running = true; }, () => { running = false; stops++; });
  lifetime.dispose();
  assert.equal(stops, 0, `${transport}: wait for pending startup before stopping`);
  pending.resolve();
  await start;
  assert.equal(running, false, `${transport}: a late startup cannot orphan a PTY`);
  assert.equal(stops, 1);
  lifetime.dispose();
  assert.equal(stops, 1, "cleanup is idempotent");
  let restarted = false;
  await lifetime.run(async () => { restarted = true; }, () => {});
  assert.equal(restarted, false, "disposed effects cannot start another shell");
}

{
  const first = createTerminalPtyLifetime("auth", true);
  const second = createTerminalPtyLifetime("auth", true);
  assert.notEqual(first.threadId, second.threadId, "Strict Mode remounts and retries own distinct PTYs");
  let stops = 0;
  await first.run(async () => {}, () => { stops++; });
  first.dispose();
  assert.equal(stops, 1, "unmount stops an already started PTY");
}

{
  const lifetime = createTerminalPtyLifetime("rail", false);
  assert.equal(lifetime.threadId, "rail");
  let stops = 0;
  await lifetime.run(async () => {}, () => { stops++; });
  lifetime.dispose();
  assert.equal(stops, 0, "ordinary rail terminals survive unmount");
}

{
  const lifetime = createTerminalPtyLifetime("auth", true);
  await assert.rejects(lifetime.run(async () => { throw new Error("failed handshake"); }, () => {}));
  lifetime.dispose();
}

{
  const lifetime = createTerminalPtyLifetime("auth", true);
  let stops = 0;
  const stop = () => { stops++; };
  await lifetime.run(async () => {}, stop);
  const pending = deferred();
  const reconnect = lifetime.run(() => pending.promise, stop);
  lifetime.dispose();
  assert.equal(stops, 0, "close must not detach a pending reconnect before its kill frame can be sent");
  pending.resolve();
  await reconnect;
  assert.equal(stops, 1, "a late reconnect is reaped");
}
console.log("terminal-pty-lifetime.test.ts: ok");
