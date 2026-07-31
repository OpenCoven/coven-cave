"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

type ModelResponse = { ok?: boolean; models?: RuntimeModelOption[] };
type RuntimeInventory = {
  key: string | null;
  models: RuntimeModelOption[] | null;
};
const DYNAMIC_INVENTORY_RUNTIMES = new Set(["claude", "copilot", "opencode", "grok"]);

/** Static seeds stay synchronous while capable runtimes replace them live. */
export function useRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelOption[] {
  // Configs created by older/package-based setup flows can retain an alias
  // such as `opencode-ai`. Keep the local inventory on the same canonical
  // runtime that the send route uses, rather than falling back to an empty
  // static menu for that alias.
  const canonicalRuntime = canonicalHarnessId(runtime);
  const staticModels = useMemo(
    () => catalogForRuntime(canonicalRuntime)?.models ?? [],
    [canonicalRuntime],
  );
  const [runtimeInventory, setRuntimeInventory] = useState<RuntimeInventory>({
    key: null,
    models: null,
  });
  const inventoryFamiliarId = familiarId ?? null;
  const inventoryKey = `${canonicalRuntime}\u0000${inventoryFamiliarId ?? ""}`;

  useEffect(() => {
    if (!DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime)) return;
    let cancelled = false;
    setRuntimeInventory({ key: inventoryKey, models: null });
    const params = new URLSearchParams();
    if (inventoryFamiliarId) params.set("familiarId", inventoryFamiliarId);
    const base = `/api/runtime-models/${encodeURIComponent(canonicalRuntime)}`;
    const url = params.size ? `${base}?${params.toString()}` : base;
    void fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ModelResponse | null) => {
        if (!cancelled && json?.ok && Array.isArray(json.models)) {
          setRuntimeInventory({ key: inventoryKey, models: json.models });
        } else if (!cancelled) {
          setRuntimeInventory({ key: inventoryKey, models: staticModels });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInventory({ key: inventoryKey, models: staticModels });
        }
      });
    return () => { cancelled = true; };
  }, [
    canonicalRuntime,
    inventoryFamiliarId,
    inventoryKey,
    staticModels,
  ]);

  // A selected familiar can have a different vault scope. Do not briefly show
  // its predecessor's inventory while this scope's request is in flight.
  if (
    DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime) &&
    runtimeInventory.key === inventoryKey &&
    runtimeInventory.models !== null
  ) {
    return runtimeInventory.models;
  }
  return staticModels;
}
