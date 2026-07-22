"use client";

import { useEffect, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";

export type ProjectFamiliarsState = {
  familiars: Familiar[];
  loading: boolean;
  loadedSuccessfully: boolean;
};

/**
 * Loads only familiars that may launch a session in the selected project.
 * Clearing the prior result before each fetch prevents a picker from briefly
 * offering a familiar authorized for the previously selected project.
 */
export function useProjectFamiliars({
  projectId,
  enabled = true,
}: {
  projectId: string | null;
  enabled?: boolean;
}): ProjectFamiliarsState {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!enabled || !projectId) {
      setFamiliars([]);
      setLoading(false);
      setLoadedSuccessfully(false);
      return;
    }

    setFamiliars([]);
    setLoading(true);
    setLoadedSuccessfully(false);
    void (async () => {
      try {
        const response = await fetch(`/api/familiars?projectId=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; familiars?: Familiar[] } | null;
        if (generationRef.current !== generation) return;
        if (response.ok && payload?.ok) {
          setFamiliars(Array.isArray(payload.familiars) ? payload.familiars : []);
          setLoadedSuccessfully(true);
        }
      } finally {
        if (generationRef.current === generation) setLoading(false);
      }
    })();
  }, [enabled, projectId]);

  return { familiars, loading, loadedSuccessfully };
}
