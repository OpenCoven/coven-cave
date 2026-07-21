"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useAnnouncer } from "@/components/ui/live-region";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Card } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import {
  readDetailCardOpen,
  writeDetailCardOpen,
  capVisible,
  showMoreLabel,
  type DetailCardId,
} from "@/lib/projects/detail-cards";
import { accessSummary, bulkGrantOps, nextSelectAll, type BulkGrantAction } from "@/lib/projects/access-grants";

// The selected project's collapsible detail cards (Tasks / Access) plus the
// shared card chrome and the grants hook. Polling discipline: the selected
// project's git chip polls /api/changes from the detail head (useChangesSummary
// — 5s, visibility-gated, single-flight); board cards arrive once from the
// shell and are filtered client-side; grants load once per selection and
// mutate optimistically.

function localStorageOrNull(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

// ── Collapsible card chrome ──────────────────────────────────────────────────

/**
 * Bordered, translucent collapsible card: uppercase title + count tag behind
 * a chevron toggle, optional header extras (ghost actions / summaries), an
 * optional bordered footer, and per-card open-state persisted to
 * localStorage (cave:projects:card:<id>).
 */
export function DetailCard({
  card,
  ariaLabel,
  title,
  countTag,
  headerExtras,
  summary,
  footer,
  children,
}: {
  card: DetailCardId;
  ariaLabel: string;
  title: string;
  countTag?: number | null;
  /** Interactive header extras, rendered as siblings of the toggle. */
  headerExtras?: ReactNode;
  /** Quiet right-aligned header summary (e.g. "Latest 2h ago"). */
  summary?: ReactNode;
  /** Rendered inside a bordered footer row while the card is open. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readDetailCardOpen(localStorageOrNull(), card));
  useEffect(() => {
    writeDetailCardOpen(localStorageOrNull(), card, open);
  }, [card, open]);

  return (
    <section className="projects-detail-section projects-card" aria-label={ariaLabel}>
      <div className="projects-card__header">
        <button
          type="button"
          className="projects-card__toggle focus-ring"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="ph:caret-right-bold" width={11} className="projects-card__chevron" aria-hidden />
          <span className="projects-card__title">{title}</span>
          {countTag != null ? <span className="projects-list-row__count">{countTag}</span> : null}
        </button>
        {headerExtras}
        {summary ? <span className="projects-card__summary">{summary}</span> : null}
      </div>
      {open ? <div className="projects-card__body">{children}</div> : null}
      {open && footer ? <div className="projects-card__footer">{footer}</div> : null}
    </section>
  );
}

/** The dashed accent show-more toggle shared by the cards (dashed =
 *  invitation). Renders nothing when the list already fits. */
export function ShowMoreButton({
  total,
  cap,
  expanded,
  noun,
  onToggle,
}: {
  total: number;
  cap: number;
  expanded: boolean;
  noun: string;
  onToggle: () => void;
}) {
  const label = showMoreLabel(total, cap, expanded, noun);
  if (!label) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onToggle}
      aria-expanded={expanded}
      className="projects-more-btn"
    >
      {label}
    </Button>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

const TASK_CAP = 6;

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
  openCards,
  doneCount,
  runningCount,
  creatingTask,
  onCreateTask,
  onOpenBoard,
}: {
  project: CaveProject;
  /** Open (not-done) cards for this project, optimistic quick-adds included. */
  openCards: Card[];
  doneCount: number;
  runningCount: number;
  creatingTask: boolean;
  /** Creates a board card linked to this project (POST /api/board — owned by
   *  the detail pane so the stat strip sees the same optimistic list). */
  onCreateTask: (title: string) => Promise<boolean>;
  onOpenBoard?: () => void;
}) {
  const [taskDraft, setTaskDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setTaskDraft("");
    setShowAll(false);
  }, [project.id]);

  const submit = async () => {
    const title = taskDraft.trim();
    if (!title || creatingTask) return;
    if (await onCreateTask(title)) setTaskDraft("");
  };

  const visible = capVisible(openCards, TASK_CAP, showAll);

  return (
    <DetailCard
      card="tasks"
      ariaLabel={`Tasks for ${project.name}`}
      title="Tasks"
      countTag={openCards.length > 0 ? openCards.length : null}
      headerExtras={
        <>
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
                className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-medium normal-case tracking-normal text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Open board →
              </Button>
            </span>
          ) : null}
        </>
      }
      footer={
        <form
          className="flex w-full items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            value={taskDraft}
            onChange={(event) => setTaskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && taskDraft) {
                event.stopPropagation();
                setTaskDraft("");
              }
            }}
            placeholder="Add a task…"
            aria-label={`Add a task to ${project.name}`}
            disabled={creatingTask}
            className="focus-ring h-7 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-transparent px-2 text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <Button
            type="submit"
            variant="primary"
            size="xs"
            disabled={creatingTask || !taskDraft.trim()}
            aria-label={`Add task to ${project.name}`}
            className="h-7 shrink-0 rounded-[var(--radius-control)] px-2.5 text-[length:var(--text-xs)] font-medium"
          >
            {creatingTask ? "Adding…" : "Add"}
          </Button>
        </form>
      }
    >
      {openCards.length === 0 ? (
        <div className="projects-detail-empty">
          {doneCount > 0
            ? `All ${doneCount} task${doneCount === 1 ? "" : "s"} done — add the next one below.`
            : "No tasks for this project yet — add one below."}
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {visible.map((card) => (
              <li key={card.id} className="m-0 list-none p-0">
                {/* Deep-link: the board honors #card-<id> (same hash the
                    notification bell and cockpit drill-throughs use). */}
                <button
                  type="button"
                  onClick={() => {
                    onOpenBoard?.();
                    window.location.hash = `card-${card.id}`;
                  }}
                  title={`Open "${card.title}" in Tasks`}
                  className="focus-ring-inset flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1 py-1 text-left text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${CARD_STATUS_DOT[card.status] ?? "bg-[var(--accent-presence)]"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  <span className="shrink-0 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                    {card.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <ShowMoreButton
            total={openCards.length}
            cap={TASK_CAP}
            expanded={showAll}
            noun="tasks"
            onToggle={() => setShowAll((value) => !value)}
          />
          {doneCount > 0 ? (
            <p className="mt-1 px-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{doneCount} done</p>
          ) : null}
        </>
      )}
    </DetailCard>
  );
}

// ── Access (familiar grants) ─────────────────────────────────────────────────

export type ProjectGrantsState = {
  loaded: boolean;
  error: string | null;
  /** Familiar ids holding an explicit grant on this project. */
  grantedIds: Set<string>;
  supremeFamiliarId: string | null;
  pendingIds: Set<string>;
  toggle: (familiarId: string, familiarName: string, next: boolean) => Promise<void>;
};

/**
 * The project's familiar grants, lifted to the detail pane so the stat strip,
 * the Access card, and the Remove dialog all read one copy. Loads once per
 * selection (the detail pane remounts with the project key); mutations are
 * optimistic with revert-on-failure (same discipline as the Familiar Studio
 * grant matrix — both drive /api/project-grants).
 */
export function useProjectGrants(project: CaveProject): ProjectGrantsState {
  const { announce } = useAnnouncer();
  const [grantedIds, setGrantedIds] = useState<Set<string>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/project-grants", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        const grants = Array.isArray(json?.grants) ? json.grants : [];
        setGrantedIds(
          new Set(
            grants
              .filter((g: { projectId?: string }) => g.projectId === project.id)
              .map((g: { familiarId: string }) => g.familiarId),
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

  const toggle = useCallback(
    async (familiarId: string, familiarName: string, next: boolean) => {
      setPendingIds((p) => new Set(p).add(familiarId));
      setGrantedIds((g) => {
        const copy = new Set(g);
        if (next) copy.add(familiarId);
        else copy.delete(familiarId);
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
        setGrantedIds((g) => {
          const copy = new Set(g);
          if (next) copy.delete(familiarId);
          else copy.add(familiarId);
          return copy;
        });
        setError("Couldn't update that grant.");
        announce("Couldn't update that grant.", "assertive");
      } finally {
        setPendingIds((p) => {
          const copy = new Set(p);
          copy.delete(familiarId);
          return copy;
        });
      }
    },
    [project.id, project.name, announce],
  );

  return { loaded, error, grantedIds, supremeFamiliarId, pendingIds, toggle };
}

const ACCESS_CAP = 8;

export function GrantsSection({
  project,
  familiars,
  grants,
}: {
  project: CaveProject;
  /** Resolved roster (display names/avatars) — resolved once in the detail. */
  familiars: ResolvedFamiliar[];
  grants: ProjectGrantsState;
}) {
  const { loaded, error, grantedIds, supremeFamiliarId, pendingIds, toggle } = grants;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const grantedFamiliars = useMemo(
    () => familiars.filter((f) => f.id === supremeFamiliarId || grantedIds.has(f.id)),
    [familiars, grantedIds, supremeFamiliarId],
  );
  const supremeCount = familiars.some((f) => f.id === supremeFamiliarId) ? 1 : 0;
  const summary = accessSummary(grantedFamiliars.length - supremeCount, supremeCount);
  const selectableIds = useMemo(
    () => familiars.filter((f) => f.id !== supremeFamiliarId).map((f) => f.id),
    [familiars, supremeFamiliarId],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const runBulk = async (action: BulkGrantAction) => {
    const ops = bulkGrantOps([...selected], grantedIds, supremeFamiliarId, action);
    if (ops.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    const byId = new Map(familiars.map((f) => [f.id, f.display_name] as const));
    await Promise.all(ops.map((op) => toggle(op.familiarId, byId.get(op.familiarId) ?? op.familiarId, op.next)));
    setBulkBusy(false);
  };

  const visible = capVisible(familiars, ACCESS_CAP, showAll);

  return (
    <DetailCard
      card="access"
      ariaLabel={`Familiar access to ${project.name}`}
      title="Access"
      headerExtras={
        grantedFamiliars.length > 0 ? (
          <span className="projects-access-stack" aria-hidden>
            {grantedFamiliars.slice(0, 5).map((familiar) => (
              <span key={familiar.id} className="projects-access-stack__item">
                <FamiliarAvatar familiar={familiar} size="sm" />
              </span>
            ))}
          </span>
        ) : null
      }
      summary={summary}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="min-w-0 flex-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Grant familiars access to this project&apos;s folder so they can work in it.
        </span>
        {selectableIds.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSelected(nextSelectAll(selectableIds, selected))}
            className="shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            {allSelected ? "Select none" : "Select all"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-1 text-[length:var(--text-xs)] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {selected.size > 0 ? (
        <div className="projects-access-bulk" role="toolbar" aria-label="Bulk access actions">
          <span className="projects-access-bulk__count">{selected.size} selected</span>
          <span className="flex-1" />
          <Button variant="ghost" size="xs" disabled={bulkBusy} onClick={() => void runBulk("grant")} className="px-1.5 py-0.5 text-[length:var(--text-xs)]">
            Grant access
          </Button>
          <Button variant="ghost" size="xs" disabled={bulkBusy} onClick={() => void runBulk("revoke")} className="px-1.5 py-0.5 text-[length:var(--text-xs)]">
            Revoke
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSelected(new Set())}
            className="px-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)]"
          >
            Clear
          </Button>
        </div>
      ) : null}
      {!loaded ? (
        <p className="px-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">Loading access…</p>
      ) : familiars.length === 0 ? (
        <div className="projects-detail-empty">No familiars yet.</div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-px p-0">
            {visible.map((familiar) => {
              const isSupremeFamiliar = familiar.id === supremeFamiliarId;
              const has = isSupremeFamiliar || grantedIds.has(familiar.id);
              const busy = pendingIds.has(familiar.id);
              const isSelected = selected.has(familiar.id);
              const toggleSelect = () => {
                if (isSupremeFamiliar) return;
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(familiar.id)) next.delete(familiar.id);
                  else next.add(familiar.id);
                  return next;
                });
              };
              return (
                <li key={familiar.id} className="m-0 list-none p-0">
                  <div className="projects-access-row" data-selected={isSelected ? "true" : undefined}>
                    {isSupremeFamiliar ? (
                      <span className="projects-access-row__check" aria-hidden />
                    ) : (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Select ${familiar.display_name}`}
                        onClick={toggleSelect}
                        className="projects-access-row__check focus-ring"
                        data-checked={isSelected ? "true" : undefined}
                      >
                        {isSelected ? <Icon name="ph:check-bold" width={9} aria-hidden /> : null}
                      </button>
                    )}
                    <FamiliarAvatar familiar={familiar} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
                      {familiar.display_name}
                    </span>
                    {isSupremeFamiliar ? (
                      <span
                        className="shrink-0 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]"
                        title={`${familiar.display_name} is the supreme familiar — access to every project`}
                      >
                        always
                      </span>
                    ) : (
                      // The grant model is binary (a familiar holds the grant
                      // or it doesn't) — the segmented control mirrors exactly
                      // that, no invented permission levels.
                      <span className="projects-access-seg" role="group" aria-label={`Access for ${familiar.display_name}`}>
                        <button
                          type="button"
                          aria-pressed={!has}
                          disabled={busy}
                          onClick={() => {
                            if (has) void toggle(familiar.id, familiar.display_name, false);
                          }}
                          title={has ? `Revoke ${project.name} from ${familiar.display_name}` : "No access"}
                          className="projects-access-seg__btn focus-ring"
                        >
                          None
                        </button>
                        <button
                          type="button"
                          aria-pressed={has}
                          disabled={busy}
                          onClick={() => {
                            if (!has) void toggle(familiar.id, familiar.display_name, true);
                          }}
                          title={has ? "Access granted" : `Grant ${project.name} to ${familiar.display_name}`}
                          className="projects-access-seg__btn focus-ring"
                        >
                          Granted
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <ShowMoreButton
            total={familiars.length}
            cap={ACCESS_CAP}
            expanded={showAll}
            noun="familiars"
            onToggle={() => setShowAll((value) => !value)}
          />
        </>
      )}
    </DetailCard>
  );
}
