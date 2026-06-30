"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useCopy } from "@/lib/use-copy";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import { githubItemMatchesQuery } from "@/lib/github-search";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { MarkdownBlock } from "@/components/message-bubble";
import { DiffHunk } from "@/components/gh-diff-view";
import { gfmAutolink } from "@/lib/gfm-autolink";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  GitHubActionPopover,
  type PopoverMode,
} from "@/components/github-action-popover";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { openExternalUrl } from "@/lib/open-external";

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

const GITHUB_PAT_URL = "https://github.com/settings/tokens/new?scopes=read:user,repo,notifications&description=Cave+local";

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
            <button
              type="button"
              onClick={() => void openExternalUrl(GITHUB_PAT_URL)}
              className="border-0 bg-transparent p-0 text-[11px] text-[var(--accent-presence)] hover:underline"
            >
              Generate a PAT on GitHub →
            </button>
            <button
              type="submit"
              disabled={(!pat.trim() && !usernameInput.trim()) || saving}
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

      {error && <span className="gh-action-error" role="img" aria-label={`Error: ${error}`} title={error}>!</span>}

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

// ── Safe merge action ─────────────────────────────────────────────────────────

function SafeMergeAction({
  item,
  linkedCards,
  familiars,
  onJumpToSession,
}: {
  item: GitHubItem;
  linkedCards: Card[];
  familiars: Familiar[];
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (item.kind !== "pr" && item.kind !== "review_request") return null;

  const linkedCard = linkedCards.find((card) => card.cwd) ?? linkedCards[0] ?? null;
  const familiarId = linkedCard?.familiarId ?? familiars[0]?.id ?? null;

  async function startSafeMerge(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    let worktreeLine =
      "Worktree: no linked local project root was available; resolve the repo root before editing.";

    try {
      if (linkedCard?.cwd) {
        const res = await fetch("/api/github/worktree", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectRoot: linkedCard.cwd,
            kind: item.kind,
            number: item.number ?? null,
            title: item.title,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          worktree?: string;
          branch?: string;
          created?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `worktree HTTP ${res.status}`);
        }
        worktreeLine = `Worktree: ${json.worktree} (${json.created ? "created" : "reused"}). Branch: ${json.branch}.`;
      }

      const context = [
        `**Safely merge this PR: ${item.title}**`,
        `Repo: \`${item.repo}\`${item.number != null ? ` #${item.number}` : ""}`,
        `URL: ${item.url}`,
        worktreeLine,
        "",
        "Prefer the worktree path over switching branches in the shared checkout.",
        "Fetch latest refs, inspect the diff, verify mergeability, run the relevant checks, and only merge after verification evidence is clear.",
        "Use the repository's PR merge flow when available; do not push directly to main unless explicitly instructed.",
      ].join("\n");

      window.dispatchEvent(
        new CustomEvent("cave:agents-new-chat", {
          detail: { familiarId, context },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "safe merge setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gh-action-wrap">
      <button
        type="button"
        onClick={startSafeMerge}
        disabled={busy}
        title="Safely merge from a worktree"
        className="gh-action-btn"
      >
        <Icon name="ph:git-merge" width={12} />
        <span className="gh-action-btn-label">{busy ? "Prep…" : "Merge"}</span>
      </button>
      {error && <span className="gh-action-error" role="img" aria-label={`Error: ${error}`} title={error}>!</span>}
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

// ── Item detail (full issue/PR body, author, assignees, labels) ───────────────

type GitHubPerson = { login: string; avatarUrl: string | null; url: string | null };

type ItemDetail = {
  ok: true;
  title: string;
  number: number;
  state: string;
  isPull: boolean;
  merged: boolean;
  draft: boolean;
  body: string;
  author: GitHubPerson | null;
  assignees: GitHubPerson[];
  labels: { name: string; color: string }[];
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string | null;
  comments: number;
};

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; detail: ItemDetail }
  | { status: "error" };

/**
 * Fetches the full issue/PR detail (body, author, assignees, colored labels)
 * for the selected item so the panel can render a faithful GitHub issue view.
 * Re-fetches whenever the selected repo/number changes; in-flight responses for
 * a since-changed selection are dropped.
 */
function useGitHubItemDetail(item: GitHubItem | null): DetailState {
  const [state, setState] = useState<DetailState>({ status: "idle" });
  const repo = item?.repo ?? null;
  const number = item?.number ?? null;

  useEffect(() => {
    if (!repo || number == null) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/github/item?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) setState({ status: "ready", detail: data as ItemDetail });
        else setState({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => { cancelled = true; };
  }, [repo, number]);

  return state;
}

/** A tiny copy-to-clipboard affordance for the issue number. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(1200);
  return (
    <button
      type="button"
      className="gh-issue-copy"
      title={copied ? "Copied" : label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        copy(value);
      }}
    >
      <Icon name={copied ? "ph:check" : "ph:copy"} width={11} />
    </button>
  );
}

/** GitHub person avatar + login. Falls back to a monogram when no avatar. */
function PersonChip({ person, prefix }: { person: GitHubPerson; prefix?: string }) {
  return (
    <span className="gh-person">
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" className="gh-person-avatar" width={16} height={16} />
      ) : (
        <span className="gh-person-avatar gh-person-avatar--fallback" aria-hidden>
          {person.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="gh-person-login">{prefix}{person.login}</span>
    </span>
  );
}

// ── Comments + review threads (read · resolve · tag a familiar) ───────────────

type GhComment = {
  id: string;
  author: GitHubPerson | null;
  body: string;
  createdAt: string | null;
  url: string | null;
  authorAssociation: string | null;
};

type GhReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  diffHunk: string | null;
  comments: GhComment[];
};

type CommentsResult = {
  ok: true;
  authed: boolean;
  canResolve: boolean;
  issueComments: GhComment[];
  reviewThreads: GhReviewThread[];
};

type CommentsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CommentsResult }
  | { status: "error" };

/** Author chip + relative timestamp header shared by comments and threads. */
function CommentHeader({ comment }: { comment: GhComment }) {
  return (
    <div className="gh-comment-head">
      {comment.author ? (
        <PersonChip person={comment.author} />
      ) : (
        <span className="gh-person-login">ghost</span>
      )}
      {comment.authorAssociation && comment.authorAssociation !== "NONE" && (
        <span className="gh-comment-assoc">{comment.authorAssociation.toLowerCase()}</span>
      )}
      {comment.createdAt && (
        <RelativeTime iso={comment.createdAt} className="gh-comment-time" />
      )}
      {comment.url && (
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className="gh-comment-link"
          title="Open this comment on GitHub"
          aria-label="Open this comment on GitHub"
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="ph:arrow-square-out" width={11} />
        </a>
      )}
    </div>
  );
}

function CommentBody({ comment, repo }: { comment: GhComment; repo: string }) {
  return comment.body.trim() ? (
    <MarkdownBlock text={gfmAutolink(comment.body, { repo })} className="gh-comment-body" />
  ) : (
    <p className="gh-glass-muted gh-comment-body">No content.</p>
  );
}

/**
 * Reads the conversation timeline + inline PR review threads, resolves threads
 * (PAT only), and posts a reply with optional `@familiar` tagging. The whole
 * surface is reused verbatim by the native iOS app via the same API routes.
 */
function GitHubComments({
  item,
  detail,
  familiars,
}: {
  item: GitHubItem;
  detail: ItemDetail | null;
  familiars: Familiar[];
}) {
  const [state, setState] = useState<CommentsState>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [familiarPickerOpen, setFamiliarPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const repo = item.repo;
  const number = item.number ?? null;
  const isPull = detail?.isPull ?? (item.kind === "pr" || item.kind === "review_request");

  // Reset the composer when the selected item changes.
  useEffect(() => {
    setDraft("");
    setPostError(null);
    setFamiliarPickerOpen(false);
  }, [repo, number]);

  useEffect(() => {
    if (number == null) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(
      `/api/github/comments?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}${isPull ? "&isPull=1" : ""}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) setState({ status: "ready", data: data as CommentsResult });
        else setState({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, number, isPull, tick]);

  const data = state.status === "ready" ? state.data : null;
  const canResolve = data?.canResolve ?? false;
  const canComment = data?.authed ?? false;

  const threads = data?.reviewThreads ?? [];
  const unresolvedThreads = threads.filter((t) => !t.isResolved);
  const resolvedThreads = threads.filter((t) => t.isResolved);
  const visibleThreads = showResolved ? threads : unresolvedThreads;

  async function toggleResolve(thread: GhReviewThread) {
    if (!canResolve || state.status !== "ready") return;
    const next = !thread.isResolved;
    // Optimistic flip — revert on failure.
    setState({
      status: "ready",
      data: {
        ...state.data,
        reviewThreads: state.data.reviewThreads.map((t) =>
          t.id === thread.id ? { ...t, isResolved: next } : t,
        ),
      },
    });
    try {
      const res = await fetch("/api/github/resolve-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, resolved: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "failed");
    } catch {
      // Revert by refetching the authoritative state.
      setTick((n) => n + 1);
    }
  }

  function insertMention(familiar: Familiar) {
    const handle = (familiar.name ?? familiar.display_name).replace(/\s+/g, "-");
    const mention = `@${handle}`;
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => (d ? `${d} ${mention} ` : `${mention} `));
    } else {
      const start = el.selectionStart ?? draft.length;
      const end = el.selectionEnd ?? draft.length;
      const before = draft.slice(0, start);
      const after = draft.slice(end);
      const spacer = before && !before.endsWith(" ") ? " " : "";
      const next = `${before}${spacer}${mention} ${after}`;
      setDraft(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = before.length + spacer.length + mention.length + 1;
        el.setSelectionRange(pos, pos);
      });
    }
    setFamiliarPickerOpen(false);
  }

  async function postComment() {
    const text = draft.trim();
    if (!text || number == null || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch("/api/github/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, number, body: text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setPostError(json?.error === "auth_required" ? "Add a PAT to comment." : json?.error ?? "Failed to post.");
        return;
      }
      setDraft("");
      setTick((n) => n + 1);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : "Network error");
    } finally {
      setPosting(false);
    }
  }

  if (number == null) return null;

  const commentCount = data?.issueComments.length ?? detail?.comments ?? 0;

  return (
    <div className="gh-glass-section gh-comments">
      <div className="gh-glass-section-title gh-comments-title">
        <span>
          Conversation
          {commentCount > 0 && <span className="gh-comments-count">{commentCount}</span>}
        </span>
        {isPull && unresolvedThreads.length > 0 && (
          <span className="gh-comments-unresolved" title="Unresolved review threads">
            <Icon name="ph:chat-circle-dots" width={11} />
            {unresolvedThreads.length} unresolved
          </span>
        )}
      </div>

      {state.status === "loading" ? (
        <p className="gh-glass-muted">Loading the thread…</p>
      ) : state.status === "error" ? (
        <p className="gh-glass-muted">Couldn’t load comments — open on GitHub for the full thread.</p>
      ) : (
        <>
          {/* Inline PR review threads, unresolved first. */}
          {isPull && threads.length > 0 && (
            <div className="gh-threads">
              {resolvedThreads.length > 0 && (
                <button
                  type="button"
                  className="gh-threads-toggle"
                  onClick={() => setShowResolved((v) => !v)}
                  aria-pressed={showResolved}
                >
                  <Icon name={showResolved ? "ph:caret-up" : "ph:caret-down"} width={11} />
                  {showResolved
                    ? `Hide ${resolvedThreads.length} resolved`
                    : `Show ${resolvedThreads.length} resolved`}
                </button>
              )}
              {visibleThreads.map((thread) => (
                <div
                  key={thread.id}
                  className={`gh-thread${thread.isResolved ? " is-resolved" : ""}`}
                >
                  <div className="gh-thread-head">
                    {thread.path && (
                      <span className="gh-thread-path" title={thread.path}>
                        <Icon name="ph:file-code" width={11} />
                        {thread.path.split("/").pop()}
                      </span>
                    )}
                    {thread.isOutdated && <span className="gh-thread-badge">outdated</span>}
                    {thread.isResolved && (
                      <span className="gh-thread-badge gh-thread-badge--ok">
                        <Icon name="ph:check-circle" width={11} /> resolved
                      </span>
                    )}
                    {canResolve && (
                      <button
                        type="button"
                        className="gh-thread-resolve"
                        onClick={() => void toggleResolve(thread)}
                      >
                        {thread.isResolved ? "Unresolve" : "Resolve"}
                      </button>
                    )}
                  </div>
                  {thread.diffHunk && (
                    <DiffHunk hunk={thread.diffHunk} previewLines={4} className="gh-thread-diff" />
                  )}
                  {thread.comments.map((c) => (
                    <div key={c.id} className="gh-comment gh-comment--inline">
                      <CommentHeader comment={c} />
                      <CommentBody comment={c} repo={repo} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Conversation timeline. */}
          {data && data.issueComments.length > 0 ? (
            <div className="gh-comment-list">
              {data.issueComments.map((c) => (
                <div key={c.id} className="gh-comment">
                  <CommentHeader comment={c} />
                  <CommentBody comment={c} repo={repo} />
                </div>
              ))}
            </div>
          ) : (
            isPull && threads.length > 0 ? null : <p className="gh-glass-muted">No comments yet.</p>
          )}

          {/* Composer — read-only hint without a PAT. */}
          {canComment ? (
            <div className="gh-composer">
              <textarea
                ref={textareaRef}
                className="gh-composer-input"
                placeholder="Reply… use @ to tag a familiar"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void postComment();
                  }
                }}
                rows={2}
              />
              {postError && <p className="gh-composer-error">{postError}</p>}
              <div className="gh-composer-actions">
                <div className="gh-composer-tag">
                  <button
                    type="button"
                    className="gh-composer-tag-btn"
                    onClick={() => setFamiliarPickerOpen((v) => !v)}
                    aria-expanded={familiarPickerOpen}
                    title="Tag a familiar"
                    disabled={familiars.length === 0}
                  >
                    <Icon name="ph:at" width={12} />
                    Tag familiar
                  </button>
                  {familiarPickerOpen && (
                    <div className="gh-composer-tag-menu" role="menu">
                      {familiars.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="menuitem"
                          className="gh-composer-tag-item"
                          onClick={() => insertMention(f)}
                        >
                          <span
                            className="gh-task-chip-dot"
                            style={{ background: f.color ?? "var(--accent-presence)" }}
                            aria-hidden
                          />
                          {f.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="gh-composer-submit"
                  onClick={() => void postComment()}
                  disabled={!draft.trim() || posting}
                >
                  {posting ? "Posting…" : "Comment"}
                </button>
              </div>
            </div>
          ) : (
            <p className="gh-glass-muted gh-composer-hint">
              Add a PAT to reply and resolve review threads.
            </p>
          )}
        </>
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
  const detailState = useGitHubItemDetail(item);
  if (!item) {
    return (
      <aside className="gh-glass-panel gh-glass-panel--empty" aria-label="GitHub item details">
        <Icon name="ph:git-pull-request" width={24} />
        <p>Select a GitHub item to inspect its key details.</p>
      </aside>
    );
  }

  const detail = detailState.status === "ready" ? detailState.detail : null;
  const rawState = detail?.state ?? item.state ?? "open";
  const merged = detail?.merged ?? false;
  const stateKind = merged ? "merged" : rawState === "closed" ? "closed" : "open";
  const stateLabel = merged ? "Merged" : stateKind === "closed" ? "Closed" : "Open";
  const openedNoun =
    item.kind === "pr" || item.kind === "review_request" ? "pull request" : "issue";
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
      <div className="gh-glass-panel-scroll">
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
          <h3>{detail?.title ?? item.title}</h3>
          <div className="gh-issue-subline">
            {item.number != null && (
              <span className="gh-issue-number">
                #{item.number}
                <CopyButton value={`#${item.number}`} label={`Copy #${item.number}`} />
              </span>
            )}
            <span className={`gh-issue-state gh-issue-state--${stateKind}`} title={stateLabel}>
              <span className="gh-issue-state-dot" aria-hidden />
              {stateLabel}
            </span>
          </div>
          <div className="gh-issue-opened">
            {detail?.author && <PersonChip person={detail.author} />}
            <span className="gh-issue-opened-text">
              {detail?.author ? "opened this " : ""}
              {openedNoun}
              {" · "}
              {item.repo}
              {" · "}
              <RelativeTime iso={detail?.createdAt ?? item.updatedAt} />
            </span>
          </div>
        </div>

        <div className="gh-glass-section">
          <div className="gh-glass-section-title">Assignees</div>
          {detail?.assignees && detail.assignees.length > 0 ? (
            <div className="gh-issue-people">
              {detail.assignees.map((p) => (
                <PersonChip key={p.login} person={p} />
              ))}
            </div>
          ) : (
            <p className="gh-glass-muted">No one assigned.</p>
          )}
        </div>
        <div className="gh-glass-section">
          <div className="gh-glass-section-title">Description</div>
          {detailState.status === "loading" ? (
            <p className="gh-glass-muted">Loading description…</p>
          ) : detailState.status === "error" ? (
            <p className="gh-glass-muted">Couldn’t load the description — open on GitHub for the full thread.</p>
          ) : detail?.body?.trim() ? (
            <MarkdownBlock text={gfmAutolink(detail.body, { repo: item.repo })} className="gh-issue-body" />
          ) : (
            <p className="gh-glass-muted">No description provided.</p>
          )}
        </div>

        <GitHubComments item={item} detail={detail} familiars={familiars} />

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
                      ? resolvedById.get(card.familiarId) ?? null
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
          <SafeMergeAction
            item={item}
            linkedCards={linkedCards}
            familiars={familiars}
            onJumpToSession={onJumpToSession}
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
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [patStatus, setPatStatus] = useState<PatStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [showPatModal, setShowPatModal] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // Guards against setState after unmount from an in-flight fetch (mirrors useCards).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

  // Schedule the next poll, unless the tab is hidden — a backgrounded tab keeps
  // burning the GitHub rate limit for output nobody's looking at. The
  // visibilitychange effect refetches (and reschedules) on return.
  function schedulePoll(ms: number) {
    if (typeof document !== "undefined" && document.hidden) return;
    timerRef.current = window.setTimeout(() => void fetchActivity(true), ms);
  }

  async function fetchActivity(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/activity");
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;

      if (res.status === 401 && data?.error === "no_user") {
        setError("no_user");
        setLoading(false);
        return;
      }

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `GitHub error (${res.status})`);
        setLoading(false);
        schedulePoll(60_000);
        return;
      }

      setActivity(data as ActivityResult);
      setError(null);
      schedulePoll((data as ActivityResult).authed ? 90_000 : 120_000);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load GitHub activity");
      schedulePoll(60_000);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPatStatus();
    void fetchActivity();
    return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); };
  }, []);

  // Pause polling while the tab is hidden; refetch (and resume the chain) on
  // return so a backgrounded tab doesn't keep spending the rate limit.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      } else {
        void fetchActivity(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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
      reloadCards(); // keep the linked-task chips fresh too (parity with the toolbar refresh)
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = activity?.items ?? [];
  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

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
          (repoFilter === "all" || i.repo === repoFilter) &&
          githubItemMatchesQuery(i, query),
      ),
    [filtered, orgFilter, repoFilter, query],
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

  const counts: Record<Filter, number> = useMemo(
    () => ({
      all: items.length,
      pr: items.filter((i) => i.kind === "pr").length,
      review_request: items.filter((i) => i.kind === "review_request").length,
      issue: items.filter((i) => i.kind === "issue").length,
    }),
    [items],
  );

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

  // Keyboard navigation for the rows: ↑/↓ + Home/End move a roving tab stop
  // (the selected row carries tabIndex 0), selection follows focus so the
  // detail panel tracks the keyboard, and Enter opens the item on GitHub. Keyed
  // on the row count so the listeners (re)bind once the table mounts after the
  // async fetch — the table isn't in the DOM during the loading/empty states.
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  useEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const rowOf = (el: EventTarget | null) =>
      (el as HTMLElement | null)?.closest?.('tr[data-gh-row="true"]') as HTMLElement | null;
    const rows = () => Array.from(tbody.querySelectorAll<HTMLElement>('tr[data-gh-row="true"]'));
    const focusRow = (i: number) => {
      const list = rows();
      if (list.length === 0) return;
      const row = list[Math.max(0, Math.min(list.length - 1, i))];
      if (row.dataset.itemId) setSelectedItemId(row.dataset.itemId);
      row.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const cur = rowOf(document.activeElement);
      const list = rows();
      const i = cur ? list.indexOf(cur) : list.findIndex((r) => r.getAttribute("aria-selected") === "true");
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); focusRow((i < 0 ? -1 : i) + 1); break;
        case "ArrowUp": e.preventDefault(); focusRow((i < 0 ? list.length : i) - 1); break;
        case "Home": e.preventDefault(); focusRow(0); break;
        case "End": e.preventDefault(); focusRow(list.length - 1); break;
        case "Enter": {
          const url = cur?.dataset.url;
          if (url) { e.preventDefault(); window.open(url, "_blank", "noopener,noreferrer"); }
          break;
        }
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const row = rowOf(e.target);
      if (row?.dataset.itemId) setSelectedItemId(row.dataset.itemId);
    };
    tbody.addEventListener("keydown", onKey);
    tbody.addEventListener("focusin", onFocusIn);
    return () => {
      tbody.removeEventListener("keydown", onKey);
      tbody.removeEventListener("focusin", onFocusIn);
    };
  }, [sorted.length]);

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
      <header className="github-surface-header gh-compact-header">
        <div className="gh-compact-meta">
          {activity?.login && (
            <span className="gh-compact-login">@{activity.login}</span>
          )}

          {activity?.authed === false && (
            <span className="gh-compact-auth gh-compact-auth--public">public API</span>
          )}
          {activity?.authed === true && (
            <span className="gh-compact-auth gh-compact-auth--authed">authenticated</span>
          )}

          {activity?.rateLimit && (
            <span className="gh-compact-rate">
              {activity.rateLimit.remaining}/{activity.rateLimit.limit} req left
            </span>
          )}
        </div>

        <Tabs
          className="gh-compact-tabs"
          variant="segment"
          size="sm"
          ariaLabel="Filter GitHub activity"
          value={filter}
          onChange={setFilter}
          items={(["all", "pr", "review_request", "issue"] as Filter[]).map((f) => ({
            id: f,
            label: ({ all: "All", pr: "PRs", review_request: "Reviews", issue: "Issues" } as Record<Filter, string>)[f],
            count: counts[f] > 0 ? counts[f] : undefined,
          })) satisfies TabItem<Filter>[]}
        />

        <div className="gh-compact-filters">
          <div className="gh-search">
            <Icon name="ph:magnifying-glass" width={12} className="gh-search-icon" aria-hidden />
            <input
              type="search"
              className="gh-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
              placeholder="Search…"
              aria-label="Search GitHub items by title, repo, or number"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="gh-search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icon name="ph:x" width={10} />
              </button>
            )}
          </div>
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
          <div className="gh-compact-group" role="group" aria-label="Group rows">
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
                    "gh-compact-group-button",
                    isActive
                      ? "is-active"
                      : "",
                  ].join(" ")}
                >
                  {labels[g]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="gh-compact-actions">
          <button
            type="button"
            onClick={() => setShowPatModal(true)}
            title={patStatus?.hasPat ? "Manage GitHub PAT" : "Connect GitHub PAT"}
            aria-label={patStatus?.hasPat ? "GitHub PAT connected — manage" : "Connect GitHub PAT"}
            className={`gh-compact-icon-button ${patStatus?.hasPat ? "" : "gh-compact-icon-button--labeled"}`}
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
            aria-label="Refresh GitHub activity"
            className="gh-compact-icon-button"
          >
            <Icon name="ph:arrows-clockwise" width={13} />
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="github-surface-body min-h-0 flex-1 overflow-hidden">

        {loading ? (
          <div className="p-2">
            <SkeletonRows count={8} />
          </div>

        ) : error === "no_user" ? (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState
              icon="ph:github-logo"
              headline="Connect your GitHub account"
              subtitle="Cave uses the public GitHub API (no auth needed) or your own PAT for private repos and reviews."
              actions={
                <Button variant="primary" leadingIcon="ph:github-logo" onClick={() => setShowPatModal(true)}>
                  Set up GitHub
                </Button>
              }
            />
          </div>

        ) : error ? (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState
              icon="ph:warning-circle"
              headline="Couldn't load GitHub"
              subtitle={error}
              actions={
                <Button variant="secondary" leadingIcon="ph:arrow-clockwise" onClick={() => void fetchActivity()}>
                  Retry
                </Button>
              }
            />
          </div>

        ) : sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8">
            {query.trim() ? (
              <EmptyState
                icon="ph:magnifying-glass"
                headline={`No items match “${query.trim()}”`}
                subtitle="Try a shorter query, or clear the search to see everything."
              />
            ) : (
              <EmptyState
                icon="ph:check-circle"
                headline={filter === "all" ? "Nothing open right now" : `No open ${filter === "review_request" ? "review requests" : filter + "s"}`}
                subtitle={filter === "all" ? "Pull requests, reviews, and issues that need you will show up here." : undefined}
              />
            )}
          </div>

        ) : (
          <div className="gh-workspace">
            <div className="board-table-wrap gh-list-panel">
              <table className="board-table gh-table" role="grid" aria-label="GitHub activity — use arrow keys to navigate rows">
                <thead>
                  <tr>
                    {COLS.map((col, i) => (
                      <th
                        key={`${col.label}-${i}`}
                        style={{ width: col.width, textAlign: col.align ?? "left" }}
                        className={col.key && sortKey === col.key ? "sorted" : ""}
                        aria-sort={
                          col.key
                            ? sortKey === col.key
                              ? sortDir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                            : undefined
                        }
                      >
                        {col.key ? (
                          // A real <button> so the column is sortable by keyboard;
                          // styled inline to avoid touching the shared board-table CSS.
                          <button
                            type="button"
                            className="focus-ring"
                            onClick={() => handleSortClick(col.key!)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                              background: "none",
                              border: "none",
                              padding: 0,
                              font: "inherit",
                              color: "inherit",
                              cursor: "pointer",
                            }}
                          >
                            {col.label}
                            <span className="board-table-sort-icon">
                              {sortKey === col.key
                                ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                                : <Icon name="ph:caret-up-down" width={9} />}
                            </span>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
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
                      data-gh-row="true"
                      data-item-id={item.id}
                      data-url={item.url}
                      tabIndex={selectedItem?.id === item.id ? 0 : -1}
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
                        {item.checkStatus === "failing" && (
                          <span
                            className="gh-badge gh-badge--danger"
                            role="img"
                            aria-label="CI checks failing"
                            title="CI checks failing"
                          >
                            checks failed
                          </span>
                        )}
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
                                    ? resolvedById.get(c.familiarId) ?? null
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
                        <RelativeTime iso={item.updatedAt} className="board-table-cell-time" />
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
                          <SafeMergeAction
                            item={item}
                            linkedCards={linked}
                            familiars={familiars}
                            onJumpToSession={onJumpToSession}
                          />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open on GitHub"
                            aria-label="Open on GitHub"
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
        <span>↑↓ navigate · Enter opens on GitHub · ⌘R refresh</span>
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
