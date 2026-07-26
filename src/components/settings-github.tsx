"use client";

/**
 * Code-page GitHub settings — the organization scope applied across the
 * PRs, Issues, and Reviews tabs.
 *
 * Empty `github.orgScope` means every membership. A selected subset persists
 * in app preferences and is consumed by GitHubView itself, so the setting is
 * shared with the standalone GitHub surface without duplicating filter logic.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/ui/settings-controls";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverBody, usePopoverInitialFocus } from "@/components/ui/popover";
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

const GITHUB_ORG_POPOVER_SELECTOR =
  '[role="dialog"][aria-label="GitHub organization settings"]';

export function GithubOrganizationSettings() {
  const baseId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const { announce } = useAnnouncer();
  const scope = useAppPreferences().github.orgScope;
  const scoped = scope.length > 0;

  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<OrgLoad>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  usePopoverInitialFocus(open, GITHUB_ORG_POPOVER_SELECTOR);

  useEffect(() => {
    if (!open) return;
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
  }, [open, reloadKey]);

  const memberships = load.status === "ready" ? load.organizations : [];

  // The rows to render: every membership, plus any scoped org that is no longer
  // a membership (so a stale pick stays visible and removable).
  const rows = useMemo(() => {
    const set = new Set<string>(memberships);
    for (const org of scope) set.add(org);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [memberships, scope]);

  const focusScopeControl = useCallback(() => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(GITHUB_ORG_POPOVER_SELECTOR)
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="GitHub organization scope: All"]',
        )
        ?.focus();
    });
  }, []);

  const setMode = useCallback(
    (mode: ScopeMode) => {
      if (mode === "all") {
        updateAppPreferences({ github: { orgScope: [] } });
        announce("GitHub scope set to all organizations", "polite");
        // Reset and unchecking the final row both unmount the focused control.
        // Move focus to the stable mode control instead of dropping it to body.
        focusScopeControl();
      } else {
        // Clicking the already-active segment must not replace a persisted
        // scope with the transient empty membership list used while loading.
        if (scoped) return;
        if (load.status === "loading") {
          announce("GitHub organizations are still loading", "polite");
          return;
        }
        if (memberships.length === 0) {
          announce(
            load.status === "unauthed"
              ? "Connect GitHub to choose specific organizations"
              : load.status === "error"
                ? "Couldn’t read your GitHub organizations"
                : "No GitHub organizations are available to select",
            "polite",
          );
          return;
        }
        // Enter subset mode seeded with every membership selected, so nothing
        // disappears until the operator unchecks something.
        updateAppPreferences({ github: { orgScope: normalizeOrgScope(memberships) } });
      }
    },
    [memberships, scoped, load.status, announce, focusScopeControl],
  );

  const toggleOrg = useCallback(
    (org: string) => {
      const next = scope.includes(org) ? scope.filter((o) => o !== org) : [...scope, org];
      if (next.length === 0) {
        setMode("all");
        return;
      }
      updateAppPreferences({ github: { orgScope: next } });
    },
    [scope, setMode],
  );

  const canSelect = memberships.length > 0 || scoped;

  return (
    <>
      <IconButton
        ref={anchorRef}
        icon="ph:gear-six-bold"
        size="sm"
        className="github-org-settings__trigger"
        aria-label="GitHub organization settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="GitHub organization settings"
        onClick={() => setOpen((value) => !value)}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-end"
        ariaLabel="GitHub organization settings"
        className="w-[min(20rem,calc(100vw-1rem))]"
      >
        <PopoverBody className="w-full">
          <header className="border-b border-[var(--border-hairline)] px-2 pb-3 pt-2">
            <h2 id={`${baseId}-title`} className="text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
              GitHub organizations
            </h2>
            <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              Choose what appears in Code’s PRs, Issues, and Reviews.
            </p>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-2 py-3">
            <div className="min-w-0">
              <p className="text-[length:var(--text-sm)] font-medium text-[var(--text-secondary)]">
                Organization scope
              </p>
              <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {scoped
                  ? `${scope.length} organization${scope.length === 1 ? "" : "s"} selected.`
                  : "All organizations you belong to."}
              </p>
            </div>
            <div className="github-org-settings__segments">
              <Segmented
                options={["all", "selected"] as const}
                value={scoped ? "selected" : "all"}
                onChange={setMode}
                getLabel={(option) => (option === "all" ? "All" : "Selected")}
                getTitle={(option) =>
                  option === "all"
                    ? "Include every organization you belong to"
                    : "Include only the organizations you choose below"
                }
                ariaLabel="GitHub organization scope"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto px-2 py-3" aria-labelledby={`${baseId}-title`}>
            {load.status === "loading" ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                Reading your GitHub memberships…
              </p>
            ) : load.status === "unauthed" ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                Connect GitHub from PRs, Issues, or Reviews to choose specific organizations.
              </p>
            ) : load.status === "error" ? (
              <div className="flex flex-wrap items-center gap-2" role="alert">
                <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  Couldn’t read your organizations.
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  className="github-org-settings__action"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : !scoped ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                {memberships.length > 0
                  ? `Every organization is included (${memberships.length} available). Switch to “Selected” to narrow Code.`
                  : "No organization memberships found for this account."}
              </p>
            ) : (
              <div className="space-y-3">
                <ul className="grid gap-1.5" aria-label="Included organizations">
                  {rows.map((org) => {
                    const checked = scope.includes(org);
                    const stale = !memberships.includes(org);
                    return (
                      <li key={org}>
                        <label className="github-org-settings__row flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                          <input
                            type="checkbox"
                            className="focus-ring h-4 w-4 accent-[var(--accent-presence)]"
                            checked={checked}
                            onChange={() => toggleOrg(org)}
                          />
                          <Icon
                            name="ph:users-three"
                            width={13}
                            height={13}
                            aria-hidden
                            className="shrink-0 text-[var(--text-muted)]"
                          />
                          <span className="min-w-0 flex-1 truncate">{org}</span>
                          {stale ? (
                            <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                              not a current member
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {canSelect ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="github-org-settings__action"
                    leadingIcon="ph:arrow-counter-clockwise"
                    onClick={() => setMode("all")}
                  >
                    Reset to all organizations
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </PopoverBody>
      </Popover>
    </>
  );
}
