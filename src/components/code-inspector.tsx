"use client";

/**
 * CodeInspector — the workbench's right-hand details panel (cave-k0ua):
 * session environment (harness, model, work root), local branches with
 * one-click switch, and fresh-worktree provisioning — the same /api/changes
 * surface chat's composer git chip uses (?branches=1, action=switch-branch,
 * action=create-worktree), scoped to the session's work root (cave-9q24).
 *
 * Switching a branch mutates the CHECKOUT at the work root — for worktree
 * sessions that's their private worktree; for shared-checkout sessions it's
 * the shared root (identical semantics to chat's git chip, user-explicit).
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import { codeSessionWorkRoot } from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

type BranchRow = {
  name: string;
  current: boolean;
  /** Checkout dir basename when some worktree has the branch checked out. */
  worktree: string | null;
  worktreePath?: string | null;
};

type BranchesState =
  | { phase: "loading" }
  | { phase: "ready"; branches: BranchRow[] }
  | { phase: "error"; message: string };

function useBranches(projectRoot: string): BranchesState & { refresh: () => void } {
  const [state, setState] = useState<BranchesState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((prev) => (tick > 0 && prev.phase === "ready" ? prev : { phase: "loading" }));
    (async () => {
      try {
        const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&branches=1`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; branches?: BranchRow[] }
          | null;
        if (cancelled) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.branches)) {
          setState({ phase: "error", message: json?.error ?? `branches HTTP ${res.status}` });
          return;
        }
        setState({ phase: "ready", branches: json.branches });
      } catch (err) {
        if (!cancelled)
          setState({ phase: "error", message: err instanceof Error ? err.message : "couldn't list branches" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

function EnvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-[length:var(--text-xs)]">
      <span className="w-16 shrink-0 text-[var(--text-muted)]">{label}</span>
      <span
        className={`min-w-0 truncate text-[var(--text-secondary)] ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function CodeInspector({ row, onChanged }: { row: SessionRow; onChanged?: () => void }) {
  const workRoot = codeSessionWorkRoot(row);
  const branches = useBranches(workRoot);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; worktree?: string }> {
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; worktree?: string }
        | null;
      if (!res.ok || !json?.ok) return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
      return { ok: true, worktree: json.worktree };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }

  async function switchBranch(name: string) {
    if (busyBranch) return;
    setBusyBranch(name);
    setNotice(null);
    const result = await post({ projectRoot: workRoot, action: "switch-branch", branch: name });
    setBusyBranch(null);
    if (result.ok) {
      setNotice({ kind: "ok", text: `Switched to ${name}.` });
      branches.refresh();
      onChanged?.();
    } else {
      setNotice({ kind: "err", text: result.error ?? "Switch failed." });
    }
  }

  async function createWorktree() {
    const name = newBranch.trim();
    if (!name || creating) return;
    setCreating(true);
    setNotice(null);
    const result = await post({ projectRoot: workRoot, action: "create-worktree", branch: name });
    setCreating(false);
    if (result.ok) {
      setNewBranch("");
      setNotice({ kind: "ok", text: `Worktree ready${result.worktree ? ` at ${result.worktree}` : ""}.` });
      branches.refresh();
      onChanged?.();
    } else {
      setNotice({ kind: "err", text: result.error ?? "Worktree creation failed." });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <section aria-label="Session environment" className="flex flex-col gap-1">
        <h3 className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Session
        </h3>
        <EnvRow label="Harness" value={row.harness || "—"} />
        {row.model ? <EnvRow label="Model" value={row.model} /> : null}
        <EnvRow label="Root" value={workRoot} mono />
        <EnvRow label="Updated" value={relativeTime(row.updated_at)} />
      </section>

      <section aria-label="Branches" className="flex min-h-0 flex-col gap-1">
        <h3 className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Branches
        </h3>
        {branches.phase === "loading" ? (
          <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Loading…</p>
        ) : branches.phase === "error" ? (
          <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{branches.message}</p>
        ) : (
          <ul className="flex flex-col">
            {branches.branches.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  className={`focus-ring flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[length:var(--text-xs)] ${
                    b.current
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  disabled={b.current || busyBranch != null}
                  onClick={() => void switchBranch(b.name)}
                  title={b.current ? `${b.name} (checked out here)` : `Switch to ${b.name}`}
                >
                  <Icon name="ph:git-branch" width={10} height={10} />
                  <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
                  {busyBranch === b.name ? <span className="shrink-0">…</span> : null}
                  {b.current ? <span aria-hidden className="shrink-0 text-[var(--color-success)]">✓</span> : null}
                  {b.worktree ? (
                    <span
                      className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]"
                      title={b.worktreePath ?? undefined}
                    >
                      ⑂ {b.worktree}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="New worktree" className="flex flex-col gap-1.5">
        <h3 className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          New worktree
        </h3>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className="focus-ring-inset min-w-0 flex-1 rounded border border-[var(--border-hairline)] bg-transparent px-2 py-1 font-mono text-[length:var(--text-xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            placeholder="branch name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createWorktree();
            }}
            disabled={creating}
            aria-label="New worktree branch name"
          />
          <Button size="sm" disabled={!newBranch.trim() || creating} onClick={() => void createWorktree()}>
            {creating ? "…" : "Create"}
          </Button>
        </div>
      </section>

      {notice ? (
        <p
          role={notice.kind === "err" ? "alert" : "status"}
          className={`text-[length:var(--text-xs)] ${notice.kind === "err" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
