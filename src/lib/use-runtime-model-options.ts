"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  catalogForRuntime,
  runtimeModelInventoryAvailability,
  runtimeModelInventoryFreshness,
  runtimeModelInventoryRefreshState,
  runtimeModelInventoryScope,
  type RuntimeModelInventory,
  type RuntimeModelOption,
  type RuntimeModelInventoryProvenance,
} from "@/lib/runtime-models";
import type {
  RuntimeModelInventoryAvailability,
  RuntimeModelInventoryFreshness,
  RuntimeModelInventoryRefreshState,
} from "@/lib/runtime-models";

export type ModelInventoryProvenance = RuntimeModelInventoryProvenance;
type ModelResponse = { ok?: boolean } & Partial<RuntimeModelInventory>;
type RuntimeInventoryState = {
  key: string | null;
  inventory: RuntimeModelInventory | null;
};
export type RuntimeModelInventoryResult = RuntimeModelInventory & {
  loading: boolean;
  key: string;
};

const DYNAMIC_INVENTORY_RUNTIMES = new Set([
  "claude",
  "copilot",
  "opencode",
  "grok",
  "hermes",
]);
const INVENTORY_REFRESH_MS = 60_000;
const PROVENANCE = new Set<RuntimeModelInventoryProvenance>([
  "live",
  "cached",
  "fallback",
  "runtime-managed",
  "unavailable",
]);
const FRESHNESS = new Set<RuntimeModelInventoryFreshness>([
  "fresh",
  "cached",
  "seed",
  "runtime-managed",
  "unavailable",
]);
const REFRESH_STATES = new Set<RuntimeModelInventoryRefreshState>([
  "ready",
  "degraded",
]);
const AVAILABILITY = new Set<RuntimeModelInventoryAvailability>([
  "available",
  "degraded",
  "unavailable",
]);
const PROVIDERS = new Set(["openai", "anthropic", "github", "nous", "xai", null]);
const SCOPE_STATES = new Set(["familiar", "global", "runtime-managed", "unavailable"]);

export function inventoryFailureProvenance(
  runtime: string,
  staticModels: readonly RuntimeModelOption[],
): ModelInventoryProvenance {
  if (staticModels.length > 0) return "fallback";
  return catalogForRuntime(runtime)?.defaultOwner === "runtime"
    ? "runtime-managed"
    : "unavailable";
}

export function inventoryProvenanceLabel(
  provenance: ModelInventoryProvenance | null,
  loading = false,
): string {
  if (loading) return "Loading inventory";
  switch (provenance) {
    case "live": return "Live inventory";
    case "cached": return "Cached inventory";
    case "fallback": return "Fallback inventory";
    case "runtime-managed": return "Runtime-managed models";
    case "unavailable": return "Inventory unavailable";
    default: return "Model inventory";
  }
}

function fallbackInventory(
  runtime: string,
  staticModels: readonly RuntimeModelOption[],
  familiarId: string | null,
): RuntimeModelInventory {
  const catalog = catalogForRuntime(runtime);
  // Hermes' static catalog is historical UI guidance, not a provider-backed
  // inventory. On transport failure, fail closed instead of presenting those
  // OpenAI seeds as models available to this familiar's endpoint.
  if (runtime === "hermes") {
    const provenance = "runtime-managed" as const;
    return {
      runtime,
      models: [],
      provenance,
      freshness: runtimeModelInventoryFreshness(provenance),
      refreshState: runtimeModelInventoryRefreshState(provenance),
      availability: runtimeModelInventoryAvailability(provenance),
      defaultOwner: catalog?.defaultOwner ?? "runtime",
      allowCustom: catalog?.allowCustom ?? false,
      scope: runtimeModelInventoryScope(runtime, familiarId),
    };
  }
  const provenance = inventoryFailureProvenance(runtime, staticModels);
  return {
    runtime,
    models: [...staticModels],
    provenance,
    freshness: runtimeModelInventoryFreshness(provenance),
    refreshState: runtimeModelInventoryRefreshState(provenance),
    availability: runtimeModelInventoryAvailability(provenance),
    defaultOwner: catalog?.defaultOwner ?? "runtime",
    allowCustom: catalog?.allowCustom ?? false,
    scope: runtimeModelInventoryScope(runtime, familiarId),
  };
}

function isInventoryResponse(
  value: ModelResponse | null,
  runtime: string,
  familiarId: string | null,
): value is ModelResponse & RuntimeModelInventory & { ok: true } {
  return Boolean(
    value?.ok === true &&
    value.runtime === runtime &&
    Array.isArray(value.models) &&
    value.models.every((option) =>
      option &&
      typeof option.id === "string" &&
      typeof option.label === "string"
    ) &&
    typeof value.provenance === "string" &&
    PROVENANCE.has(value.provenance as RuntimeModelInventoryProvenance) &&
    typeof value.freshness === "string" &&
    FRESHNESS.has(value.freshness as RuntimeModelInventoryFreshness) &&
    typeof value.refreshState === "string" &&
    REFRESH_STATES.has(value.refreshState as RuntimeModelInventoryRefreshState) &&
    typeof value.availability === "string" &&
    AVAILABILITY.has(value.availability as RuntimeModelInventoryAvailability) &&
    (value.defaultOwner === "cave" || value.defaultOwner === "runtime") &&
    typeof value.allowCustom === "boolean" &&
    value.scope &&
    typeof value.scope === "object" &&
    value.scope.runtime === runtime &&
    value.scope.familiarId === familiarId &&
    PROVIDERS.has(value.scope.provider as string | null) &&
    SCOPE_STATES.has(value.scope.credentialScope as string) &&
    SCOPE_STATES.has(value.scope.providerConfiguration as string),
  );
}

/** Static seeds stay synchronous while capable runtimes replace them live. */
export function useRuntimeModelInventory(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelInventoryResult {
  // Configs created by older/package-based setup flows can retain an alias
  // such as `opencode-ai`. Keep the local inventory on the same canonical
  // runtime that the send route uses.
  const canonicalRuntime = canonicalHarnessId(runtime);
  const inventoryFamiliarId = familiarId ?? null;
  const inventoryKey = `${canonicalRuntime}\u0000${inventoryFamiliarId ?? ""}`;
  const staticModels = useMemo(
    () => catalogForRuntime(canonicalRuntime)?.models ?? [],
    [canonicalRuntime],
  );
  const fallback = useMemo(
    () => fallbackInventory(canonicalRuntime, staticModels, inventoryFamiliarId),
    [canonicalRuntime, inventoryFamiliarId, staticModels],
  );
  const [runtimeInventory, setRuntimeInventory] = useState<RuntimeInventoryState>({
    key: null,
    inventory: null,
  });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const dynamicInventory = DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime);

  usePausablePoll(
    () => setRefreshRevision((revision) => revision + 1),
    INVENTORY_REFRESH_MS,
    { enabled: dynamicInventory },
  );

  // Runtime/profile edits are persisted before this event is dispatched.
  // Re-read the same key immediately so an optimistic Hermes request that
  // raced ahead of the config PATCH cannot leave an empty fallback for 60s.
  useEffect(() => {
    if (!dynamicInventory || typeof window === "undefined") return;
    const refreshAfterConfigWrite = () => {
      // A config event may change provider credentials or a runtime profile
      // without changing the familiar/runtime key. Mask the old scope first;
      // timer refreshes are the only path allowed to retain same-scope data.
      setRuntimeInventory({ key: null, inventory: null });
      setRefreshRevision((revision) => revision + 1);
    };
    window.addEventListener("cave:familiars-refresh", refreshAfterConfigWrite);
    return () => {
      window.removeEventListener("cave:familiars-refresh", refreshAfterConfigWrite);
    };
  }, [dynamicInventory]);

  useEffect(() => {
    if (!dynamicInventory) return;
    let cancelled = false;
    // A scope change fails closed synchronously. A background refresh for the
    // same scope may keep its already-validated inventory mounted.
    setRuntimeInventory((current) => current.key === inventoryKey
      ? current
      : { key: inventoryKey, inventory: null });
    const params = new URLSearchParams();
    if (inventoryFamiliarId) params.set("familiarId", inventoryFamiliarId);
    const base = `/api/runtime-models/${encodeURIComponent(canonicalRuntime)}`;
    const url = params.size ? `${base}?${params.toString()}` : base;
    void fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ModelResponse | null) => {
        if (cancelled) return;
        setRuntimeInventory({
          key: inventoryKey,
          inventory: isInventoryResponse(json, canonicalRuntime, inventoryFamiliarId) ? json : fallback,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInventory({ key: inventoryKey, inventory: fallback });
        }
      });
    return () => { cancelled = true; };
  }, [
    canonicalRuntime,
    dynamicInventory,
    fallback,
    inventoryFamiliarId,
    inventoryKey,
    refreshRevision,
  ]);

  if (!dynamicInventory) {
    return { ...fallback, loading: false, key: inventoryKey };
  }
  if (
    runtimeInventory.key === inventoryKey &&
    runtimeInventory.inventory !== null
  ) {
    return {
      ...runtimeInventory.inventory,
      loading: false,
      key: inventoryKey,
    };
  }
  return {
    ...fallback,
    models: [],
    provenance: "unavailable",
    freshness: "unavailable",
    refreshState: "degraded",
    availability: "unavailable",
    loading: true,
    key: inventoryKey,
  };
}

/** Compatibility projection for menus that do not yet render provenance. */
export function useRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelOption[] {
  return useRuntimeModelInventory(runtime, familiarId).models;
}
