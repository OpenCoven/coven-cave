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

import { useCallback, useEffect, useMemo, useState } from "react";
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

export type RoleSurfaceSession = {
  /** Null until a familiar is active — role surfaces are per-familiar rooms. */
  context: RoleSurfaceContext | null;
  /** Surfaces the active familiar should see, sorted by priority. */
  visibleSurfaces: RoleSurface[];
  /** False until the role manifests have loaded once for this familiar. */
  rolesLoaded: boolean;
};

export function useRoleSurfaceSession(input: {
  familiar: Familiar | null;
  sessions: SessionRow[];
  activeSessionId: string | null;
  daemonRunning: boolean;
  openUrl: (url: string) => void;
  openSession: (sessionId: string, familiarId?: string) => void;
  focusCard: (cardId: string) => void;
  refreshTasks: () => void;
}): RoleSurfaceSession {
  const { familiar, sessions, activeSessionId, daemonRunning, openUrl, openSession, focusCard, refreshTasks } = input;
  const familiarId = familiar?.id ?? null;

  const [manifests, setManifests] = useState<RoleEntryWire[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRolesLoaded(false);
    if (!familiarId) {
      setManifests([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/roles", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as { roles?: RoleEntryWire[] }) : null;
        if (!cancelled) setManifests(json?.roles ?? []);
      } catch {
        if (!cancelled) setManifests([]);
      } finally {
        if (!cancelled) setRolesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiarId]);

  const memory: MemoryAccess = useMemo(
    () => ({
      async listEntries(): Promise<SurfaceMemoryEntry[]> {
        if (!familiarId) return [];
        try {
          const res = await fetch(`/api/memory?familiarId=${encodeURIComponent(familiarId)}`, { cache: "no-store" });
          const json = res.ok ? ((await res.json()) as { entries?: MemoryEntryWire[] }) : null;
          return (json?.entries ?? []).map((entry) => ({
            relPath: entry.relPath,
            fullPath: entry.fullPath,
            rootLabel: entry.rootLabel,
            sourceKindLabel: entry.sourceKindLabel,
            size: entry.size,
            modified: entry.modified,
            excerpt: entry.excerpt,
            familiarId: entry.familiarId,
          }));
        } catch {
          return [];
        }
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
    }),
    [familiarId],
  );

  const activeManifests = useMemo(
    () => manifests.filter((m) => m.active && m.familiar === familiarId),
    [manifests, familiarId],
  );

  const tools: ToolRegistry = useMemo(
    () => ({
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
    }),
    [activeManifests],
  );

  const plugins: PluginRegistry = useMemo(
    () => ({
      async listPlugins() {
        return activeManifests.flatMap((manifest) =>
          (manifest.plugins ?? []).map((name) => ({ id: `${manifest.id}:${name}`, name, source: manifest.id })),
        );
      },
    }),
    [activeManifests],
  );

  const openUrlStable = useCallback((url: string) => openUrl(url), [openUrl]);
  const openSessionStable = useCallback(
    (sessionId: string, forFamiliar?: string) => openSession(sessionId, forFamiliar),
    [openSession],
  );
  const focusCardStable = useCallback((cardId: string) => focusCard(cardId), [focusCard]);
  const refreshTasksStable = useCallback(() => refreshTasks(), [refreshTasks]);

  const context: RoleSurfaceContext | null = useMemo(() => {
    if (!familiar) return null;
    const scoped = sessions.filter((s) => !s.familiarId || s.familiarId === familiar.id);
    return {
      activeFamiliar: familiar,
      activePerson: null, // the Cave has no person model yet — honest null
      currentThread: scoped.find((s) => s.id === activeSessionId) ?? null,
      runtimeState: { daemonRunning, sessions: scoped, activeSessionId },
      memory,
      tools,
      plugins,
      openUrl: openUrlStable,
      openSession: openSessionStable,
      focusCard: focusCardStable,
      refreshTasks: refreshTasksStable,
    };
  }, [familiar, sessions, activeSessionId, daemonRunning, memory, tools, plugins, openUrlStable, openSessionStable, focusCardStable, refreshTasksStable]);

  const visibleSurfaces = useMemo(() => {
    if (!familiar || !context) return [];
    return resolveVisibleRoleSurfaces(listRoleSurfaces(), familiarRoleIds(familiar, manifests), context);
  }, [familiar, manifests, context]);

  return { context, visibleSurfaces, rolesLoaded };
}
