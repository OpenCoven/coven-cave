"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useAnnouncer } from "@/components/ui/live-region";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { grantKey } from "@/lib/permissions-console";
import type { Familiar } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";

// The selected project's Git / Tasks / Grants sections (PR2 of the hub plan).
// Polling discipline: ONLY the selected project's GitSection polls
// /api/changes (via useChangesSummary — 5s, visibility-gated, single-flight);
// board cards arrive once from the shell and are filtered client-side; grants
// load once per selection and mutate optimistically.

// ── Git ───────────────────────────────────────────────────────────────────────

export function GitSection({
  projectRoot,
  sessionBranch,
}: {
  projectRoot: string;
  /** Fallback branch from the newest session's git context, shown until the
   *  authoritative /api/changes response lands. */
  sessionBranch: string | null;
}) {
  const changes = useChangesSummary(projectRoot, true);
  const branch = changes.branch ?? sessionBranch;

  return (
    <section className="projects-detail-section" aria-label="Git status">
      <div className="projects-detail-section__title">
        <span>Git</span>
      </div>
      {changes.loaded && changes.notARepo ? (
        <p className="text-[11px] text-[var(--text-muted)]">Not a git repository.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--text-muted)]">
          {branch ? (
            <span className="inline-flex max-w-[16rem] items-center gap-1 truncate font-mono" title={`Branch: ${branch}`}>
              <Icon name="ph:git-branch-bold" width={11} aria-hidden />
              <span className="truncate">{branch}</span>
            </span>
          ) : null}
          {!changes.loaded ? (
            <span>Checking working tree…</span>
          ) : changes.count > 0 ? (
            <span
              className="projects-session-chip projects-session-chip--running"
              title={`${changes.count} uncommitted ${changes.count === 1 ? "file" : "files"}`}
            >
              <Icon name="ph:git-diff" width={10} aria-hidden />
              {changes.count} changed {changes.count === 1 ? "file" : "files"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Icon name="ph:check-bold" width={10} aria-hidden />
              Working tree clean
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

const TASK_CAP = 5;

/** Board cards belonging to a project: matched by stable projectId first, with
 *  a normalized-cwd fallback for cards created before projects had ids. */
export function cardsForProject(cards: Card[], project: CaveProject): Card[] {
  const rootKey = normalizeProjectRoot(project.root);
  return cards.filter(
    (card) =>
      card.projectId === project.id ||
      (Boolean(card.cwd) && normalizeProjectRoot(card.cwd ?? "") === rootKey),
  );
}

const CARD_STATUS_DOT: Record<string, string> = {
  running: "bg-[var(--accent-presence)]",
  review: "bg-[var(--color-warning)]",
  blocked: "bg-[var(--color-danger)]",
};

export function TasksSection({
  project,
  cards,
  onOpenBoard,
}: {
  project: CaveProject;
  cards: Card[];
  onOpenBoard?: () => void;
}) {
  const projectCards = useMemo(() => cardsForProject(cards, project), [cards, project]);
  const open = useMemo(() => projectCards.filter((c) => c.status !== "done"), [projectCards]);
  const doneCount = projectCards.length - open.length;
  const runningCount = open.filter((c) => c.status === "running").length;

  return (
    <section className="projects-detail-section" aria-label={`Tasks for ${project.name}`}>
      <div className="projects-detail-section__title">
        <span>Tasks</span>
        {open.length > 0 ? <span className="projects-list-row__count">{open.length}</span> : null}
        {runningCount > 0 ? (
          <span className="projects-session-chip projects-session-chip--running" title={`${runningCount} running`}>
            <Icon name="ph:circle-notch-bold" width={9} className="animate-spin" aria-hidden />
            {runningCount}
          </span>
        ) : null}
        {onOpenBoard ? (
          <span className="ml-auto">
            <Button
              variant="ghost"
              size="xs"
              onClick={onOpenBoard}
              className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Open board →
            </Button>
          </span>
        ) : null}
      </div>
      {open.length === 0 ? (
        <div className="projects-detail-empty">
          {doneCount > 0
            ? `All ${doneCount} task${doneCount === 1 ? "" : "s"} done — add the next one on the board.`
            : "No tasks for this project yet."}
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {open.slice(0, TASK_CAP).map((card) => (
              <li key={card.id} className="flex items-center gap-2 px-1 py-1 text-[12px] text-[var(--text-secondary)]">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${CARD_STATUS_DOT[card.status] ?? "bg-[var(--text-muted)]"}`}
                />
                <span className="min-w-0 flex-1 truncate" title={card.title}>
                  {card.title}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {card.status}
                </span>
              </li>
            ))}
          </ul>
          {open.length > TASK_CAP ? (
            <p className="mt-1 px-1 text-[10px] text-[var(--text-muted)]">
              +{open.length - TASK_CAP} more on the board
              {doneCount > 0 ? ` · ${doneCount} done` : ""}
            </p>
          ) : doneCount > 0 ? (
            <p className="mt-1 px-1 text-[10px] text-[var(--text-muted)]">{doneCount} done</p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ── Grants ────────────────────────────────────────────────────────────────────

export function GrantsSection({
  project,
  familiars,
}: {
  project: CaveProject;
  familiars: Familiar[];
}) {
  const { announce } = useAnnouncer();
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const [granted, setGranted] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load once per selection (this component remounts with the detail pane's
  // project key) — grants are cheap and mutations are optimistic below.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/project-grants", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        const grants = Array.isArray(json?.grants) ? json.grants : [];
        setGranted(
          new Set(
            grants
              .filter((g: { projectId?: string }) => g.projectId === project.id)
              .map((g: { familiarId: string; projectId: string }) => grantKey(g.familiarId, g.projectId)),
          ),
        );
        setSupremeFamiliarId(typeof json?.supremeFamiliarId === "string" ? json.supremeFamiliarId : null);
        setError(null);
      } catch {
        if (!cancelled) setError("Couldn't load project access.");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Optimistic toggle with revert-on-failure (same discipline as the Familiar
  // Studio grant matrix — both drive /api/project-grants).
  const toggle = useCallback(
    async (familiarId: string, familiarName: string, next: boolean) => {
      const key = grantKey(familiarId, project.id);
      setPending((p) => new Set(p).add(key));
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
          body: JSON.stringify({ targetFamiliarId: familiarId, projectId: project.id }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
        announce(`${next ? "Granted" : "Revoked"} ${project.name} ${next ? "to" : "from"} ${familiarName}.`);
      } catch {
        // Revert on failure.
        setGranted((g) => {
          const copy = new Set(g);
          if (next) copy.delete(key);
          else copy.add(key);
          return copy;
        });
        setError("Couldn't update that grant.");
        announce("Couldn't update that grant.", "assertive");
      } finally {
        setPending((p) => {
          const copy = new Set(p);
          copy.delete(key);
          return copy;
        });
      }
    },
    [project.id, project.name, announce],
  );

  return (
    <section className="projects-detail-section" aria-label={`Familiar access to ${project.name}`}>
      <div className="projects-detail-section__title">
        <span>Grants</span>
        {granted.size > 0 ? <span className="projects-list-row__count">{granted.size}</span> : null}
      </div>
      {error ? (
        <p role="alert" className="mb-1.5 text-[11px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {!loaded ? (
        <p className="text-[11px] text-[var(--text-muted)]">Loading access…</p>
      ) : resolvedFamiliars.length === 0 ? (
        <div className="projects-detail-empty">No familiars yet.</div>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {resolvedFamiliars.map((familiar) => {
            const key = grantKey(familiar.id, project.id);
            const isSupremeFamiliar = familiar.id === supremeFamiliarId;
            const has = isSupremeFamiliar || granted.has(key);
            const busy = pending.has(key);
            return (
              <li key={familiar.id} className="m-0 list-none p-0">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy || isSupremeFamiliar}
                  onClick={() => void toggle(familiar.id, familiar.display_name, !has)}
                  aria-pressed={has}
                  title={
                    isSupremeFamiliar
                      ? `${familiar.display_name} is the supreme familiar — access to every project`
                      : has
                        ? `Revoke ${project.name} from ${familiar.display_name}`
                        : `Grant ${project.name} to ${familiar.display_name}`
                  }
                  className={`h-7 gap-1.5 rounded-full border px-2 text-[11px] ${
                    has
                      ? "border-[color-mix(in_oklch,var(--accent-presence)_38%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                      : "border-dashed border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  <FamiliarAvatar familiar={familiar} size="sm" />
                  <span className="max-w-[9rem] truncate">{familiar.display_name}</span>
                  {isSupremeFamiliar ? (
                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">always</span>
                  ) : (
                    <Icon name={has ? "ph:check-bold" : "ph:plus-bold"} width={9} aria-hidden />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
