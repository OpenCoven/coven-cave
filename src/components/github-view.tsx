"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  GitHubActionPopover,
  type PopoverMode,
} from "@/components/github-action-popover";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivityResult = {
  ok: true;
  authed: boolean;
  login: string | null;
  items: GitHubItem[];
  rateLimit: { remaining: number; limit: number } | null;
};

type PatStatus = { hasPat: boolean; login: string | null };

type Filter = "all" | "pr" | "review_request" | "issue";

type SortKey = "kind" | "repo" | "title" | "tasks" | "updatedAt";
type SortDir = "asc" | "desc";

type GroupBy = "none" | "org" | "repo";

/** `item.repo` is "owner/name" — the organization is the slash prefix. */
function orgOf(repo: string): string {
  const i = repo.indexOf("/");
  return i === -1 ? repo : repo.slice(0, i);
}

type Props = {
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard?: (cardId: string) => void;
};

// ── Data hooks ─────────────────────────────────────────────────────────────────

function useFamiliars(): Familiar[] {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  useEffect(() => {
    fetch("/api/familiars")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && Array.isArray(data.familiars)) {
          setFamiliars(data.familiars as Familiar[]);
        }
      })
      .catch(() => {});
  }, []);
  return familiars;
}

function useCards(): { cards: Card[]; reload: () => void } {
  const [cards, setCards] = useState<Card[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/board")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.cards)) {
          setCards(data.cards as Card[]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tick]);
  return { cards, reload: () => setTick((t) => t + 1) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = Math.round(s / 86400);
  return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`;
}

const KIND_ICON: Record<string, "ph:git-pull-request" | "ph:circle-dashed" | "ph:bell" | "ph:github-logo"> = {
  pr: "ph:git-pull-request",
  issue: "ph:circle-dashed",
  review_request: "ph:git-pull-request",
  notification: "ph:bell",
};

const KIND_LABEL: Record<string, string> = {
  pr: "PR",
  issue: "Issue",
  review_request: "Review",
  notification: "Notif",
};

const KIND_DETAIL_LABEL: Record<string, string> = {
  pr: "Pull request",
  issue: "Issue",
  review_request: "Review request",
  notification: "Notification",
};

const KIND_COLOR: Record<string, string> = {
  pr: "var(--color-success)",
  issue: "var(--accent-presence)",
  review_request: "var(--color-warning)",
  notification: "var(--text-muted)",
};

const KIND_ORDER: Record<string, number> = {
  review_request: 0,
  pr: 1,
  issue: 2,
  notification: 3,
};

const STATUS_DOT_COLOR: Record<CardStatus, string> = {
  backlog: "var(--text-muted)",
  inbox: "var(--accent-presence)",
  running: "var(--color-warning)",
  review: "var(--color-warning)",
  blocked: "var(--color-danger)",
  done: "var(--color-success)",
};

function linkedCardsForItem(cards: Card[], item: GitHubItem): Card[] {
  const url = item.url.trim().toLowerCase();
  const id = item.id.trim().toLowerCase();
  return cards.filter((c) =>
    (c.github ?? []).some(
      (g) =>
        g.url.trim().toLowerCase() === url ||
        (id && g.id.trim().toLowerCase() === id),
    ),
  );
}

// ── PAT Setup Modal ───────────────────────────────────────────────────────────

function PatSetupModal({
  onSaved,
  onClose,
  username,
}: {
  onSaved: (login: string, hasPat: boolean) => void;
  onClose: () => void;
  username: string | null;
}) {
  const [pat, setPat] = useState("");
  const [usernameInput, setUsernameInput] = useState(username ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Trap Tab/Shift+Tab inside the modal and close on Escape. focusFirst is off
  // so the username input's focus effect above keeps the initial focus.
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  async function save() {
    const trimmedPat = pat.trim();
    const trimmedUser = usernameInput.trim();

    if (!trimmedPat && !trimmedUser) {
      setError("Enter a GitHub username (for public data) or a PAT (for private data).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (trimmedPat) body.pat = trimmedPat;
      if (trimmedUser) body.username = trimmedUser;

      const res = await fetch("/api/github/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Failed to save. Check that your PAT has read:user and repo scopes.");
        return;
      }
      onSaved(data.login ?? trimmedUser, !!trimmedPat);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-pat-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Icon name="ph:github-logo" width={18} className="text-[var(--text-secondary)]" />
            <h3 id="github-pat-modal-title" className="text-[15px] font-semibold">Connect GitHub</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Icon name="ph:x" width={14} />
          </button>
        </div>

        <p className="text-[12px] text-[var(--text-muted)] mb-1">
          Enter your GitHub username to pull live public data (free, no auth needed).
        </p>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          Optionally add a Personal Access Token to unlock private repos and review requests.
          Your PAT is stored only on this machine — never synced, never shared.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="mb-3">
            <label htmlFor="gh-pat-username" className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">
              GitHub username
            </label>
            <input
              id="gh-pat-username"
              ref={inputRef}
              type="text"
              name="username"
              autoComplete="username"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="your-username"
              className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] focus:outline-none"
            />
          </div>

          <div className="mb-2">
            <label htmlFor="gh-pat-token" className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">
              Personal Access Token <span className="font-normal text-[var(--text-muted)]">(optional — for private repos)</span>
            </label>
            <input
              id="gh-pat-token"
              type="password"
              name="github-pat"
              autoComplete="off"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="ghp_…"
              className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] focus:outline-none"
            />
          </div>

          {error && (
            <p className="mb-3 text-[11px] text-[var(--color-danger)]">{error}</p>
          )}

          <div className="flex items-center justify-between mt-4">
            <a
              href="https://github.com/settings/tokens/new?scopes=read:user,repo,notifications&description=Cave+local"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[var(--accent-presence)] hover:underline"
            >
              Generate a PAT on GitHub →
            </a>
            <button
              type="submit"
              disabled={!pat.trim() || saving}
              className="rounded-lg bg-[var(--accent-presence)] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saving ? "Verifying…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Linked-task chip ──────────────────────────────────────────────────────────

function LinkedTaskChip({
  card,
  familiar,
  onFocusCard,
}: {
  card: Card;
  familiar: { id: string; display_name: string } | null;
  onFocusCard?: (cardId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onFocusCard?.(card.id);
      }}
      title={`${card.title}${familiar ? ` · ${familiar.display_name}` : ""}${card.sessionId ? " · chat linked" : ""}`}
      className="gh-task-chip"
    >
      <span
        className="gh-task-chip-dot"
        style={{ background: STATUS_DOT_COLOR[card.status] }}
        aria-hidden
      />
      <span className="gh-task-chip-title">{card.title}</span>
      {card.sessionId && (
        <Icon name="ph:chat-circle-dots" width={9} className="gh-task-chip-chat" />
      )}
    </button>
  );
}

// ── Open-chat action ──────────────────────────────────────────────────────────

function OpenChatAction({
  item,
  linkedCards,
  familiars,
  cards,
  onJumpToSession,
  onAfterLink,
}: {
  item: GitHubItem;
  linkedCards: Card[];
  familiars: Familiar[];
  cards: Card[];
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
  onAfterLink: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close the multi-card picker on outside click / Escape
  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 30);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  async function openChatForCard(cardId: string) {
    const target = cards.find((c) => c.id === cardId);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/${cardId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: target?.familiarId ?? null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to open chat");
        return;
      }
      onAfterLink();
      onJumpToSession?.(json.sessionId as string, json.familiarId as string | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    if (linkedCards.length === 0) {
      setPopoverOpen(true);
      return;
    }
    if (linkedCards.length === 1) {
      void openChatForCard(linkedCards[0].id);
      return;
    }
    setPickerOpen((v) => !v);
  }

  const label =
    linkedCards.length === 0
      ? "Start"
      : linkedCards.length === 1
        ? "Open"
        : `Open (${linkedCards.length})`;
  const title = linkedCards.length === 0 ? "Start chat" : "Open chat";

  return (
    <div className="gh-action-wrap">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={title}
        className="gh-action-btn"
      >
        <Icon name="ph:chat-circle-dots" width={12} />
        <span className="gh-action-btn-label">{label}</span>
      </button>

      {error && <span className="gh-action-error" title={error}>!</span>}

      {pickerOpen && linkedCards.length > 1 && (
        <div ref={pickerRef} className="gh-action-popover" onClick={(e) => e.stopPropagation()}>
          <p className="gh-action-popover-title">Open chat for…</p>
          <ul className="gh-action-popover-list">
            {linkedCards.map((c) => {
              const f = familiars.find((x) => x.id === c.familiarId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openChatForCard(c.id)}
                    disabled={busy}
                    className="gh-action-popover-item"
                  >
                    <span
                      className="gh-task-chip-dot"
                      style={{ background: STATUS_DOT_COLOR[c.status] }}
                      aria-hidden
                    />
                    <span className="gh-action-popover-item-title">{c.title}</span>
                    {f && (
                      <span className="gh-action-popover-item-familiar">
                        {f.display_name}
                      </span>
                    )}
                    {c.sessionId && (
                      <Icon name="ph:chat-circle-dots" width={10} className="gh-task-chip-chat" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {popoverOpen && (
        <div className="gh-action-popover gh-action-popover--wide" onClick={(e) => e.stopPropagation()}>
          <GitHubActionPopover
            mode="chat"
            item={item}
            familiars={familiars}
            cards={cards}
            onClose={() => setPopoverOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Add-to-board action ───────────────────────────────────────────────────────

function AddToBoardAction({
  item,
  familiars,
  cards,
  onAfterLink,
}: {
  item: GitHubItem;
  familiars: Familiar[];
  cards: Card[];
  onAfterLink: () => void;
}) {
  const [mode, setMode] = useState<PopoverMode | null>(null);

  function open(m: PopoverMode, e: React.MouseEvent) {
    e.stopPropagation();
    setMode(m);
  }
  function close() {
    setMode(null);
    onAfterLink();
  }

  return (
    <div className="gh-action-wrap">
      <button
        type="button"
        onClick={(e) => open("board", e)}
        title="Add to task"
        className="gh-action-btn"
      >
        <Icon name="ph:kanban" width={12} />
        <span className="gh-action-btn-label">Task</span>
      </button>
      {mode && (
        <div className="gh-action-popover gh-action-popover--wide" onClick={(e) => e.stopPropagation()}>
          <GitHubActionPopover
            mode={mode}
            item={item}
            familiars={familiars}
            cards={cards}
            onClose={close}
          />
        </div>
      )}
    </div>
  );
}

// ── Selected item detail ─────────────────────────────────────────────────────

function GitHubItemGlassPanel({
  item,
  linkedCards,
  familiars,
  resolvedById,
  cards,
  counts,
  onJumpToSession,
  onFocusCard,
  onAfterLink,
}: {
  item: GitHubItem | null;
  linkedCards: Card[];
  familiars: Familiar[];
  resolvedById: Map<string, ResolvedFamiliar>;
  cards: Card[];
  counts: Record<Filter, number>;
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard?: (cardId: string) => void;
  onAfterLink: () => void;
}) {
  if (!item) {
    return (
      <aside className="gh-glass-panel gh-glass-panel--empty" aria-label="GitHub item details">
        <Icon name="ph:git-pull-request" width={24} />
        <p>Select a GitHub item to inspect its key details.</p>
      </aside>
    );
  }

  const rowFamiliars = Array.from(
    new Set(
      linkedCards
        .map((card) => card.familiarId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const kindColor = KIND_COLOR[item.kind] ?? "var(--text-muted)";
  const detailLabel = KIND_DETAIL_LABEL[item.kind] ?? item.kind;

  return (
    <aside className="gh-glass-panel" aria-label={`${detailLabel} details`}>
      <div className="gh-glass-aura" aria-hidden />

      <div className="gh-glass-stat-grid" aria-label="GitHub activity counts">
        <div className="gh-glass-stat">
          <span>PRs</span>
          <strong>{counts.pr}</strong>
        </div>
        <div className="gh-glass-stat">
          <span>Reviews</span>
          <strong>{counts.review_request}</strong>
        </div>
        <div className="gh-glass-stat">
          <span>Issues</span>
          <strong>{counts.issue}</strong>
        </div>
      </div>

      <div className="gh-glass-hero">
        <span className="gh-glass-kind" style={{ color: kindColor }}>
          <Icon name={KIND_ICON[item.kind] ?? "ph:github-logo"} width={15} />
          {detailLabel}
        </span>
        <h3>{item.title}</h3>
        <div className="gh-glass-meta">
          <span>{item.repo}</span>
          {item.number != null && <span>#{item.number}</span>}
          <span>{item.state ?? "open"}</span>
          <span>{relTime(item.updatedAt)} ago</span>
        </div>
      </div>

      <div className="gh-glass-section">
        <div className="gh-glass-section-title">Key information</div>
        <dl className="gh-glass-facts">
          <div>
            <dt>Repository</dt>
            <dd>{item.repo}</dd>
          </div>
          <div>
            <dt>Number</dt>
            <dd>{item.number != null ? `#${item.number}` : "Unnumbered"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{item.draft ? "Draft" : item.state ?? "Open"}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <div className="gh-glass-section">
        <div className="gh-glass-section-title">Labels</div>
        {item.labels && item.labels.length > 0 ? (
          <div className="gh-glass-labels">
            {item.labels.slice(0, 6).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        ) : (
          <p className="gh-glass-muted">No labels on this item.</p>
        )}
      </div>

      <div className="gh-glass-section">
        <div className="gh-glass-section-title">Linked work</div>
        {linkedCards.length > 0 ? (
          <div className="gh-glass-linked">
            {linkedCards.slice(0, 4).map((card) => (
              <LinkedTaskChip
                key={card.id}
                card={card}
                familiar={
                  card.familiarId
                    ? familiars.find((familiar) => familiar.id === card.familiarId) ?? null
                    : null
                }
                onFocusCard={onFocusCard}
              />
            ))}
          </div>
        ) : (
          <p className="gh-glass-muted">No Cave tasks linked yet.</p>
        )}

        {rowFamiliars.length > 0 && (
          <div className="gh-glass-familiars" aria-label="Linked familiars">
            {rowFamiliars.slice(0, 5).map((familiarId) => {
              const familiar = resolvedById.get(familiarId);
              if (!familiar) return null;
              return (
                <span key={familiarId} title={familiar.display_name}>
                  <FamiliarAvatar familiar={familiar} size="sm" />
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="gh-glass-actions">
        <OpenChatAction
          item={item}
          linkedCards={linkedCards}
          familiars={familiars}
          cards={cards}
          onJumpToSession={onJumpToSession}
          onAfterLink={onAfterLink}
        />
        <AddToBoardAction
          item={item}
          familiars={familiars}
          cards={cards}
          onAfterLink={onAfterLink}
        />
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="gh-action-btn"
        >
          <Icon name="ph:arrow-square-out" width={12} />
          <span className="gh-action-btn-label">GitHub</span>
        </a>
      </div>
    </aside>
  );
}

// ── Sortable header ───────────────────────────────────────────────────────────

type ColDef = { key: SortKey | null; label: string; width?: string; align?: "left" | "right" };
const COLS: ColDef[] = [
  { key: "kind", label: "Kind", width: "82px" },
  { key: "repo", label: "Repo", width: "180px" },
  { key: "title", label: "Title" },
  { key: "tasks", label: "Tasks", width: "240px" },
  { key: null, label: "Familiars", width: "92px" },
  { key: "updatedAt", label: "Updated", width: "80px", align: "right" },
  { key: null, label: "", width: "210px", align: "right" },
];

// ── Main component ────────────────────────────────────────────────────────────

export function GitHubView({ onJumpToSession, onFocusCard }: Props = {}) {
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [patStatus, setPatStatus] = useState<PatStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [showPatModal, setShowPatModal] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const familiars = useFamiliars();
  const { cards, reload: reloadCards } = useCards();
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });
  const resolvedById = useMemo(
    () => new Map(resolvedFamiliars.map((f) => [f.id, f])),
    [resolvedFamiliars],
  );

  async function fetchPatStatus() {
    try {
      const res = await fetch("/api/github/pat");
      const data = await res.json().catch(() => null);
      if (data) setPatStatus(data as PatStatus);
    } catch { /* non-fatal */ }
  }

  async function fetchActivity(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/activity");
      const data = await res.json().catch(() => null);

      if (res.status === 401 && data?.error === "no_user") {
        setError("no_user");
        setLoading(false);
        return;
      }

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `GitHub error (${res.status})`);
        setLoading(false);
        timerRef.current = window.setTimeout(() => void fetchActivity(true), 60_000);
        return;
      }

      setActivity(data as ActivityResult);
      setError(null);
      const interval = (data as ActivityResult).authed ? 90_000 : 120_000;
      timerRef.current = window.setTimeout(() => void fetchActivity(true), interval);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load GitHub activity");
      timerRef.current = window.setTimeout(() => void fetchActivity(true), 60_000);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPatStatus();
    void fetchActivity();
    return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "r" && e.key !== "R") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void fetchActivity();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = activity?.items ?? [];
  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);

  // Organization options come from the kind-filtered set; repository options
  // narrow to the chosen org so the two selects cascade (org → repo).
  const orgOptions = useMemo(
    () => Array.from(new Set(filtered.map((i) => orgOf(i.repo)))).sort((a, b) => a.localeCompare(b)),
    [filtered],
  );
  const repoOptions = useMemo(() => {
    const base = orgFilter === "all" ? filtered : filtered.filter((i) => orgOf(i.repo) === orgFilter);
    return Array.from(new Set(base.map((i) => i.repo))).sort((a, b) => a.localeCompare(b));
  }, [filtered, orgFilter]);

  // Drop a stale org/repo selection when the underlying options change (e.g.
  // the kind filter or org filter removed the previously-selected value).
  useEffect(() => {
    if (orgFilter !== "all" && !orgOptions.includes(orgFilter)) setOrgFilter("all");
  }, [orgOptions, orgFilter]);
  useEffect(() => {
    if (repoFilter !== "all" && !repoOptions.includes(repoFilter)) setRepoFilter("all");
  }, [repoOptions, repoFilter]);
  // Selecting a repo pins the Org filter to that repo's org (the Org select is
  // disabled while a repo is chosen — clearing the repo re-enables it).
  useEffect(() => {
    if (repoFilter === "all") return;
    const org = orgOf(repoFilter);
    if (orgFilter !== org) setOrgFilter(org);
  }, [repoFilter, orgFilter]);

  const scoped = useMemo(
    () =>
      filtered.filter(
        (i) =>
          (orgFilter === "all" || orgOf(i.repo) === orgFilter) &&
          (repoFilter === "all" || i.repo === repoFilter),
      ),
    [filtered, orgFilter, repoFilter],
  );

  const linkedMap = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const item of scoped) {
      m.set(item.id, linkedCardsForItem(cards, item));
    }
    return m;
  }, [scoped, cards]);

  const sorted = useMemo(() => {
    const arr = [...scoped];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "kind":
          cmp = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
          break;
        case "repo": {
          const ra = `${a.repo}#${a.number ?? 0}`;
          const rb = `${b.repo}#${b.number ?? 0}`;
          cmp = ra.localeCompare(rb);
          break;
        }
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "tasks": {
          const la = linkedMap.get(a.id)?.length ?? 0;
          const lb = linkedMap.get(b.id)?.length ?? 0;
          cmp = la - lb;
          break;
        }
        case "updatedAt":
          cmp = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [scoped, sortKey, sortDir, linkedMap]);

  // When grouping is on, bucket the already-sorted rows by org or full repo.
  // Map insertion order follows the sort, so groups appear in sorted order too.
  const grouped = useMemo(() => {
    if (groupBy === "none") return null;
    const m = new Map<string, GitHubItem[]>();
    for (const item of sorted) {
      const key = groupBy === "org" ? orgOf(item.repo) : item.repo;
      const bucket = m.get(key);
      if (bucket) bucket.push(item);
      else m.set(key, [item]);
    }
    return Array.from(m.entries());
  }, [sorted, groupBy]);

  const counts: Record<Filter, number> = {
    all: items.length,
    pr: items.filter((i) => i.kind === "pr").length,
    review_request: items.filter((i) => i.kind === "review_request").length,
    issue: items.filter((i) => i.kind === "issue").length,
  };

  useEffect(() => {
    if (sorted.length === 0) {
      if (selectedItemId !== null) setSelectedItemId(null);
      return;
    }
    if (!selectedItemId || !sorted.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(sorted[0].id);
    }
  }, [sorted, selectedItemId]);

  const selectedItem = useMemo(
    () => sorted.find((item) => item.id === selectedItemId) ?? sorted[0] ?? null,
    [sorted, selectedItemId],
  );
  const selectedLinkedCards = selectedItem ? linkedMap.get(selectedItem.id) ?? [] : [];

  function handleSortClick(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "updatedAt" || key === "tasks" ? "desc" : "asc"); }
  }

  return (
    <section className="github-surface flex h-full flex-col text-[var(--text-primary)]">

      {showPatModal && (
        <PatSetupModal
          username={patStatus?.login ?? null}
          onSaved={(login, hasPat) => {
            setPatStatus({ hasPat, login });
            setShowPatModal(false);
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            void fetchActivity();
          }}
          onClose={() => setShowPatModal(false)}
        />
      )}

      {/* ── Header ── */}
      <header className="github-surface-header flex items-center gap-3 px-5 py-2">
        <div className="flex items-center gap-2">
          {activity?.login && (
            <span className="text-[12px] text-[var(--text-secondary)]">@{activity.login}</span>
          )}
        </div>

        {activity?.authed === false && (
          <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            public API
          </span>
        )}
        {activity?.authed === true && (
          <span className="rounded-full border border-[color-mix(in_oklch,var(--color-success)_55%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_40%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-success)]">
            authenticated
          </span>
        )}

        {activity?.rateLimit && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {activity.rateLimit.remaining}/{activity.rateLimit.limit} req left
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPatModal(true)}
            title={patStatus?.hasPat ? "Manage GitHub PAT" : "Connect GitHub PAT"}
            aria-label={patStatus?.hasPat ? "GitHub PAT connected — manage" : "Connect GitHub PAT"}
            className={`flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors ${patStatus?.hasPat ? "px-1.5" : "px-2"}`}
          >
            <Icon name="ph:key" width={11} />
            {patStatus?.hasPat ? null : "Add PAT"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (timerRef.current !== null) window.clearTimeout(timerRef.current);
              void fetchActivity();
              reloadCards();
            }}
            title="Refresh (⌘R)"
            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            <Icon name="ph:arrows-clockwise" width={13} />
          </button>
        </div>
      </header>

      {/* ── Filter tabs ── */}
      <div className="github-surface-controls flex items-center gap-1 px-4 py-2">
        {(["all", "pr", "review_request", "issue"] as Filter[]).map((f) => {
          const labels: Record<Filter, string> = { all: "All", pr: "PRs", review_request: "Reviews", issue: "Issues" };
          const isActive = filter === f;
          const count = counts[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors",
                isActive
                  ? "bg-[var(--bg-raised)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
              ].join(" ")}
            >
              {labels[f]}
              {count > 0 && (
                <span className={`rounded-full px-1 py-0.5 text-[9px] leading-none ${
                  isActive ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]" : "bg-[var(--bg-raised)] text-[var(--text-muted)]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <select
            className="gh-select"
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            title={repoFilter !== "all" ? "Org is locked to the selected repo — clear the repo to change it" : "Filter by organization"}
            aria-label="Filter by organization"
            disabled={orgOptions.length === 0 || repoFilter !== "all"}
          >
            <option value="all">All orgs</option>
            {orgOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            className="gh-select"
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            title="Filter by repository"
            aria-label="Filter by repository"
            disabled={repoOptions.length === 0}
          >
            <option value="all">All repos</option>
            {repoOptions.map((r) => (
              <option key={r} value={r}>{orgFilter === "all" ? r : (r.split("/")[1] ?? r)}</option>
            ))}
          </select>
          <span className="gh-select-sep" aria-hidden />
          <div className="flex items-center gap-1" role="group" aria-label="Group rows">
            {(["none", "org", "repo"] as GroupBy[]).map((g) => {
              const labels: Record<GroupBy, string> = { none: "None", org: "Org", repo: "Repo" };
              const isActive = groupBy === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  aria-pressed={isActive}
                  title={g === "none" ? "No grouping" : `Group by ${g}`}
                  className={[
                    "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                    isActive
                      ? "bg-[var(--bg-raised)] text-[var(--text-primary)] font-medium"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  {labels[g]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">

        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-[12px] text-[var(--text-muted)]">Loading…</span>
          </div>

        ) : error === "no_user" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Icon name="ph:github-logo" width={28} className="text-[var(--text-muted)]" />
            <div>
              <p className="text-[14px] font-medium text-[var(--text-primary)] mb-1">Connect your GitHub account</p>
              <p className="text-[12px] text-[var(--text-muted)] max-w-xs">
                Cave uses the public GitHub API (no auth needed) or your own PAT for private repos and reviews.
              </p>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <button
                type="button"
                onClick={() => setShowPatModal(true)}
                className="rounded-lg bg-[var(--accent-presence)] px-5 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity"
              >
                Set up GitHub
              </button>
            </div>
          </div>

        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-[12px] text-[var(--color-danger)]">{error}</p>
            <button
              type="button"
              onClick={() => void fetchActivity()}
              className="text-[11px] text-[var(--accent-presence)] hover:underline"
            >
              Retry
            </button>
          </div>

        ) : sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="ph:check-circle" width={22} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-muted)]">
              {filter === "all" ? "Nothing open right now." : `No open ${filter === "review_request" ? "review requests" : filter + "s"}.`}
            </p>
          </div>

        ) : (
          <div className="gh-workspace">
            <div className="board-table-wrap gh-list-panel">
              <table className="board-table gh-table">
                <thead>
                  <tr>
                    {COLS.map((col, i) => (
                      <th
                        key={`${col.label}-${i}`}
                        style={{
                          width: col.width,
                          textAlign: col.align ?? "left",
                          cursor: col.key ? "pointer" : "default",
                        }}
                        className={col.key && sortKey === col.key ? "sorted" : ""}
                        onClick={() => col.key && handleSortClick(col.key)}
                      >
                        {col.label}
                        {col.key && (
                          <span className="board-table-sort-icon">
                            {sortKey === col.key
                              ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                              : <Icon name="ph:caret-up-down" width={9} />}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const renderRow = (item: GitHubItem) => {
                  const linked = linkedMap.get(item.id) ?? [];
                  const familiarsForRow = Array.from(
                    new Set(
                      linked
                        .map((c) => c.familiarId)
                        .filter((id): id is string => Boolean(id)),
                    ),
                  );
                  return (
                    <tr
                      key={item.id}
                      className={`gh-row${selectedItem?.id === item.id ? " is-selected" : ""}`}
                      onClick={() => setSelectedItemId(item.id)}
                      aria-selected={selectedItem?.id === item.id}
                    >
                      <td>
                        <span className="gh-kind" style={{ color: KIND_COLOR[item.kind] }}>
                          <Icon
                            name={KIND_ICON[item.kind] ?? "ph:github-logo"}
                            width={12}
                          />
                          <span>{KIND_LABEL[item.kind] ?? item.kind}</span>
                        </span>
                      </td>
                      <td>
                        <span className="gh-repo" title={item.repo}>
                          {item.repo}
                          {item.number != null && (
                            <span className="gh-repo-number">#{item.number}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="gh-title"
                          onClick={(e) => e.stopPropagation()}
                          title={item.title}
                        >
                          {item.title}
                        </a>
                        {item.draft && (
                          <span className="gh-badge gh-badge--muted">draft</span>
                        )}
                        {item.labels?.slice(0, 2).map((l) => (
                          <span key={l} className="gh-badge gh-badge--label" title={l}>
                            {l}
                          </span>
                        ))}
                      </td>
                      <td>
                        {linked.length === 0 ? (
                          <span className="gh-empty-cell">—</span>
                        ) : (
                          <div className="gh-task-chip-list">
                            {linked.slice(0, 3).map((c) => (
                              <LinkedTaskChip
                                key={c.id}
                                card={c}
                                familiar={
                                  c.familiarId
                                    ? familiars.find((f) => f.id === c.familiarId) ?? null
                                    : null
                                }
                                onFocusCard={onFocusCard}
                              />
                            ))}
                            {linked.length > 3 && (
                              <span className="gh-task-chip-more">+{linked.length - 3}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {familiarsForRow.length === 0 ? (
                          <span className="gh-empty-cell">—</span>
                        ) : (
                          <div className="gh-familiar-stack">
                            {familiarsForRow.slice(0, 3).map((fid) => {
                              const f = resolvedById.get(fid);
                              if (!f) return null;
                              return (
                                <span key={fid} className="gh-familiar-stack-item" title={f.display_name}>
                                  <FamiliarAvatar familiar={f} size="sm" />
                                </span>
                              );
                            })}
                            {familiarsForRow.length > 3 && (
                              <span className="gh-familiar-stack-more">+{familiarsForRow.length - 3}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="board-table-cell-time">{relTime(item.updatedAt)}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="gh-actions">
                          <OpenChatAction
                            item={item}
                            linkedCards={linked}
                            familiars={familiars}
                            cards={cards}
                            onJumpToSession={onJumpToSession}
                            onAfterLink={reloadCards}
                          />
                          <AddToBoardAction
                            item={item}
                            familiars={familiars}
                            cards={cards}
                            onAfterLink={reloadCards}
                          />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open on GitHub"
                            className="gh-action-btn gh-action-btn--icon"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Icon name="ph:arrow-square-out" width={11} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                  };
                    return grouped
                      ? grouped.flatMap(([key, rows]) => [
                          <tr key={`grp:${key}`} className="gh-group-row">
                            <td colSpan={COLS.length}>
                              <span className="gh-group-label">
                                <Icon
                                  name={groupBy === "org" ? "ph:folders-bold" : "ph:git-branch-bold"}
                                  width={11}
                                />
                                <span className="gh-group-name">{key}</span>
                                <span className="gh-group-count">{rows.length}</span>
                              </span>
                            </td>
                          </tr>,
                          ...rows.map(renderRow),
                        ])
                      : sorted.map(renderRow);
                  })()}
                </tbody>
              </table>
            </div>
            <GitHubItemGlassPanel
              item={selectedItem}
              linkedCards={selectedLinkedCards}
              familiars={familiars}
              resolvedById={resolvedById}
              cards={cards}
              counts={counts}
              onJumpToSession={onJumpToSession}
              onFocusCard={onFocusCard}
              onAfterLink={reloadCards}
            />
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="github-surface-footer shrink-0 px-5 py-1.5 text-[10px] text-[var(--text-muted)] flex items-center justify-between gap-3">
        <span>⌘R refresh · click a row to inspect · open icon launches GitHub</span>
        <span className="inline-flex items-center gap-3">
          {activity?.rateLimit && activity.rateLimit.remaining < 10 && (
            <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
              <Icon name="ph:warning-fill" width={12} aria-hidden />
              {activity.rateLimit.remaining} requests remaining
            </span>
          )}
          {activity && (
            <span>
              {activity.authed
                ? "Authenticated — private repos included"
                : "Public API — add a PAT for private repos + review requests"}
            </span>
          )}
        </span>
      </footer>
    </section>
  );
}
