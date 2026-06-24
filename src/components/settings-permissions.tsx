"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { SettingsGroup } from "@/components/ui/settings-group";

type Familiar = { id: string; displayName?: string; name?: string };
type Project = { id: string; name: string; root: string; color?: string };
type Grant = { familiarId: string; projectId: string };

const grantKey = (familiarId: string, projectId: string) => `${familiarId}::${projectId}`;

/**
 * Settings → Permissions. Per familiar, shows every project and a toggle for
 * whether that familiar can see/use it. Toggling drives the human-confirmed
 * `/api/project-grants` grant (POST) / revoke (DELETE). The supreme familiar has
 * access to every project; its toggles are locked on.
 */
export function PermissionsSection() {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keys mid-flight, so a row can't be double-toggled while its request runs.
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [famRes, projRes, grantRes] = await Promise.all([
        fetch("/api/familiars", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/project-grants", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setFamiliars(Array.isArray(famRes?.familiars) ? famRes.familiars : []);
      setProjects(Array.isArray(projRes?.projects) ? projRes.projects : []);
      setGranted(
        new Set(
          (Array.isArray(grantRes?.grants) ? (grantRes.grants as Grant[]) : []).map((g) =>
            grantKey(g.familiarId, g.projectId),
          ),
        ),
      );
      setSupremeFamiliarId(typeof grantRes?.supremeFamiliarId === "string" ? grantRes.supremeFamiliarId : null);
      setError(null);
    } catch {
      setError("Couldn’t load permissions. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (familiarId: string, projectId: string, next: boolean) => {
      const key = grantKey(familiarId, projectId);
      setPending((p) => new Set(p).add(key));
      // Optimistic.
      setGranted((g) => {
        const copy = new Set(g);
        if (next) copy.add(key);
        else copy.delete(key);
        return copy;
      });
      try {
        const res = await fetch("/api/project-grants", {
          method: next ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetFamiliarId: familiarId, projectId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
      } catch {
        // Revert on failure.
        setGranted((g) => {
          const copy = new Set(g);
          if (next) copy.delete(key);
          else copy.add(key);
          return copy;
        });
        setError("Couldn’t update that grant.");
      } finally {
        setPending((p) => {
          const copy = new Set(p);
          copy.delete(key);
          return copy;
        });
      }
    },
    [],
  );

  const familiarName = (f: Familiar) => f.displayName?.trim() || f.name?.trim() || f.id;
  const sortedFamiliars = useMemo(
    () => [...familiars].sort((a, b) => familiarName(a).localeCompare(familiarName(b))),
    [familiars],
  );

  if (loading) {
    return (
      <div aria-hidden className="animate-pulse space-y-3 px-1 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--bg-hover)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="px-1 text-[12px] text-[var(--text-muted)]">
        Choose which projects each familiar can see and work in. A familiar only has visibility into
        the projects granted here (chats, sessions, file access, and the project picker all respect
        it). Changes apply immediately.
      </p>

      {error && (
        <p role="alert" className="px-1 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {sortedFamiliars.length === 0 ? (
        <SettingsGroup label="Familiars">
          <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">No familiars yet.</p>
        </SettingsGroup>
      ) : (
        sortedFamiliars.map((fam) => {
          const isSupreme = supremeFamiliarId != null && fam.id === supremeFamiliarId;
          return (
            <SettingsGroup
              key={fam.id}
              label={familiarName(fam)}
              description={isSupreme ? "Access to all projects" : undefined}
            >
              {isSupreme ? (
                <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-[var(--text-muted)]">
                  <Icon name="ph:seal-check" width={15} className="shrink-0 text-[var(--accent-presence)]" />
                  This familiar has access to every project.
                </p>
              ) : projects.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">
                  No projects yet — add one in the Code workspace.
                </p>
              ) : (
                projects.map((project) => {
                  const key = grantKey(fam.id, project.id);
                  const on = granted.has(key);
                  const busy = pending.has(key);
                  return (
                    <div key={project.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: project.color || "var(--text-muted)" }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-[var(--text-primary)]">{project.name}</p>
                          <p className="truncate text-[11px] text-[var(--text-muted)]" title={project.root}>
                            {project.root}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${on ? "Revoke" : "Grant"} ${project.name} for ${familiarName(fam)}`}
                        disabled={busy}
                        onClick={() => void toggle(fam.id, project.id, !on)}
                        className={`focus-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                          on ? "bg-[var(--accent-presence)]" : "bg-[var(--bg-elevated)]"
                        } ${busy ? "opacity-60" : ""}`}
                      >
                        <span
                          className={`pointer-events-none mt-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
                            on ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </SettingsGroup>
          );
        })
      )}
    </div>
  );
}
