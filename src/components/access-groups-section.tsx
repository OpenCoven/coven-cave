"use client";

import "@/styles/access-groups.css";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { useOptionalConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  accessLevelMeta,
  accessRollupLabel,
  isSupreme,
  rollupAccessLevels,
  type ConsoleAccessGroup,
  type ConsoleProject,
} from "@/lib/permissions-console";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import { publishProjectAccessChanged } from "@/lib/project-access-events";

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
  const confirm = useOptionalConfirm();
  const newNameId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const readResponse = async (response: Response) => {
        if (!response.ok) throw new Error("Access groups request failed");
        return response.json();
      };
      const [groupRes, projRes, grantRes] = await Promise.all([
        fetch("/api/access-groups", { cache: "no-store" }).then(readResponse),
        fetch("/api/projects", { cache: "no-store" }).then(readResponse),
        fetch("/api/project-grants", { cache: "no-store" }).then(readResponse),
      ]);
      if (groupRes?.ok !== true || !Array.isArray(groupRes.accessGroups)
        || projRes?.ok !== true || !Array.isArray(projRes.projects)
        || grantRes?.ok !== true) {
        throw new Error("Access groups response is invalid");
      }
      setGroups(groupRes.accessGroups);
      setProjects(projRes.projects);
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
    async (
      groupId: string,
      affectedProjectIds: readonly string[],
      run: () => Promise<Response>,
    ) => {
      setBusy((prev) => new Set(prev).add(groupId));
      try {
        const res = await run();
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
        for (const projectId of new Set(affectedProjectIds)) {
          publishProjectAccessChanged(projectId);
        }
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
      void withBusy(group.id, group.projectGrants.map((grant) => grant.projectId), () =>
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
      void withBusy(group.id, [projectId], () =>
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
      void withBusy(group.id, group.projectGrants.map((grant) => grant.projectId), () =>
        fetch(`/api/access-groups/${group.id}`, { method: "DELETE" }),
      );
    },
    [withBusy],
  );

  // Deleting a group takes its base projects away from every member at once,
  // so it names the group and that consequence first. Without a provider
  // (tests, controlled renders) there is nobody to ask, so it runs.
  const requestDelete = useCallback(
    async (group: ConsoleAccessGroup) => {
      if (confirm) {
        const members = group.memberFamiliarIds.length;
        const confirmed = await confirm({
          title: `Delete the ${group.name} group?`,
          body: (
            <>
              {members === 1 ? "Its member loses" : `Its ${members} members lose`} the base
              projects they inherit from it. Their own grants stay as they are.
            </>
          ),
          confirmLabel: "Delete group",
          danger: true,
        });
        if (!confirmed) return;
      }
      deleteGroup(group);
    },
    [confirm, deleteGroup],
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
      <div className="access-groups__skeleton" role="status" aria-busy="true">
        <SkeletonRows count={3} />
      </div>
    );
  }

  return (
    <div className="access-groups">
      {error && (
        <ErrorState
          compact
          headline={error}
          actions={(
            <Button size="xs" leadingIcon="ph:arrows-clockwise" onClick={() => { void load(); }}>
              Retry
            </Button>
          )}
        />
      )}

      <SettingsGroup
        label="Access groups"
        description="Give a set of familiars a shared base of projects — each at read or write. A familiar's effective access is the most permissive of its own grants and its groups'."
        meta={groups.length > 0 ? `${groups.length}` : undefined}
      >
        {!error && groups.length === 0 && (
          <EmptyState
            compact
            icon="ph:users-three"
            headline="No access groups yet."
            subtitle="Create one to grant a base set of projects to several familiars at once — e.g. “Researchers” with read access to your docs."
          />
        )}

        {groups.map((group) => {
          const open = expanded === group.id;
          const groupBusy = busy.has(group.id);
          // The group's own base-project grants, rolled up into read vs write
          // (legacy level-less grants mean write). Shown in the header so a
          // collapsed group still answers "read-only or mixed?" at a glance.
          const grantRollup = rollupAccessLevels(
            group.projectGrants.map((grant) => (grant.access === "read" ? "read" : "write")),
          );
          const orphanMembers = group.memberFamiliarIds.filter(
            (id) => !familiars.some((familiar) => familiar.id === id),
          );
          return (
            <div key={group.id}>
              <div className="access-groups__head">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : group.id)}
                  className="focus-ring-inset access-groups__toggle"
                >
                  <span className="access-groups__mark">
                    <Icon name="ph:users-three" width={14} height={14} aria-hidden />
                  </span>
                  <span className="access-groups__text">
                    <span className="access-groups__name">{group.name}</span>
                    <span className="access-groups__summary">
                      {group.memberFamiliarIds.length === 1
                        ? "1 member"
                        : `${group.memberFamiliarIds.length} members`}
                      {" · "}
                      {group.projectGrants.length === 1
                        ? "1 project"
                        : `${group.projectGrants.length} projects`}
                      {group.projectGrants.length > 0
                        ? ` · ${accessRollupLabel(grantRollup)}`
                        : ""}
                    </span>
                  </span>
                  <Icon name="ph:caret-down" width={13} height={13} className="access-groups__caret" aria-hidden />
                </button>
                <div className="access-groups__menu">
                  <OverflowMenu
                    ariaLabel={`Options for the ${group.name} access group`}
                    size="xs"
                    disabled={groupBusy}
                  >
                    <PopoverItem icon="ph:trash" danger onSelect={() => { void requestDelete(group); }}>
                      Delete group
                    </PopoverItem>
                  </OverflowMenu>
                </div>
              </div>

              {open && (
                <div className="access-groups__well">
                  {/* Members */}
                  <div>
                    <p className="access-groups__eyebrow">Members</p>
                    {memberCandidates.length === 0 ? (
                      <p className="access-groups__note">No familiars to add.</p>
                    ) : (
                      <div className="access-groups__chips">
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
                              className="focus-ring access-groups__chip"
                            >
                              {member && <Icon name="ph:check-bold" width={11} height={11} aria-hidden />}
                              {familiar.display_name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {orphanMembers.length > 0 && (
                      <p className="access-groups__note access-groups__orphans">
                        Includes familiars no longer in the roster:{" "}
                        {orphanMembers.map(familiarName).join(", ")}
                      </p>
                    )}
                  </div>

                  {/* Base projects */}
                  <div>
                    <p className="access-groups__eyebrow">Base projects</p>
                    {projects.length === 0 ? (
                      <p className="access-groups__note">No projects registered yet.</p>
                    ) : (
                      <div className="access-groups__grants">
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
                            <div key={project.id} className="access-groups__grant">
                              <span className="access-groups__project">
                                <span
                                  aria-hidden
                                  className="access-groups__project-dot"
                                  style={{ background: project.color || "var(--text-muted)" }}
                                />
                                <span className="access-groups__project-name" title={project.root}>
                                  {project.name}
                                </span>
                              </span>
                              <button
                                type="button"
                                disabled={groupBusy}
                                data-level={level ?? "off"}
                                title={meta ? meta.title : "Not granted — click to grant read access"}
                                aria-label={`${project.name} access for ${group.name}: ${meta ? meta.label : "off"}. Click to change.`}
                                onClick={() => cycleProjectGrant(group, project.id)}
                                className="focus-ring access-groups__level"
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
                </div>
              )}
            </div>
          );
        })}

        {/* Create */}
        <form
          className="access-groups__create"
          onSubmit={(event) => {
            event.preventDefault();
            void createGroup();
          }}
        >
          <label htmlFor={newNameId} className="access-groups__create-label">New group</label>
          <input
            id={newNameId}
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Researchers"
            className="focus-ring access-groups__input"
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
