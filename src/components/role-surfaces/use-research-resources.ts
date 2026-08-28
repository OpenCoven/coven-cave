"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseResourceManifestV1,
  parseResourceQueryResponseV1,
  type ResourceManifestV1,
  type ResourceQueryResponseV1,
} from "@/lib/research-resource-contracts";
import { mutateResearchResource } from "@/lib/research-resource-client";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function useResearchResources() {
  const [resources, setResources] = useState<ResourceManifestV1[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<ResourceQueryResponseV1 | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/research/resources", { cache: "no-store" });
      const data: unknown = await response.json();
      if (response.status === 404) {
        generation.current += 1;
        setAvailable(false);
        setResources([]);
        setResult(null);
        setSearching(false);
        setSearchError(null);
        setError(null);
        return;
      }
      const values = record(data) && data.ok === true && Array.isArray(data.resources)
        ? data.resources.map(parseResourceManifestV1)
        : [];
      if (!response.ok || values.some((value) => !value.ok)) throw new Error("invalid catalog response");
      setResources(values.map((value) => value.ok ? value.value : neverResource()));
      setAvailable(true);
      setError(null);
    } catch {
      generation.current += 1;
      setAvailable(false);
      setResources([]);
      setResult(null);
      setSearching(false);
      setSearchError(null);
      setError("Couldn’t load local resource status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const clearSearch = useCallback(() => {
    generation.current += 1;
    setResult(null);
    setSearchError(null);
    setSearching(false);
  }, []);

  const search = useCallback(async (text: string) => {
    const request = ++generation.current;
    if (!available || text.trim().length < 2) {
      setResult(null);
      setSearchError(null);
      setSearching(false);
      return false;
    }
    // The previous evidence belongs to the previous query. Remove it as soon
    // as this debounced request begins so it cannot masquerade as the pending
    // query's result.
    setResult(null);
    setSearchError(null);
    setSearching(true);
    try {
      const response = await fetch("/api/research/resources/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, text: text.trim(), ranking: "hybrid", limit: 20 }),
      });
      const data: unknown = await response.json();
      const parsed = record(data) && data.ok === true
        ? parseResourceQueryResponseV1(data.result)
        : null;
      if (!response.ok || !parsed?.ok) throw new Error("search unavailable");
      if (generation.current !== request) return;
      setResult(parsed.value);
      setSearchError(null);
      return true;
    } catch {
      if (generation.current !== request) return false;
      setResult(null);
      setSearchError("Local evidence search is unavailable.");
      return false;
    } finally {
      if (generation.current === request) setSearching(false);
    }
  }, [available]);

  const retry = useCallback(async (id: string) => {
    if (!await mutateResearchResource(id, "POST")) return false;
    await load();
    return true;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    if (!await mutateResearchResource(id, "DELETE")) return false;
    setResult(null);
    await load();
    return true;
  }, [load]);

  return {
    resources,
    available,
    loading,
    error,
    searching,
    searchError,
    result,
    load,
    clearSearch,
    search,
    retry,
    remove,
  };
}

function neverResource(): never {
  throw new Error("unreachable invalid resource");
}
