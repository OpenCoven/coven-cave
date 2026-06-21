import { useEffect, useState } from "react";

/**
 * Re-renders the calling component about once a minute so relative-time labels
 * ("4m ago") stay current without waiting for a data refresh. The returned
 * counter is incidental — callers don't need to read it; the state change is
 * what triggers the re-render.
 *
 * Cheap by design: a single 60s interval per consumer, cleared on unmount.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}
