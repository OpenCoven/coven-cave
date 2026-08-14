"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { SettingsGroup } from "@/components/ui/settings-group";

type Capability = { id: string; label: string; description: string };
type Grant = { id: string; familiarId: string; sessionId: string; capability: string; grantedAt: string; expiresAt: string };

/** Host authority is intentionally not another project toggle. It is visible
 * here so “Full” cannot be mistaken for administrator or OS-service access. */
export function HostAccessSection({ familiarId }: { familiarId?: string | null }) {
  const [catalog, setCatalog] = useState<Capability[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/host-capability-grants", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error("load failed");
      setCatalog(Array.isArray(body.catalog) ? body.catalog : []);
      setGrants(Array.isArray(body.grants) ? body.grants : []);
      setError(null);
    } catch { setError("Couldn’t load host access."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => grants.filter((grant) => !familiarId || grant.familiarId === familiarId), [grants, familiarId]);
  const revoke = useCallback(async (grant: Grant) => {
    setBusy(grant.id);
    try {
      const response = await fetch("/api/host-capability-grants", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetFamiliarId: grant.familiarId, sessionId: grant.sessionId, capability: grant.capability }) });
      if (!response.ok) throw new Error("revoke failed");
      await load();
    } catch { setError("Couldn’t revoke that host capability."); }
    finally { setBusy(null); }
  }, [load]);
  return (
    <div className="space-y-4">
      <p className="px-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        Project Full access applies only to project files. It never grants operating-system, virtualization, credential, or administrator access.
      </p>
      {error ? <p role="alert" className="px-1 text-[length:var(--text-sm)] text-[var(--color-danger)]">{error}</p> : null}
      <SettingsGroup label="Host capabilities" description="Off by default · session-bound · expires automatically">
        {catalog.length === 0 ? (
          <EmptyState icon="ph:hard-drives" headline="No host capabilities on this platform" subtitle="Project access remains available; host access is platform-specific." compact />
        ) : (
          <div className="divide-y divide-[var(--border-hairline)]">
            {catalog.map((capability) => <div key={capability.id} className="px-4 py-3">
              <p className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">{capability.label}</p>
              <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{capability.description}</p>
            </div>)}
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup label="Active host access" description={`${visible.length} active session${visible.length === 1 ? "" : "s"}`}>
        {visible.length === 0 ? <p className="px-4 py-3 text-[length:var(--text-sm)] text-[var(--text-muted)]">No active host capabilities. A direct human approval is required when a session requests one.</p> : <div className="divide-y divide-[var(--border-hairline)]">{visible.map((grant) => <div key={grant.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-[length:var(--text-base)] text-[var(--text-primary)]">{grant.capability}</p><p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Expires <RelativeTime iso={grant.expiresAt} /></p></div><Button variant="secondary" size="xs" disabled={busy === grant.id} onClick={() => void revoke(grant)}>{busy === grant.id ? "Revoking…" : "Revoke"}</Button></div>)}</div>}
      </SettingsGroup>
      <p className="px-1 text-[length:var(--text-xs)] text-[var(--text-muted)]"><Icon name="ph:shield-warning" width={13} className="mr-1 inline" aria-hidden />Signing verifies publisher identity and tamper protection. It does not grant host authority.</p>
    </div>
  );
}
