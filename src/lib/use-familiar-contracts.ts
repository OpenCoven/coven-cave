"use client";

import { useEffect, useState } from "react";
import type { ContractReport } from "@/lib/familiar-contract";
import type { RetroRunsSnapshot } from "@/lib/retro-runs";

/**
 * Per-familiar contract reports + the shared retro-runs snapshot — the raw
 * material for confidence scoring (dashboard cockpit heatmap/insight rows).
 *
 * Contracts are fetched per-familiar; the fan-out is bounded for large covens.
 * Familiars beyond the cap still show activity/health (which need no
 * contract) — they just read "—" for confidence. `partial` tells the caller
 * to say so honestly (KPI coverage subs).
 *
 * Refetches when the visible familiar-id set changes; a stale in-flight batch
 * for a previous set (or an unmounted tree) is dropped by the effect-scoped
 * cancelled guard.
 */
export const CONTRACT_FETCH_CAP = 12;

export type FamiliarContracts = {
  contractsById: Map<string, ContractReport | null>;
  snapshot: RetroRunsSnapshot | null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useFamiliarContracts(familiars: readonly { id: string }[]): {
  /** Null until the first batch lands (and when there are no familiars). */
  contracts: FamiliarContracts | null;
  /** How many familiars were actually fetched (≤ CONTRACT_FETCH_CAP). */
  fetchedCount: number;
  /** True when the cap left some familiars unscored. */
  partial: boolean;
} {
  const [contracts, setContracts] = useState<FamiliarContracts | null>(null);
  const capped = familiars.slice(0, CONTRACT_FETCH_CAP);
  const key = capped.map((f) => f.id).join(",");
  const fetchedCount = capped.length;
  const partial = familiars.length > fetchedCount;

  useEffect(() => {
    if (!key) {
      setContracts(null);
      return;
    }
    let alive = true;
    const ids = key.split(",");
    void Promise.all([
      getJson<{ snapshot?: RetroRunsSnapshot }>("/api/retro-runs"),
      ...ids.map((id) => getJson<{ report?: ContractReport }>(`/api/familiars/${encodeURIComponent(id)}/contract`)),
    ]).then(([retro, ...reports]) => {
      if (!alive) return;
      const contractsById = new Map<string, ContractReport | null>();
      ids.forEach((id, i) => contractsById.set(id, reports[i]?.report ?? null));
      setContracts({ contractsById, snapshot: retro?.snapshot ?? null });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return { contracts, fetchedCount, partial };
}
