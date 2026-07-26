import { useEffect, useState } from "react";
import { isFleetTokenPresent } from "./fleet-gate.ts";

// One status probe per page load — gate callers (board drawer, familiar
// studio) mount repeatedly and /api/omnigent/status does a remote health call.
let cached: Promise<boolean> | null = null;
const listeners = new Set<(enabled: boolean) => void>();
let revision = 0;
let current = false;

/** Keep mounted Fleet controls in sync when Settings changes the master gate. */
export function publishFleetTokenStatus(
  status: Parameters<typeof isFleetTokenPresent>[0],
): boolean {
  const enabled = isFleetTokenPresent(status);
  revision += 1;
  current = enabled;
  cached = Promise.resolve(enabled);
  for (const listener of listeners) listener(enabled);
  return enabled;
}

function probeFleetToken(): Promise<boolean> {
  const probeRevision = revision;
  cached ??= fetch("/api/omnigent/status", { cache: "no-store" })
    .then((r) => r.json())
    .then((j: unknown) => isFleetTokenPresent(j as Parameters<typeof isFleetTokenPresent>[0]))
    .then((enabled) => {
      if (probeRevision !== revision) return current;
      current = enabled;
      return enabled;
    })
    .catch(() => (probeRevision === revision ? false : current));
  return cached;
}

/**
 * True only when the user has the Omnigent env set up in their Cave Vault and
 * the server resolved an auth token — the condition for showing any Fleet
 * button. Defaults to false (hidden) until proven.
 */
export function useFleetTokenEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    const update = (value: boolean) => {
      if (alive) setEnabled(value);
    };
    listeners.add(update);
    void probeFleetToken().then((v) => {
      update(v);
    });
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, []);
  return enabled;
}
