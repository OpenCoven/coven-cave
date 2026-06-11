"use client";

import { useMemo, useState, type FormEvent } from "react";

import { Icon } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects";
import { normalizeProjectRoot } from "@/lib/cave-projects";
import { useProjects } from "@/lib/use-projects";

type ProjectsViewProps = {
  sessions?: Array<{ project_root?: string | null }>;
  onNewChat?: (projectRoot: string) => void;
};

type ProjectRowProps = {
  project: CaveProject;
  chatCount: number;
  onRename: (id: string, name: string) => Promise<boolean>;
  onUpdateRoot: (id: string, root: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onNewChat?: (projectRoot: string) => void;
};

function ProjectRow({
  project,
  chatCount,
  onRename,
  onUpdateRoot,
  onDelete,
  onNewChat,
}: ProjectRowProps) {
  const [editingName, setEditingName] = useState(false);
  const [editingRoot, setEditingRoot] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [rootDraft, setRootDraft] = useState(project.root);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"name" | "root" | "delete" | null>(null);

  const commitName = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setNameDraft(project.name);
      setEditingName(false);
      return;
    }
    if (next !== project.name) {
      setBusy("name");
      await onRename(project.id, next);
      setBusy(null);
    }
    setEditingName(false);
  };

  const commitRoot = async () => {
    const next = rootDraft.trim();
    if (!next) {
      setRootDraft(project.root);
      setEditingRoot(false);
      return;
    }
    if (normalizeProjectRoot(next) !== normalizeProjectRoot(project.root)) {
      setBusy("root");
      await onUpdateRoot(project.id, next);
      setBusy(null);
    }
    setEditingRoot(false);
  };

  const deleteProject = async () => {
    setBusy("delete");
    await onDelete(project.id);
    setBusy(null);
  };

  return (
    <article className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-3 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          name="ph:folder-open-bold"
          width={15}
          className="shrink-0 text-[var(--accent-presence)]"
          aria-hidden
        />
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitName();
              if (event.key === "Escape") {
                setNameDraft(project.name);
                setEditingName(false);
              }
            }}
            disabled={busy === "name"}
            className="focus-ring min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[13px] font-semibold text-[var(--text-primary)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(project.name);
              setEditingName(true);
            }}
            className="focus-ring min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent-presence)]"
            title="Rename project"
          >
            {project.name}
          </button>
        )}

        <span className="shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {chatCount} {chatCount === 1 ? "chat" : "chats"}
        </span>

        <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onNewChat?.(project.root)}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="New chat"
          >
            <Icon name="ph:chat-circle-dots-bold" width={14} aria-hidden />
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="focus-ring h-7 rounded-md px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteProject()}
                disabled={busy === "delete"}
                className="focus-ring h-7 rounded-md border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-2 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)]"
              title="Delete project"
            >
              <Icon name="ph:trash-bold" width={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 pl-6">
        <Icon
          name="ph:folder-simple-dashed"
          width={13}
          className="shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
        {editingRoot ? (
          <input
            autoFocus
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            onBlur={() => void commitRoot()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRoot();
              if (event.key === "Escape") {
                setRootDraft(project.root);
                setEditingRoot(false);
              }
            }}
            disabled={busy === "root"}
            className="focus-ring min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setRootDraft(project.root);
              setEditingRoot(true);
            }}
            className="focus-ring min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left font-mono text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={project.root}
          >
            {project.root}
          </button>
        )}
      </div>
    </article>
  );
}

export function ProjectsView({ sessions = [], onNewChat }: ProjectsViewProps) {
  const {
    projects,
    loading,
    error,
    createProject,
    renameProject,
    updateRoot,
    deleteProject,
    reload,
  } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [creating, setCreating] = useState(false);

  const chatCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      const root = normalizeProjectRoot(session.project_root);
      counts.set(root, (counts.get(root) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameDraft.trim();
    const root = rootDraft.trim();
    if (!name || !root) return;
    setCreating(true);
    const project = await createProject(name, root);
    setCreating(false);
    if (!project) return;
    setNameDraft("");
    setRootDraft("");
    setShowForm(false);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="ph:folders-bold" width={16} className="text-[var(--accent-presence)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Projects</h2>
            <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {projects.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              <Icon name="ph:arrows-clockwise-bold" width={12} className={loading ? "animate-spin" : undefined} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[12px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
            >
              <Icon name="ph:plus-bold" width={12} />
              New project
            </button>
          </div>
        </div>
      </header>

      {showForm ? (
        <form
          onSubmit={handleCreate}
          className="shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-sunken)] px-4 py-3 sm:px-6"
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(160px,0.7fr)_minmax(260px,1.3fr)_auto]">
            <input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Project name"
              className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <input
              value={rootDraft}
              onChange={(event) => setRootDraft(event.target.value)}
              placeholder="/absolute/path/to/project"
              className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 font-mono text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating || !nameDraft.trim() || !rootDraft.trim()}
                className="focus-ring h-9 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-[var(--text-primary)] disabled:opacity-50"
              >
                {creating ? "Creating" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {error ? (
          <div className="mb-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-[12px] text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        {loading && projects.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
            <Icon name="ph:circle-notch-bold" width={14} className="animate-spin" />
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border-hairline)] text-center">
            <Icon name="ph:folder-open" width={28} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-muted)]">No projects yet.</p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              New project
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                chatCount={chatCounts.get(normalizeProjectRoot(project.root)) ?? 0}
                onRename={renameProject}
                onUpdateRoot={updateRoot}
                onDelete={deleteProject}
                onNewChat={onNewChat}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
