"use client";

// The GitHub surface's styles (every `gh-*` class) live in board.css. Import it
// here so the surface is styled even when it loads before the Board surface —
// both views are code-split, and board.css was previously only pulled in by
// board-view, so opening GitHub first left this surface unstyled.
import "@/styles/board.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { useAppPreferences } from "@/lib/app-preferences";
import { Icon, type IconName } from "@/lib/icon";
import { useDateTimePrefs } from "@/lib/datetime-format";
import {
  activityCollectionsComplete,
  activityCollectionsEqual,
  activityCompletenessNotice,
  activityCountLabel,
  activityRetryAfterSeconds,
  mergeFailedActivityItems,
} from "@/lib/github-activity";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { useArmedConfirm } from "@/lib/use-armed-confirm";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StandardSelect } from "@/components/ui/select";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { useAnnouncer } from "@/components/ui/live-region";
import { useCopy } from "@/lib/use-copy";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { Familiar } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { GitHubItemTarget } from "@/lib/github-item-url";
import { githubItemMatchesQuery } from "@/lib/github-search";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { MarkdownBlock } from "@/components/message-bubble";
import { DiffHunk } from "@/components/gh-diff-view";
import { GhReviewActions } from "@/components/gh-review-actions";
import { gfmAutolink } from "@/lib/gfm-autolink";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  GitHubActionPopover,
  type PopoverMode,
} from "@/components/github-action-popover";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { GithubSubscriptionsModal } from "@/components/github-subscriptions-modal";
import { openExternalUrl } from "@/lib/open-external";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useSurfacePreference } from "@/lib/surface-preferences";
import {
  invalidateSurfaceResources,
  readSurfaceResource,
  surfaceWarmupRetryAfterSeconds,
} from "@/lib/surface-warmup-registry";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";
import { GitHubStream } from "@/components/github-stream";
import {
  deriveStage,
  facetsFor,
  groupIntoSections,
  GH_NEXT_STEP,
  type GhSectionKey,
  type GhStreamEntry,
  type GhTone,
} from "@/lib/github-stage";
import {
  GITHUB_PAT_URL, KIND_COLOR, KIND_DETAIL_LABEL, KIND_ICON,
  linkedCardsForItem, orgOf, useCards, useFamiliars,
  type ActivityResult, type Filter, type PatStatus,
} from "./github-view-data";

type Props = {
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard?: (cardId: string) => void;
  /** Refresh the shell's cached GitHub assignment/session enrichment. */
  onTasksRefresh?: () => void;
  /** Deep-link target from a GitHub-event inbox notification — opens that
   *  PR/issue's detail natively, even when it isn't in the activity list. */
  initialTarget?: GitHubItemTarget | null;
  /** Called after the view captures a host target into local detail state. */
  onInitialTargetHandled?: () => void;
  /** When set, the host owns the content filter (e.g. the Code Workshop's
   *  PRs/Issues/Reviews top tabs). The view is driven to this filter and hides
   *  its own filter control to avoid a redundant second switch. */
  initialFilter?: Filter | null;
};

type ActivityPayload = ActivityResult | {
  ok: false;
  error?: string;
  retryAfterSeconds?: number | null;
};

// ── Data hooks ─────────────────────────────────────────────────────────────────


function PatSetupModal({
  onSaved,
  onClose,
  username,
  hasPat = false,
  canRemoveStoredPat = false,
}: {
  onSaved: () => void;
  onClose: () => void;
  username: string | null;
  /** A GitHub credential is configured, including an external launcher token. */
  hasPat?: boolean;
  /** Only Cave-managed credentials can be removed through the local API. */
  canRemoveStoredPat?: boolean;
}) {
  const [pat, setPat] = useState("");
  const [usernameInput, setUsernameInput] = useState(username ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeConfirm = useArmedConfirm();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // While a save is in flight, dismissal is deferred: closing mid-save would
  // unmount under the pending setStates and leave the user unsure whether the
  // PAT persisted (cave-b8ba).
  const savingRef = useRef(false);
  savingRef.current = saving;
  const closeUnlessSaving = () => {
    if (!savingRef.current) onClose();
  };
  // Trap Tab/Shift+Tab inside the modal and close on Escape. focusFirst is off
  // so the username input's focus effect above keeps the initial focus.
  useFocusTrap(true, dialogRef, { onEscape: closeUnlessSaving, focusFirst: false });

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
      invalidateSurfaceResources("github:pat", "github:activity");
      onSaved();
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
      onClick={closeUnlessSaving}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-pat-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="gh-pat-dialog"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Icon name="ph:github-logo" width={18} className="text-[var(--text-secondary)]" />
            <h3 id="github-pat-modal-title" className="text-[length:var(--text-md)] font-semibold">Connect GitHub</h3>
          </div>
          <IconButton
            icon="ph:x"
            size="sm"
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)] mb-1">
          Enter your GitHub username to pull live public data (free, no auth needed).
        </p>
        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)] mb-4">
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
            <label htmlFor="gh-pat-username" className="block text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] mb-1.5">
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
              className="gh-input"
            />
          </div>

          <div className="mb-2">
            <label htmlFor="gh-pat-token" className="block text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] mb-1.5">
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
              className="gh-input"
            />
          </div>

          {error && (
            <p className="mb-3 text-[length:var(--text-xs)] text-[var(--color-danger)]">{error}</p>
          )}

          <div className="flex items-center justify-between mt-4">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void openExternalUrl(GITHUB_PAT_URL)}
            >
              Generate a PAT on GitHub →
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={(!pat.trim() && !usernameInput.trim()) || saving}
              loading={saving}
            >
              {saving ? "Verifying…" : "Save"}
            </Button>
          </div>
        </form>

        {canRemoveStoredPat && (
          <div className="mt-3 border-t border-[var(--border-hairline)] pt-3">
            <Button
              variant="ghost"
              size="xs"
              disabled={removing || saving}
              onClick={() => {
                if (removing) return;
                // Two-step, matching the app's armed-confirm standard (cave-w96h).
                removeConfirm.trigger(() => {
                  setRemoving(true);
                  setError(null);
                  void (async () => {
                    try {
                      const res = await fetch("/api/github/pat", { method: "DELETE" });
                      const data = await res.json().catch(() => null);
                      if (!res.ok || data?.ok === false) {
                        setError(data?.error ?? "Couldn't remove the token.");
                        return;
                      }
                      invalidateSurfaceResources("github:pat", "github:activity");
                      onSaved();
                    } catch {
                      setError("Network error — please try again.");
                    } finally {
                      setRemoving(false);
                    }
                  })();
                });
              }}
            >
              {removing ? "Removing…" : removeConfirm.armed ? "Really remove?" : "Remove stored token"}
            </Button>
            <p className="mt-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              Drops back to public data for @{usernameInput.trim() || username || "…"}.
            </p>
          </div>
        )}
        {hasPat && !canRemoveStoredPat && (
          <p className="mt-3 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            GitHub authentication is supplied by the launch environment; manage that credential outside Cave.
          </p>
        )}
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
        className={`gh-task-chip-dot gh-task-chip-dot--${card.status}`}
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
  familiarsFailed = false,
  cardsFailed = false,
  onJumpToSession,
  onAfterLink,
}: {
  item: GitHubItem;
  linkedCards: Card[];
  familiars: Familiar[];
  cards: Card[];
  familiarsFailed?: boolean;
  cardsFailed?: boolean;
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
      <Button
        size="xs"
        variant="secondary"
        leadingIcon="ph:chat-circle-dots"
        onClick={handleClick}
        disabled={busy}
        title={title}
      >
        {label}
      </Button>

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
                      className={`gh-task-chip-dot gh-task-chip-dot--${c.status}`}
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
            familiarsFailed={familiarsFailed}
            cards={cards}
            cardsFailed={cardsFailed}
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
}: {
  item: GitHubItem;
  linkedCards: Card[];
  familiars: Familiar[];
}) {
  const [busy, setBusy] = useState(false);
  const { announce } = useAnnouncer();
  const [error, setError] = useState<string | null>(null);
  if (item.kind !== "pr" && item.kind !== "review_request") return null;

  const linkedCard = linkedCards.find((card) => card.cwd) ?? linkedCards[0] ?? null;
  const familiarId = linkedCard?.familiarId ?? familiars[0]?.id ?? null;

  async function startSafeMerge(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    let safeMergeRoot: string | null = linkedCard?.cwd ?? null;
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
        safeMergeRoot = typeof json.worktree === "string" && json.worktree ? json.worktree : linkedCard.cwd;
        worktreeLine = `Worktree: ${json.worktree} (${json.created ? "created" : "reused"}). Branch: ${json.branch}.`;
        announce(`Worktree ${json.created ? "created" : "reused"} for the safe merge.`);
      }

      const initialPrompt = [
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
          detail: { familiarId, projectRoot: safeMergeRoot ?? undefined, initialPrompt },
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
      <Button
        size="xs"
        variant="secondary"
        leadingIcon="ph:git-merge"
        onClick={startSafeMerge}
        disabled={busy}
        title="Safely merge from a worktree"
      >
        {busy ? "Prep…" : "Merge"}
      </Button>
      {error && <span className="gh-action-error" role="img" aria-label={`Error: ${error}`} title={error}>!</span>}
    </div>
  );
}

// ── Add-to-board action ───────────────────────────────────────────────────────

function AddToBoardAction({
  item,
  familiars,
  cards,
  familiarsFailed = false,
  cardsFailed = false,
  onAfterLink,
}: {
  item: GitHubItem;
  familiars: Familiar[];
  cards: Card[];
  familiarsFailed?: boolean;
  cardsFailed?: boolean;
  onAfterLink: () => void;
}) {
  const [mode, setMode] = useState<PopoverMode | null>(null);

  function open(m: PopoverMode, e: React.MouseEvent) {
    e.stopPropagation();
    setMode(m);
  }
  function close() {
    setMode(null);
  }

  return (
    <div className="gh-action-wrap">
      <Button
        size="xs"
        variant="secondary"
        leadingIcon="ph:kanban"
        onClick={(e) => open("board", e)}
        title="Add to task"
      >
        Task
      </Button>
      {mode && (
        <div className="gh-action-popover gh-action-popover--wide" onClick={(e) => e.stopPropagation()}>
          <GitHubActionPopover
            mode={mode}
            item={item}
            familiars={familiars}
            familiarsFailed={familiarsFailed}
            cards={cards}
            cardsFailed={cardsFailed}
            onClose={close}
            onComplete={onAfterLink}
          />
        </div>
      )}
    </div>
  );
}

// ── Item detail (full issue/PR body, author, assignees, labels) ───────────────

type GitHubPerson = { login: string; avatarUrl: string | null; url: string | null };

/** The `?pull=1` block the item route adds for pull requests. */
type PullSummary = {
  headRef: string;
  baseRef: string;
  headSha: string;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** null while GitHub is still computing the merge commit. */
  mergeable: boolean | null;
  mergeableState: string;
  reviews: { approved: number; changesRequested: number; commented: number };
};

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
  /** Present only for pull requests — absent on issues, null when the extra
   *  round-trip failed (the base item still renders). */
  pull?: PullSummary | null;
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
    // AbortController (not a cancelled flag): arrowing through the list must
    // actually cancel the left-behind request, not just ignore its response —
    // uncancelled fetches burn the 60/hr unauthenticated rate limit (cave-b8ba).
    const ctl = new AbortController();
    setState({ status: "loading" });
    // `pull=1` adds mergeability, the review tally and the diff size — the
    // three things the landing gates report. Issues ignore the flag.
    fetch(`/api/github/item?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}&pull=1`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (ctl.signal.aborted) return;
        if (data?.ok) setState({ status: "ready", detail: data as ItemDetail });
        else setState({ status: "error" });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ status: "error" });
      });
    return () => ctl.abort();
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

// ── User profile viewer (click a person → GitHub profile card) ───────────────

type UserProfile = {
  ok: true;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter: string | null;
  type: string;
  followers: number;
  following: number;
  publicRepos: number;
  createdAt: string | null;
};

type ProfileViewer = { open: (login: string, anchor: HTMLElement) => void };
const ProfileViewerContext = createContext<ProfileViewer | null>(null);
/** Real GitHub logins only — bot logins ("x[bot]") have no profile to open. */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: UserProfile }
  | { status: "error" };

/** Compact number for follower/repo counts (1200 → "1.2k"). */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

// Session-lifetime profile cache: reopening a person's card is instant and
// doesn't respend the GitHub rate limit. Profiles change rarely enough that a
// page-load-scoped cache never going stale in practice is the right trade.
const profileCache = new Map<string, UserProfile>();

/**
 * Floating GitHub profile card. Anchored under the clicked chip, clamped to the
 * viewport, focus-trapped, and dismissed on Escape / outside click. Fetches the
 * public profile on open (cache-first); a since-closed selection's response is
 * dropped.
 */
function UserProfileCard({
  login,
  anchor,
  onClose,
}: {
  login: string;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, cardRef, { onEscape: onClose, focusFirst: false });

  useEffect(() => {
    const cached = profileCache.get(login);
    if (cached) {
      setState({ status: "ready", profile: cached });
      return;
    }
    const ctl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/github/user?login=${encodeURIComponent(login)}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (ctl.signal.aborted) return;
        if (data?.ok) {
          const profile = data as UserProfile;
          profileCache.set(login, profile);
          setState({ status: "ready", profile });
        } else setState({ status: "error" });
      })
      .catch(() => { if (!ctl.signal.aborted) setState({ status: "error" }); });
    return () => ctl.abort();
  }, [login]);

  // Outside-click dismissal (deferred one tick so the opening click doesn't
  // immediately close it).
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    }
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 30);
    return () => { window.clearTimeout(id); document.removeEventListener("mousedown", onDoc); };
  }, [onClose]);

  // Clamp to the viewport: prefer opening just below the chip, flip up if it
  // would overflow the bottom, and keep a gutter from the right edge.
  const CARD_W = 288;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - CARD_W - 8));
  const below = anchor.bottom + 6;
  const flipUp = below + 210 > window.innerHeight;
  const style: React.CSSProperties = flipUp
    ? { left, bottom: window.innerHeight - anchor.top + 6, width: CARD_W }
    : { left, top: below, width: CARD_W };

  const p = state.status === "ready" ? state.profile : null;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={`GitHub profile for ${login}`}
      tabIndex={-1}
      className="gh-profile-card"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {state.status === "loading" ? (
        <div className="gh-profile-loading">Loading @{login}…</div>
      ) : state.status === "error" || !p ? (
        <div className="gh-profile-error">
          <p>Couldn’t load @{login}’s profile.</p>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:arrow-square-out"
            onClick={() => openExternalUrl(`https://github.com/${login}`)}
          >
            Open on GitHub
          </Button>
        </div>
      ) : (
        <>
          <div className="gh-profile-head">
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatarUrl} alt="" className="gh-profile-avatar" width={48} height={48} />
            ) : (
              <span className="gh-profile-avatar gh-profile-avatar--fallback" aria-hidden>
                {p.login.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="gh-profile-id">
              {p.name && <strong className="gh-profile-name">{p.name}</strong>}
              <span className="gh-profile-login">
                @{p.login}
                {p.type === "Organization" && <span className="gh-profile-type">org</span>}
              </span>
            </div>
          </div>

          {p.bio && <p className="gh-profile-bio">{p.bio}</p>}

          <div className="gh-profile-stats">
            <span><strong>{compactCount(p.followers)}</strong> followers</span>
            <span><strong>{compactCount(p.following)}</strong> following</span>
            <span><strong>{compactCount(p.publicRepos)}</strong> repos</span>
          </div>

          <div className="gh-profile-meta">
            {p.company && (
              <span title="Company"><Icon name="ph:users-three" width={12} />{p.company}</span>
            )}
            {p.location && (
              <span title="Location"><Icon name="ph:globe" width={12} />{p.location}</span>
            )}
            {p.blog && (
              <button
                type="button"
                className="gh-profile-link"
                title={p.blog}
                onClick={() => openExternalUrl(p.blog!)}
              >
                <Icon name="ph:link" width={12} />
                {p.blog.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </button>
            )}
            {p.twitter && (
              <button
                type="button"
                className="gh-profile-link"
                title={`@${p.twitter} on X`}
                onClick={() => openExternalUrl(`https://twitter.com/${p.twitter}`)}
              >
                <Icon name="ph:x-logo-bold" width={12} />@{p.twitter}
              </button>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:github-logo"
            onClick={() => openExternalUrl(p.htmlUrl ?? `https://github.com/${p.login}`)}
          >
            View full profile
          </Button>
        </>
      )}
    </div>
  );
}

/** Owns the single open profile card; children open it via {@link useProfileViewer}. */
function GitHubProfileProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<{ login: string; anchor: DOMRect } | null>(null);
  const viewer = useMemo<ProfileViewer>(
    () => ({
      open: (login, el) => setOpen({ login, anchor: el.getBoundingClientRect() }),
    }),
    [],
  );
  return (
    <ProfileViewerContext.Provider value={viewer}>
      {children}
      {/* Portal to <body> so the fixed-position card escapes the workspace's
          transformed content area — otherwise `position:fixed` resolves against
          that transformed ancestor and the card lands offset by the nav width. */}
      {open && typeof document !== "undefined" &&
        createPortal(
          <UserProfileCard login={open.login} anchor={open.anchor} onClose={() => setOpen(null)} />,
          document.body,
        )}
    </ProfileViewerContext.Provider>
  );
}

/**
 * GitHub person avatar + login. Falls back to a monogram when no avatar. When a
 * profile viewer is in context and the login is a real user (not a bot), the
 * chip becomes a button that opens the GitHub profile card.
 */
function PersonChip({ person, prefix }: { person: GitHubPerson; prefix?: string }) {
  const viewer = useContext(ProfileViewerContext);
  const clickable = viewer != null && LOGIN_RE.test(person.login);
  const inner = (
    <>
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" className="gh-person-avatar" width={16} height={16} />
      ) : (
        <span className="gh-person-avatar gh-person-avatar--fallback" aria-hidden>
          {person.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="gh-person-login">{prefix}{person.login}</span>
    </>
  );

  if (!clickable) {
    return <span className="gh-person">{inner}</span>;
  }
  return (
    <button
      type="button"
      className="gh-person gh-person--button"
      title={`View @${person.login}’s GitHub profile`}
      aria-label={`View @${person.login}’s GitHub profile`}
      onClick={(e) => {
        e.stopPropagation();
        viewer!.open(person.login, e.currentTarget);
      }}
    >
      {inner}
    </button>
  );
}

// ── Comments + review threads (read · resolve · reply) ───────────────────────

type GhReaction = { content: string; count: number };

type GhComment = {
  id: string;
  author: GitHubPerson | null;
  body: string;
  createdAt: string | null;
  url: string | null;
  authorAssociation: string | null;
  reactions?: GhReaction[];
};

/** PR review summary — APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED. */
type GhReview = {
  id: string;
  author: GitHubPerson | null;
  state: string;
  body: string;
  submittedAt: string | null;
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
  reviews: GhReview[];
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
          className="gh-comment-link"
          title="Open this comment on GitHub"
          aria-label="Open this comment on GitHub"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (comment.url) openExternalUrl(comment.url);
          }}
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

// GitHub reaction slugs → emoji glyph, for the reaction summary chips.
const REACTION_EMOJI: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

const REACTION_LABEL: Record<string, string> = {
  "+1": "thumbs up",
  "-1": "thumbs down",
  laugh: "laugh",
  hooray: "hooray",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes",
};

/** Read-only reaction summary (emoji + count) under a comment. */
function CommentReactions({ reactions }: { reactions?: GhReaction[] }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="gh-reactions" aria-label="Reactions">
      {reactions.map((r) => (
        <span
          key={r.content}
          className="gh-reaction"
          title={`${r.count} ${r.content}`}
          aria-label={`${r.count} ${REACTION_LABEL[r.content] ?? r.content} ${r.count === 1 ? "reaction" : "reactions"}`}
        >
          <span aria-hidden>{REACTION_EMOJI[r.content] ?? "•"}</span>
          {r.count}
        </span>
      ))}
    </div>
  );
}

// PR review state → presentation. Only states GitHub actually submits appear.
const REVIEW_STATE: Record<
  string,
  { icon: IconName; color: string; label: string; cls: string }
> = {
  APPROVED: { icon: "ph:check-circle-fill", color: "var(--color-success)", label: "approved these changes", cls: "is-approved" },
  CHANGES_REQUESTED: { icon: "ph:x-circle-fill", color: "var(--color-danger)", label: "requested changes", cls: "is-changes" },
  COMMENTED: { icon: "ph:chat-circle-dots", color: "var(--text-muted)", label: "reviewed", cls: "is-commented" },
  DISMISSED: { icon: "ph:minus-circle", color: "var(--text-muted)", label: "dismissed a review", cls: "is-dismissed" },
};

/** A single PR review summary entry in the conversation timeline. */
function ReviewEntry({ review, repo }: { review: GhReview; repo: string }) {
  const cfg = REVIEW_STATE[review.state] ?? REVIEW_STATE.COMMENTED;
  return (
    <div className={`gh-review-entry ${cfg.cls}`}>
      <div className="gh-comment-head">
        <span className="gh-review-verdict" style={{ color: cfg.color }}>
          <Icon name={cfg.icon} width={13} />
        </span>
        {review.author ? <PersonChip person={review.author} /> : <span className="gh-person-login">ghost</span>}
        <span className="gh-review-verb">{cfg.label}</span>
        {review.submittedAt && <RelativeTime iso={review.submittedAt} className="gh-comment-time" />}
        {review.url && (
          <a
            href={review.url}
            className="gh-comment-link"
            title="Open this review on GitHub"
            aria-label="Open this review on GitHub"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (review.url) openExternalUrl(review.url);
            }}
          >
            <Icon name="ph:arrow-square-out" width={11} />
          </a>
        )}
      </div>
      {review.body.trim() && (
        <MarkdownBlock text={gfmAutolink(review.body, { repo })} className="gh-comment-body" />
      )}
    </div>
  );
}

/**
 * Reads the conversation timeline + inline PR review threads, resolves threads
 * (PAT only), and posts a reply. The whole surface is reused verbatim by the
 * native iOS app via the same API routes.
 */
function GitHubComments({
  item,
  detail,
}: {
  item: GitHubItem;
  detail: ItemDetail | null;
}) {
  const [state, setState] = useState<CommentsState>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const { announce } = useAnnouncer();
  const [postError, setPostError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Optimistic thread-resolve flips awaiting API confirmation — applied over
  // fetched data so a post-comment refetch during GitHub's read-after-write
  // lag can't overwrite them (cave-b8ba). Confirmed entries drop out.
  const pendingResolveRef = useRef(new Map<string, boolean>());

  const repo = item.repo;
  const number = item.number ?? null;
  const isPull = detail?.isPull ?? (item.kind === "pr" || item.kind === "review_request");

  // Reset the composer when the selected item changes.
  useEffect(() => {
    setDraft("");
    setPostError(null);
  }, [repo, number]);

  useEffect(() => {
    if (number == null) {
      setState({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setState({ status: "loading" });
    fetch(
      `/api/github/comments?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}${isPull ? "&isPull=1" : ""}`,
      { signal: ctl.signal },
    )
      .then((r) => r.json())
      .then((data) => {
        if (ctl.signal.aborted) return;
        if (data?.ok) {
          const result = data as CommentsResult;
          const pending = pendingResolveRef.current;
          if (pending.size > 0) {
            result.reviewThreads = result.reviewThreads.map((t) => {
              const want = pending.get(t.id);
              if (want === undefined) return t;
              if (t.isResolved === want) {
                pending.delete(t.id); // API caught up — stop overriding
                return t;
              }
              return { ...t, isResolved: want };
            });
          }
          setState({ status: "ready", data: result });
        } else setState({ status: "error" });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ status: "error" });
      });
    return () => ctl.abort();
  }, [repo, number, isPull, tick]);

  // A different PR's threads can't inherit stale overrides.
  useEffect(() => {
    pendingResolveRef.current.clear();
  }, [repo, number]);

  const data = state.status === "ready" ? state.data : null;
  const canResolve = data?.canResolve ?? false;
  const canComment = data?.authed ?? false;

  const threads = data?.reviewThreads ?? [];
  const unresolvedThreads = threads.filter((t) => !t.isResolved);
  const resolvedThreads = threads.filter((t) => t.isResolved);
  const visibleThreads = showResolved ? threads : unresolvedThreads;

  // Merge issue comments and PR review summaries into one chronological
  // timeline so "X approved these changes" reads in-order with the discussion.
  const reviews = data?.reviews ?? [];
  const timeline: Array<
    | { kind: "comment"; at: string; comment: GhComment }
    | { kind: "review"; at: string; review: GhReview }
  > = [
    ...(data?.issueComments ?? []).map(
      (c) => ({ kind: "comment" as const, at: c.createdAt ?? "", comment: c }),
    ),
    ...reviews.map((r) => ({ kind: "review" as const, at: r.submittedAt ?? "", review: r })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  async function toggleResolve(thread: GhReviewThread) {
    if (!canResolve || state.status !== "ready") return;
    const next = !thread.isResolved;
    announce(next ? "Thread resolved." : "Thread unresolved.");
    // Record the optimistic value: a post-comment refetch during GitHub's
    // read-after-write lag would otherwise overwrite the flip with stale
    // isResolved (cave-b8ba). The fetch handler applies pending overrides
    // until the API confirms them.
    pendingResolveRef.current.set(thread.id, next);
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
      // Revert by refetching the authoritative state (and stop overriding).
      pendingResolveRef.current.delete(thread.id);
      setTick((n) => n + 1);
    }
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
      announce("Comment posted.");
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
                    <DiffHunk hunk={thread.diffHunk} path={thread.path} previewLines={4} className="gh-thread-diff" />
                  )}
                  {thread.comments.map((c) => (
                    <div key={c.id} className="gh-comment gh-comment--inline">
                      <CommentHeader comment={c} />
                      <CommentBody comment={c} repo={repo} />
                      <CommentReactions reactions={c.reactions} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Conversation timeline — issue comments and PR review summaries,
              interleaved in chronological order. */}
          {timeline.length > 0 ? (
            <div className="gh-comment-list">
              {timeline.map((entry) =>
                entry.kind === "review" ? (
                  <ReviewEntry key={`rv-${entry.review.id}`} review={entry.review} repo={repo} />
                ) : (
                  <div key={`c-${entry.comment.id}`} className="gh-comment">
                    <CommentHeader comment={entry.comment} />
                    <CommentBody comment={entry.comment} repo={repo} />
                    <CommentReactions reactions={entry.comment.reactions} />
                  </div>
                ),
              )}
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
                aria-label="Reply to this thread"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                placeholder="Reply… (⌘↵ to send)"
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
              {postError && <p className="gh-composer-error" role="alert">{postError}</p>}
              <div className="gh-composer-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void postComment()}
                  disabled={!draft.trim() || posting}
                >
                  {posting ? "Posting…" : "Comment"}
                </Button>
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

// ── CI action details (per-PR check runs) ────────────────────────────────────

type CheckRunDetail = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  appName: string | null;
  appAvatarUrl: string | null;
};

type StatusDetail = {
  context: string;
  state: string;
  description: string | null;
  targetUrl: string | null;
};

type ChecksResult = {
  ok: true;
  authed: boolean;
  sha: string;
  rollup: "passing" | "failing" | "pending" | null;
  runs: CheckRunDetail[];
  statuses: StatusDetail[];
};

type ChecksState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ChecksResult }
  | { status: "error" };

const CHECK_FAIL = new Set(["failure", "timed_out", "action_required", "startup_failure"]);
const CHECK_SKIP = new Set(["neutral", "skipped"]);
const CHECK_STALE = new Set(["cancelled", "stale"]);

/** Map a check-run's status/conclusion to an icon, tint, and short verb. */
function checkPresentation(status: string, conclusion: string | null): {
  icon: IconName;
  color: string;
  bucket: "passed" | "failed" | "skipped" | "cancelled" | "running";
} {
  if (status !== "completed") {
    return { icon: "ph:circle-dashed", color: "var(--color-warning)", bucket: "running" };
  }
  const c = conclusion ?? "";
  if (c === "success") return { icon: "ph:check-circle-fill", color: "var(--color-success)", bucket: "passed" };
  if (CHECK_FAIL.has(c)) return { icon: "ph:x-circle-fill", color: "var(--color-danger)", bucket: "failed" };
  if (CHECK_SKIP.has(c)) return { icon: "ph:minus-circle", color: "var(--text-muted)", bucket: "skipped" };
  if (CHECK_STALE.has(c)) return { icon: "ph:minus-circle", color: "var(--text-muted)", bucket: "cancelled" };
  return { icon: "ph:circle", color: "var(--text-muted)", bucket: "skipped" };
}

/** Human duration between two ISO timestamps ("1m 20s", "12s"); null if unknown. */
function checkDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

function useGitHubChecks(item: GitHubItem | null, enabled: boolean): ChecksState {
  const [state, setState] = useState<ChecksState>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const repo = item?.repo ?? null;
  const number = item?.number ?? null;
  // Tracks the last-fetched PR so a live-refresh of the SAME PR is silent (no
  // skeleton flash, list stays mounted) while switching PRs shows loading.
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !repo || number == null) {
      keyRef.current = null;
      setState({ status: "idle" });
      return;
    }
    const key = `${repo}#${number}`;
    const silent = keyRef.current === key;
    keyRef.current = key;
    const ctl = new AbortController();
    if (!silent) setState({ status: "loading" });
    fetch(`/api/github/checks?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (ctl.signal.aborted) return;
        if (data?.ok) setState({ status: "ready", data: data as ChecksResult });
        else if (!silent) setState({ status: "error" }); // a failed refresh keeps the last good list
      })
      .catch(() => { if (!ctl.signal.aborted && !silent) setState({ status: "error" }); });
    return () => ctl.abort();
  }, [enabled, repo, number, tick]);

  // Live-refresh while CI is still running: poll every 30s until the rollup
  // leaves "pending". usePausablePoll (cave-e794) keeps the hidden-tab skip
  // (a backgrounded tab doesn't spend rate limit) and adds an immediate
  // refresh on return, so CI status is current the moment the tab comes back
  // instead of up to 30s later.
  const rollup = state.status === "ready" ? state.data.rollup : null;
  usePausablePoll(() => setTick((t) => t + 1), 30_000, { enabled: rollup === "pending" });

  return state;
}

/** Combined-status state → icon + tint (legacy commit statuses / contexts). */
function statusPresentation(state: string): { icon: IconName; color: string } {
  if (state === "success") return { icon: "ph:check-circle-fill", color: "var(--color-success)" };
  if (state === "failure" || state === "error") return { icon: "ph:x-circle-fill", color: "var(--color-danger)" };
  return { icon: "ph:circle-dashed", color: "var(--color-warning)" };
}

/**
 * Expandable CI breakdown for the selected PR: a rollup summary line
 * (passed/failed/running counts) over the individual GitHub Actions check-runs
 * and legacy statuses, each with its timing and a link out to the run logs.
 * PR-only; issues have no checks. Read-only, so no announcer.
 */
function GitHubChecks({ item, state }: { item: GitHubItem; state: ChecksState }) {
  const isPull = item.kind === "pr" || item.kind === "review_request";
  const data = state.status === "ready" ? state.data : null;
  const runs = data?.runs ?? [];
  const statuses = data?.statuses ?? [];
  const total = runs.length + statuses.length;

  // Default the list open when something's wrong; collapse a clean run.
  const [open, setOpen] = useState(false);
  const rollup = data?.rollup ?? null;
  useEffect(() => { setOpen(rollup === "failing"); }, [rollup, item.repo, item.number]);

  if (!isPull) return null;
  if (state.status === "idle") return null;

  const buckets = runs.reduce(
    (acc, r) => {
      acc[checkPresentation(r.status, r.conclusion).bucket] += 1;
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0, cancelled: 0, running: 0 } as Record<string, number>,
  );
  const summary = [
    buckets.passed ? `${buckets.passed} passed` : "",
    buckets.failed ? `${buckets.failed} failed` : "",
    buckets.running ? `${buckets.running} running` : "",
    buckets.skipped ? `${buckets.skipped} skipped` : "",
    buckets.cancelled ? `${buckets.cancelled} cancelled` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="gh-glass-section gh-checks">
      <div className="gh-glass-section-title gh-checks-title">
        <span>Checks</span>
        {rollup && (
          <span className={`gh-checks-rollup gh-checks-rollup--${rollup}`}>
            <span className="gh-checks-rollup-dot" aria-hidden />
            {rollup === "passing" ? "All checks passed" : rollup === "failing" ? "Some checks failed" : "Checks running"}
          </span>
        )}
      </div>

      {state.status === "loading" ? (
        <p className="gh-glass-muted">Loading checks…</p>
      ) : state.status === "error" ? (
        <p className="gh-glass-muted">Couldn’t load checks — open on GitHub for the run details.</p>
      ) : total === 0 ? (
        <p className="gh-glass-muted">No CI checks reported on the latest commit.</p>
      ) : (
        <>
          <button
            type="button"
            className="gh-checks-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={11} />
            {summary || `${total} check${total === 1 ? "" : "s"}`}
          </button>
          {open && (
            <ul className="gh-checks-list">
              {runs.map((r) => {
                const pres = checkPresentation(r.status, r.conclusion);
                const dur = checkDuration(r.startedAt, r.completedAt);
                return (
                  <li key={r.id} className="gh-check-row">
                    <span className="gh-check-icon" style={{ color: pres.color }} title={pres.bucket}>
                      <Icon name={pres.icon} width={13} />
                    </span>
                    <span className="gh-check-name" title={r.name}>{r.name}</span>
                    {r.appName && <span className="gh-check-app">{r.appName}</span>}
                    {dur && <span className="gh-check-dur">{dur}</span>}
                    {r.detailsUrl && (
                      <button
                        type="button"
                        className="gh-check-logs"
                        title="Open the run logs on GitHub"
                        aria-label={`Open logs for ${r.name}`}
                        onClick={() => openExternalUrl(r.detailsUrl!)}
                      >
                        <Icon name="ph:arrow-square-out" width={11} />
                      </button>
                    )}
                  </li>
                );
              })}
              {statuses.map((s) => {
                const pres = statusPresentation(s.state);
                return (
                  <li key={s.context} className="gh-check-row">
                    <span className="gh-check-icon" style={{ color: pres.color }} title={s.state}>
                      <Icon name={pres.icon} width={13} />
                    </span>
                    <span className="gh-check-name" title={s.description ?? s.context}>{s.context}</span>
                    {s.targetUrl && (
                      <button
                        type="button"
                        className="gh-check-logs"
                        title="Open the status details on GitHub"
                        aria-label={`Open details for ${s.context}`}
                        onClick={() => openExternalUrl(s.targetUrl!)}
                      >
                        <Icon name="ph:arrow-square-out" width={11} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Workspace split (list ⇄ detail) ──────────────────────────────────────────

const GH_WORKSPACE_GROUP_ID = "cave.github.workspace.v1";
const GH_DETAIL_COLLAPSED_KEY = "cave:github:details-collapsed:v1";
// Icons-only rail the detail panel collapses to — keeps the expand control
// visible instead of vanishing the panel entirely (shell nav-rail pattern).
const GH_DETAIL_RAIL_PX = 40;
// Below this measured workspace width the side-by-side split would crush the
// table, so the detail stacks above the list instead. Measured on the pane,
// not the viewport — a drag-to-split pane can be narrow in a wide window.
const GH_SPLIT_MIN_PX = 760;

// Width persistence for the resizable split. Guards mirror shell.tsx's
// shellStorage: drop corrupt layouts, and drop rail-width saves — collapse
// state lives in its own pref, so a stale collapsed layout must never restore
// as a crushed "expanded" panel.
const ghWorkspaceStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const values = Object.values(parsed as Record<string, unknown>).filter(
              (v): v is number => typeof v === "number" && Number.isFinite(v),
            );
            if (values.length >= 2) {
              const sum = values.reduce((a, b) => a + b, 0);
              const anyCollapsed = values.some((v) => v >= 0 && v <= 6);
              if (anyCollapsed || sum < 98 || sum > 102) {
                window.localStorage.removeItem(key);
                return null;
              }
            }
          }
        } catch { /* not a layout object, pass through */ }
      }
      return raw;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch { /* ignore — strict privacy mode or storage quota */ }
  },
};

function readDetailCollapsedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GH_DETAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function GhWorkspace({ detail, children }: { detail: ReactNode; children: ReactNode }) {
  const isMobile = useIsMobile();
  // Until the first measurement lands, fall back to the viewport heuristic so
  // SSR and first paint agree with the CSS (chat-surface pattern).
  const [width, setWidth] = useState<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  const split = width === null ? !isMobile : width >= GH_SPLIT_MIN_PX;

  const [collapsed, setCollapsed] = useState(readDetailCollapsedPref);
  const collapsedRef = useRef(collapsed);
  const detailPanelRef = useRef<PanelImperativeHandle | null>(null);
  // Last width the user actually saw expanded. expand() restores the panel's
  // "most recent size", but a panel that MOUNTS collapsed (persisted pref) has
  // no such size and would pop open at minSize — onResize seeds this ref from
  // the restored layout before the mount-time collapse lands.
  const lastExpandedPxRef = useRef<number | null>(null);
  const persistCollapsed = useCallback((next: boolean) => {
    collapsedRef.current = next;
    setCollapsed(next);
    try {
      window.localStorage.setItem(GH_DETAIL_COLLAPSED_KEY, next ? "1" : "0");
    } catch { /* ignore */ }
  }, []);
  const toggleCollapsed = useCallback(() => {
    const next = !collapsedRef.current;
    // Flip the ref BEFORE the imperative call — collapse()/expand() fire
    // onLayoutChanged synchronously, and the save gate must already see the
    // new state or collapsing overwrites the saved width with the rail's.
    collapsedRef.current = next;
    const panel = detailPanelRef.current;
    if (next) {
      panel?.collapse();
    } else {
      panel?.expand();
      const px = lastExpandedPxRef.current;
      if (panel && px != null && px >= 100) panel.resize(`${Math.round(px)}px`);
    }
    persistCollapsed(next);
  }, [persistCollapsed]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: GH_WORKSPACE_GROUP_ID,
    panelIds: ["gh-list", "gh-detail"],
    storage: ghWorkspaceStorage,
  });

  // The detail Panel remounts whenever the layout flips stacked → split;
  // re-apply the persisted collapse before paint so it never flashes open.
  // Capture the restored width first — collapsing this early means the panel
  // never reports an expanded onResize, so this is the only seed for the
  // width toggle-expand should return to.
  useLayoutEffect(() => {
    if (!split) return;
    const panel = detailPanelRef.current;
    if (panel && collapsedRef.current && !panel.isCollapsed()) {
      const px = panel.getSize().inPixels;
      if (px > GH_DETAIL_RAIL_PX + 8) lastExpandedPxRef.current = px;
      panel.collapse();
    }
  }, [split]);

  if (!split) {
    return (
      <div ref={measureRef} className="gh-workspace gh-workspace--stacked">
        {children}
        {collapsed ? (
          <button
            type="button"
            className="gh-detail-toggle-bar"
            aria-expanded={false}
            onClick={toggleCollapsed}
          >
            <Icon name="ph:caret-down-bold" width={11} aria-hidden />
            Show details
          </button>
        ) : (
          <div className="gh-detail-holder reveal-scope">
            {detail}
            <IconButton
              icon="ph:sidebar-simple"
              aria-label="Collapse details panel"
              aria-expanded
              size="sm"
              className="gh-detail-collapse reveal-on-hover"
              onClick={toggleCollapsed}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={measureRef} className="gh-workspace gh-workspace--split">
      <Group
        orientation="horizontal"
        className="gh-workspace-group"
        defaultLayout={defaultLayout}
        onLayoutChanged={(...args) => {
          // Never persist the collapsed rail as the saved width.
          if (!collapsedRef.current) onLayoutChanged(...args);
        }}
      >
        <Panel id="gh-list" className="gh-list-pane" minSize="320px">
          {children}
        </Panel>
        <Separator className="shell-separator gh-workspace-separator">
          <SeparatorHandle orientation="col" />
        </Separator>
        <Panel
          id="gh-detail"
          className="gh-detail-pane"
          defaultSize="380px"
          minSize="300px"
          maxSize="560px"
          collapsible
          collapsedSize={GH_DETAIL_RAIL_PX}
          panelRef={detailPanelRef}
          onResize={(size) => {
            // Dragging past minSize collapses without the toggle button —
            // keep the pref in sync with what the user can see.
            const px = size.inPixels ?? 0;
            const next = px <= GH_DETAIL_RAIL_PX + 8;
            if (!next) lastExpandedPxRef.current = px;
            if (next !== collapsedRef.current) persistCollapsed(next);
          }}
        >
          {collapsed ? (
            <div className="gh-detail-rail">
              <IconButton
                icon="ph:sidebar-simple"
                aria-label="Expand details panel"
                aria-expanded={false}
                size="sm"
                onClick={toggleCollapsed}
              />
            </div>
          ) : (
            <div className="gh-detail-holder reveal-scope">
              {detail}
              <IconButton
                icon="ph:sidebar-simple"
                aria-label="Collapse details panel"
                aria-expanded
                size="sm"
                className="gh-detail-collapse reveal-on-hover"
                onClick={toggleCollapsed}
              />
            </div>
          )}
        </Panel>
      </Group>
    </div>
  );
}

// ── Selected item detail ─────────────────────────────────────────────────────

/**
 * Watch/unwatch the selected item's repo right from the detail panel — the
 * subscribe path for "the repo you're viewing" (cave-hlxn). Backed by
 * /api/github/subscriptions; the first watch also flips the watcher's master
 * switch on (watching a repo means you want its notifications). Hidden until
 * the current watch state is known so it never lies.
 */
function WatchRepoChip({ repo }: { repo: string }) {
  const { announce } = useAnnouncer();
  const [watched, setWatched] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWatched(null);
    (async () => {
      try {
        const res = await fetch("/api/github/subscriptions", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.ok) {
          setWatched(Array.isArray(data.prefs?.repos) && data.prefs.repos.includes(repo));
        }
      } catch {
        /* leave null — the chip stays hidden rather than guessing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const toggle = async () => {
    if (watched === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/github/subscriptions", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // Refresh failed — deriving repos from a failed read could PATCH the
        // user's whole watch list away (empty repos). Keep state, tell them.
        announce(`Could not update the watch list for ${repo} — try again.`);
        return;
      }
      const repos: string[] = Array.isArray(data?.prefs?.repos) ? data.prefs.repos : [];
      const next = watched ? repos.filter((r) => r !== repo) : [...new Set([...repos, repo])];
      const body = watched ? { repos: next } : { repos: next, enabled: true };
      const patch = await fetch("/api/github/subscriptions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const patched = await patch.json().catch(() => null);
      if (patch.ok && patched?.ok) {
        setWatched(!watched);
        announce(
          watched
            ? `Unwatched ${repo}.`
            : `Watching ${repo} — new PRs and CI results land in your Inbox.`,
        );
      } else {
        announce(`Could not update the watch list for ${repo} — try again.`);
      }
    } catch {
      announce(`Could not update the watch list for ${repo} — try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (watched === null) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      leadingIcon={watched ? "ph:bell-ringing" : "ph:bell"}
      aria-pressed={watched}
      disabled={busy}
      onClick={() => void toggle()}
      title={
        watched
          ? `Stop watching ${repo}`
          : `Watch ${repo} — new PRs and CI results land in your Inbox`
      }
    >
      {watched ? "Watching" : "Watch repo"}
    </Button>
  );
}

// ── Landing gates ─────────────────────────────────────────────────────────────

/** One merge precondition, and how close it is to clear. */
type LandingGate = {
  key: string;
  label: string;
  value: string;
  tone: GhTone;
  /** 0–1, drawn as the card's fill bar. */
  progress: number;
  title: string;
};

const GATE_ICON: Record<GhTone, IconName> = {
  ok: "ph:check",
  bad: "ph:x",
  warn: "ph:warning-circle",
  acc: "ph:sparkle",
  mute: "ph:circle",
};

/**
 * The three things that decide whether a pull request can land — CI, review,
 * mergeability — as one strip, read before the title's ink is dry.
 *
 * Each card says what it knows and nothing more: a precondition whose data
 * never arrived reports "not reported" in the muted tone rather than borrowing
 * a green from a sibling. Issues get no strip at all; they have no gates, and
 * three grey cards saying so would be worse than the space they cost.
 */
function landingGates(item: GitHubItem, detail: ItemDetail | null, checks: ChecksState): LandingGate[] {
  const data = checks.status === "ready" ? checks.data : null;
  const rollup = data?.rollup ?? item.checkStatus ?? null;
  const failed = (data?.runs ?? []).filter(
    (r) => checkPresentation(r.status, r.conclusion).bucket === "failed",
  ).length;
  const running = (data?.runs ?? []).filter(
    (r) => checkPresentation(r.status, r.conclusion).bucket === "running",
  ).length;

  const checksGate: LandingGate =
    rollup === "passing"
      ? { key: "checks", label: "checks", value: "all passed", tone: "ok", progress: 1, title: "Continuous integration" }
      : rollup === "failing"
        ? { key: "checks", label: "checks", value: failed ? `${failed} failed` : "failing", tone: "bad", progress: 0.4, title: "Continuous integration" }
        : rollup === "pending"
          ? { key: "checks", label: "checks", value: running ? `${running} running` : "running", tone: "warn", progress: 0.6, title: "Continuous integration" }
          : { key: "checks", label: "checks", value: "not reported", tone: "mute", progress: 0, title: "Continuous integration" };

  const tally = detail?.pull?.reviews ?? null;
  const reviewGate: LandingGate = !tally
    ? { key: "review", label: "review", value: "not reported", tone: "mute", progress: 0, title: "Review verdicts on this pull request" }
    : tally.changesRequested > 0
      ? { key: "review", label: "review", value: `${tally.changesRequested} requesting changes`, tone: "bad", progress: 0.25, title: "Review verdicts on this pull request" }
      : tally.approved > 0
        ? { key: "review", label: "review", value: `${tally.approved} approval${tally.approved === 1 ? "" : "s"}`, tone: "ok", progress: 1, title: "Review verdicts on this pull request" }
        : { key: "review", label: "review", value: "no verdict yet", tone: "warn", progress: 0.4, title: "Review verdicts on this pull request" };

  const pull = detail?.pull ?? null;
  const mergeState = pull?.mergeableState ?? "unknown";
  const mergeGate: LandingGate =
    pull == null
      ? { key: "merge", label: "merge", value: "not reported", tone: "mute", progress: 0, title: "Mergeability against the base branch" }
      : pull.mergeable === false || mergeState === "dirty"
        ? { key: "merge", label: "merge", value: "conflicts", tone: "bad", progress: 0.2, title: "Mergeability against the base branch" }
        : mergeState === "blocked"
          ? { key: "merge", label: "merge", value: "blocked by a rule", tone: "warn", progress: 0.5, title: "Mergeability against the base branch" }
          : mergeState === "behind"
            ? { key: "merge", label: "merge", value: "behind the base", tone: "warn", progress: 0.6, title: "Mergeability against the base branch" }
            : mergeState === "unstable"
              ? { key: "merge", label: "merge", value: "checks unstable", tone: "warn", progress: 0.6, title: "Mergeability against the base branch" }
              : mergeState === "draft"
                ? { key: "merge", label: "merge", value: "draft", tone: "mute", progress: 0, title: "Mergeability against the base branch" }
                : pull.mergeable === true
                  ? { key: "merge", label: "merge", value: "clean", tone: "ok", progress: 1, title: "Mergeability against the base branch" }
                  : { key: "merge", label: "merge", value: "computing…", tone: "mute", progress: 0, title: "Mergeability against the base branch" };

  return [checksGate, reviewGate, mergeGate];
}

/**
 * The gate strip. Below ~300px the three cards stop being cards — a value that
 * ellipses to nothing is not a signal — and collapse to one label-and-value row
 * each, measured on the element itself rather than the viewport so it still
 * works at a dragged split the media query knows nothing about.
 */
function LandingGateStrip({ gates }: { gates: LandingGate[] }) {
  const [tight, setTight] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0) setTight(width < 300);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      role="group"
      aria-label="Landing signals"
      className={`gh-gates${tight ? " gh-gates--tight" : ""}`}
    >
      {gates.map((gate) => (
        <div key={gate.key} className={`gh-gate gh-tone--${gate.tone}`} title={`${gate.title} — ${gate.value}`}>
          <span className="gh-gate-label">
            <Icon name={GATE_ICON[gate.tone]} width={9} aria-hidden />
            <span className="gh-gate-label-text">{gate.label}</span>
          </span>
          <span className="gh-gate-value">{gate.value}</span>
          <span className="gh-gate-track" aria-hidden>
            <span className="gh-gate-fill" style={{ width: `${Math.round(gate.progress * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A collapsible body section with a tone edge and a summary in its header. */
function GhSection({
  id,
  title,
  summary,
  tone = "mute",
  open,
  onToggle,
  count,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  tone?: GhTone;
  open: boolean;
  onToggle: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section data-gh-section={id} className={`gh-section gh-tone--${tone}`}>
      <button type="button" className="gh-section-head focus-ring" aria-expanded={open} onClick={onToggle}>
        <span className="gh-section-edge" aria-hidden />
        <span className="gh-section-title">{title}</span>
        {count != null ? <span className="gh-section-count">{count}</span> : null}
        <span className="gh-section-spacer" />
        {summary ? <span className="gh-section-summary">{summary}</span> : null}
        <span className={`gh-section-caret${open ? "" : " is-collapsed"}`} aria-hidden>
          <Icon name="ph:caret-down" width={9} />
        </span>
      </button>
      {open ? <div className="gh-section-body">{children}</div> : null}
    </section>
  );
}

/**
 * The selected item, read in full.
 *
 * Three bands, in the order a triage decision actually needs them: a masthead
 * that identifies the item and states its landing gates; a scrolling body with
 * the brief, the conversation, the checks and the linked Cave work; and a
 * pinned "what to do next" drawer that names the one sentence of judgment and
 * puts the verbs under it. The drawer is pinned rather than appended because
 * the decision is what the panel is for — scrolling past the conversation to
 * find the buttons put the least-read content between you and the action.
 *
 * `focused` raises the same panel over the list as a modal read, through a
 * portal: an ancestor with `backdrop-filter` would otherwise become the
 * containing block for `position:fixed` and strand it inside the split.
 */
function GitHubItemGlassPanel({
  item,
  linkedCards,
  familiars,
  resolvedById,
  cards,
  familiarsFailed = false,
  cardsFailed = false,
  countLabels,
  focused = false,
  backLabel = "Back to the list",
  onUnfocus,
  onJumpToSession,
  onFocusCard,
  onAfterLink,
}: {
  item: GitHubItem | null;
  linkedCards: Card[];
  familiars: Familiar[];
  resolvedById: Map<string, ResolvedFamiliar>;
  cards: Card[];
  familiarsFailed?: boolean;
  cardsFailed?: boolean;
  countLabels: Record<"pr" | "review_request" | "issue", string>;
  focused?: boolean;
  backLabel?: string;
  onUnfocus?: () => void;
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard?: (cardId: string) => void;
  onAfterLink: () => void;
}) {
  const detailState = useGitHubItemDetail(item);
  const isPull = item != null && (item.kind === "pr" || item.kind === "review_request");
  const checksState = useGitHubChecks(item, isPull);
  const [open, setOpen] = useState<Record<string, boolean>>({ brief: true, talk: true, linked: true });
  const [factsOpen, setFactsOpen] = useState(false);
  // Collapsed by default, as in the design. Open, the drawer takes a third of a
  // quarter-width split and leaves the brief a couple of lines — so the
  // collapsed header carries the gate rollup instead, and one click gets the
  // verbs. The choice sticks for the visit: triage opens it once, not per row.
  const [nextOpen, setNextOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // Focused, this is a real modal: trap the tab ring inside it, return focus to
  // whatever opened it, and let the hook own Escape. Inert while docked in the
  // split, where the panel is just another region of the page.
  useFocusTrap(focused, panelRef, { onEscape: onUnfocus });

  const toggle = useCallback((key: string) => {
    setOpen((prev) => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  // Jump: open the section first, then scroll it under the sticky rail. The
  // section may still be collapsed on this frame, so measure on the next one.
  const jumpTo = useCallback((key: string) => {
    setOpen((prev) => ({ ...prev, [key]: true }));
    requestAnimationFrame(() => {
      const host = bodyRef.current;
      const target = host?.querySelector<HTMLElement>(`[data-gh-section="${key}"]`);
      if (!host || !target) return;
      const rail = host.querySelector<HTMLElement>(".gh-jump");
      const pad = 6 + (rail?.getBoundingClientRect().height ?? 0);
      const delta = target.getBoundingClientRect().top - host.getBoundingClientRect().top - pad;
      host.scrollTop = Math.max(0, host.scrollTop + delta);
    });
  }, []);

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
  const openedNoun = isPull ? "pull request" : "issue";
  const detailLabel = KIND_DETAIL_LABEL[item.kind] ?? item.kind;
  const kindColor = KIND_COLOR[item.kind] ?? "var(--text-muted)";

  const rowFamiliars = Array.from(
    new Set(linkedCards.map((card) => card.familiarId).filter((id): id is string => Boolean(id))),
  );
  const sessionCard = linkedCards.find((card) => card.sessionId) ?? null;
  const sessionFamiliar = sessionCard?.familiarId ? resolvedById.get(sessionCard.familiarId) : null;
  const sessionLabel = sessionCard
    ? sessionFamiliar?.display_name ?? sessionCard.sessionId!.slice(0, 12)
    : null;

  const stage = deriveStage(item, { linkedCount: linkedCards.length, session: sessionLabel });
  const gates = landingGates(item, detail, checksState);
  const worstGate =
    gates.find((g) => g.tone === "bad")
    ?? gates.find((g) => g.tone === "warn")
    ?? gates.find((g) => g.tone === "mute")
    ?? null;
  const gateTone = worstGate?.tone ?? "ok";

  const labels = detail?.labels ?? [];
  const pull = detail?.pull ?? null;
  const facts: { key: string; value: string }[] = [
    { key: "repo", value: item.repo },
    { key: "branch", value: pull?.headRef || (sessionLabel ? `${sessionLabel} (Cave)` : "no local branch") },
    { key: "base", value: pull?.baseRef || "—" },
    {
      key: "size",
      value: pull
        ? `${pull.changedFiles} file${pull.changedFiles === 1 ? "" : "s"} · +${pull.additions} −${pull.deletions}`
        : "—",
    },
    { key: "assignees", value: (detail?.assignees ?? []).map((p) => p.login).join(", ") || "unassigned" },
    { key: "labels", value: labels.map((l) => l.name).join(", ") || "none" },
  ].filter((f) => f.value !== "—");

  const jumpTargets = [
    { key: "brief", label: "brief" },
    { key: "talk", label: "talk", count: detail?.comments },
    ...(isPull ? [{ key: "checks", label: "checks" }] : []),
    { key: "linked", label: "linked", count: linkedCards.length },
  ];

  const panel = (
    <aside
      ref={panelRef}
      // Docked, it is a labelled region. Raised over the list behind a scrim it
      // IS a modal, and saying so is what lets a screen reader treat it as one.
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      className={`gh-glass-panel gh-detail${focused ? " is-focused" : ""}`}
      aria-label={`${detailLabel} details`}
    >
      {focused ? (
        <div className="gh-detail-focusbar">
          <button type="button" className="gh-detail-back focus-ring" onClick={onUnfocus}>
            <Icon name="ph:caret-left" width={10} aria-hidden />
            {backLabel}
          </button>
          <span className="gh-detail-spacer" />
          <span className="gh-detail-esc">Esc to close</span>
        </div>
      ) : null}

      <div className="gh-detail-mast">
        <div className="gh-detail-kindrow">
          <span className="gh-detail-kind" style={{ color: kindColor }}>
            <Icon name={KIND_ICON[item.kind] ?? "ph:github-logo"} width={12} aria-hidden />
            {detailLabel}
          </span>
          {item.number != null ? <span className="gh-detail-number">#{item.number}</span> : null}
          <span className={`gh-detail-state gh-detail-state--${stateKind}`}>
            <span className="gh-detail-state-dot" aria-hidden />
            {stateLabel}
          </span>
          <span className="gh-detail-spacer" />
          <CopyButton value={item.url} label="Copy the link to this item" />
        </div>

        <h2 className="gh-detail-title">{detail?.title ?? item.title}</h2>

        <div className="gh-detail-byline">
          {detail?.author ? <PersonChip person={detail.author} /> : null}
          <span className="gh-detail-byline-text">
            {detail?.author ? "opened this " : ""}
            {openedNoun}
            {" · "}
            <RelativeTime iso={detail?.createdAt ?? item.updatedAt} />
          </span>
        </div>

        {isPull ? <LandingGateStrip gates={gates} /> : null}

        <div className="gh-detail-verbs">
          <WatchRepoChip repo={item.repo} />
          <Button
            size="sm"
            variant="secondary"
            leadingIcon="ph:arrow-square-out"
            onClick={(e) => { e.preventDefault(); openExternalUrl(item.url); }}
          >
            Open on GitHub
          </Button>
          {isPull ? (
            <GhReviewActions
              pr={{
                repo: item.repo,
                number: item.number ?? null,
                title: detail?.title ?? item.title,
                state: stateKind,
                author: detail?.author?.login ?? null,
                url: detail?.htmlUrl ?? item.url,
                body: detail?.body ?? null,
              }}
              familiars={familiars}
            />
          ) : null}
          <button
            type="button"
            className="gh-detail-facts-toggle focus-ring"
            aria-expanded={factsOpen}
            onClick={() => setFactsOpen((v) => !v)}
          >
            <Icon name={factsOpen ? "ph:caret-up" : "ph:caret-down"} width={9} aria-hidden />
            Facts
          </button>
        </div>

        {factsOpen ? (
          <dl className="gh-facts">
            {facts.map((fact) => (
              <div key={fact.key} className="gh-facts-row">
                <dt>{fact.key}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="gh-detail-body" ref={bodyRef}>
        <nav className="gh-jump" aria-label="Jump to a section">
          {jumpTargets.map((target) => (
            <button
              key={target.key}
              type="button"
              className="gh-jump-pill focus-ring"
              onClick={() => jumpTo(target.key)}
            >
              {target.label}
              {target.count ? <span className="gh-jump-count">{target.count}</span> : null}
            </button>
          ))}
        </nav>

        <GhSection
          id="brief"
          title="brief"
          summary={open.brief === false ? "what this is" : undefined}
          open={open.brief !== false}
          onToggle={() => toggle("brief")}
        >
          {detailState.status === "loading" ? (
            <p className="gh-glass-muted">Loading the description…</p>
          ) : detailState.status === "error" ? (
            <p className="gh-glass-muted">Couldn’t load the description — open on GitHub for the full thread.</p>
          ) : detail?.body?.trim() ? (
            <MarkdownBlock text={gfmAutolink(detail.body, { repo: item.repo })} className="gh-issue-body" />
          ) : (
            <p className="gh-glass-muted">No description provided.</p>
          )}
          {labels.length > 0 ? (
            <div className="gh-detail-labels">
              {labels.map((label) => (
                <span key={label.name} className="gh-detail-label">{label.name}</span>
              ))}
            </div>
          ) : null}
        </GhSection>

        <div data-gh-section="talk">
          <GitHubComments item={item} detail={detail} />
        </div>

        {isPull ? (
          <div data-gh-section="checks">
            <GitHubChecks item={item} state={checksState} />
          </div>
        ) : null}

        <GhSection
          id="linked"
          title="linked work"
          tone={linkedCards.length > 0 ? "acc" : "mute"}
          count={linkedCards.length}
          open={open.linked !== false}
          onToggle={() => toggle("linked")}
        >
          {linkedCards.length > 0 ? (
            <div className="gh-glass-linked">
              {linkedCards.slice(0, 4).map((card) => (
                <LinkedTaskChip
                  key={card.id}
                  card={card}
                  familiar={card.familiarId ? resolvedById.get(card.familiarId) ?? null : null}
                  onFocusCard={onFocusCard}
                />
              ))}
            </div>
          ) : (
            <p className="gh-glass-muted">No Cave tasks linked yet.</p>
          )}
          {rowFamiliars.length > 0 ? (
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
          ) : null}
        </GhSection>
      </div>

      <div className={`gh-next${nextOpen ? " is-open" : ""}`}>
        <button
          type="button"
          className="gh-next-head focus-ring"
          aria-expanded={nextOpen}
          onClick={() => setNextOpen((v) => !v)}
        >
          <span className={`gh-next-caret${nextOpen ? " is-open" : ""}`} aria-hidden>
            <Icon name="ph:caret-up" width={9} />
          </span>
          <span className="gh-next-title">what to do next</span>
          <span className="gh-detail-spacer" />
          {isPull ? (
            // The headline, not all three values concatenated: collapsed, this
            // line has room for one fact, and the one worth having is whichever
            // gate is furthest from clear.
            <span className={`gh-next-rollup gh-tone--${gateTone}`}>
              <span className="gh-next-rollup-dot" aria-hidden />
              {worstGate ? `${worstGate.label} — ${worstGate.value}` : "every gate clear"}
            </span>
          ) : null}
        </button>

        {nextOpen ? (
          <div className="gh-next-body">
            <p className={`gh-next-card gh-tone--${stage.tone}`}>{GH_NEXT_STEP[stage.key]}</p>

            <div className="gh-next-verbs">
              <OpenChatAction
                item={item}
                linkedCards={linkedCards}
                familiars={familiars}
                cards={cards}
                familiarsFailed={familiarsFailed}
                cardsFailed={cardsFailed}
                onJumpToSession={onJumpToSession}
                onAfterLink={onAfterLink}
              />
              <AddToBoardAction
                item={item}
                familiars={familiars}
                cards={cards}
                familiarsFailed={familiarsFailed}
                cardsFailed={cardsFailed}
                onAfterLink={onAfterLink}
              />
              <SafeMergeAction item={item} linkedCards={linkedCards} familiars={familiars} />
            </div>

            <dl className="gh-next-wire">
              <div className="gh-facts-row">
                <dt>github</dt>
                <dd>
                  {stateLabel.toLowerCase()}
                  {isPull && pull ? ` · ${pull.commits} commit${pull.commits === 1 ? "" : "s"}` : ""}
                  {isPull ? ` · ${gates[0].value}` : ""}
                </dd>
              </div>
              <div className="gh-facts-row">
                <dt>local</dt>
                <dd>{sessionLabel ? `${sessionLabel} has this open` : "not checked out locally"}</dd>
              </div>
            </dl>

            <div className="gh-next-stats" aria-label="GitHub activity counts">
              <span className="gh-next-stat"><span>PRs</span><strong>{countLabels.pr}</strong></span>
              <span className="gh-next-stat"><span>Reviews</span><strong>{countLabels.review_request}</strong></span>
              <span className="gh-next-stat"><span>Issues</span><strong>{countLabels.issue}</strong></span>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );

  if (!focused) return panel;
  return createPortal(
    <div className="gh-detail-overlay">
      <div className="gh-detail-scrim" onClick={onUnfocus} aria-hidden />
      {panel}
    </div>,
    document.body,
  );
}

/** Where the focused read returns to — named, so the way out is never a guess. */
const FILTER_BACK_LABEL: Record<Filter, string> = {
  all: "Back to Activity",
  pr: "Back to PRs",
  issue: "Back to Issues",
  review_request: "Back to Reviews",
};

// ── Freshness + budget ────────────────────────────────────────────────────────

/**
 * How stale the list is, as a tone rather than a timestamp nobody subtracts in
 * their head: green under a minute, amber while it drifts, red once a fetch is
 * failing. Ticks on its own so "synced 40s ago" doesn't quietly become a lie
 * between polls.
 */
function GhSyncPill({ syncedAt, failing }: { syncedAt: number | null; failing: boolean }) {
  const [, setTick] = useState(0);
  // Only age a label that is on screen. Before the first successful fetch the
  // pill renders nothing, and a ticker behind it is a timer plus a re-render
  // per 15s for no pixels.
  const ticking = syncedAt !== null;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [ticking]);

  if (syncedAt === null && !failing) return null;
  const ageMs = syncedAt === null ? Number.POSITIVE_INFINITY : Date.now() - syncedAt;
  const tone = failing ? "bad" : ageMs < 60_000 ? "ok" : ageMs < 300_000 ? "warn" : "mute";
  const label = failing
    ? "sync failing"
    : syncedAt === null
      ? "not synced"
      : ageMs < 60_000
        ? "synced just now"
        : `synced ${Math.round(ageMs / 60_000)}m ago`;

  return (
    <span
      className={`gh-sync gh-tone--${tone}`}
      title="Last successful GitHub fetch — green under a minute, amber as it drifts, red once a fetch is failing"
    >
      <span className="gh-sync-dot" aria-hidden />
      {label}
    </span>
  );
}

/**
 * The hour's GitHub API budget as a spent bar. Shown because every surface in
 * the Cave shares one rate limit: when reviews stop loading, this is the first
 * place to look, and a bare number doesn't say whether it is nearly gone.
 */
function GhBudgetMeter({ rateLimit }: { rateLimit: { remaining: number; limit: number } }) {
  const { remaining, limit } = rateLimit;
  if (limit <= 0) return null;
  const left = Math.max(0, Math.min(1, remaining / limit));
  const tone = left < 0.15 ? "bad" : left < 0.4 ? "warn" : "mute";
  return (
    <span
      className={`gh-budget gh-tone--${tone}`}
      title={`GitHub API budget for this hour — ${remaining} of ${limit} requests left. Public access gets 60/h, a PAT gets 5,000/h.`}
    >
      <span className="gh-budget-track" aria-hidden>
        <span className="gh-budget-fill" style={{ width: `${Math.round(left * 100)}%` }} />
      </span>
      {remaining}/{limit} req
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GitHubView({
  onJumpToSession,
  onFocusCard,
  onTasksRefresh,
  initialTarget,
  onInitialTargetHandled,
  initialFilter,
}: Props = {}) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [patStatus, setPatStatus] = useState<PatStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useSurfacePreference(surfacePreferenceSpecs.github.filter);
  // Host-driven filter (Code Workshop's PRs/Issues/Reviews tabs): follow the
  // prop whenever it changes so switching tabs re-filters the same mounted view.
  useEffect(() => {
    if (initialFilter && initialFilter !== filter) setFilter(initialFilter);
    // Only react to the host's prop, not the user's own later chip changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);
  const [orgFilter, setOrgFilter] = useSurfacePreference(surfacePreferenceSpecs.github.organization);
  const [repoFilter, setRepoFilter] = useSurfacePreference(surfacePreferenceSpecs.github.repository);
  const [query, setQuery] = useState("");
  const [showPatModal, setShowPatModal] = useState(false);
  const [showSubsModal, setShowSubsModal] = useState(false);
  const [retryBlocked, setRetryBlocked] = useState(false);
  // Wall-clock of the last successful fetch, for the freshness pill. Held
  // separately from the payload: a poll that fails leaves `activity` intact
  // (stale data still beats none), and the pill has to say so.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [selectedTarget, setSelectedTarget] = useSurfacePreference(surfacePreferenceSpecs.github.selected);
  // Stream state: which stage sections the facet bar narrows to, which are
  // collapsed, and which rows have their peek open. All per-visit — a filter
  // you can't see the effect of is worse than one you have to re-pick.
  const [pickedFacets, setPickedFacets] = useState<GhSectionKey[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Partial<Record<GhSectionKey, boolean>>>({});
  const [peeked, setPeeked] = useState<Record<string, boolean>>({});
  // The detail panel raised over the list (Esc closes) — the design's focused
  // read, for when a diff needs more than the split's quarter-width.
  const [focused, setFocused] = useState(false);
  // Notifications without a PR/issue number cannot be restored semantically,
  // but still need to remain selected for the current visit.
  const [transientSelectedItemId, setTransientSelectedItemId] = useState<string | null>(null);
  // Deep-linked PR/issue from a GitHub-event notification. Cleared when the
  // user picks a row themselves — from then on selection owns the detail.
  const [deepLink, setDeepLink] = useState<GitHubItemTarget | null>(initialTarget ?? null);
  useEffect(() => {
    if (!initialTarget) return;
    setDeepLink(initialTarget);
    onInitialTargetHandled?.();
  }, [initialTarget, onInitialTargetHandled]);
  const selectRow = useCallback((id: string) => {
    setDeepLink(null);
    setTransientSelectedItemId(id);
    const item = activity?.items.find((candidate) => candidate.id === id);
    // The durable selection is a semantic GitHub identity, not the API row id.
    // Notifications without a PR/issue number continue to open for the current
    // visit but are intentionally not persisted.
    setSelectedTarget(item && typeof item.number === "number"
      ? { repo: item.repo, number: item.number, kind: item.kind }
      : null);
  }, [activity?.items, setSelectedTarget]);
  const timerRef = useRef<number | null>(null);
  const retryUnlockTimerRef = useRef<number | null>(null);
  const retryBlockedUntilRef = useRef(0);
  // Guards against setState after unmount from an in-flight fetch (mirrors useCards).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { familiars, familiarsFailed } = useFamiliars();
  const { cards, cardsFailed, reload: reloadCards } = useCards();
  const refreshLinkedWork = useCallback(() => {
    reloadCards();
    onTasksRefresh?.();
  }, [reloadCards, onTasksRefresh]);
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });
  const resolvedById = useMemo(
    () => new Map(resolvedFamiliars.map((f) => [f.id, f])),
    [resolvedFamiliars],
  );

  async function fetchPatStatus() {
    try {
      const { data } = await readSurfaceResource<PatStatus>("github:pat");
      if (data) setPatStatus(data as PatStatus);
    } catch { /* non-fatal */ }
  }

  // Schedule the next poll, unless the tab is hidden — a backgrounded tab keeps
  // burning the GitHub rate limit for output nobody's looking at. The
  // visibilitychange effect refetches (and reschedules) on return.
  function schedulePoll(ms: number) {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (typeof document !== "undefined" && document.hidden) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void fetchActivity(true, true);
    }, ms);
  }

  function applyRetryCooldown(ms: number) {
    if (retryUnlockTimerRef.current !== null) {
      window.clearTimeout(retryUnlockTimerRef.current);
      retryUnlockTimerRef.current = null;
    }
    retryBlockedUntilRef.current = ms > 0 ? Date.now() + ms : 0;
    setRetryBlocked(ms > 0);
    if (ms > 0) {
      retryUnlockTimerRef.current = window.setTimeout(() => {
        retryUnlockTimerRef.current = null;
        retryBlockedUntilRef.current = 0;
        if (mountedRef.current) setRetryBlocked(false);
      }, ms);
    }
  }

  async function fetchActivity(silent = false, force = false) {
    // Skeleton only on the first load — a manual refresh with data already on
    // screen must not unmount the list (and any open composer draft with it).
    if (!silent && !activity) setLoading(true);
    setError(null);
    try {
      const { data } = await readSurfaceResource<ActivityPayload>("github:activity", force);
      if (!mountedRef.current) return;
      if (!data.ok) {
        const retryDelayMs = (data.retryAfterSeconds ?? 0) * 1000;
        applyRetryCooldown(retryDelayMs);
        if (data.error === "no_user") {
          setError("no_user");
          return;
        }
        setError(data.error ?? "GitHub activity unavailable");
        schedulePoll(Math.max(60_000, retryDelayMs));
        return;
      }
      const nextActivity = data;
      setActivity((prev) => {
        const mergedItems = prev
          && prev.login === nextActivity.login
          && prev.authed === nextActivity.authed
          && prev.patInvalid === nextActivity.patInvalid
          ? mergeFailedActivityItems(prev.items, nextActivity.items, nextActivity.collections)
          : nextActivity.items;
        const mergedActivity = mergedItems === nextActivity.items
          ? nextActivity
          : { ...nextActivity, items: mergedItems };
        return prev && prev.authed === mergedActivity.authed
          && prev.patInvalid === mergedActivity.patInvalid
          && prev.warning === mergedActivity.warning
          && prev.retryAfterSeconds === mergedActivity.retryAfterSeconds
          && arrayContentEqual(prev.organizations, mergedActivity.organizations)
          && activityCollectionsEqual(prev.collections, mergedActivity.collections)
          && arrayContentEqual(prev.items, mergedActivity.items)
          ? prev
          : mergedActivity;
      });
      setError(null);
      setLastSyncedAt(Date.now());
      const basePollMs = nextActivity.authed ? 90_000 : 120_000;
      const retryDelayMs = Math.max(
        activityRetryAfterSeconds(nextActivity.collections),
        nextActivity.retryAfterSeconds ?? 0,
      ) * 1000;
      applyRetryCooldown(retryDelayMs);
      schedulePoll(Math.max(basePollMs, retryDelayMs));
    } catch (e) {
      if (!mountedRef.current) return;
      const retryDelayMs = surfaceWarmupRetryAfterSeconds(e) * 1000;
      applyRetryCooldown(retryDelayMs);
      setError(e instanceof Error ? e.message : "Failed to load GitHub activity");
      schedulePoll(Math.max(60_000, retryDelayMs));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // Manual refresh: cancel the pending scheduled poll first so we never spawn a
  // second self-scheduling timer chain (the error-state Retry used to skip this
  // and leak a chain, doubling the poll rate — and the GitHub rate-limit spend).
  function refreshActivity() {
    if (Date.now() < retryBlockedUntilRef.current) return;
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    void fetchActivity(false, true);
  }

  useEffect(() => {
    void fetchPatStatus();
    void fetchActivity();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (retryUnlockTimerRef.current !== null) window.clearTimeout(retryUnlockTimerRef.current);
    };
  }, []);

  // Pause polling while the tab is hidden; refetch (and resume the chain) on
  // return so a backgrounded tab doesn't keep spending the rate limit.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      } else {
        const retryDelayMs = Math.max(0, retryBlockedUntilRef.current - Date.now());
        if (retryDelayMs > 0) schedulePoll(retryDelayMs);
        else void fetchActivity(true, true);
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
      refreshActivity();
      refreshLinkedWork(); // keep linked cards and shell task context fresh too
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshLinkedWork]);

  const items = activity?.items ?? [];
  // The configured organization scope (Settings → GitHub). Empty = all
  // memberships; a non-empty list limits the whole surface to those orgs.
  const orgScope = useAppPreferences().github.orgScope;
  const filtered = useMemo(() => {
    const byKind = filter === "all" ? items : items.filter((i) => i.kind === filter);
    return orgScope.length === 0 ? byKind : byKind.filter((i) => orgScope.includes(orgOf(i.repo)));
  }, [items, filter, orgScope]);

  // Org filter options are derived only from organizations represented in the
  // current base item set (after kind + orgScope filtering, but before org/repo
  // filters and the search query). The active orgFilter is still included so a
  // selection whose rows dropped out doesn't fall out of the select's options.
  const orgOptions = useMemo(
    () => Array.from(new Set([
      ...filtered.map((i) => orgOf(i.repo)),
      ...(orgFilter === "all" ? [] : [orgFilter]),
    ])).sort((a, b) => a.localeCompare(b)),
    [filtered, orgFilter],
  );
  const repoOptions = useMemo(() => {
    const base = orgFilter === "all" ? filtered : filtered.filter((i) => orgOf(i.repo) === orgFilter);
    return Array.from(new Set([
      ...base.map((i) => i.repo),
      ...(repoFilter === "all" ? [] : [repoFilter]),
    ])).sort((a, b) => a.localeCompare(b));
  }, [filtered, orgFilter, repoFilter]);
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

  // Stage sections do the grouping now, so the only ordering left inside a
  // bucket is recency — the question a sort column used to answer ("what
  // changed last") is the one thing sections don't already say.
  const sorted = useMemo(
    () => [...scoped].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    [scoped],
  );

  // Each row resolved once: stage, linked Cave work, and the familiar holding
  // it. Sections, facet counts and the row badges all read from this, so a chip
  // can never advertise a count the list underneath it doesn't contain.
  const entries = useMemo<GhStreamEntry<GitHubItem>[]>(
    () =>
      sorted.map((item) => {
        const linked = linkedMap.get(item.id) ?? [];
        const withSession = linked.find((card) => card.sessionId);
        const familiarId = withSession?.familiarId ?? linked.find((c) => c.familiarId)?.familiarId;
        const session = withSession
          ? (familiarId ? resolvedById.get(familiarId)?.display_name : null)
            ?? withSession.sessionId!.slice(0, 12)
          : null;
        const linkage = { linkedCount: linked.length, session };
        return { row: item, stage: deriveStage(item, linkage), ...linkage };
      }),
    [sorted, linkedMap, resolvedById],
  );

  const allSections = useMemo(() => groupIntoSections(filter, entries), [filter, entries]);
  const facets = useMemo(() => facetsFor(allSections), [allSections]);
  const sections = useMemo(
    () => (pickedFacets.length === 0 ? allSections : allSections.filter((s) => pickedFacets.includes(s.key))),
    [allSections, pickedFacets],
  );
  const shownCount = useMemo(
    () => sections.reduce((n, s) => n + s.entries.length, 0),
    [sections],
  );
  const streamRows = useMemo(
    () => sections.flatMap((s) => (collapsedSections[s.key] ? [] : s.entries.map((e) => e.row))),
    [sections, collapsedSections],
  );

  const counts: Record<Filter, number> = useMemo(
    () => ({
      all: items.length,
      pr: items.filter((i) => i.kind === "pr").length,
      review_request: items.filter((i) => i.kind === "review_request").length,
      issue: items.filter((i) => i.kind === "issue").length,
    }),
    [items],
  );
  const activityIncomplete = activity
    ? !activityCollectionsComplete(activity.collections)
    : false;
  const countLabels = useMemo(
    () => ({
      pr: activity ? activityCountLabel(counts.pr, activity.collections.authored) : String(counts.pr),
      review_request: activity
        ? activityCountLabel(counts.review_request, activity.collections.reviewRequests)
        : String(counts.review_request),
      issue: activity
        ? activityCountLabel(counts.issue, activity.collections.assignedIssues)
        : String(counts.issue),
    }),
    [activity, counts],
  );
  const completenessNotice = activity
    ? activityCompletenessNotice(activity.collections, { includeUnavailable: !activity.patInvalid })
    : null;
  const completenessNeedsRetry = activity
    ? Object.values(activity.collections).some(
        (collection) => collection.status === "failed" || collection.githubIncomplete,
      )
    : false;
  const staleErrorNotice = error && activity
    ? `Couldn't refresh GitHub. Showing last loaded activity. ${error}`
    : null;
  const activityNotice = [staleErrorNotice, activity?.warning, completenessNotice]
    .filter((notice): notice is string => Boolean(notice))
    .join(" ");
  const activityNoticeNeedsRetry = Boolean(
    staleErrorNotice || activity?.warning || completenessNeedsRetry,
  );
  const reviewsUnavailable = activity?.collections.reviewRequests.status === "unavailable";

  const sameSelectedTarget = useCallback((item: GitHubItem) =>
    selectedTarget !== null &&
    item.repo === selectedTarget.repo &&
    item.number === selectedTarget.number &&
    (item.kind === selectedTarget.kind ||
      ((item.kind === "pr" || item.kind === "review_request") &&
        (selectedTarget.kind === "pr" || selectedTarget.kind === "review_request"))),
  [selectedTarget]);

  useEffect(() => {
    if (!selectedTarget || loading || error) return;
    const exists = items.some(sameSelectedTarget);
    if (!exists) setSelectedTarget(null);
  }, [items, loading, error, selectedTarget, sameSelectedTarget, setSelectedTarget]);

  // The deep-linked item may not be in the activity list (old PR, other repo):
  // prefer the live row when present (real title/state, row highlight), else
  // synthesize the minimal shape the detail pane needs to fetch
  // /api/github/item?repo&number.
  const deepLinkItem = useMemo<GitHubItem | null>(() => {
    if (!deepLink) return null;
    const listed = sorted.find((it) => it.repo === deepLink.repo && it.number === deepLink.number);
    if (listed) return listed;
    return {
      kind: deepLink.kind,
      id: `deeplink:${deepLink.repo}#${deepLink.number}`,
      title: `${deepLink.repo} #${deepLink.number}`,
      repo: deepLink.repo,
      number: deepLink.number,
      url: deepLink.url,
      updatedAt: new Date().toISOString(),
    };
  }, [deepLink, sorted]);

  // Falls back to the first row the stream is actually showing, not the first
  // row that exists — otherwise narrowing to a facet leaves the panel inspecting
  // something the list no longer lists.
  const selectedItem = useMemo(
    () =>
      deepLinkItem
      ?? sorted.find(sameSelectedTarget)
      ?? sorted.find((item) => item.id === transientSelectedItemId)
      ?? streamRows[0]
      ?? sorted[0]
      ?? null,
    [deepLinkItem, sorted, streamRows, sameSelectedTarget, transientSelectedItemId],
  );
  const selectedLinkedCards = selectedItem ? linkedMap.get(selectedItem.id) ?? [] : [];

  // A facet naming a section that no longer exists would silently empty the
  // list, so drop stale picks whenever the available sections change (tab
  // switch, search, a bucket emptying out).
  useEffect(() => {
    setPickedFacets((picked) => {
      const live = picked.filter((key) => allSections.some((s) => s.key === key));
      return live.length === picked.length ? picked : live;
    });
  }, [allSections]);

  const toggleFacet = useCallback((key: GhSectionKey) => {
    setPickedFacets((picked) =>
      picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key],
    );
  }, []);
  const toggleSection = useCallback((key: GhSectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const togglePeek = useCallback((id: string) => {
    setPeeked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const openDetail = useCallback((id: string) => {
    selectRow(id);
    setFocused(true);
  }, [selectRow]);

  const filtersDirty =
    pickedFacets.length > 0 || query.trim().length > 0 || orgFilter !== "all" || repoFilter !== "all";
  const clearFilters = useCallback(() => {
    setPickedFacets([]);
    setQuery("");
    setOrgFilter("all");
    setRepoFilter("all");
  }, [setOrgFilter, setRepoFilter]);

  // Esc leaves the focused read and returns to the split — the only way out
  // that doesn't require finding a button.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setFocused(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  return (
    <GitHubProfileProvider>
    <section className="github-surface flex h-full flex-col text-[var(--text-primary)]">

      {showPatModal && (
        <PatSetupModal
          username={patStatus?.login ?? null}
          hasPat={patStatus?.hasPat ?? false}
          canRemoveStoredPat={patStatus?.canRemoveStoredPat ?? false}
          onSaved={() => {
            invalidateSurfaceResources("github:pat", "github:activity");
            // A stored Cave PAT can coexist with a launcher-provided token.
            // Re-read the server status after either save or removal instead of
            // assuming the local mutation describes the remaining credential.
            void fetchPatStatus();
            setShowPatModal(false);
            refreshActivity();
          }}
          onClose={() => setShowPatModal(false)}
        />
      )}

      {showSubsModal && (
        <GithubSubscriptionsModal
          hasPat={patStatus?.hasPat ?? false}
          onConnectPat={() => {
            setShowSubsModal(false);
            setShowPatModal(true);
          }}
          onClose={() => setShowSubsModal(false)}
        />
      )}

      {/* ── Header ── */}
      <header className="github-surface-header gh-compact-header">
        <div className="gh-compact-meta">
          {activity?.login && (
            <span className="gh-compact-login">@{activity.login}</span>
          )}

          {activity?.patInvalid && (
            <button
              type="button"
              onClick={() => setShowPatModal(true)}
              className="gh-compact-auth gh-compact-auth--invalid focus-ring"
              title="GitHub rejected the stored token (revoked or expired) — update your PAT"
            >
              token rejected — update PAT
            </button>
          )}
          {!activity?.patInvalid && activity?.authed === false && (
            <span
              className="gh-compact-auth gh-compact-auth--public"
              title="Public API — add a PAT for private repos + review requests"
            >
              public API
            </span>
          )}

          <GhSyncPill syncedAt={lastSyncedAt} failing={Boolean(error)} />

          {activity?.rateLimit && <GhBudgetMeter rateLimit={activity.rateLimit} />}
        </div>

        {/* Host-driven filter (Code Workshop tabs) owns the switch — hide the
            in-view chips so there is only one control. */}
        {initialFilter ? null : (
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
        )}

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
          <StandardSelect
            label="Filter by organization"
            className="gh-select"
            value={orgFilter}
            onChange={setOrgFilter}
            title={repoFilter !== "all" ? "Org is locked to the selected repo — clear the repo to change it" : "Filter by organization"}
            disabled={orgOptions.length === 0 || repoFilter !== "all"}
            options={[
              { value: "all", label: "All orgs" },
              ...orgOptions.map((org) => ({ value: org, label: org })),
            ]}
          />
          <StandardSelect
            label="Filter by repository"
            className="gh-select"
            value={repoFilter}
            onChange={setRepoFilter}
            title="Filter by repository"
            disabled={repoOptions.length === 0}
            options={[
              { value: "all", label: "All repos" },
              ...repoOptions.map((repo) => ({
                value: repo,
                label: orgFilter === "all" ? repo : (repo.split("/")[1] ?? repo),
              })),
            ]}
          />
          {/* §8 chrome budget: the grouping radios and PAT management moved to
              the overflow menu below — occasional configuration, not per-visit
              chrome. "Add PAT" stays visible only while unconnected (setup CTA). */}
        </div>

        <div className="gh-compact-actions">
          {!patStatus?.hasPat ? (
            <Button
              size="xs"
              variant="secondary"
              leadingIcon="ph:key"
              onClick={() => setShowPatModal(true)}
              title="Connect GitHub PAT"
              aria-label="Connect GitHub PAT"
            >
              Add PAT
            </Button>
          ) : null}
          <IconButton
            icon="ph:arrows-clockwise"
            size="sm"
            onClick={() => {
              refreshActivity();
              refreshLinkedWork();
            }}
            title="Refresh (⌘R)"
            aria-label="Refresh GitHub activity"
          />
          <IconButton
            icon="ph:bell-ringing"
            size="sm"
            onClick={() => setShowSubsModal(true)}
            title="Event subscriptions — opened PRs, CI completions"
            aria-label="Event subscriptions"
          />
          {/* Row grouping retired with the table: the stream groups by stage,
              and a second grouping axis on top of that only competes with it. */}
          <OverflowMenu ariaLabel="More GitHub options">
            <PopoverLabel>Sections</PopoverLabel>
            <PopoverItem
              icon="ph:caret-down"
              onSelect={() => setCollapsedSections({})}
            >
              Expand every section
            </PopoverItem>
            <PopoverItem
              icon="ph:caret-right"
              onSelect={() =>
                setCollapsedSections(
                  Object.fromEntries(allSections.map((s) => [s.key, true])) as Partial<
                    Record<GhSectionKey, boolean>
                  >,
                )
              }
            >
              Collapse every section
            </PopoverItem>
            {patStatus?.hasPat ? (
              <>
                <PopoverSeparator />
                <PopoverItem icon="ph:key" onSelect={() => setShowPatModal(true)}>
                  Manage GitHub PAT
                </PopoverItem>
              </>
            ) : null}
          </OverflowMenu>
        </div>
      </header>

      {activityNotice && (
        <div role="status" className="gh-completeness-notice">
          <Icon
            name="ph:warning-circle"
            width={14}
            className="gh-completeness-notice-icon"
            aria-hidden
          />
          <span>{activityNotice}</span>
          {activityNoticeNeedsRetry ? (
            <Button
              className="gh-completeness-action"
              size="xs"
              variant="ghost"
              leadingIcon="ph:arrow-clockwise"
              onClick={refreshActivity}
              disabled={retryBlocked}
            >
              {retryBlocked ? "Retry later" : "Retry"}
            </Button>
          ) : reviewsUnavailable ? (
            <Button
              className="gh-completeness-action"
              size="xs"
              variant="ghost"
              leadingIcon="ph:key"
              onClick={() => setShowPatModal(true)}
            >
              {activity?.patInvalid ? "Update PAT" : "Add PAT"}
            </Button>
          ) : null}
        </div>
      )}

      {/* ── Body ── */}
      <div className="github-surface-body min-h-0 flex-1 overflow-hidden">

        {loading ? (
          <div className="p-2">
            <SkeletonRows count={8} />
          </div>

        ) : error === "no_user" && !activity ? (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState
              icon="ph:github-logo"
              headline="Connect your GitHub account"
              subtitle="Start with just a GitHub username to browse public repos — add a personal access token (PAT) later for private repos and reviews. Both stay on this machine."
              actions={
                <Button variant="primary" leadingIcon="ph:github-logo" onClick={() => setShowPatModal(true)}>
                  Set up GitHub
                </Button>
              }
            />
          </div>

        ) : error && !activity ? (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState
              icon="ph:warning-circle"
              headline="Couldn't load GitHub"
              subtitle={error}
              actions={
              <Button
                variant="secondary"
                leadingIcon="ph:arrow-clockwise"
                onClick={refreshActivity}
                disabled={retryBlocked}
              >
                {retryBlocked ? "Retry later" : "Retry"}
              </Button>
              }
            />
          </div>

        ) : sorted.length === 0 && !deepLinkItem ? (
          <div className="flex h-full items-center justify-center px-8">
            {query.trim() ? (
              <EmptyState
                icon="ph:magnifying-glass"
                headline={activityIncomplete
                  ? `No loaded items match “${query.trim()}”`
                  : `No items match “${query.trim()}”`}
                subtitle={activityIncomplete
                  ? activity?.patInvalid
                    ? "Only loaded public activity was searched. Update the rejected PAT to search private repos and reviews."
                    : `Only loaded activity was searched. ${completenessNotice ?? "GitHub activity is incomplete."}`
                  : "Try a shorter query, or clear the search to see everything."}
              />
            ) : completenessNotice ? (
              <EmptyState
                icon="ph:warning-circle"
                headline="GitHub activity is incomplete"
                subtitle={completenessNotice}
                actions={
                  completenessNeedsRetry ? (
                    <Button
                      variant="secondary"
                      leadingIcon="ph:arrow-clockwise"
                      onClick={refreshActivity}
                      disabled={retryBlocked}
                    >
                      {retryBlocked ? "Retry later" : "Retry"}
                    </Button>
                  ) : reviewsUnavailable ? (
                    <Button variant="secondary" leadingIcon="ph:key" onClick={() => setShowPatModal(true)}>
                      Add PAT
                    </Button>
                  ) : undefined
                }
              />
            ) : activity?.patInvalid ? (
              // A dead PAT means this emptiness is unverifiable — an all-clear
              // check mark here would be a lie (cave-cjgg).
              <EmptyState
                icon="ph:key"
                headline="GitHub token rejected"
                subtitle="The stored token was revoked or expired, so private repos and reviews can't be read. Update the PAT to restore the full view."
                actions={
                  <Button variant="primary" leadingIcon="ph:key" onClick={() => setShowPatModal(true)}>
                    Update PAT
                  </Button>
                }
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
          <GhWorkspace
            detail={
              <GitHubItemGlassPanel
                item={selectedItem}
                linkedCards={selectedLinkedCards}
                familiars={familiars}
                resolvedById={resolvedById}
                cards={cards}
                familiarsFailed={familiarsFailed}
                cardsFailed={cardsFailed}
                countLabels={countLabels}
                focused={focused}
                backLabel={FILTER_BACK_LABEL[filter]}
                onUnfocus={() => setFocused(false)}
                onJumpToSession={onJumpToSession}
                onFocusCard={onFocusCard}
                onAfterLink={refreshLinkedWork}
              />
            }
          >
            <div className="gh-list-panel">
              {facets.length > 1 ? (
                <div className="gh-facet-bar" role="group" aria-label="Narrow to a section">
                  {facets.map((facet) => {
                    const on = pickedFacets.includes(facet.key);
                    return (
                      <button
                        key={facet.key}
                        type="button"
                        className={`gh-facet gh-tone--${facet.tone}${on ? " is-on" : ""} focus-ring`}
                        aria-pressed={on}
                        onClick={() => toggleFacet(facet.key)}
                      >
                        <span className="gh-facet-dot" aria-hidden />
                        {facet.label}
                        <span className="gh-facet-count">{facet.count}</span>
                      </button>
                    );
                  })}
                  {filtersDirty ? (
                    <button type="button" className="gh-facet-clear focus-ring" onClick={clearFilters}>
                      <Icon name="ph:x" width={9} aria-hidden />
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : null}
              {shownCount === 0 ? (
                <div className="gh-stream-empty">
                  <EmptyState
                    icon="ph:funnel"
                    headline="Nothing in these sections"
                    subtitle="Clear the section filter to see the rest of the workstream."
                    actions={
                      <Button variant="secondary" leadingIcon="ph:x" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                </div>
              ) : (
                <GitHubStream
                  sections={sections}
                  selectedId={selectedItem?.id ?? null}
                  collapsed={collapsedSections}
                  onToggleSection={toggleSection}
                  peeked={peeked}
                  onTogglePeek={togglePeek}
                  onSelect={selectRow}
                  onOpen={openDetail}
                  renderRowActions={(item) => {
                    const linked = linkedMap.get(item.id) ?? [];
                    return (
                      <>
                        <OpenChatAction
                          item={item}
                          linkedCards={linked}
                          familiars={familiars}
                          cards={cards}
                          familiarsFailed={familiarsFailed}
                          cardsFailed={cardsFailed}
                          onJumpToSession={onJumpToSession}
                          onAfterLink={refreshLinkedWork}
                        />
                        <AddToBoardAction
                          item={item}
                          familiars={familiars}
                          cards={cards}
                          familiarsFailed={familiarsFailed}
                          cardsFailed={cardsFailed}
                          onAfterLink={refreshLinkedWork}
                        />
                        <SafeMergeAction item={item} linkedCards={linked} familiars={familiars} />
                        <IconButton
                          icon="ph:arrow-square-out"
                          size="xs"
                          title="Open on GitHub"
                          aria-label="Open on GitHub"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openExternalUrl(item.url);
                          }}
                        />
                      </>
                    );
                  }}
                />
              )}
            </div>
          </GhWorkspace>
        )}
      </div>

      {/* Keyboard hints moved to the ⌘/ Shortcuts sheet (§8 chrome diet); only
          the actionable low-rate warning remains in this footer. */}
      {activity?.rateLimit && activity.rateLimit.remaining < 10 && (
        <footer className="github-surface-footer shrink-0 px-5 py-1.5 text-[length:var(--text-2xs)] flex items-center justify-end">
          <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
            <Icon name="ph:warning-fill" width={12} aria-hidden />
            {activity.rateLimit.remaining} requests remaining
          </span>
        </footer>
      )}
    </section>
    </GitHubProfileProvider>
  );
}
