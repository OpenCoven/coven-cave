"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import { isCraftInstallationVerified, type MarketplacePlugin } from "@/lib/marketplace-catalog";
import { openExternalUrl } from "@/lib/open-external";
import type { RoleEffectiveComposition } from "@/lib/role-craft-composition";
import { useFocusTrap } from "@/lib/use-focus-trap";

type CraftPlanComponent = {
  id: string;
  displayName: string;
  version: string;
  kind: string;
  requiredConfig: string[];
  requiresConfiguration: boolean;
};

type CraftSourceResource = {
  id: string;
  sourcePath: string;
  upstreamPath: string;
  contentHash: string;
  modifications: string[];
};

type CraftInstallPlan = {
  id: string;
  displayName: string;
  version: string;
  commands: { install: string[]; verify: string[]; uninstall: string[] };
  components: {
    required: CraftPlanComponent[];
    optionalEnhancements: CraftPlanComponent[];
  };
  bundled: { skills: string[]; prompts: string[]; workflows: string[] };
  requiredCapabilities: string[];
  recommendedRoles: string[];
  provenance: {
    source: string;
    commit: string;
    license: string;
    licensePath: string;
    resources?: CraftSourceResource[];
  };
  runtime: { id: string; marketplace: string; scope: "user"; disclosure: string };
};

type RoleWire = {
  id: string;
  name: string;
  familiar: string;
  crafts: string[];
  effective: RoleEffectiveComposition;
};

export type CraftActionError = {
  message: string;
  code?: string;
  affectedRoles?: Array<{ id: string; name: string; familiar: string }>;
  affectedRoleCount?: number;
  affectedRolesTruncated?: boolean;
};

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  actionError?: CraftActionError | null;
  onClose: () => void;
  onInstall: () => void;
  onRemove: () => void;
  onActionCleared: () => void;
};

const EFFECTIVE_LABELS: Record<keyof RoleEffectiveComposition, string> = {
  skills: "Skills",
  tools: "Tools",
  mcpServers: "MCP servers",
  plugins: "Plugins",
  workflows: "Workflows",
  prompts: "Prompts",
  capabilities: "Capabilities",
};

function DossierSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="craft-dossier__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ResourceList({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return <p className="craft-dossier__quiet">None bundled.</p>;
  return (
    <ul className="craft-dossier__resource-list">
      {ids.map((id) => <li key={id}>{id}</li>)}
    </ul>
  );
}

export function CraftDetail({
  plugin,
  busy,
  actionError,
  onClose,
  onInstall,
  onRemove,
  onActionCleared,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [plan, setPlan] = useState<CraftInstallPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleWire[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [roleActionError, setRoleActionError] = useState<string | null>(null);
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  const loadRoles = useCallback(async (signal?: AbortSignal) => {
    setRolesLoading(true);
    try {
      const res = await fetch("/api/roles", { cache: "no-store", signal });
      const json = (await res.json()) as { ok?: boolean; roles?: RoleWire[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? `roles http ${res.status}`);
      const next = json.roles ?? [];
      setRoles(next);
      setRolesError(null);
      setSelectedRoleKey((current) => {
        if (current && next.some((role) => `${role.familiar}:${role.id}` === current)) return current;
        const equipped = next.find((role) => role.crafts.includes(plugin.id));
        const first = equipped ?? next[0];
        return first ? `${first.familiar}:${first.id}` : null;
      });
    } catch (error) {
      if (signal?.aborted) return;
      setRoles([]);
      setRolesError(error instanceof Error ? error.message : "Roles unavailable");
    } finally {
      if (!signal?.aborted) setRolesLoading(false);
    }
  }, [plugin.id]);

  // Pre-flight: Crafts install through the Codex CLI. Warn BEFORE the user
  // clicks Install instead of failing after (cave-nkte). Best-effort — a
  // failed probe stays quiet and the server gate remains authoritative.
  const [codexMissing, setCodexMissing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/harnesses", { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (controller.signal.aborted || !Array.isArray(json?.harnesses)) return;
        const codex = json.harnesses.find((h: { id?: string; installed?: boolean }) => h.id === "codex");
        setCodexMissing(Boolean(codex) && codex.installed === false);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPlan(null);
    setPlanError(null);
    fetch(`/api/marketplace/crafts/plan?id=${encodeURIComponent(plugin.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => res.json().then((json) => ({ res, json })))
      .then(({ res, json }) => {
        if (controller.signal.aborted) return;
        if (!json?.ok || !json.plan) throw new Error(json?.error ?? `plan http ${res.status}`);
        setPlan(json.plan as CraftInstallPlan);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPlanError(error instanceof Error ? error.message : "Install plan unavailable");
      });
    void loadRoles(controller.signal);
    return () => controller.abort();
  }, [
    loadRoles,
    plugin.id,
    plugin.installed,
    plugin.installation?.verifiedAt,
    plugin.installation?.craftVersion,
    plugin.updateAvailable,
  ]);

  const attachRole = useCallback(async (role: RoleWire, attach: boolean) => {
    const key = `${role.familiar}:${role.id}`;
    setRoleBusy(key);
    setRoleActionError(null);
    try {
      const res = await fetch("/api/roles/crafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: role.id, familiar: role.familiar, craftId: plugin.id, attach }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? `role update http ${res.status}`);
      announce(attach ? `Equipped ${plugin.displayName}` : `Detached ${plugin.displayName}`, "polite");
      onActionCleared();
      await loadRoles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Role update failed";
      setRoleActionError(message);
      announce(message, "assertive");
    } finally {
      setRoleBusy(null);
    }
  }, [announce, loadRoles, onActionCleared, plugin.displayName, plugin.id]);

  const attachedRoles = useMemo(
    () => roles.filter((role) => role.crafts.includes(plugin.id)),
    [plugin.id, roles],
  );
  const selectedRole = roles.find((role) => `${role.familiar}:${role.id}` === selectedRoleKey) ?? null;
  const current = isCraftInstallationVerified(plugin);
  const installLabel = plugin.installed ? "Update Craft" : "Install Craft";
  const displayedAffectedRoles = actionError?.affectedRoles ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} Craft details`}
        className="craft-dossier"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="craft-dossier__header">
          <span className="craft-dossier__sigil" aria-hidden><Icon name="ph:package-bold" width={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="craft-dossier__eyebrow">Research Craft · v{plugin.version}</p>
            <h2>{plugin.displayName}</h2>
            <p>{plugin.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Craft details" className="focus-ring craft-dossier__close">
            <Icon name="ph:x" width={16} />
          </button>
        </header>

        <div className="craft-dossier__body">
          <div className="craft-dossier__runtime" aria-live="polite">
            <span><Icon name={current ? "ph:seal-check" : "ph:package-bold"} width={14} aria-hidden /></span>
            <div>
              <strong>{current ? "Installed and verified" : plugin.updateAvailable ? "Update available" : "Ready to preview"}</strong>
              <p>{plan?.runtime.disclosure ?? "Loading Codex runtime compatibility…"}</p>
            </div>
          </div>

          {codexMissing ? (
            <p role="alert" className="craft-dossier__alert">
              Crafts install through the Codex CLI, which isn&apos;t installed on this machine. Install it with{" "}
              <code>npm i -g @openai/codex</code>, then retry.
            </p>
          ) : null}
          {planError ? <p role="alert" className="craft-dossier__alert">{planError}</p> : null}
          {actionError ? (
            <div role="alert" className="craft-dossier__alert">
              <strong>{actionError.message}</strong>
              {displayedAffectedRoles.length > 0 ? (
                <ul>{displayedAffectedRoles.map((role) => <li key={`${role.familiar}:${role.id}`}>{role.name} · {role.familiar}</li>)}</ul>
              ) : null}
              {actionError.affectedRolesTruncated ? (
                <p>{Math.max(0, (actionError.affectedRoleCount ?? displayedAffectedRoles.length) - displayedAffectedRoles.length)} more affected Roles are not shown.</p>
              ) : null}
            </div>
          ) : null}

          <div className="craft-dossier__ledger">
            <DossierSection title="Install plan">
              {plan ? (
                <>
                  <code className="craft-dossier__command">{plan.commands.install.join(" ")}</code>
                  <p className="craft-dossier__quiet">Then verify with <code>{plan.commands.verify.join(" ")}</code>.</p>
                </>
              ) : <p className="craft-dossier__quiet">Loading exact Codex commands…</p>}
            </DossierSection>

            <DossierSection title="Required components">
              <ResourceList ids={plan?.components.required.map((component) => `${component.displayName} · ${component.id}@${component.version}`) ?? []} />
            </DossierSection>

            <DossierSection title="Bundled skills">
              <ResourceList ids={plan?.bundled.skills ?? []} />
            </DossierSection>

            <DossierSection title="Prompts & workflows">
              <ResourceList ids={[...(plan?.bundled.prompts ?? []), ...(plan?.bundled.workflows ?? [])]} />
            </DossierSection>

            <DossierSection title="Capability footprint">
              <ResourceList ids={plan?.requiredCapabilities ?? []} />
            </DossierSection>

            <DossierSection title="Optional enhancements">
              {plan?.components.optionalEnhancements.length ? (
                <ul className="craft-dossier__enhancements">
                  {plan.components.optionalEnhancements.map((component) => (
                    <li key={component.id}>
                      <span>{component.displayName}</span>
                      <small>{component.requiresConfiguration ? `Uses ${component.requiredConfig.join(", ")}` : "Credential-free"}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="craft-dossier__quiet">No optional enhancements.</p>}
              <p className="craft-dossier__quiet">Removing the Craft does not remove shared optional enhancements.</p>
            </DossierSection>

            <DossierSection title="Provenance">
              {plan ? (
                <dl className="craft-dossier__provenance">
                  <div><dt>Upstream</dt><dd><a href={plan.provenance.source} onClick={(event) => { event.preventDefault(); openExternalUrl(plan.provenance.source); }}>Source repository</a></dd></div>
                  <div><dt>Revision</dt><dd><code>{plan.provenance.commit.slice(0, 12)}</code></dd></div>
                  <div><dt>License</dt><dd>{plan.provenance.license}</dd></div>
                  <div><dt>License notice</dt><dd><code>{plan.provenance.licensePath}</code></dd></div>
                  <div><dt>Runtime</dt><dd>{plan.runtime.id} · {plan.runtime.scope} scope</dd></div>
                </dl>
              ) : <p className="craft-dossier__quiet">Loading provenance…</p>}
              {plan?.provenance.resources?.length ? (
                <ul className="craft-dossier__source-list">
                  {plan.provenance.resources.map((resource) => (
                    <li key={resource.id}>
                      <strong>{resource.id}</strong>
                      <span>Upstream: <code>{resource.upstreamPath}</code></span>
                      <span>Bundle: <code>{resource.sourcePath}</code></span>
                      <span>Hash: <code>{resource.contentHash}</code></span>
                      <span>{resource.modifications.length ? resource.modifications.join(" · ") : "Unmodified from the pinned upstream source."}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </DossierSection>
          </div>

          <section className="craft-dossier__roles" aria-labelledby="craft-role-heading">
            <div className="craft-dossier__section-head">
              <div><p className="craft-dossier__eyebrow">Routing boundary</p><h3 id="craft-role-heading">Equip Roles</h3></div>
              <span>{attachedRoles.length} equipped</span>
            </div>
            <p className="craft-dossier__quiet">Equipping changes Role context, recommendations, workflows, and summaries. Codex installs the plugin once at user scope; this is not a security sandbox.</p>
            {rolesError || roleActionError ? <p role="alert" className="craft-dossier__alert">{roleActionError ?? rolesError}</p> : null}
            {rolesLoading ? <p className="craft-dossier__quiet">Loading Roles…</p> : roles.length === 0 ? (
              <p className="craft-dossier__quiet">No Roles are available to equip.</p>
            ) : (
              <div className="craft-role-grid">
                <div className="craft-role-list" aria-label={`Roles for ${plugin.displayName}`}>
                  {roles.map((role) => {
                    const key = `${role.familiar}:${role.id}`;
                    const checked = role.crafts.includes(plugin.id);
                    const canAttach = current || checked;
                    // Inline disabled reason (docs/craft-ux.md F10): the "why"
                    // used to live only in the far-away footer status.
                    const installFirst = !canAttach ? " (install the Craft first)" : "";
                    return (
                      <div key={key} className="craft-role-row" data-selected={selectedRoleKey === key || undefined}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={roleBusy === key || !canAttach}
                          title={!canAttach ? "Install the Craft first to equip Roles" : undefined}
                          aria-label={`${checked ? "Detach" : "Equip"} ${plugin.displayName} ${checked ? "from" : "on"} ${role.name}${installFirst}`}
                          onFocus={() => setSelectedRoleKey(key)}
                          onChange={(event) => void attachRole(role, event.target.checked)}
                        />
                        <button type="button" onClick={() => setSelectedRoleKey(key)} className="focus-ring">
                          <strong>{role.name}</strong><span>{role.familiar}</span>
                        </button>
                        {checked ? <small>Equipped</small> : null}
                      </div>
                    );
                  })}
                </div>
                <div className="craft-role-effective" aria-live="polite">
                  <h4>Effective capabilities</h4>
                  {selectedRole ? Object.entries(selectedRole.effective).map(([field, entries]) => {
                    if (entries.length === 0) return null;
                    return (
                      <div key={field}>
                        <h5>{EFFECTIVE_LABELS[field as keyof RoleEffectiveComposition]}</h5>
                        <ul>{entries.map((entry) => <li key={`${field}:${entry.id}`}><span>{entry.id}</span><small>{entry.originLabel}</small></li>)}</ul>
                      </div>
                    );
                  }) : <p className="craft-dossier__quiet">Select a Role to inspect its effective loadout.</p>}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="craft-dossier__footer">
          <div>
            <strong>{current ? "Verified in Codex" : plugin.updateAvailable ? "Version mismatch" : "Not installed"}</strong>
            <span>{plan ? `${plan.runtime.marketplace} · ${plan.version}` : "Plan loading"}</span>
          </div>
          {plugin.installed ? (
            <>
              {plugin.updateAvailable ? <Button variant="primary" loading={busy} disabled={!plan} onClick={onInstall}>Update Craft</Button> : null}
              <Button variant="secondary" loading={busy} disabled={attachedRoles.length > 0} onClick={onRemove}>
                {attachedRoles.length > 0 ? `Detach from ${attachedRoles.length} Role${attachedRoles.length === 1 ? "" : "s"} first` : "Remove Craft"}
              </Button>
            </>
          ) : (
            <Button variant="primary" leadingIcon="ph:package-bold" loading={busy} disabled={!plan} onClick={onInstall}>{installLabel}</Button>
          )}
        </footer>
      </div>
    </div>
  );
}
