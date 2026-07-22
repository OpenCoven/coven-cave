"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

type ModelResponse = { ok?: boolean; models?: RuntimeModelOption[] };

/** Static catalogs stay synchronous; OpenCode reads its authenticated local inventory. */
export function useRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelOption[] {
  const staticModels = useMemo(() => catalogForRuntime(runtime)?.models ?? [], [runtime]);
  const [openCodeModels, setOpenCodeModels] = useState<RuntimeModelOption[]>([]);

  useEffect(() => {
    if (runtime !== "opencode") return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (familiarId) params.set("familiarId", familiarId);
    const url = params.size
      ? `/api/runtime-models/opencode?${params.toString()}`
      : "/api/runtime-models/opencode";
    void fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ModelResponse | null) => {
        if (!cancelled && json?.ok && Array.isArray(json.models)) setOpenCodeModels(json.models);
      })
      .catch(() => {
        if (!cancelled) setOpenCodeModels([]);
      });
    return () => { cancelled = true; };
  }, [runtime, familiarId]);

  return runtime === "opencode" ? openCodeModels : staticModels;
}
