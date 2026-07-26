/**
 * Pure host → workspace resolution for Omnigent runs (no @/ imports; unit-testable).
 */

export type HostWorkspaceMaps = {
  hostWorkspaceMap?: Record<string, string>;
  hostMap?: Record<string, string>;
};

/**
 * Resolve absolute workspace for a chosen Omnigent host.
 * Lookup order for map keys: host_id → host name → hostMap aliases that point at this host.
 */
export function resolveWorkspaceForHost(
  maps: HostWorkspaceMaps,
  hostId: string | undefined,
  hostName?: string | null,
): string | undefined {
  if (!hostId) return undefined;
  const map = maps.hostWorkspaceMap ?? {};
  const take = (key: string | undefined | null): string | undefined => {
    if (!key) return undefined;
    const v = map[key]?.trim();
    return v || undefined;
  };

  const byId = take(hostId);
  if (byId) return byId;

  const byName = take(hostName ?? undefined);
  if (byName) return byName;

  for (const [alias, mappedId] of Object.entries(maps.hostMap ?? {})) {
    if (mappedId === hostId) {
      const byAlias = take(alias);
      if (byAlias) return byAlias;
    }
  }
  return undefined;
}
