"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

type ModelResponse = { ok?: boolean; models?: RuntimeModelOption[] };

/** Static catalogs stay synchronous; OpenCode reads its authenticated local inventory. */
export function useRuntimeModelOptions(runtime: string): RuntimeModelOption[] {
  const staticModels = useMemo(() => catalogForRuntime(runtime)?.models ?? [], [runtime]);
  const [openCodeModels, setOpenCodeModels] = useState<RuntimeModelOption[]>([]);

  useEffect(() => {
    if (runtime !== "opencode") return;
    let cancelled = false;
    void fetch("/api/runtime-models/opencode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ModelResponse | null) => {
        if (!cancelled && json?.ok && Array.isArray(json.models)) setOpenCodeModels(json.models);
      })
      .catch(() => {
        if (!cancelled) setOpenCodeModels([]);
      });
    return () => { cancelled = true; };
  }, [runtime]);

  return runtime === "opencode" ? openCodeModels : staticModels;
}
