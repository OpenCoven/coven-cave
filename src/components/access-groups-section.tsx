"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SettingsGroup } from "@/components/ui/settings-group";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  accessLevelMeta,
  isSupreme,
  type ConsoleAccessGroup,
  type ConsoleProject,
} from "@/lib/permissions-console";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";

/**
 * Settings → Familiars → Access groups — manage named groups of familiars that
 * share a base set of project grants (each at read or write level).
 *
 * Groups are the role-shaped layer of the project-permissions protocol:
 * membership is by explicit familiar id (never the editable `role` display
 * label), and a member's effective access to a project is the most permissive
 * of its direct grant and every group grant it inherits (union-max — enforced
 * server-side by the same resolver the Familiar Studio Projects tab renders
 * with). Mutations go to /api/access-groups, which rejects relayed approvals:
 * only the human, acting directly, can move a group's reach.
 */
export function AccessGroupsSection({ familiars }: { familiars: ResolvedFamiliar[] }) {
  const [groups, setGroups] = useState<ConsoleAccessGroup[]>([]);
  const [projects, setProjects] = useState<ConsoleProject[]>([]);
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Group ids with a mutation mid-flight, so rows can't be double-submitted.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupRes, projRes, grantRes] = await Promise.all([
        fetch("/api/access-groups", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/project-grants", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setGroups(Array.isArray(groupRes?.accessGroups) ? groupRes.accessGroups : []);
      setProjects(Array.isArray(projRes?.projects) ? projRes.projects : []);
      setSupremeFamiliarId(
        typeof grantRes?.supremeFamiliarId === "string" ? grantRes.supremeFamiliarId : null,
      );
      setError(null);
    } catch {
      setError("Couldn’t load access groups. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withBusy = useCallback(
    async (groupId: string, run: () => Promise<Response>) => {
      setBusy((prev) => new Set(prev).add(groupId));
      try {
        const res = await run();
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
        await load();
      } catch {
        setError("Couldn’t update that access group.");
      } finally {
        setBusy((prev) => {
          const copy = new Set(prev);
          copy.delete(groupId);
          return copy;
        });
      }
    },
    [load],
  );

  const createGroup = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/access-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json().catch(() => null);
      setNewName("");
      setError(null);
      await load();
      if (typeof json?.group?.id === "string") setExpanded(json.group.id);
    } catch {
      setError("Couldn’t create that access group.");
    } finally {
      setCreating(false);
    }
  }, [newName, creating, load]);

  const toggleMember = useCallback(
    (group: ConsoleAccessGroup, familiarId: string) => {
      const isMember = group.memberFamiliarIds.includes(familiarId);
      const memberFamiliarIds = isMember
        ? group.memberFamiliarIds.filter((id) => id !== familiarId)
        : [...group.memberFamiliarIds, familiarId];
      void withBusy(group.id, () =>
        fetch(`/api/access-groups/${group.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberFamiliarIds }),
        }),
      );
    },
    [withBusy],
  );

  // Off → Read → Write → Off, one click per step.
  const cycleProjectGrant = useCallback(
    (group: ConsoleAccessGroup, projectId: string) => {
      const current = group.projectGrants.find((grant) => grant.projectId === projectId);
      const currentLevel: ProjectAccessLevel | null = current
        ? current.access === "read"
          ? "read"
          : "write"
        : null;
      const nextLevel: ProjectAccessLevel | null =
        currentLevel === null ? "read" : currentLevel === "read" ? "write" : null;
      const projectGrants = group.projectGrants
        .filter((grant) => grant.projectId !== projectId)
        .map((grant) => ({ projectId: grant.projectId, access: grant.access ?? "write" }));
      if (nextLevel) projectGrants.push({ projectId, access: nextLevel });
      void withBusy(group.id, () =>
        fetch(`/api/access-groups/${group.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectGrants }),
        }),
      );
    },
    [withBusy],
  );

  const deleteGroup = useCallback(
    (group: ConsoleAccessGroup) => {
      void withBusy(group.id, () =>
        fetch(`/api/access-groups/${group.id}`, { method: "DELETE" }),
      );
    },
    [withBusy],
  );

  // Supreme is all-access already; listing it as a pickable member would only
  // suggest its reach is governed here.
  const memberCandidates = useMemo(
    () => familiars.filter((familiar) => !isSupreme(familiar.id, supremeFamiliarId)),
    [familiars, supremeFamiliarId],
  );
  const familiarName = useCallback(
    (id: string) => familiars.find((familiar) => familiar.id === id)?.display_name ?? id,
    [familiars],
  );

  if (loading) {
    return (
      <div aria-hidden className="animate-pulse space-y-3 px-1 py-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-[var(--bg-hover)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="px-1 text-[length:var(--text-sm)] text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <SettingsGroup
        label="Access groups"
        description="Give a set of familiars a shared base of projects — each at read or write. A familiar's effective access is the most permissive of its own grants and its groups'."
      >
        {groups.length === 0 && (
          <p className="px-4 py-3 text-[length:var(--text-sm)] text-[var(--text-muted)]">
            No access groups yet. Create one to grant a base set of projects to several familiars at
            once — e.g. “Researchers” with read access to your docs.
          </p>
        )}

        {groups.map((group) => {
          const open = expanded === group.id;
          const groupBusy = busy.has(group.id);
          return (
            <div key={group.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : group.id)}
                className="focus-ring-inset flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon name="ph:users-three" width={15} height={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-base)] text-[var(--text-primary)]">{group.name}</span>
                    <span className="mt-0.5 block truncate text-[length:var(--text-xs)] text-[var(--text-muted)]">
                      {group.memberFamiliarIds.length === 1
                        ? "1 member"
                        : `${group.memberFamiliarIds.length} members`}
                      {" · "}
                      {group.projectGrants.length === 1
                        ? "1 project"
                        : `${group.projectGrants.length} projects`}
                    </span>
                  </span>
                </span>
                <Icon
                  name={open ? "ph:caret-up" : "ph:caret-down"}
                  width={13}
                  height={13}
                  className="shrink-0 text-[var(--text-muted)]"
                  aria-hidden
                />
              </button>

              {open && (
                <div className="space-y-4 border-t border-[var(--border-hairline)] bg-[var(--bg-base)] px-4 py-3">
                  {/* Members */}
                  <div>
                    <p className="mb-1.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                      Members
                    </p>
                    {memberCandidates.length === 0 ? (
                      <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">No familiars to add.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {memberCandidates.map((familiar) => {
                          const member = group.memberFamiliarIds.includes(familiar.id);
                          return (
                            <button
                              key={familiar.id}
                              type="button"
                              role="checkbox"
                              aria-checked={member}
                              disabled={groupBusy}
                              onClick={() => toggleMember(group, familiar.id)}
                              className={`focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[length:var(--text-xs)] font-medium transition-colors duration-150 ${
                                member
                                  ? "border-transparent bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                                  : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                              } ${groupBusy ? "opacity-60" : ""}`}
                            >
                              {member && <Icon name="ph:check-bold" width={11} height={11} aria-hidden />}
                              {familiar.display_name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {group.memberFamiliarIds.some(
                      (id) => !familiars.some((familiar) => familiar.id === id),
                    ) && (
                      <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                        Includes familiars no longer in the roster:{" "}
                        {group.memberFamiliarIds
                          .filter((id) => !familiars.some((familiar) => familiar.id === id))
                          .map(familiarName)
                          .join(", ")}
                      </p>
                    )}
                  </div>

                  {/* Base projects */}
                  <div>
                    <p className="mb-1.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                      Base projects
                    </p>
                    {projects.length === 0 ? (
                      <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                        No projects registered yet.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {projects.map((project) => {
                          const grant = group.projectGrants.find(
                            (candidate) => candidate.projectId === project.id,
                          );
                          const level: ProjectAccessLevel | null = grant
                            ? grant.access === "read"
                              ? "read"
                              : "write"
                            : null;
                          const meta = level ? accessLevelMeta(level) : null;
                          return (
                            <div key={project.id} className="flex items-center justify-between gap-3 py-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  aria-hidden
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ background: project.color || "var(--text-muted)" }}
                                />
                                <span className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)]" title={project.root}>
                                  {project.name}
                                </span>
                              </span>
                              <button
                                type="button"
                                disabled={groupBusy}
                                title={meta ? meta.title : "Not granted — click to grant read access"}
                                aria-label={`${project.name} access for ${group.name}: ${meta ? meta.label : "off"}. Click to change.`}
                                onClick={() => cycleProjectGrant(group, project.id)}
                                className={`focus-ring inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium transition-colors duration-150 ${
                                  level
                                    ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                                    : "border border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                                } ${groupBusy ? "opacity-60" : ""}`}
                              >
                                {meta && <Icon name={meta.icon} width={11} height={11} aria-hidden />}
                                {meta ? meta.label : "Off"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={groupBusy}
                      onClick={() => deleteGroup(group)}
                      leadingIcon="ph:trash"
                      aria-label={`Delete the ${group.name} access group`}
                    >
                      Delete group
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Create */}
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createGroup();
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New group name (e.g. Researchers)…"
            aria-label="New access group name"
            className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <IconButton
            icon="ph:plus-bold"
            size="xs"
            type="submit"
            aria-label="Create access group"
            disabled={creating || !newName.trim()}
          />
        </form>
      </SettingsGroup>
    </div>
  );
}
