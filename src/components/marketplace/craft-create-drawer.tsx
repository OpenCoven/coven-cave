"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { RoleEntry } from "@/app/api/roles/route";

type RolesResponse = {
  ok?: boolean;
  roles?: RoleEntry[];
  error?: string;
};

type DraftResponse = {
  ok?: boolean;
  draft?: { id: string };
  error?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
};

export function CraftCreateDrawer({ open, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familiar, setFamiliar] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useFocusTrap(open, ref, { onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setLoaded(false);
    setError(null);
    fetch("/api/roles", { cache: "no-store", signal: ctl.signal })
      .then(async (res) => {
        const json = (await res.json()) as RolesResponse;
        if (!json.ok) throw new Error(json.error ?? `roles http ${res.status}`);
        const nextRoles = json.roles ?? [];
        setRoles(nextRoles);
        setFamiliar((current) => current || nextRoles[0]?.familiar || "");
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "roles unavailable");
        setRoles([]);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoaded(true);
      });
    return () => ctl.abort();
  }, [open]);

  const familiarOptions = useMemo(
    () => [...new Set(roles.map((role) => role.familiar))].sort().map((id) => ({ value: id, label: id })),
    [roles],
  );
  const visibleRoles = useMemo(
    () => roles.filter((role) => role.familiar === familiar),
    [roles, familiar],
  );
  const selectedRoles = useMemo(
    () => visibleRoles.filter((role) => selectedRoleIds.has(role.id)),
    [visibleRoles, selectedRoleIds],
  );
  const counts = useMemo(() => {
    const unique = {
      skills: new Set<string>(),
      components: new Set<string>(),
      workflows: new Set<string>(),
      capabilities: new Set<string>(),
    };
    for (const role of selectedRoles) {
      for (const skill of [...role.skills, ...role.effective.skills.map((entry) => entry.id)]) unique.skills.add(skill);
      for (const component of [
        ...role.mcpServers,
        ...role.plugins,
        ...role.effective.mcpServers.map((entry) => entry.id),
        ...role.effective.plugins.map((entry) => entry.id),
      ]) unique.components.add(component);
      for (const workflow of [...role.workflows, ...role.effective.workflows.map((entry) => entry.id)]) unique.workflows.add(workflow);
      for (const capability of [
        ...role.tools,
        ...role.effective.tools.map((entry) => entry.id),
        ...role.effective.capabilities.map((entry) => entry.id),
      ]) unique.capabilities.add(capability);
    }
    return {
      skills: unique.skills.size,
      components: unique.components.size,
      workflows: unique.workflows.size,
      capabilities: unique.capabilities.size,
    };
  }, [selectedRoles]);

  const chooseFamiliar = useCallback((next: string) => {
    setFamiliar(next);
    setSelectedRoleIds(new Set());
  }, []);

  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!familiar || selectedRoleIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace/crafts/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiar, roleIds: [...selectedRoleIds] }),
      });
      const json = (await res.json()) as DraftResponse;
      if (!json.ok || !json.draft?.id) throw new Error(json.error ?? "draft create failed");
      onCreated(json.draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "draft create failed");
    } finally {
      setSaving(false);
    }
  }, [familiar, onCreated, selectedRoleIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Create Craft"
        tabIndex={-1}
        className="craft-create-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Craft authoring</p>
            <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">Create Craft</h2>
            <p className="text-[12px] text-[var(--text-muted)]">Extract a reusable bundle from a familiar&apos;s roles.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        <label className="grid gap-1 text-[12px] text-[var(--text-muted)]">
          <span>Familiar</span>
          <StandardSelect
            label="Familiar"
            value={familiar}
            onChange={chooseFamiliar}
            options={familiarOptions}
            className="focus-ring rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
          />
        </label>

        <section className="grid gap-2" aria-label="Roles to extract">
          <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">Roles</h3>
          {!loaded ? (
            <p className="text-[12px] text-[var(--text-muted)]">Loading roles...</p>
          ) : visibleRoles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]">No roles found for this familiar.</p>
          ) : (
            <div className="grid gap-2">
              {visibleRoles.map((role) => (
                <label key={`${role.familiar}:${role.id}`} className="craft-create-drawer__role">
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.has(role.id)}
                    onChange={() => toggleRole(role.id)}
                  />
                  <span>
                    <strong>{role.name}</strong>
                    <em>{role.description ?? `${role.skills.length} skills · ${role.tools.length} capabilities`}</em>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="craft-draft-ledger" aria-label="Extraction preview">
          <h3>Extraction preview</h3>
          <div className="craft-draft-ledger__stats">
            <span><strong>{counts.components}</strong> components</span>
            <span><strong>{counts.skills}</strong> skills</span>
            <span><strong>{counts.workflows}</strong> workflows</span>
            <span><strong>{counts.capabilities}</strong> capabilities</span>
          </div>
        </section>

        <div className="mt-auto flex justify-end gap-2 border-t border-[var(--border-hairline)] pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:package-bold"
            loading={saving}
            disabled={!familiar || selectedRoleIds.size === 0}
            onClick={save}
          >
            Save draft
          </Button>
        </div>
      </div>
    </div>
  );
}
