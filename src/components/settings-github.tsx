"use client";

/**
 * GitHub settings — the organization scope the GitHub surface pulls from.
 *
 * By default Cave surfaces every organization the authenticated account belongs
 * to. Here the operator can narrow that to a chosen subset; the scope persists
 * in app preferences (`github.orgScope`, empty = all) and the GitHub surface
 * applies it consistently. The membership list is read live from
 * `/api/github/activity`, the same source the surface's own org filter uses.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { SettingsOverview } from "@/components/settings-overview";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SettingControlRow, Segmented } from "@/components/ui/settings-controls";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { useAppPreferences, updateAppPreferences } from "@/lib/app-preferences";
import { normalizeOrgScope } from "@/lib/preferences-schema";
import type { ActivityResult } from "@/components/github-view-data";

type OrgLoad =
  | { status: "loading" }
  | { status: "unauthed" }
  | { status: "error" }
  | { status: "ready"; login: string | null; organizations: string[] };

type ScopeMode = "all" | "selected";

export function GithubSection() {
  const baseId = useId();
  const { announce } = useAnnouncer();
  const scope = useAppPreferences().github.orgScope;
  const scoped = scope.length > 0;

  const [load, setLoad] = useState<OrgLoad>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/github/activity", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as ActivityResult | { ok: false }) : null;
        if (cancelled) return;
        if (!json || json.ok !== true) {
          setLoad({ status: "error" });
        } else if (!json.authed) {
          setLoad({ status: "unauthed" });
        } else {
          setLoad({ status: "ready", login: json.login, organizations: json.organizations });
        }
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const memberships = load.status === "ready" ? load.organizations : [];

  // The rows to render: every membership, plus any scoped org that is no longer
  // a membership (so a stale pick stays visible and removable).
  const rows = useMemo(() => {
    const set = new Set<string>(memberships);
    for (const org of scope) set.add(org);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [memberships, scope]);

  const setMode = useCallback(
    (mode: ScopeMode) => {
      if (mode === "all") {
        updateAppPreferences({ github: { orgScope: [] } });
        announce("GitHub scope set to all organizations", "polite");
      } else {
        // Enter subset mode seeded with every membership selected, so nothing
        // disappears until the operator unchecks something.
        updateAppPreferences({ github: { orgScope: normalizeOrgScope(memberships) } });
      }
    },
    [memberships, announce],
  );

  const toggleOrg = useCallback(
    (org: string) => {
      const next = scope.includes(org) ? scope.filter((o) => o !== org) : [...scope, org];
      updateAppPreferences({ github: { orgScope: next } });
    },
    [scope],
  );

  const canSelect = memberships.length > 0 || scoped;

  return (
    <section className="max-w-none space-y-6" aria-labelledby={`${baseId}-title`}>
      <h2 id={`${baseId}-title`} className="sr-only">
        GitHub
      </h2>
      <SettingsOverview section="github" />

      <SettingsGroup
        label="Organizations"
        description="Choose which GitHub organizations the GitHub surface pulls issues, pull requests, and repositories from."
      >
        <SettingControlRow
          label="Organization scope"
          hint={
            scoped
              ? `Limited to ${scope.length} organization${scope.length === 1 ? "" : "s"}.`
              : "All organizations you belong to."
          }
        >
          <Segmented
            options={["all", "selected"] as const}
            value={scoped ? "selected" : "all"}
            onChange={setMode}
            getLabel={(o) => (o === "all" ? "All" : "Selected")}
            getTitle={(o) =>
              o === "all"
                ? "Include every organization you belong to"
                : "Include only the organizations you choose below"
            }
            ariaLabel="GitHub organization scope"
          />
        </SettingControlRow>

        <div className="px-4 pb-4">
          {load.status === "loading" ? (
            <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Reading your GitHub memberships…</p>
          ) : load.status === "unauthed" ? (
            <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Connect a GitHub token on the GitHub surface to choose specific organizations.
            </p>
          ) : load.status === "error" ? (
            <p className="flex flex-wrap items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-muted)]" role="alert">
              Couldn’t read your organizations.
              <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </Button>
            </p>
          ) : !scoped ? (
            <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
              {memberships.length > 0
                ? `Every organization is included (${memberships.length} available). Switch to “Selected” to narrow the surface.`
                : "No organization memberships found for this account."}
            </p>
          ) : (
            <div className="space-y-3">
              <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Included organizations">
                {rows.map((org) => {
                  const checked = scope.includes(org);
                  const stale = !memberships.includes(org);
                  return (
                    <li key={org}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                        <input
                          type="checkbox"
                          className="focus-ring h-4 w-4 accent-[var(--accent-presence)]"
                          checked={checked}
                          onChange={() => toggleOrg(org)}
                        />
                        <Icon name="ph:users-three" width={13} height={13} aria-hidden className="text-[var(--text-muted)]" />
                        <span className="min-w-0 truncate">{org}</span>
                        {stale ? (
                          <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">not a current member</span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {canSelect ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon="ph:arrow-counter-clockwise"
                  onClick={() => setMode("all")}
                >
                  Reset to all organizations
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </SettingsGroup>
    </section>
  );
}
