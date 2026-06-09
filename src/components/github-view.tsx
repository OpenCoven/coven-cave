"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
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

function useCards(): Card[] {
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => {
    fetch("/api/board")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && Array.isArray(data.cards)) {
          setCards(data.cards as Card[]);
        }
      })
      .catch(() => {});
  }, []);
  return cards;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function age(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const KIND_ICON: Record<string, string> = {
  pr: "ph:git-pull-request",
  issue: "ph:issue-opened",
  review_request: "ph:git-pull-request",
  notification: "ph:bell",
};

const KIND_LABEL: Record<string, string> = {
  pr: "PR",
  issue: "Issue",
  review_request: "Review",
  notification: "Notif",
};

const KIND_COLOR: Record<string, string> = {
  pr: "text-[var(--color-success)]",
  issue: "text-[var(--accent-presence)]",
  review_request: "text-[var(--color-warning)]",
  notification: "text-[var(--text-muted)]",
};

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

  useEffect(() => { inputRef.current?.focus(); }, []);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Icon name="ph:github-logo" width={18} className="text-[var(--text-secondary)]" />
            <h3 className="text-[15px] font-semibold">Connect GitHub</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
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

        <div className="mb-3">
          <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">
            GitHub username
          </label>
          <input
            ref={inputRef}
            type="text"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="your-username"
            className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] focus:outline-none"
          />
        </div>

        <div className="mb-2">
          <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">
            Personal Access Token <span className="font-normal text-[var(--text-muted)]">(optional — for private repos)</span>
          </label>
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
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
            type="button"
            disabled={!pat.trim() || saving}
            onClick={() => void save()}
            className="rounded-lg bg-[var(--accent-presence)] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving ? "Verifying…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Item row with actions ─────────────────────────────────────────────────────

function GitHubItemRow({
  item,
  familiars,
  cards,
}: {
  item: GitHubItem;
  familiars: Familiar[];
  cards: Card[];
}) {
  const [openPopover, setOpenPopover] = useState<PopoverMode | null>(null);

  function openMode(mode: PopoverMode, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpenPopover((prev) => (prev === mode ? null : mode));
  }

  return (
    <li className="group relative">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--bg-raised)]/50 transition-colors"
      >
        {/* Kind icon */}
        <Icon
          name={(KIND_ICON[item.kind] ?? "ph:github-logo") as Parameters<typeof Icon>[0]["name"]}
          width={14}
          className={`mt-[3px] shrink-0 ${KIND_COLOR[item.kind] ?? "text-[var(--text-muted)]"}`}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Row 1: repo + number + age */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {item.repo}{item.number ? `#${item.number}` : ""}
              </span>
              {item.draft && (
                <span className="rounded px-1 py-0.5 text-[9px] bg-[var(--bg-raised)] text-[var(--text-muted)]">draft</span>
              )}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{age(item.updatedAt)}</span>
          </div>

          {/* Row 2: title */}
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-presence)] transition-colors">
            {item.title}
          </span>

          {/* Row 3: kind + labels */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-medium ${KIND_COLOR[item.kind]}`}>
              {KIND_LABEL[item.kind]}
            </span>
            {item.labels?.slice(0, 3).map((l) => (
              <span
                key={l}
                className="rounded px-1.5 py-0.5 text-[9px] bg-[var(--bg-raised)] text-[var(--text-muted)]"
              >
                {l}
              </span>
            ))}
          </div>

          {/* Row 4: action buttons (hover-revealed) */}
          <div className="flex items-center gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => openMode("board", e)}
              title="Add to board"
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                openPopover === "board"
                  ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon name="ph:kanban" width={11} />
              Board
            </button>
            <button
              type="button"
              onClick={(e) => openMode("chat", e)}
              title="Start chat"
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                openPopover === "chat"
                  ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon name="ph:chat-circle-dots" width={11} />
              Chat
            </button>
            <button
              type="button"
              onClick={(e) => openMode("assign", e)}
              title="Assign to familiar"
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                openPopover === "assign"
                  ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon name="ph:robot" width={11} />
              Assign
            </button>
          </div>
        </div>

        <Icon name="ph:arrow-square-out" width={11} className="mt-1 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
      </a>

      {/* Action popover — rendered outside the <a> to avoid nesting issues */}
      {openPopover && (
        <div className="relative px-5 pb-2" onClick={(e) => e.stopPropagation()}>
          <GitHubActionPopover
            mode={openPopover}
            item={item}
            familiars={familiars}
            cards={cards}
            onClose={() => setOpenPopover(null)}
          />
        </div>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Filter = "all" | "pr" | "review_request" | "issue";

export function GitHubView() {
  const [activity, setActivity] = useState<ActivityResult | null>(null);
  const [patStatus, setPatStatus] = useState<PatStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showPatModal, setShowPatModal] = useState(false);
  const timerRef = useRef<number | null>(null);

  const familiars = useFamiliars();
  const cards = useCards();

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
        // No username — show setup prompt
        setError("no_user");
        setLoading(false);
        return;
      }

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `GitHub error (${res.status})`);
        setLoading(false);
        // back off 60s on config errors
        timerRef.current = window.setTimeout(() => void fetchActivity(true), 60_000);
        return;
      }

      setActivity(data as ActivityResult);
      setError(null);
      // poll every 90s when authed, 120s on public API
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

  const counts: Record<Filter, number> = {
    all: items.length,
    pr: items.filter((i) => i.kind === "pr").length,
    review_request: items.filter((i) => i.kind === "review_request").length,
    issue: items.filter((i) => i.kind === "issue").length,
  };

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">

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
      <header className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-5 py-2">
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
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            <Icon name="ph:key" width={11} />
            {patStatus?.hasPat ? "PAT connected" : "Add PAT"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (timerRef.current !== null) window.clearTimeout(timerRef.current);
              void fetchActivity();
            }}
            title="Refresh (⌘R)"
            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            <Icon name="ph:arrows-clockwise" width={13} />
          </button>
        </div>
      </header>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] px-4 py-2">
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

        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="ph:check-circle" width={22} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-muted)]">
              {filter === "all" ? "Nothing open right now." : `No open ${filter === "review_request" ? "review requests" : filter + "s"}.`}
            </p>
          </div>

        ) : (
          <ul className="divide-y divide-[var(--border-hairline)]">
            {filtered.map((item) => (
              <GitHubItemRow
                key={item.id}
                item={item}
                familiars={familiars}
                cards={cards}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-[var(--border-hairline)] px-5 py-1.5 text-[10px] text-[var(--text-muted)] flex items-center justify-between gap-3">
        <span>⌘R refresh · click a row to open in GitHub</span>
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
