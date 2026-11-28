"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { Familiar } from "@/lib/types";

type FamiliarRoster = {
  familiars: Familiar[];
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** This window's own read of the familiar roster. A failed load keeps the
 *  last good roster (a failure means "can't see them", not "there are none")
 *  and retries quietly until it clears. */
export function useFamiliarRoster(): FamiliarRoster {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);

  const reload = useCallback(() => {
    const pending = inFlightRef.current;
    if (pending?.generation === generationRef.current) return pending.promise;
    const generation = ++generationRef.current;
    const promise = (async () => {
      try {
        const response = await fetch("/api/familiars", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const json = (await response.json()) as { ok?: boolean; error?: string; familiars?: Familiar[] };
        if (generation !== generationRef.current) return;
        if (!response.ok || !json.ok || !Array.isArray(json.familiars)) {
          setError(json.error ?? "The Coven daemon is not reachable.");
          return;
        }
        setError(null);
        setFamiliars(json.familiars ?? []);
      } catch (cause) {
        if (generation !== generationRef.current) return;
        setError(cause instanceof Error ? cause.message : "The request failed.");
      } finally {
        if (generation === generationRef.current) setLoaded(true);
      }
    })().finally(() => {
      if (inFlightRef.current?.generation === generation) inFlightRef.current = null;
    });
    inFlightRef.current = { generation, promise };
    return promise;
  }, []);

  useEffect(() => {
    void reload();
    return () => { generationRef.current += 1; };
  }, [reload]);
  usePausablePoll(reload, 4_000, { enabled: error !== null, serialize: true });
  // A roster changes rarely; a slow refresh picks up a newly summoned familiar.
  usePausablePoll(reload, 60_000, { enabled: error === null, serialize: true });

  return { familiars, loaded, error, reload };
}
