"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocGraph } from "./grimoire-graph";
import type { GrimoireGraphMeta } from "./server/grimoire-graph-scan";

type GrimoireGraphScan = {
  scan: { graph: DocGraph; meta: GrimoireGraphMeta; scopeKey: string } | null;
  scopeKey: string | null;
  scanning: boolean;
  scanError: string | null;
  refreshGraph: () => void;
};

export function useGrimoireGraphScan(familiarScope: ReadonlySet<string>): GrimoireGraphScan {
  const [state, setState] = useState<Omit<GrimoireGraphScan, "refreshGraph">>({
    scan: null,
    scopeKey: null,
    scanning: true,
    scanError: null,
  });
  const [scanTick, setScanTick] = useState(0);

  // Key the scan on the scope's VALUE, not the Set's identity. `scopeFamiliarIds`
  // is a new Set on most parent renders, so depending on it directly would
  // refetch the whole corpus on every render rather than when the selection
  // actually changes (cave-z6xvd).
  const scopeKey = useMemo(() => [...familiarScope].sort().join(","), [familiarScope]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, scopeKey, scanning: true, scanError: null }));
    void (async () => {
      try {
        // Scoping server-side means the cap applies to THIS familiar's files
        // rather than the coven's, so a scoped view is complete up to the cap
        // instead of showing its (F/T) slice.
        const params = scopeKey
          ? `?${scopeKey.split(",").map((id) => `familiarId=${encodeURIComponent(id)}`).join("&")}`
          : "";
        const res = await fetch(`/api/grimoire/graph${params}`, { cache: "no-store", signal: controller.signal });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (json.ok && Array.isArray(json.nodes) && Array.isArray(json.edges)) {
          setState({
            scan: { graph: { nodes: json.nodes, edges: json.edges }, meta: json.meta, scopeKey },
            scopeKey,
            scanning: false,
            scanError: null,
          });
        } else {
          // A failed rescan retains data only within the same familiar scope.
          setState((s) => ({ ...s, scanning: false, scanError: json.error ?? "Graph scan failed" }));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          scanning: false,
          scanError: err instanceof Error ? err.message : "Graph scan failed",
        }));
      }
    })();
    return () => controller.abort();
  }, [scanTick, scopeKey]);

  const refreshGraph = useCallback(() => setScanTick((t) => t + 1), []);
  return {
    ...state,
    scan: state.scan?.scopeKey === scopeKey ? state.scan : null,
    scanning: state.scopeKey !== scopeKey || state.scanning,
    scanError: state.scopeKey === scopeKey ? state.scanError : null,
    refreshGraph,
  };
}
