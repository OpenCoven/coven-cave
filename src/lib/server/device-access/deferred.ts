/**
 * Device access, initialized without holding the server hostage.
 *
 * WHY THIS EXISTS. `createDeviceAccessStore()` was awaited at `server.ts`
 * module scope, so the whole server booted through it. That initialization
 * hardens the store's directory and its three SQLite files, and on Windows each
 * of those is a `powershell.exe` spawn that translates every ACE's SID. On a
 * CI runner with no domain controller those lookups stall, so the server never
 * reached `listen()` and the packaged-server probe reported
 * "did not answer within 90000 ms" — four release candidates in a row
 * (cave-9jt60). Bounding the probe only changed the symptom: the bounded probe
 * was killed, and the kill still took boot down with it.
 *
 * The fix is not to weaken the hardening. It is to stop a slow or failed
 * hardening of ONE feature from deciding whether the server exists. Chat,
 * Board, Canvas and everything else have nothing to do with device pairing.
 *
 * WHAT THIS DOES NOT DO. It does not grant access it could not verify. If
 * initialization fails, every method that could hand out or honour a device
 * credential refuses, permanently, with the reason. The feature fails CLOSED
 * while the server stays up — which is the opposite trade from the one that
 * was there before, where the feature's failure took everything down and, on
 * the way, took device access with it anyway.
 */

import { DeviceAccessError, type DeviceAccessStore } from "./store.ts";

/**
 * How long a policy read waits on initialization before answering
 * "unavailable". Long enough that an ordinary slow start is simply awaited,
 * short enough that a stalled probe cannot hold the server's request path.
 */
const POLICY_WAIT_MS = 5_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export type DeferredDeviceAccess = {
  store: DeviceAccessStore;
  /** Resolves when initialization has settled, successfully or not. */
  settled: Promise<void>;
  /** The failure, once settled and unsuccessful. */
  failure(): Error | null;
};

/**
 * Wrap a store initializer so the caller can start serving immediately.
 *
 * Every method awaits `settled` before delegating, so a request that arrives
 * mid-initialization waits for the real answer rather than being told "not
 * ready" and having to retry. `settled` never rejects — the failure is held and
 * turned into a refusal at the point of use, where it can be reported in the
 * vocabulary the gateway already speaks.
 */
export function deferDeviceAccessStore(
  initialize: () => Promise<DeviceAccessStore>,
  { warn = console.warn }: { warn?: (message: string) => void } = {},
): DeferredDeviceAccess {
  let ready: DeviceAccessStore | null = null;
  let failed: Error | null = null;

  const settled = initialize().then(
    (store) => {
      ready = store;
    },
    (error: unknown) => {
      failed = error instanceof Error ? error : new Error(String(error));
      // Said once, at the moment it becomes true, and in full: an operator
      // who sees device pairing refuse needs this line to explain why, and
      // the server being up is exactly what makes it easy to miss.
      warn(
        "[device-access] unavailable — the server is running and device access is refused. "
          + `Pairing, approvals and device credentials will not work until this is fixed: ${failed.message}`,
      );
    },
  );

  /** The live store, or a refusal carrying why there isn't one. */
  const live = (): DeviceAccessStore => {
    if (ready) return ready;
    throw new DeviceAccessError(
      "forbidden",
      failed
        ? `Device access is unavailable on this host: ${failed.message}`
        : "Device access is unavailable on this host.",
    );
  };

  const store: DeviceAccessStore = {
    async policy() {
      // Bounded, because the gateway awaits this on EVERY request — including
      // direct loopback. An unbounded wait here means a stalled probe stops the
      // server answering at all, which is the same outage as blocking boot,
      // just moved one layer down.
      await Promise.race([settled, sleep(POLICY_WAIT_MS)]);
      // `enabled: false` is NOT a safe answer here: the gateway reads it as
      // "configured off" and runs in legacy mode, which passes REMOTE requests
      // through without pairing. Saying it when the store never opened would
      // turn a failed security check into an open door. `unavailable` is the
      // answer that refuses.
      if (!ready) return { enabled: false, allowedTailnets: [], unavailable: true };
      return ready.policy();
    },
    async snapshot() {
      await settled;
      return live().snapshot();
    },
    async setAllowedTailnets(tailnets, actor) {
      await settled;
      return live().setAllowedTailnets(tailnets, actor);
    },
    async request(peer, input) {
      await settled;
      return live().request(peer, input);
    },
    async inspect(credential, peer) {
      await settled;
      return live().inspect(credential, peer);
    },
    async verify(credential, peer) {
      await settled;
      return live().verify(credential, peer);
    },
    async decide(id, decision, actor) {
      await settled;
      return live().decide(id, decision, actor);
    },
    async recordAccess(deviceId, input) {
      await settled;
      return live().recordAccess(deviceId, input);
    },
    close() {
      // Synchronous by contract. Only the store that actually opened has
      // anything to close; a failed initialization left nothing behind.
      if (ready) ready.close();
    },
  };

  return { store, settled, failure: () => failed };
}
