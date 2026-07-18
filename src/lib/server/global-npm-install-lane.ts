/**
 * Process-wide lease for global npm mutations.
 *
 * npm stores global packages, shims, and cache metadata under one prefix, so
 * two unrelated `npm install -g` invocations can corrupt or lock the same
 * tree. Keep this state on globalThis: Next's dev HMR can re-evaluate a module
 * while a child process is active, but it must not forget the active lease.
 */

type GlobalNpmInstallLane = {
  target: string | null;
};

type GlobalScope = typeof globalThis & {
  __covenGlobalNpmInstallLane?: GlobalNpmInstallLane;
};

function lane(): GlobalNpmInstallLane {
  const scope = globalThis as GlobalScope;
  return (scope.__covenGlobalNpmInstallLane ??= { target: null });
}

export type NpmInstallLease = {
  target: string;
  release: () => void;
};

export type NpmInstallReservation =
  | { ok: true; lease: NpmInstallLease }
  | { ok: false; owner: string };

/** Atomically reserve the one global npm lane, or identify its current owner. */
export function reserveGlobalNpmInstall(target: string): NpmInstallReservation {
  const current = lane();
  if (current.target) return { ok: false, owner: current.target };
  current.target = target;

  let released = false;
  return {
    ok: true,
    lease: {
      target,
      // A late child `error` after `close` must not clear a newer lease.
      release: () => {
        if (released) return;
        released = true;
        if (current.target === target) current.target = null;
      },
    },
  };
}

export function globalNpmInstallOwner(): string | null {
  return lane().target;
}

/** Clear a completed/stale owner without touching a newer lease. */
export function releaseGlobalNpmInstall(target: string): void {
  const current = lane();
  if (current.target === target) current.target = null;
}

/** Test-only recovery for a process that has no active child to clean up. */
export function resetGlobalNpmInstallLaneForTest(): void {
  lane().target = null;
}
