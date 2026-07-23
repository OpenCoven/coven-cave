"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

type ModelResponse = { ok?: boolean; models?: RuntimeModelOption[] };
type OpenCodeInventory = {
  familiarId: string | null;
  models: RuntimeModelOption[];
};
type HarnessesResponse = {
  ok?: boolean;
  harnesses?: Array<{ id?: string; models?: RuntimeModelOption[] }>;
};
type HarnessInventory = {
  runtime: string | null;
  models: RuntimeModelOption[];
};

/** Static catalogs stay synchronous; OpenCode reads its authenticated local inventory. */
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
  const [openCodeInventory, setOpenCodeInventory] = useState<OpenCodeInventory>({
    familiarId: null,
    models: [],
  });
  const [harnessInventory, setHarnessInventory] = useState<HarnessInventory>({
    runtime: null,
    models: [],
  });
  const inventoryFamiliarId = familiarId ?? null;

  useEffect(() => {
    if (canonicalRuntime !== "opencode") return;
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
  }, [canonicalRuntime, inventoryFamiliarId]);

  // Grok's model list is authenticated and installation-specific. Reuse the
  // same local harness inventory that Familiar Studio uses instead of falling
  // back to a stale static list (or making task cards free-text-only).
  useEffect(() => {
    if (canonicalRuntime !== "grok") return;
    let cancelled = false;
    void fetch("/api/harnesses", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: HarnessesResponse | null) => {
        if (cancelled || !json?.ok || !Array.isArray(json.harnesses)) return;
        const models = json.harnesses.find((item) => item.id === canonicalRuntime)?.models;
        setHarnessInventory({ runtime: canonicalRuntime, models: Array.isArray(models) ? models : [] });
      })
      .catch(() => {
        if (!cancelled) setHarnessInventory({ runtime: canonicalRuntime, models: [] });
      });
    return () => { cancelled = true; };
  }, [canonicalRuntime]);

  // A selected familiar can have a different vault scope. Do not briefly show
  // its predecessor's inventory while this scope's request is in flight.
  if (canonicalRuntime === "opencode") {
    return openCodeInventory.familiarId === inventoryFamiliarId
      ? openCodeInventory.models
      : staticModels;
  }
  if (canonicalRuntime === "grok" && harnessInventory.runtime === canonicalRuntime) {
    return harnessInventory.models;
  }
  return staticModels;
}
