"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { SettingsGroup } from "@/components/ui/settings-group";
import { StandardSelect } from "@/components/ui/select";

type Capability = { id: string; label: string; description: string; adapter: string | null };
type Grant = { id: string; familiarId: string; sessionId: string; capability: string; grantedAt: string; expiresAt: string };
type Session = { id: string; title: string };

/** Host authority is intentionally not another project toggle. It is visible
 * here so “Full” cannot be mistaken for administrator or OS-service access. */
export function HostAccessSection({ familiarId }: { familiarId?: string | null }) {
  const [catalog, setCatalog] = useState<Capability[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/host-capability-grants${familiarId ? `?familiarId=${encodeURIComponent(familiarId)}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error("load failed");
      setCatalog(Array.isArray(body.catalog) ? body.catalog : []);
      setGrants(Array.isArray(body.grants) ? body.grants : []);
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
      setError(null);
    } catch { setError("Couldn’t load host access."); }
  }, [familiarId]);
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
  const approve = useCallback(async (capability: Capability) => {
    if (!familiarId || !sessionId.trim()) { setError("Choose the session that needs this capability."); return; }
    setBusy(capability.id);
    try {
      const response = await fetch("/api/host-capability-grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetFamiliarId: familiarId, sessionId: sessionId.trim(), capability: capability.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "approval failed");
      await load();
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t approve that host capability."); }
    finally { setBusy(null); }
  }, [familiarId, load, sessionId]);
  return (
    <div className="space-y-4">
      <p className="px-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        Project Full access applies only to project files. A host grant authorizes one registered broker; it never grants arbitrary shell, operating-system, credential, or administrator access.
      </p>
      {error ? <p role="alert" className="px-1 text-[length:var(--text-sm)] text-[var(--color-danger)]">{error}</p> : null}
      <SettingsGroup label="Host capabilities" description="Off by default · session-bound · expires automatically">
        {catalog.length === 0 ? (
          <EmptyState icon="ph:hard-drives" headline="No host capabilities on this platform" subtitle="Project access remains available; host access is platform-specific." compact />
        ) : (
          <div className="divide-y divide-[var(--border-hairline)]">
            <div className="px-4 py-3">
              <p className="text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">Cave session</p>
              <StandardSelect
                id="host-access-session"
                label="Cave session"
                value={sessionId}
                onChange={setSessionId}
                options={[{ value: "", label: "Choose a session…" }, ...sessions.map((session) => ({ value: session.id, label: session.title }))]}
                className="focus-ring mt-1 flex h-8 w-full rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-sunken)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-primary)]"
              />
              <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">Approval applies only to this familiar and session for 30 minutes. It starts a fresh native session and authorizes only the registered broker.</p>
            </div>
            {catalog.map((capability) => <div key={capability.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
              <p className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">{capability.label}</p>
              <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{capability.description}</p>
              </div>
              {capability.adapter ? <Button variant="secondary" size="xs" disabled={busy === capability.id} onClick={() => void approve(capability)}>{busy === capability.id ? "Approving…" : "Approve"}</Button> : <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">No adapter installed</span>}
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
