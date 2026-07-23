"use client";

/**
 * CodeNewSession — the Code surface's "+ New session" flow (cave-k0ua):
 * pick a project + familiar, optionally provision a FRESH worktree for a
 * named branch (POST /api/changes action=create-worktree — .worktrees/<branch>
 * off origin's default), write the kickoff prompt, and start the conversation
 * through the sanctioned client LLM path (streamFamiliarText, no sessionId =
 * new thread) rooted at the chosen cwd. The moment the bridge announces the
 * backing session id we hand it to the rail and close — the stream keeps
 * running server-side; the transcript lives in Chat.
 */

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { Familiar } from "@/lib/types";

type Phase = { kind: "idle" } | { kind: "provisioning" } | { kind: "starting" } | { kind: "error"; message: string };

export function CodeNewSession({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired as soon as the bridge announces the new session id. */
  onCreated: (sessionId: string) => void;
}) {
  const [projects, setProjects] = useState<CaveProject[]>([]);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [projectId, setProjectId] = useState("");
  const [familiarId, setFamiliarId] = useState("");
  const [freshWorktree, setFreshWorktree] = useState(false);
  const [branch, setBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "provisioning" || phase.kind === "starting";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [projRes, famRes] = await Promise.all([
          fetch("/api/projects", { cache: "no-store" }),
          fetch("/api/familiars", { cache: "no-store" }),
        ]);
        const proj = (await projRes.json().catch(() => null)) as { ok?: boolean; projects?: CaveProject[] } | null;
        const fam = (await famRes.json().catch(() => null)) as { ok?: boolean; familiars?: Familiar[] } | null;
        if (cancelled) return;
        const projectRows = proj?.ok && Array.isArray(proj.projects) ? proj.projects : [];
        const familiarRows = fam?.ok && Array.isArray(fam.familiars) ? fam.familiars : [];
        setProjects(projectRows);
        setFamiliars(familiarRows);
        setProjectId((prev) => prev || (projectRows[0]?.id ?? ""));
        setFamiliarId((prev) => prev || (familiarRows[0]?.id ?? ""));
      } catch {
        if (!cancelled) setPhase({ kind: "error", message: "Couldn’t load projects/familiars." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const canCreate = Boolean(project && familiarId && prompt.trim() && (!freshWorktree || branch.trim()) && !busy);

  async function create() {
    if (!project || !canCreate) return;
    let cwd = project.root;

    if (freshWorktree) {
      setPhase({ kind: "provisioning" });
      try {
        const res = await fetch("/api/changes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectRoot: project.root, action: "create-worktree", branch: branch.trim() }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; worktree?: string; error?: string }
          | null;
        if (!res.ok || !json?.ok || !json.worktree) {
          setPhase({ kind: "error", message: json?.error ?? "Couldn’t create the worktree." });
          return;
        }
        cwd = json.worktree;
      } catch (err) {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : "Couldn’t create the worktree." });
        return;
      }
    }

    setPhase({ kind: "starting" });
    let announced = false;
    // Fire-and-continue: the moment the session id arrives the rail can select
    // it; the stream keeps flowing server-side and Chat shows the transcript.
    void streamFamiliarText({
      familiarId,
      prompt: prompt.trim(),
      projectRoot: cwd,
      runId: `code-new-session-${Date.now().toString(36)}`,
      onSession: (sessionId) => {
        if (announced) return;
        announced = true;
        onCreated(sessionId);
      },
    }).then((result) => {
      if (!announced && result.sessionId) {
        announced = true;
        onCreated(result.sessionId);
      } else if (!announced && result.error) {
        setPhase({ kind: "error", message: result.error });
      }
    });
  }

  function reset() {
    setPhase({ kind: "idle" });
    setPrompt("");
    setBranch("");
    setFreshWorktree(false);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy && phase.kind !== "starting") return; // don't abandon mid-provision
        reset();
        onClose();
      }}
      breadcrumb={["Code", "New session"]}
      footerActions={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={phase.kind === "provisioning"}
          >
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!canCreate} onClick={() => void create()}>
            {phase.kind === "provisioning"
              ? "Creating worktree…"
              : phase.kind === "starting"
                ? "Starting session…"
                : "Start session"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <StandardSelect
          label="Project"
          value={projectId}
          onChange={setProjectId}
          options={projects.map((p) => ({ value: p.id, label: p.name || p.root }))}
          disabled={busy || projects.length === 0}
        />
        <StandardSelect
          label="Familiar"
          value={familiarId}
          onChange={setFamiliarId}
          options={familiars.map((f) => ({ value: f.id, label: f.display_name }))}
          disabled={busy || familiars.length === 0}
        />
        <label className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={freshWorktree}
            onChange={(e) => setFreshWorktree(e.target.checked)}
            disabled={busy}
          />
          Work in a fresh worktree
        </label>
        {freshWorktree ? (
          <input
            type="text"
            className="focus-ring-inset w-full rounded border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 font-mono text-[length:var(--text-xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            placeholder="branch name (e.g. feat/my-change)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={busy}
            aria-label="Worktree branch name"
          />
        ) : null}
        <textarea
          className="focus-ring-inset min-h-20 w-full resize-y rounded border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          placeholder="What should this session work on?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          aria-label="Kickoff prompt"
        />
        {phase.kind === "error" ? (
          <p role="alert" className="text-[length:var(--text-xs)] text-[var(--color-danger)]">
            {phase.message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
