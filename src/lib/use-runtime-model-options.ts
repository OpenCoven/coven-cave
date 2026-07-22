"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

type ModelResponse = { ok?: boolean; models?: RuntimeModelOption[] };
type OpenCodeInventory = {
  familiarId: string | null;
  models: RuntimeModelOption[];
};

/** Static catalogs stay synchronous; OpenCode reads its authenticated local inventory. */
export function useRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelOption[] {
  const staticModels = useMemo(() => catalogForRuntime(runtime)?.models ?? [], [runtime]);
  const [openCodeInventory, setOpenCodeInventory] = useState<OpenCodeInventory>({
    familiarId: null,
    models: [],
  });
  const inventoryFamiliarId = familiarId ?? null;

  useEffect(() => {
    if (runtime !== "opencode") return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (inventoryFamiliarId) params.set("familiarId", inventoryFamiliarId);
    const url = params.size
      ? `/api/runtime-models/opencode?${params.toString()}`
      : "/api/runtime-models/opencode";
    void fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ModelResponse | null) => {
        if (!cancelled && json?.ok && Array.isArray(json.models)) {
          setOpenCodeInventory({ familiarId: inventoryFamiliarId, models: json.models });
        }
      })
      .catch(() => {
        if (!cancelled) setOpenCodeInventory({ familiarId: inventoryFamiliarId, models: [] });
      });
    return () => { cancelled = true; };
  }, [runtime, inventoryFamiliarId]);

  // A selected familiar can have a different vault scope. Do not briefly show
  // its predecessor's inventory while this scope's request is in flight.
  return runtime === "opencode" && openCodeInventory.familiarId === inventoryFamiliarId
    ? openCodeInventory.models
    : staticModels;
}
