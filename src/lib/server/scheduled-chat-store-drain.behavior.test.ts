import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, test, vi } from "vitest";
const fault = vi.hoisted(() => ({ fail: false, observed: vi.fn() }));
vi.mock("./atomic-write.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("./atomic-write.ts")>();
  return { ...actual, writeJsonAtomic: async (file: string, state: { items: Array<{ id: string; status: string }> }) => {
    if (fault.fail && state.items.some(item => item.id === "a" && item.status === "sent")) {
      fault.fail = false; fault.observed();
      throw new Error("synthetic final persistence failure");
    }
    return actual.writeJsonAtomic(file, state);
  } };
});
import { createScheduledChatStore } from "./scheduled-chat-store.ts";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test("a failed session write cannot release another admitted send from the pass drain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "c6-sd-"));
  const file = path.join(root, "scheduled.json");
  const store = createScheduledChatStore(file);
  const now = Date.parse("2026-10-12T15:00:00Z");
  const a = gate(), b = gate(), enteredA = gate(), enteredB = gate();
  let tick: Promise<void> | undefined;
  try {
    for (const id of ["a", "b"]) await store.add({ id, sendAt: new Date(now + 1_000).toISOString(),
      message: { familiarId: "sage", sessionId: `chat-${id}`, prompt: "synthetic scheduled reply" } }, now);
    let settled = false;
    tick = store.tick(async message => {
      if (message.sessionId === "chat-a") { enteredA.release(); await a.promise; }
      else { enteredB.release(); await b.promise; }
      return { status: "sent" };
    }, now + 2_000);
    // Observe both outcomes now, including the expected rejection, without an
    // unhandled rejection or cancelling the other admitted dispatch.
    void tick.then(() => { settled = true; }, () => { settled = true; });
    await Promise.all([enteredA.promise, enteredB.promise]);
    fault.fail = true;
    a.release();
    await vi.waitFor(() => expect(fault.observed).toHaveBeenCalledOnce());
    const dispatchLock = `${file}.${createHash("sha256").update("chat-a").digest("hex")}.dispatch`;
    await vi.waitFor(async () => expect(await readdir(dispatchLock)).toHaveLength(0));
    await setImmediate();
    expect(settled).toBe(false);
    b.release();
    await expect(tick).rejects.toThrow();
    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted.items.find((item: { id: string }) => item.id === "a").status).toBe("sending");
    expect(persisted.items.find((item: { id: string }) => item.id === "b").status).toBe("sent");
    await store.tick(async () => { throw new Error("an ambiguous send was replayed"); }, now + 3_000);
    expect(JSON.parse(await readFile(file, "utf8")).items).toEqual(persisted.items);
  } finally {
    a.release(); b.release(); fault.fail = false;
    await tick?.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
