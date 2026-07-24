"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects-types";
import { projectNameForRoot, type CreateProjectOptions } from "@/lib/chat-add-project";
import { projectTint } from "@/lib/comux-projects";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import { emitProjectRegistryMutation } from "@/lib/project-registry-events";
import { PROJECT_SETUP_COLOR_CHOICES } from "@/lib/project-setup-offer";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";

type AccessChoice = "none" | ProjectAccessLevel;

type SetupAccessGroup = {
  id: string;
  name: string;
  memberFamiliarIds: string[];
  projectGrants: { projectId: string; access?: ProjectAccessLevel }[];
};

const ACCESS_OPTIONS: StandardSelectOption<AccessChoice>[] = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

/**
 * "Set up as project" — registers an ad-hoc chat folder as a Cave project in
 * place (spec 2026-07-24). One human-confirmed submit sequences: create the
 * project (with optional color + GitHub link) → grant the chat's familiar →
 * patch each chosen access group — every request fired from the direct click
 * the grant routes require (they reject relayed approvals). A partial failure
 * keeps the modal open naming the failed step; retry reuses the already
 * created project instead of duplicating it (addChatProject's two-step
 * semantics, including the partial-mutation registry emit).
 */
export function ProjectSetupModal({
  root,
  familiar,
  createProject,
  onClose,
  onCreated,
}: {
  /** Normalized ad-hoc folder being registered; null keeps the modal closed. */
  root: string | null;
  familiar: { id: string | null; name: string };
  /** The caller's useProjects().createProjectOrThrow so its local list
   *  updates in place AND create failures carry the server's message. */
  createProject: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { announce } = useAnnouncer();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [repoDraft, setRepoDraft] = useState("");
  const [familiarAccess, setFamiliarAccess] = useState<AccessChoice>("write");
  const [groupLevels, setGroupLevels] = useState<Record<string, AccessChoice>>({});
  const [groups, setGroups] = useState<SetupAccessGroup[]>([]);
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<CaveProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed per folder: prefill the name from the leaf, probe groups +
  // supreme (one grants fetch) and the git origin (GitHub prefill). Both
  // probes are best-effort — a failure leaves its section blank/hidden and
  // never blocks setup.
  useEffect(() => {
    if (!root) return;
    setName(projectNameForRoot(root));
    setColor(null);
    setRepoDraft("");
    setFamiliarAccess("write");
    setGroupLevels({});
    setCreatedProject(null);
    setBusy(false);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/project-grants", { cache: "no-store" });
        const data = (await res.json()) as {
          accessGroups?: SetupAccessGroup[];
          supremeFamiliarId?: string;
        };
        if (cancelled) return;
        setGroups(Array.isArray(data?.accessGroups) ? data.accessGroups : []);
        setSupremeFamiliarId(
          typeof data?.supremeFamiliarId === "string" ? data.supremeFamiliarId : null,
        );
      } catch {
        /* group section stays hidden; direct grant + creation still work */
      }
    })();
    void (async () => {
      try {
        const res = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(root)}&remote=1`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { remoteUrl?: string | null };
        if (cancelled) return;
        const normalized =
          typeof data?.remoteUrl === "string" ? normalizeGitHubRepoUrl(data.remoteUrl) : null;
        if (normalized) setRepoDraft((current) => (current.trim() ? current : normalized));
      } catch {
        /* prefill only — never blocks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);

  if (!root) return null;

  const isSupremeFamiliar = Boolean(familiar.id) && familiar.id === supremeFamiliarId;
  const memberGroups = familiar.id
    ? groups.filter((group) => group.memberFamiliarIds.includes(familiar.id as string))
    : [];

  const submit = async () => {
    if (busy) return;
    const trimmedName = name.trim() || projectNameForRoot(root);
    const trimmedRepo = repoDraft.trim();
    const normalizedRepo = trimmedRepo ? normalizeGitHubRepoUrl(trimmedRepo) : null;
    if (trimmedRepo && !normalizedRepo) {
      setError(
        "That doesn't look like a GitHub repository. Try owner/repo or a https://github.com/owner/repo link.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    // Creation succeeded but a later grant failed → the project exists, so
    // fan the partial registry mutation out before surfacing the error
    // (mirrors addChatProject).
    const failAfterCreate = (message: string) => {
      emitProjectRegistryMutation();
      setError(message);
    };
    let resolvedProject = createdProject;
    try {
      let project = createdProject;
      if (!project) {
        project = await createProject(trimmedName, root, {
          emitMutation: false,
          ...(color ? { color } : {}),
          ...(normalizedRepo ? { repoUrl: normalizedRepo } : {}),
        });
        setCreatedProject(project);
        resolvedProject = project;
      }
      if (familiar.id && familiarAccess !== "none" && !isSupremeFamiliar) {
        const res = await fetch("/api/project-grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetFamiliarId: familiar.id,
            projectId: project.id,
            access: familiarAccess,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as { error?: string }));
          failAfterCreate(
            data.error
              ? `Project registered, but granting ${familiar.name} failed: ${data.error}`
              : `Project registered, but granting ${familiar.name} failed — retry, or grant it from Permissions.`,
          );
          return;
        }
      }
      for (const group of memberGroups) {
        const level = groupLevels[group.id] ?? "none";
        if (level === "none") continue;
        const projectGrants = group.projectGrants
          .filter((grant) => grant.projectId !== project.id)
          .map((grant) => ({ projectId: grant.projectId, access: grant.access ?? "write" }));
        projectGrants.push({ projectId: project.id, access: level });
        const res = await fetch(`/api/access-groups/${group.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectGrants }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as { error?: string }));
          failAfterCreate(
            data.error
              ? `Project registered, but granting the ${group.name} group failed: ${data.error}`
              : `Project registered, but granting the ${group.name} group failed — retry, or grant it from Permissions.`,
          );
          return;
        }
      }
      emitProjectRegistryMutation();
      announce("Project created.");
      onCreated(project.id);
      onClose();
    } catch (error) {
      if (resolvedProject) {
        failAfterCreate(
          "Project registered, but applying access failed — retry, or grant it from Permissions.",
        );
      } else {
        setError(
          error instanceof Error && error.message
            ? error.message
            : "Couldn't reach the desktop — nothing was created. Retry?",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissOnBackdrop={!busy}
      breadcrumb={["Projects", "Set up project"]}
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <Icon name="ph:folder-plus" width={13} aria-hidden />
        <span className="truncate" title={root}>
          {root}
        </span>
      </div>

      <p className="mb-4 text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]">
        Registering makes this folder a project across the Cave — it shows up in project pickers,
        the Board, and chat rails. Familiars can only work in a project after you grant access;
        choose who starts with access below. Everything here can be changed later in Projects and Permissions.
      </p>

      <label className="block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          Project name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          spellCheck={false}
          className="focus-ring w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none"
        />
      </label>

      <div className="mt-4">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          Color
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Project color">
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-pressed={color === null}
            aria-label="Automatic color from the folder path"
            title="Auto"
            className={`focus-ring h-6 w-6 rounded-md transition-transform hover:scale-110 ${
              color === null ? "ring-2 ring-[var(--accent-presence)]" : "ring-1 ring-[var(--border-strong)]"
            }`}
            style={{ background: projectTint(root) }}
          />
          {PROJECT_SETUP_COLOR_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setColor(choice)}
              aria-pressed={color === choice}
              aria-label={`Use ${choice}`}
              title={choice}
              className={`focus-ring h-6 w-6 rounded-md transition-transform hover:scale-110 ${
                color === choice ? "ring-2 ring-[var(--accent-presence)]" : "ring-1 ring-[var(--border-strong)]"
              }`}
              style={{ background: choice }}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Auto derives a stable tint from the folder path.
        </p>
      </div>

      <label className="mt-4 block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          GitHub repository
        </div>
        <input
          value={repoDraft}
          onChange={(e) => {
            setRepoDraft(e.target.value);
            setError(null);
          }}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="GitHub repository"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="focus-ring w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </label>
      <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Optional — ties the project to a repository. Leave empty to skip.
      </p>

      <div className="mt-4">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
          {familiar.name}'s access
        </div>
        {isSupremeFamiliar ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            {familiar.name} has access to every project.
          </p>
        ) : familiar.id ? (
          <>
            <StandardSelect
              label={`${familiar.name}'s access`}
              value={familiarAccess}
              onChange={setFamiliarAccess}
              options={ACCESS_OPTIONS}
            />
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              Write lets {familiar.name} run chats and edit files here; Read is read-only.
            </p>
          </>
        ) : (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            No familiar in this chat — grant access from Permissions later.
          </p>
        )}
      </div>

      {memberGroups.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
            {familiar.name}'s groups
          </div>
          <div className="flex flex-col gap-2">
            {memberGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                    {group.name}
                  </span>
                  <span className="block text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {group.memberFamiliarIds.length}{" "}
                    {group.memberFamiliarIds.length === 1 ? "member" : "members"}
                  </span>
                </span>
                <StandardSelect
                  label={`${group.name} group access`}
                  value={groupLevels[group.id] ?? "none"}
                  onChange={(level) =>
                    setGroupLevels((prev) => ({ ...prev, [group.id]: level }))
                  }
                  options={ACCESS_OPTIONS}
                />
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            Applies to every member of the group.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          className="mt-4 rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-1.5 text-[length:var(--text-xs)] text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
