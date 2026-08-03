"use client";

/**
 * use-role-surfaces — client bridge between the live Cave session and the
 * Role Surface registry.
 *
 * Builds the shared RoleSurfaceContext (memory/tools/plugins adapters over the
 * Cave's real APIs — honest empties when a backing API has nothing) and
 * resolves which registered surfaces the active familiar should see. The
 * shell consumes only this hook's generic output; it never names a role.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import {
  familiarRoleIds,
  listRoleSurfaces,
  resolveVisibleRoleSurfaces,
  type FamiliarRoleManifest,
  type MemoryAccess,
  type PluginRegistry,
  type RoleSurface,
  type RoleSurfaceContext,
  type SurfaceMemoryEntry,
  type ToolRegistry,
} from "@/lib/role-surfaces";

/** `/api/roles` entry fields this bridge consumes. */
type RoleEntryWire = FamiliarRoleManifest & {
  tools?: string[];
  plugins?: string[];
  mcpServers?: string[];
};

function isRoleEntryWire(value: unknown): value is RoleEntryWire {
  if (value == null || typeof value !== "object") return false;
  const entry = value as Partial<RoleEntryWire>;
  return (
    typeof entry.id === "string" &&
    typeof entry.familiar === "string" &&
    typeof entry.active === "boolean" &&
    (entry.name == null || typeof entry.name === "string") &&
    (entry.tools == null || (Array.isArray(entry.tools) && entry.tools.every((item) => typeof item === "string"))) &&
    (entry.plugins == null || (Array.isArray(entry.plugins) && entry.plugins.every((item) => typeof item === "string"))) &&
    (entry.mcpServers == null || (Array.isArray(entry.mcpServers) && entry.mcpServers.every((item) => typeof item === "string")))
  );
}

type MemoryEntryWire = {
  relPath: string;
  fullPath: string;
  rootLabel: string;
  sourceKindLabel: string;
  size: number;
  modified: string;
  excerpt?: string;
  familiarId?: string;
};

function isMemoryEntryWire(value: unknown): value is MemoryEntryWire {
  if (value == null || typeof value !== "object") return false;
  const entry = value as Partial<MemoryEntryWire>;
  return (
    typeof entry.relPath === "string" &&
    typeof entry.fullPath === "string" &&
    typeof entry.rootLabel === "string" &&
    typeof entry.sourceKindLabel === "string" &&
    typeof entry.size === "number" &&
    typeof entry.modified === "string" &&
    (entry.excerpt == null || typeof entry.excerpt === "string") &&
    (entry.familiarId == null || typeof entry.familiarId === "string")
  );
}

export function createMemoryAccess(familiarId: string | null): MemoryAccess {
  return {
    async listEntries(): Promise<SurfaceMemoryEntry[]> {
      if (!familiarId) return [];
      const res = await fetch(`/api/memory?familiarId=${encodeURIComponent(familiarId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`memory inventory request failed with status ${res.status}`);
      const json = (await res.json()) as { ok?: unknown; entries?: unknown };
      if (json?.ok !== true || !Array.isArray(json.entries) || !json.entries.every(isMemoryEntryWire)) {
        throw new Error("memory inventory response was malformed");
      }
      return json.entries.map((entry) => ({
        relPath: entry.relPath,
        fullPath: entry.fullPath,
        rootLabel: entry.rootLabel,
        sourceKindLabel: entry.sourceKindLabel,
        size: entry.size,
        modified: entry.modified,
        excerpt: entry.excerpt,
        familiarId: entry.familiarId,
      }));
    },
    async readFile(path: string) {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const json = res.ok
          ? ((await res.json()) as { ok?: boolean; text?: string; mtimeMs?: number | null })
          : null;
        if (!json?.ok || typeof json.text !== "string") return null;
        // Redacted text by default — surfaces never bypass the redaction pass.
        return { content: json.text, mtimeMs: json.mtimeMs ?? null };
      } catch {
        return null;
      }
    },
  };
}

type LatestAsyncDataOptions<T> = {
  scopeKey: string;
  load(): Promise<T>;
  errorMessage: string;
  enabled?: boolean;
};

type LatestAsyncData<T> = {
  data: T | null;
  error: string | null;
  reload(options?: { retainData?: boolean }): Promise<boolean>;
};

/**
 * Own one async value for the latest scope/request only. Every load starts
 * from an honest loading state unless a caller explicitly retains same-scope
 * data while revalidating; effect cleanup invalidates in-flight work.
 */
export function useLatestAsyncData<T>({
  scopeKey,
  load,
  errorMessage,
  enabled = true,
}: LatestAsyncDataOptions<T>): LatestAsyncData<T> {
  const requestSequence = useRef(0);
  const [state, setState] = useState<{
    scopeKey: string;
    data: T | null;
    error: string | null;
  }>({ scopeKey, data: null, error: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async (options?: { retainData?: boolean }) => {
    const sequence = ++requestSequence.current;
    const retainedData =
      options?.retainData === true && stateRef.current.scopeKey === scopeKey
        ? stateRef.current.data
        : null;
    setState({ scopeKey, data: retainedData, error: null });
    if (!enabled) return true;
    try {
      const data = await load();
      if (sequence !== requestSequence.current) return false;
      setState({ scopeKey, data, error: null });
      return true;
    } catch {
      if (sequence !== requestSequence.current) return false;
      setState({ scopeKey, data: retainedData, error: errorMessage });
      return false;
    }
  }, [enabled, errorMessage, load, scopeKey]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const current = state.scopeKey === scopeKey ? state : { scopeKey, data: null, error: null };
  return { data: current.data, error: current.error, reload };
}

export type RoleSurfaceSession = {
  /** Null when All/multi-familiar scope is active; a room click selects its owner. */
  context: RoleSurfaceContext | null;
  /** Surfaces the active familiar, or the selected familiar union, should see. */
  visibleSurfaces: RoleSurface[];
  /** Familiar ids that can enter each resolved room. */
  surfaceFamiliarIds: Readonly<Record<string, readonly string[]>>;
  /** False until the role manifests have loaded once for this scope. */
  rolesLoaded: boolean;
  /** True only when `/api/roles` settled with valid evidence for this scope. */
  rolesLoadedSuccessfully: boolean;
};

export function useRoleSurfaceSession(input: {
  familiar: Familiar | null;
  /** Familiars represented by the current scope. Empty scope means All. */
  familiars?: readonly Familiar[];
  sessions: SessionRow[];
  activeSessionId: string | null;
  daemonRunning: boolean;
  openUrl: (url: string) => void;
  openSession: (sessionId: string, familiarId?: string) => void;
  focusCard: (cardId: string) => void;
  refreshTasks: () => void;
}): RoleSurfaceSession {
  const {
    familiar,
    familiars: scopedFamiliars = [],
    sessions,
    activeSessionId,
    daemonRunning,
    openUrl,
    openSession,
    focusCard,
    refreshTasks,
  } = input;
  const candidateFamiliars = useMemo(() => {
    // The scoped roster is authoritative when it is present. A caller may
    // still carry a non-null primary familiar while a multi-scope transition
    // is settling, and letting that primary replace the roster would hide the
    // rest of the selected rooms.
    const candidates = scopedFamiliars.length > 0 ? scopedFamiliars : familiar ? [familiar] : [];
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }, [familiar, scopedFamiliars]);
  // A null familiar without candidates is the intentionally unfetched state
  // used during roster hydration and by callers that have no scope yet.
  // Once the roster is available, All/multi scope gets one shared manifest
  // request rather than one request per familiar.
  const scopeKey = candidateFamiliars.length === 0
    ? null
    : `scope:${candidateFamiliars.map((candidate) => candidate.id).join(",")}`;

  const [roleLoadState, setRoleLoadState] = useState<{
    scopeKey: string | null;
    manifests: RoleEntryWire[];
    rolesLoaded: boolean;
    rolesLoadedSuccessfully: boolean;
  }>({
    scopeKey,
    manifests: [],
    rolesLoaded: false,
    rolesLoadedSuccessfully: false,
  });

  useEffect(() => {
    let cancelled = false;
    setRoleLoadState({
      scopeKey,
      manifests: [],
      rolesLoaded: false,
      rolesLoadedSuccessfully: false,
    });
    if (!scopeKey) {
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/roles", { cache: "no-store" });
        if (!res.ok) throw new Error(`roles request failed with status ${res.status}`);
        const json = (await res.json()) as { roles?: unknown };
        if (!Array.isArray(json.roles) || !json.roles.every(isRoleEntryWire)) {
          throw new Error("roles response was malformed");
        }
        if (!cancelled) {
          setRoleLoadState({
            scopeKey,
            manifests: json.roles,
            rolesLoaded: true,
            rolesLoadedSuccessfully: true,
          });
        }
      } catch {
        if (!cancelled) {
          setRoleLoadState({
            scopeKey,
            manifests: [],
            rolesLoaded: true,
            rolesLoadedSuccessfully: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const currentRoleLoadState =
    roleLoadState.scopeKey === scopeKey
      ? roleLoadState
      : {
          scopeKey,
          manifests: [],
          rolesLoaded: false,
          rolesLoadedSuccessfully: false,
        };
  const manifests = currentRoleLoadState.manifests;
  const rolesLoaded = currentRoleLoadState.rolesLoaded;
  const rolesLoadedSuccessfully = currentRoleLoadState.rolesLoadedSuccessfully;

  const openUrlStable = useCallback((url: string) => openUrl(url), [openUrl]);
  const openSessionStable = useCallback(
    (sessionId: string, forFamiliar?: string) => openSession(sessionId, forFamiliar),
    [openSession],
  );
  const focusCardStable = useCallback((cardId: string) => focusCard(cardId), [focusCard]);
  const refreshTasksStable = useCallback(() => refreshTasks(), [refreshTasks]);

  const contextsByFamiliarId = useMemo(() => {
    const contexts = new Map<string, RoleSurfaceContext>();
    for (const candidate of candidateFamiliars) {
      const scoped = sessions.filter((s) => !s.familiarId || s.familiarId === candidate.id);
      const activeManifests = manifests.filter((manifest) => manifest.active && manifest.familiar === candidate.id);
      const tools: ToolRegistry = {
        async listTools() {
          return activeManifests.flatMap((manifest) => [
            ...(manifest.tools ?? []).map((name) => ({ id: `${manifest.id}:${name}`, name, source: manifest.id })),
            ...(manifest.mcpServers ?? []).map((name) => ({
              id: `${manifest.id}:mcp:${name}`,
              name: `${name} (MCP)`,
              source: manifest.id,
            })),
          ]);
        },
      };
      const plugins: PluginRegistry = {
        async listPlugins() {
          return activeManifests.flatMap((manifest) =>
            (manifest.plugins ?? []).map((name) => ({ id: `${manifest.id}:${name}`, name, source: manifest.id })),
          );
        },
      };
      contexts.set(candidate.id, {
        activeFamiliar: candidate,
        activePerson: null, // the Cave has no person model yet — honest null
        currentThread: scoped.find((s) => s.id === activeSessionId) ?? null,
        runtimeState: { daemonRunning, sessions: scoped, activeSessionId },
        memory: createMemoryAccess(candidate.id),
        tools,
        plugins,
        openUrl: openUrlStable,
        openSession: openSessionStable,
        focusCard: focusCardStable,
        refreshTasks: refreshTasksStable,
      });
    }
    return contexts;
  }, [
    candidateFamiliars,
    manifests,
    sessions,
    activeSessionId,
    daemonRunning,
    openUrlStable,
    openSessionStable,
    focusCardStable,
    refreshTasksStable,
  ]);

  const context = familiar && candidateFamiliars.length === 1 && candidateFamiliars[0]?.id === familiar.id
    ? contextsByFamiliarId.get(familiar.id) ?? null
    : null;
  const { visibleSurfaces, surfaceFamiliarIds } = useMemo(() => {
    const surfaces = listRoleSurfaces();
    const visibleById = new Map<string, RoleSurface>();
    const owners = new Map<string, string[]>();
    for (const candidate of candidateFamiliars) {
      const candidateContext = contextsByFamiliarId.get(candidate.id);
      if (!candidateContext) continue;
      const visible = resolveVisibleRoleSurfaces(
        surfaces,
        familiarRoleIds(candidate, manifests),
        candidateContext,
      );
      for (const surface of visible) {
        visibleById.set(surface.id, surface);
        const familiarIds = owners.get(surface.id) ?? [];
        if (!familiarIds.includes(candidate.id)) familiarIds.push(candidate.id);
        owners.set(surface.id, familiarIds);
      }
    }
    const visibleSurfaces = surfaces
      .filter((surface) => visibleById.has(surface.id))
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
    const surfaceFamiliarIds: Record<string, readonly string[]> = {};
    for (const [surfaceId, familiarIds] of owners) {
      surfaceFamiliarIds[surfaceId] = familiarIds;
    }
    return { visibleSurfaces, surfaceFamiliarIds };
  }, [candidateFamiliars, contextsByFamiliarId, manifests]);

  return {
    context,
    visibleSurfaces,
    surfaceFamiliarIds,
    rolesLoaded,
    rolesLoadedSuccessfully,
  };
}
