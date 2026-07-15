import { useEffect, useState } from "react";
import { isFleetTokenPresent } from "./fleet-gate.ts";

// One status probe per page load — gate callers (board drawer, familiar
// studio) mount repeatedly and /api/omnigent/status does a remote health call.
let cached: Promise<boolean> | null = null;

function probeFleetToken(): Promise<boolean> {
  cached ??= fetch("/api/omnigent/status", { cache: "no-store" })
    .then((r) => r.json())
    .then((j: unknown) => isFleetTokenPresent(j as Parameters<typeof isFleetTokenPresent>[0]))
    .catch(() => false);
  return cached;
}

/**
 * True only when Omnigent is configured with an auth token — the condition
 * for showing any Fleet button. Defaults to false (hidden) until proven.
 */
export function useFleetTokenEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void probeFleetToken().then((v) => {
      if (alive) setEnabled(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
