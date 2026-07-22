"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardLifecycle, CardPriority, CardStatus } from "@/lib/cave-board-types";
import { STATUSES, PRIORITIES } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects";
import { LifecycleBadge, formatTimeoutBadge } from "@/components/ui/lifecycle-badge";
import { SkeletonRows } from "@/components/ui/skeleton";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { publishBoardChanged } from "@/lib/board-cache-events";
import { useFleetTokenEnabled } from "@/lib/omnigent/use-fleet-gate";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { GitHubItem } from "@/lib/github-tasks";
import {
  mergeLinksWithGitHub,
  mergeTaskGitHubLinks,
  taskGitHubLinkFromGitHubItem,
} from "@/lib/task-github";
import type { AsanaItem } from "@/lib/asana-tasks";
import {
  mergeLinksWithAsana,
  mergeTaskAsanaLinks,
  taskAsanaLinkFromAsanaItem,
} from "@/lib/task-asana";
import { Icon } from "@/lib/icon";
import { useCopy } from "@/lib/use-copy";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import type { IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { StandardSelect } from "@/components/ui/select";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { useRuntimeModelOptions } from "@/lib/use-runtime-model-options";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { HarnessFixActions } from "@/components/harness-fix-actions";
import { parseHarnessFailure } from "@/lib/harness-failure";
import { CHAT_OPEN_PROJECTS_EVENT, markProjectsTabPending } from "@/lib/chat-tab-events";
import { useDateTimePrefs, formatDate, formatClock } from "@/lib/datetime-format";
import { openExternalUrl } from "@/lib/open-external";
import { InlineAsanaPATSetup } from "@/components/asana-connect-inline";
import { attachmentIcon, fileToAttachment, hasDraggedFiles } from "@/lib/chat-attachments";
import type { CardPatch } from "@/lib/board-card-ops";
import { sessionStatusTone, sessionStatusWord } from "@/lib/session-status";
import { BoardInspectorDebug } from "@/components/board-inspector-debug";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function formatAttachmentSize(size?: number): string {
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
const GITHUB_PAT_URL = "https://github.com/settings/tokens/new?scopes=read:user,repo,notifications&description=Cave+local";

type LifecycleMove = { to: CardLifecycle; label: string; retry?: boolean };
const NEXT_MOVES: Record<CardLifecycle, LifecycleMove[]> = {
  queued:     [{ to: "dispatched", label: "dispatch" }, { to: "cancelled", label: "cancel" }],
  dispatched: [{ to: "running", label: "running" }, { to: "failed", label: "fail" }, { to: "cancelled", label: "cancel" }],
  running:    [{ to: "review", label: "review" }, { to: "completed", label: "complete" }, { to: "failed", label: "fail" }, { to: "cancelled", label: "cancel" }],
  review:     [{ to: "completed", label: "complete" }, { to: "failed", label: "fail" }],
  completed:  [],
  failed:     [{ to: "queued", label: "retry", retry: true }, { to: "cancelled", label: "cancel" }],
  cancelled:  [{ to: "queued", label: "re-queue" }],
};

function openProjectsSurface() {
  // Latch BEFORE the mode flip: a freshly-mounting ChatSurface consumes it on
  // mount, so the Projects tab opens even when the event loses the race (cave-c2zf).
  markProjectsTabPending();
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
  }, 0);
}

type Props = {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  projects: CaveProject[];
  onClose: () => void;
  onPatch: (id: string, patch: CardPatch) => void | boolean | Promise<boolean>;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onDelete: (id: string) => Promise<void>;
  onCardReplaced: (card: Card) => void;
  onOpenTaskWork?: (id: string) => Promise<void>;
  onOpenUrl?: (url: string) => void;
  chatLinking?: boolean;
  /** Surfaces an in-drawer error when /api/board/:id/chat fails (typically
   *  daemon offline → 502). Without this the failure only appears as a
   *  small banner at the top of the board, hidden behind the open drawer. */
  chatLinkError?: string | null;
  /** Harness-failure recovery: rebind the card's familiar to this adapter and
   *  re-run the task-chat start (provided only when chatLinkError is this card's). */
  onUseHarnessFix?: (harnessId: string) => void | Promise<void>;
};

function TimeoutBadge({ runningSince, timeoutMs }: { runningSince?: string; timeoutMs?: number }) {
  const [, setTick] = useState(0);
  // Re-render once a minute so the relative "running for…" text advances — paused
  // while the tab is hidden, refreshed on return (see usePausablePoll).
  usePausablePoll(() => setTick((n) => n + 1), 60_000);
  const text = formatTimeoutBadge(runningSince, timeoutMs, DEFAULT_TIMEOUT_MS);
  if (!text) return null;
  const over = runningSince ? Date.now() - new Date(runningSince).getTime() > (timeoutMs ?? DEFAULT_TIMEOUT_MS) : false;
  return (
    <span className={`rounded border px-1.5 py-px text-[length:var(--text-2xs)] uppercase tracking-widest ${over ? "border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]" : "border-border bg-card text-muted-foreground"}`}>
      {text}
    </span>
  );
}

// ── Inline PAT Setup ─────────────────────────────────────────────────────────
function InlinePATSetup({ onSaved }: { onSaved: () => void }) {
  const [pat, setPat] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmedPat = pat.trim();
    const trimmedUser = usernameInput.trim();
    if (!trimmedPat && !trimmedUser) { setError("Enter a GitHub username or PAT."); return; }
    setSaving(true); setError(null);
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
      if (!res.ok || !data?.ok) { setError(data?.error ?? "Failed to save."); return; }
      onSaved();
    } catch { setError("Network error — please try again."); }
    finally { setSaving(false); }
  }

  return (
    <div className="[padding:10px_10px_var(--space-2)]! [display:flex]! [flex-direction:column]! [gap:var(--space-2)]!">
      <div className="[display:flex]! [align-items:center]! [gap:6px]! [margin-bottom:2px]!">
        <Icon name="ph:github-logo" width={14} className="text-[var(--text-muted)]" />
        <span className="[font-size:var(--text-xs)]! [font-weight:600]! [color:var(--text-secondary)]!">Connect GitHub</span>
      </div>
      <div className="[display:flex]! [flex-direction:column]! [gap:var(--space-1)]!">
        <label className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [font-weight:500]!">GitHub username</label>
        <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="your-username"
          className="[background:var(--bg-base)]! [border:1px_solid_var(--border-hairline)]! [border-radius:6px]! [padding:5px_var(--space-2)]! [font-size:var(--text-xs)]! [color:var(--text-primary)]! [outline:none]! [width:100%]! [box-sizing:border-box]!" />
      </div>
      <div className="[display:flex]! [flex-direction:column]! [gap:var(--space-1)]!">
        <label className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [font-weight:500]!">
          Personal Access Token <span className="[font-weight:400]!">(optional)</span>
        </label>
        <input type="password" value={pat} onChange={(e) => setPat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="ghp_…"
          className="[background:var(--bg-base)]! [border:1px_solid_var(--border-hairline)]! [border-radius:6px]! [padding:5px_var(--space-2)]! [font-size:var(--text-xs)]! [color:var(--text-primary)]! [outline:none]! [width:100%]! [box-sizing:border-box]!" />
      </div>
      {error && <p className="[font-size:var(--text-2xs)]! [color:var(--color-danger)]! [margin:0]!">{error}</p>}
      <div className="[display:flex]! [align-items:center]! [justify-content:space-between]! [margin-top:2px]!">
        <button type="button" onClick={() => void openExternalUrl(GITHUB_PAT_URL)}
          className="[background:transparent]! [border:0]! [padding:0]! [font-size:var(--text-2xs)]! [color:var(--accent-presence)]! [text-decoration:none]! [cursor:pointer]!">
          Generate PAT →
        </button>
        <button type="button" disabled={(!pat.trim() && !usernameInput.trim()) || saving} onClick={() => void save()}
          style={{ background: "var(--accent-presence)", color: "var(--text-primary)", border: "none", borderRadius: 6,
            padding: "4px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Verifying…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── GitHub attach ─────────────────────────────────────────────────────────────
const KIND_ICON: Record<string, string> = {
  pr: "ph:git-pull-request",
  issue: "ph:bug-bold",
  discussion: "ph:chat-teardrop-text-bold",
  repo: "ph:git-fork-bold",
};

const STATE_COLOR: Record<string, string> = {
  open: "text-[var(--color-success)]",
  merged: "text-violet-400",
  closed: "text-[var(--color-danger)]",
};

function taskGitHubLinkFromAssignedItem(item: GitHubItem) {
  return taskGitHubLinkFromGitHubItem(item);
}

function GitHubAttachSection({
  card,
  familiars,
  onPatch,
  onOpenUrl,
}: {
  card: Card;
  familiars: Familiar[];
  onPatch: (id: string, patch: CardPatch) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [patRejected, setPatRejected] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch("/api/github/assigned", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; items?: GitHubItem[]; configured?: boolean; error?: string; patInvalid?: boolean }) => {
        // Drop a superseded/post-close response (open toggled or PAT re-saved).
        if (cancelled) return;
        if (d.ok) {
          setItems(d.items ?? []);
          setConfigured(d.configured ?? true);
          setPatRejected(false);
        } else if (d.patInvalid) {
          // Rejected token: reopen the connect form (it was gated on
          // configured===false, unreachable with a stored-but-dead PAT).
          setItems([]);
          setConfigured(false);
          setPatRejected(true);
        } else {
          setErr(d.error ?? "failed");
        }
      })
      .catch(() => { if (!cancelled) setErr("fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, fetchKey]); // fetchKey bumped to force refetch after PAT save

  const attachedUrls = new Set([...(card.links ?? []), ...(card.github ?? []).map((item) => item.url)]);

  const filtered = items.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.repo.toLowerCase().includes(q) ||
      (item.number != null && String(item.number).includes(q))
    );
  });

  const attachedItems = mergeTaskGitHubLinks(
    card.github ?? [],
    ...items.filter((i) => attachedUrls.has(i.url)).map(taskGitHubLinkFromAssignedItem),
  );

  function attach(item: GitHubItem) {
    if (attachedUrls.has(item.url)) return;
    const github = mergeTaskGitHubLinks(card.github ?? [], taskGitHubLinkFromAssignedItem(item));
    onPatch(card.id, { github, links: mergeLinksWithGitHub(card.links, github) });
  }

  function detach(url: string) {
    const github = (card.github ?? []).filter((item) => item.url !== url);
    onPatch(card.id, { github, links: card.links.filter((l) => l !== url) });
  }

  function assignAgent(item: GitHubItem) {
    const fam = familiars.find(
      (f) => f.display_name?.toLowerCase() === item.repo?.toLowerCase()
    );
    if (fam) onPatch(card.id, { familiarId: fam.id });
  }

  const iconName = (k: string) => (KIND_ICON[k] ?? "ph:link") as IconName;

  return (
    <div className="board-drawer-field">
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [justify-content:space-between]!">
        <span className="[display:inline-flex]! [align-items:center]! [gap:5px]!">
          <Icon name="ph:github-logo" width={11} />
          GitHub
          {attachedItems.length > 0 && <span className="board-drawer-count-pill">{attachedItems.length}</span>}
        </span>
        <button
          type="button"
          className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_var(--space-2)]!"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "ph:caret-up" : "ph:github-logo"} width={11} />
          {open ? "Hide" : "Attach"}
        </button>
      </div>

      {attachedItems.length > 0 && (
        <div className="[display:flex]! [flex-direction:column]! [gap:var(--space-1)]! [margin-bottom:6px]!">
          {attachedItems.map((item) => (
            <div key={item.id} className="[display:flex]! [align-items:center]! [gap:6px]! [background:var(--bg-elevated)]! [border-radius:6px]! [padding:5px_var(--space-2)]! [border:1px_solid_var(--border-hairline)]!">
              <button
                type="button"
                className="board-github-attachment-open [flex:1]! [min-width:0]! [display:inline-flex]! [align-items:center]! [gap:6px]! [border:0]! [padding:0]! [background:transparent]! [color:var(--text-primary)]! [text-align:left]! [cursor:pointer]!"
                onClick={() => onOpenUrl?.(item.url)}
                title="Open in app browser"
              >
                <Icon name={iconName(item.kind)} width={12} className={STATE_COLOR[item.state ?? ""] ?? "text-[var(--text-muted)]"} />
                <span className="[flex:1]! [min-width:0]! [font-size:var(--text-xs)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                  {item.repo}{item.number != null ? " #" + item.number : ""} — {item.title}
                </span>
              </button>
              <button
                type="button"
                className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:1px_6px]!"
                onClick={() => detach(item.url)}
                title="Detach"
              >
                <Icon name="ph:x-bold" width={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="[border:1px_solid_var(--border-hairline)]! [border-radius:var(--radius-control)]! [overflow:hidden]! [background:var(--bg-raised)]!">
          <div className="[display:flex]! [align-items:center]! [gap:6px]! [padding:7px_10px]! [border-bottom:1px_solid_var(--border-hairline)]!">
            <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" />
            <input
              autoFocus={!coarse}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PRs, issues…"
              className="[flex:1]! [background:transparent]! [border:none]! [outline:none]! [font-size:var(--text-sm)]! [color:var(--text-primary)]!"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="[background:none]! [border:none]! [cursor:pointer]! [color:var(--text-muted)]! [display:flex]!">
                <Icon name="ph:x" width={11} />
              </button>
            )}
          </div>

          <div className="[max-height:240px]! [overflow-y:auto]!">
            {loading && (
              <div className="[padding:10px]!"><SkeletonRows count={4} /></div>
            )}
            {err && (
              <div className="[padding:10px]! [font-size:var(--text-xs)]! [color:var(--color-danger)]!">{err}</div>
            )}
            {!loading && !err && configured === false && (
              <>
                {patRejected && (
                  <div className="[padding:10px_10px_0]! [font-size:var(--text-xs)]! [color:var(--color-danger)]!">
                    GitHub rejected the stored token (revoked or expired) — reconnect below.
                  </div>
                )}
                <InlinePATSetup onSaved={() => { setItems([]); setConfigured(null); setPatRejected(false); setFetchKey((k) => k + 1); }} />
              </>
            )}
            {!loading && !err && configured !== false && filtered.length === 0 && items.length === 0 && (
              <div className="[padding:var(--space-3)_10px]! [font-size:var(--text-xs)]! [color:var(--text-muted)]! [text-align:center]!">
                No open issues, PRs, or review requests assigned to you.
              </div>
            )}
            {!loading && !err && configured !== false && items.length > 0 && filtered.length === 0 && (
              <div className="[padding:var(--space-3)_10px]! [font-size:var(--text-xs)]! [color:var(--text-muted)]! [text-align:center]!">No matches.</div>
            )}
            {filtered.map((item) => {
              const attached = attachedUrls.has(item.url);
              const fam = familiars.find(
                (f) => f.display_name?.toLowerCase() === item.repo?.toLowerCase()
              );
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderBottom: "1px solid var(--border-hairline)",
                  background: attached ? "color-mix(in oklch, var(--accent-presence) 8%, var(--bg-raised))" : undefined,
                }}>
                  <Icon
                    name={iconName(item.kind)}
                    width={13}
                    className={STATE_COLOR[item.state ?? ""] ?? "text-[var(--text-muted)]"}
                  />
                  <div className="[flex:1]! [min-width:0]!">
                    <div className="[font-size:var(--text-xs)]! [font-weight:500]! [color:var(--text-primary)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                      {item.repo}{item.number != null ? " #" + item.number : ""}
                    </div>
                    <div className="[font-size:var(--text-xs)]! [color:var(--text-muted)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                      {item.title}
                    </div>
                  </div>
                  <div className="[display:flex]! [gap:var(--space-1)]! [flex-shrink:0]!">
                    {fam && (
                      <button
                        type="button"
                        className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_7px]!"
                        title={"Assign to " + fam.display_name}
                        onClick={() => assignAgent(item)}
                      >
                        <Icon name="ph:user-bold" width={10} />
                        {fam.display_name}
                      </button>
                    )}
                    <button
                      type="button"
                      className="board-toolbar-btn"
                      style={{
                        fontSize: 10, padding: "2px 7px",
                        ...(attached ? { color: "var(--accent-presence)", borderColor: "var(--accent-presence)" } : {}),
                      }}
                      onClick={() => attached ? detach(item.url) : attach(item)}
                    >
                      <Icon name={attached ? "ph:check-bold" : "ph:paperclip-bold"} width={10} />
                      {attached ? "Attached" : "Attach"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}



// ── Asana attach ──────────────────────────────────────────────────────────────
// Mirrors GitHubAttachSection. Surfaces the connected user's incomplete Asana
// tasks (via /api/asana/assigned, populated once the Asana PAT is stored) so a
// card can be linked to the work it tracks. When no PAT is configured the
// inline connect form appears — the in-app "enable Asana" on-ramp.
function AsanaAttachSection({
  card,
  onPatch,
  onOpenUrl,
}: {
  card: Card;
  onPatch: (id: string, patch: CardPatch) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AsanaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [patRejected, setPatRejected] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    // Scope to the card's familiar: the picker offers the Asana tasks THIS
    // agent is assigned to work with (per-agent enablement + workspace scope).
    const url = card.familiarId
      ? `/api/asana/assigned?familiarId=${encodeURIComponent(card.familiarId)}`
      : "/api/asana/assigned";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; items?: AsanaItem[]; configured?: boolean; error?: string; patInvalid?: boolean }) => {
        if (cancelled) return;
        if (d.ok) {
          setItems(d.items ?? []);
          setConfigured(d.configured ?? true);
          setPatRejected(false);
        } else if (d.patInvalid) {
          // Rejected token: reopen the connect form with an explanation. The
          // raw 401 used to render here forever — and the form was gated on
          // configured===false, which a stored-but-dead PAT never satisfies
          // (cave-d6zq).
          setItems([]);
          setConfigured(false);
          setPatRejected(true);
        } else {
          setErr(d.error ?? "failed");
        }
      })
      .catch(() => { if (!cancelled) setErr("fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, fetchKey, card.familiarId]); // fetchKey bumped to refetch after PAT save

  const attachedUrls = new Set([...(card.links ?? []), ...(card.asana ?? []).map((item) => item.url)]);

  const filtered = items.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return item.title.toLowerCase().includes(q) || (item.projectName?.toLowerCase().includes(q) ?? false);
  });

  const attachedItems = mergeTaskAsanaLinks(
    card.asana ?? [],
    ...items.filter((i) => attachedUrls.has(i.url)).map(taskAsanaLinkFromAsanaItem),
  );

  function attach(item: AsanaItem) {
    if (attachedUrls.has(item.url)) return;
    const asana = mergeTaskAsanaLinks(card.asana ?? [], taskAsanaLinkFromAsanaItem(item));
    onPatch(card.id, { asana, links: mergeLinksWithAsana(card.links, asana) });
  }

  function detach(url: string) {
    const asana = (card.asana ?? []).filter((item) => item.url !== url);
    onPatch(card.id, { asana, links: card.links.filter((l) => l !== url) });
  }

  const subtitle = (item: { projectName?: string; dueOn?: string | null }) =>
    [item.projectName, item.dueOn ? `due ${item.dueOn}` : null].filter(Boolean).join(" · ");

  return (
    <div className="board-drawer-field">
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [justify-content:space-between]!">
        <span className="[display:inline-flex]! [align-items:center]! [gap:5px]!">
          <Icon name="ph:check-circle" width={11} />
          Asana
          {attachedItems.length > 0 && <span className="board-drawer-count-pill">{attachedItems.length}</span>}
        </span>
        <button
          type="button"
          className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_var(--space-2)]!"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "ph:caret-up" : "ph:check-circle"} width={11} />
          {open ? "Hide" : "Attach"}
        </button>
      </div>

      {attachedItems.length > 0 && (
        <div className="[display:flex]! [flex-direction:column]! [gap:var(--space-1)]! [margin-bottom:6px]!">
          {attachedItems.map((item) => (
            <div key={item.id} className="[display:flex]! [align-items:center]! [gap:6px]! [background:var(--bg-elevated)]! [border-radius:6px]! [padding:5px_var(--space-2)]! [border:1px_solid_var(--border-hairline)]!">
              <button
                type="button"
                className="board-github-attachment-open [flex:1]! [min-width:0]! [display:inline-flex]! [align-items:center]! [gap:6px]! [border:0]! [padding:0]! [background:transparent]! [color:var(--text-primary)]! [text-align:left]! [cursor:pointer]!"
                onClick={() => onOpenUrl?.(item.url)}
                title="Open in Asana"
              >
                <Icon name="ph:check-circle" width={12} className={item.completed ? "text-[var(--color-success)]" : "text-[var(--text-muted)]"} />
                <span className="[flex:1]! [min-width:0]! [font-size:var(--text-xs)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                  {item.title}{subtitle(item) ? ` — ${subtitle(item)}` : ""}
                </span>
              </button>
              <button
                type="button"
                className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:1px_6px]!"
                onClick={() => detach(item.url)}
                title="Detach"
              >
                <Icon name="ph:x-bold" width={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="[border:1px_solid_var(--border-hairline)]! [border-radius:var(--radius-control)]! [overflow:hidden]! [background:var(--bg-raised)]!">
          <div className="[display:flex]! [align-items:center]! [gap:6px]! [padding:7px_10px]! [border-bottom:1px_solid_var(--border-hairline)]!">
            <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" />
            <input
              autoFocus={!coarse}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, projects…"
              className="[flex:1]! [background:transparent]! [border:none]! [outline:none]! [font-size:var(--text-sm)]! [color:var(--text-primary)]!"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="[background:none]! [border:none]! [cursor:pointer]! [color:var(--text-muted)]! [display:flex]!">
                <Icon name="ph:x" width={11} />
              </button>
            )}
          </div>

          <div className="[max-height:240px]! [overflow-y:auto]!">
            {loading && (
              <div className="[padding:10px]!"><SkeletonRows count={4} /></div>
            )}
            {err && (
              <div className="[padding:10px]! [font-size:var(--text-xs)]! [color:var(--color-danger)]!">{err}</div>
            )}
            {!loading && !err && configured === false && (
              <>
                {patRejected && (
                  <div className="[padding:10px_10px_0]! [font-size:var(--text-xs)]! [color:var(--color-danger)]!">
                    Asana rejected the stored token (revoked or expired) — reconnect below.
                  </div>
                )}
                <InlineAsanaPATSetup onSaved={() => { setItems([]); setConfigured(null); setPatRejected(false); setFetchKey((k) => k + 1); }} />
              </>
            )}
            {!loading && !err && configured !== false && filtered.length === 0 && items.length === 0 && (
              <div className="[padding:var(--space-3)_10px]! [font-size:var(--text-xs)]! [color:var(--text-muted)]! [text-align:center]!">
                No incomplete tasks assigned to you.
              </div>
            )}
            {!loading && !err && configured !== false && items.length > 0 && filtered.length === 0 && (
              <div className="[padding:var(--space-3)_10px]! [font-size:var(--text-xs)]! [color:var(--text-muted)]! [text-align:center]!">No matches.</div>
            )}
            {filtered.map((item) => {
              const attached = attachedUrls.has(item.url);
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderBottom: "1px solid var(--border-hairline)",
                  background: attached ? "color-mix(in oklch, var(--accent-presence) 8%, var(--bg-raised))" : undefined,
                }}>
                  <Icon name="ph:check-circle" width={13} className="text-[var(--text-muted)]" />
                  <div className="[flex:1]! [min-width:0]!">
                    <div className="[font-size:var(--text-xs)]! [font-weight:500]! [color:var(--text-primary)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                      {item.title}
                    </div>
                    <div className="[font-size:var(--text-xs)]! [color:var(--text-muted)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                      {subtitle(item) || "Asana task"}
                    </div>
                  </div>
                  <div className="[display:flex]! [gap:var(--space-1)]! [flex-shrink:0]!">
                    <button
                      type="button"
                      className="board-toolbar-btn"
                      style={{
                        fontSize: 10, padding: "2px 7px",
                        ...(attached ? { color: "var(--accent-presence)", borderColor: "var(--accent-presence)" } : {}),
                      }}
                      onClick={() => attached ? detach(item.url) : attach(item)}
                    >
                      <Icon name={attached ? "ph:check-bold" : "ph:paperclip-bold"} width={10} />
                      {attached ? "Attached" : "Attach"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Links ────────────────────────────────────────────────────────────────────
function LinksSection({
  card,
  onPatch,
  onOpenUrl,
}: {
  card: Card;
  onPatch: (id: string, patch: CardPatch) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const links = card.links ?? [];

  function isValidUrl(value: string): boolean {
    return value.startsWith("http://") || value.startsWith("https://");
  }

  function addLink() {
    const url = draft.trim();
    if (!url || !isValidUrl(url)) return;
    if (links.includes(url)) return;
    onPatch(card.id, { ops: { linkOps: [{ op: "add", value: url }] } });
    setDraft("");
    inputRef.current?.focus();
  }

  function deleteLink(url: string) {
    onPatch(card.id, { ops: { linkOps: [{ op: "remove", value: url }] } });
  }

  return (
    <div className="board-drawer-field">
      {/* Header row */}
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [gap:6px]!">
        <Icon name="ph:link-simple" width={12} />
        Links
        {links.length > 0 && (
          <span className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [background:var(--bg-elevated)]! [border-radius:var(--radius-control)]! [padding:1px_6px]!">
            {links.length}
          </span>
        )}
      </div>

      {/* Link list */}
      {links.length > 0 && (
        <ul className="[display:flex]! [flex-direction:column]! [gap:2px]! [margin-bottom:var(--space-2)]!">
          {links.map((link) => {
            const href = safeHref(link);
            return (
              <li
                key={link}
                className="[display:flex]! [align-items:center]! [gap:var(--space-2)]! [padding:5px_var(--space-2)]! [border-radius:6px]! [background:var(--bg-elevated)]! [border:1px_solid_var(--border-hairline)]!"
              >
                <Icon name="ph:link-simple" width={10} className="shrink-0 text-[var(--text-muted)]" />
                {href ? (
                  <button
                    type="button"
                    onClick={() => onOpenUrl?.(href)}
                    title="Open in app browser"
                    className="link-item-anchor [flex:1]! [font-size:var(--text-sm)]! [color:var(--text-primary)]! [text-decoration:none]! [text-align:left]! [border:0]! [padding:0]! [background:transparent]! [cursor:pointer]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!"
                  >
                    {formatLinkLabel(link)}
                  </button>
                ) : (
                  <span className="[flex:1]! [font-size:var(--text-sm)]! [color:var(--text-primary)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">
                    {link}
                  </span>
                )}
                <span className="step-actions [display:flex]! [align-items:center]! [gap:2px]!">
                  <button
                    type="button"
                    className="board-toolbar-btn [padding:1px_var(--space-1)]! [color:var(--color-danger)]!"
                    onClick={() => deleteLink(link)}
                    title="Remove link"
                  >
                    <Icon name="ph:x-bold" width={9} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add link input */}
      <div className="[display:flex]! [gap:6px]! [align-items:center]!">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addLink(); } }}
          placeholder="Paste a URL…"
          className="[flex:1]! [background:var(--bg-elevated)]! [border:1px_solid_var(--border-hairline)]! [border-radius:6px]! [padding:5px_9px]! [font-size:var(--text-sm)]! [color:var(--text-primary)]! [outline:none]!"
        />
        <button
          type="button"
          className="board-toolbar-btn [padding:var(--space-1)_10px]! [font-size:var(--text-xs)]!"
          onClick={addLink}
          disabled={!draft.trim() || !isValidUrl(draft.trim())}
        >
          <Icon name="ph:plus-bold" width={11} />
          Add
        </button>
      </div>

      {/* CSS for hover reveal on link actions */}
      <style>{".link-item-anchor:hover { text-decoration: underline; } .step-actions { opacity: 0; transition: opacity 0.1s; } li:hover .step-actions, li:focus-within .step-actions { opacity: 1; } @media (prefers-reduced-motion: reduce) { .step-actions { transition: none; } }"}</style>
    </div>
  );
}

// ── Attachments ───────────────────────────────────────────────────────────────
// Files staged in a composer ride onto a card at creation; this section lets you
// add/remove them afterward. New files are converted client-side (fileToAttachment)
// and PATCHed — the server re-normalizes them lean (base64 image payloads stripped),
// so the same file → attachment pipeline as the composer, and an edit can't bloat
// cave-board.json.
const MAX_CARD_ATTACHMENTS = 10;

function AttachmentsSection({
  card,
  onPatch,
}: {
  card: Card;
  onPatch: (id: string, patch: CardPatch) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Drop-to-attach (parity with the home composer): dragDepthRef counts
  // enter/leave pairs so crossing child elements doesn't flicker the armed state.
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const attachments = card.attachments ?? [];
  const atCap = attachments.length >= MAX_CARD_ATTACHMENTS;

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = Math.max(0, MAX_CARD_ATTACHMENTS - attachments.length);
    if (room === 0) return;
    setBusy(true);
    try {
      const picked = Array.from(files).slice(0, room);
      const converted = await Promise.all(picked.map((file) => fileToAttachment(file)));
      // Drop the composer-only `id`; the server re-normalizes to the lean shape.
      onPatch(card.id, {
        ops: { attachmentOps: [{ op: "add", attachments: converted.map(({ id: _id, ...rest }) => rest) }] },
      });
    } finally {
      setBusy(false);
    }
  }

  function removeAt(index: number) {
    const name = attachments[index]?.name;
    if (name) onPatch(card.id, { ops: { attachmentOps: [{ op: "remove", name }] } });
  }

  return (
    <div
      className="board-drawer-field"
      data-drop-active={dropActive || undefined}
      style={dropActive ? { outline: "1.5px dashed var(--accent-presence)", outlineOffset: 2, borderRadius: 8 } : undefined}
      onDragEnter={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        e.stopPropagation();
        if (busy || atCap) return;
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        e.stopPropagation();
        if (busy || atCap) return;
      }}
      onDragLeave={(e) => {
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropActive(false);
      }}
      onDrop={(e) => {
        dragDepthRef.current = 0;
        setDropActive(false);
        if (!hasDraggedFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        e.stopPropagation();
        if (busy || atCap) return;
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [gap:6px]!">
        <Icon name="ph:paperclip" width={12} />
        Attachments
        {attachments.length > 0 && (
          <span className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [background:var(--bg-elevated)]! [border-radius:var(--radius-control)]! [padding:1px_6px]!">
            {attachments.length}
          </span>
        )}
      </div>
      {attachments.length > 0 && (
        <ul className="[display:flex]! [flex-direction:column]! [gap:2px]! [margin-bottom:var(--space-2)]!">
          {attachments.map((att, i) => (
            <li
              key={`${att.name}-${i}`}
              className="[display:flex]! [align-items:center]! [gap:var(--space-2)]! [padding:5px_var(--space-2)]! [border-radius:6px]! [background:var(--bg-elevated)]! [border:1px_solid_var(--border-hairline)]!"
            >
              <Icon name={attachmentIcon(att)} width={11} className="shrink-0 text-[var(--text-muted)]" />
              <span className="[flex:1]! [font-size:var(--text-sm)]! [color:var(--text-primary)]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!" title={att.name}>
                {att.name}
              </span>
              <span className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [flex-shrink:0]!">
                {formatAttachmentSize(att.size)}
              </span>
              <button
                type="button"
                className="board-toolbar-btn [padding:1px_var(--space-1)]! [color:var(--color-danger)]! [flex-shrink:0]!"
                onClick={() => removeAt(i)}
                title={`Remove ${att.name}`}
                aria-label={`Remove ${att.name}`}
              >
                <Icon name="ph:x-bold" width={9} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
      />
      <button
        type="button"
        className="board-toolbar-btn [padding:var(--space-1)_10px]! [font-size:var(--text-xs)]!"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy || atCap}
        title={atCap ? `Attachment limit reached (${MAX_CARD_ATTACHMENTS})` : "Attach files to this task — or drop them onto this section"}
      >
        <Icon name="ph:paperclip" width={11} />
        {busy ? "Adding…" : atCap ? "Limit reached" : dropActive ? "Drop files to attach" : "Add files"}
      </button>
    </div>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────
function StepsSection({
  card,
  onPatch,
}: {
  card: Card;
  onPatch: (id: string, patch: CardPatch) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const steps = card.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  function addStep() {
    const text = draft.trim();
    if (!text) return;
    // Pre-generate the id so the optimistic step and the persisted one match.
    onPatch(card.id, { ops: { stepOps: [{ op: "add", text, id: crypto.randomUUID() }] } });
    setDraft("");
    inputRef.current?.focus();
  }

  function toggleStep(id: string) {
    onPatch(card.id, { ops: { stepOps: [{ op: "toggle", id }] } });
  }

  function deleteStep(id: string) {
    onPatch(card.id, { ops: { stepOps: [{ op: "remove", id }] } });
  }

  // Schedule a step on the Gantt (group-by-task). Empty string clears the date.
  function setStepDate(id: string, field: "startDate" | "endDate", value: string) {
    onPatch(card.id, { ops: { stepOps: [{ op: "setDate", id, field, value: value || null }] } });
  }

  function reorderStep(id: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= steps.length) return;
    onPatch(card.id, { ops: { stepOps: [{ op: "reorder", id, dir }] } });
  }

  return (
    <div className="board-drawer-field">
      {/* Header row */}
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [justify-content:space-between]! [gap:var(--space-2)]!">
        <span className="[display:flex]! [align-items:center]! [gap:6px]!">
          <Icon name="ph:list-checks-bold" width={12} />
          Steps
          {total > 0 && (
            <span className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]! [background:var(--bg-elevated)]! [border-radius:var(--radius-control)]! [padding:1px_6px]!">
              {doneCount}/{total}
            </span>
          )}
        </span>
        {total > 0 && (
          <span style={{ fontSize: 10, color: pct === 100 ? "var(--color-success)" : "var(--text-muted)" }}>
            {pct}%
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="[height:2px]! [border-radius:2px]! [background:var(--border-hairline)]! [margin-bottom:var(--space-2)]! [overflow:hidden]!">
          <div style={{
            height: "100%",
            width: pct + "%",
            background: pct === 100 ? "var(--color-success)" : "var(--accent-presence)",
            transition: reducedMotion ? "none" : "width 0.2s ease, background 0.2s ease",
          }} />
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <ul className="[display:flex]! [flex-direction:column]! [gap:2px]! [margin-bottom:var(--space-2)]!">
          {steps.map((step, i) => (
            <li
              key={step.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                background: step.done ? "color-mix(in oklch, var(--color-success) 6%, var(--bg-elevated))" : "var(--bg-elevated)",
                border: "1px solid var(--border-hairline)",
              }}
            >
              {/* Checkbox */}
              <button
                type="button"
                role="checkbox"
                aria-checked={step.done}
                aria-label={step.text || "Step"}
                onClick={() => toggleStep(step.id)}
                style={{
                  flexShrink: 0,
                  marginTop: 1,
                  width: 15,
                  height: 15,
                  borderRadius: 4,
                  border: step.done ? "none" : "1.5px solid var(--border-strong)",
                  background: step.done ? "var(--color-success)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: reducedMotion ? "none" : "background 0.15s",
                }}
                title={step.done ? "Mark incomplete" : "Mark complete"}
              >
                {step.done && <Icon name="ph:check-bold" width={9} className="text-white" />}
              </button>

              {/* Text */}
              <span style={{
                flex: 1,
                fontSize: 12,
                lineHeight: 1.5,
                color: step.done ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: step.done ? "line-through" : "none",
                wordBreak: "break-word",
              }}>
                {step.text}
              </span>

              {/* Actions */}
              <span className="step-actions [display:flex]! [gap:2px]! [flex-shrink:0]!">
                {i > 0 && (
                  <button type="button" className="board-toolbar-btn [padding:1px_var(--space-1)]!"
                    onClick={() => reorderStep(step.id, -1)} title="Move up">
                    <Icon name="ph:arrow-up-bold" width={9} />
                  </button>
                )}
                {i < steps.length - 1 && (
                  <button type="button" className="board-toolbar-btn [padding:1px_var(--space-1)]!"
                    onClick={() => reorderStep(step.id, 1)} title="Move down">
                    <Icon name="ph:arrow-down-bold" width={9} />
                  </button>
                )}
                <button type="button" className="board-toolbar-btn [padding:1px_var(--space-1)]! [color:var(--color-danger)]!"
                  onClick={() => deleteStep(step.id)} title="Delete step">
                  <Icon name="ph:x-bold" width={9} />
                </button>
              </span>

              {/* Step schedule — places this step on the Gantt under "group by Task". */}
              <div className="[display:flex]! [flex-basis:100%]! [gap:6px]! [align-items:center]! [padding-left:23px]!">
                <input
                  type="date"
                  aria-label={`Start date for step: ${step.text}`}
                  value={step.startDate ?? ""}
                  onChange={(e) => setStepDate(step.id, "startDate", e.target.value)}
                  className="[font-size:var(--text-xs)]! [padding:1px_var(--space-1)]! [border-radius:4px]! [border:1px_solid_var(--border-hairline)]! [background:var(--bg-base)]! [color:var(--text-secondary)]!"
                />
                <span className="[font-size:var(--text-xs)]! [color:var(--text-muted)]!" aria-hidden>→</span>
                <input
                  type="date"
                  aria-label={`End date for step: ${step.text}`}
                  value={step.endDate ?? ""}
                  onChange={(e) => setStepDate(step.id, "endDate", e.target.value)}
                  className="[font-size:var(--text-xs)]! [padding:1px_var(--space-1)]! [border-radius:4px]! [border:1px_solid_var(--border-hairline)]! [background:var(--bg-base)]! [color:var(--text-secondary)]!"
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add step input */}
      <div className="[display:flex]! [gap:6px]! [align-items:center]!">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addStep(); } }}
          placeholder="Add a step…"
          className="[flex:1]! [background:var(--bg-elevated)]! [border:1px_solid_var(--border-hairline)]! [border-radius:6px]! [padding:5px_9px]! [font-size:var(--text-sm)]! [color:var(--text-primary)]! [outline:none]!"
        />
        <button
          type="button"
          className="board-toolbar-btn [padding:var(--space-1)_10px]! [font-size:var(--text-xs)]!"
          onClick={addStep}
          disabled={!draft.trim()}
        >
          <Icon name="ph:plus-bold" width={11} />
          Add
        </button>
      </div>

      {/* CSS for hover reveal on step actions */}
      <style>{".step-actions { opacity: 0; transition: opacity 0.1s; } li:hover .step-actions, li:focus-within .step-actions { opacity: 1; }"}</style>
    </div>
  );
}


export function BoardInspector({ card, familiars, sessions, projects, onClose, onPatch, onMoveStatus, onDelete, onCardReplaced, onOpenTaskWork, onOpenUrl, chatLinking = false, chatLinkError, onUseHarnessFix }: Props) {
  const dtPrefs = useDateTimePrefs();
  const [closing, setClosing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState<CardLifecycle | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  // The Lifecycle section (state machine moves + created/updated stamps) is
  // power-user/debug info that confuses most people, so it's collapsed by
  // default — the badge summary still shows in the header chip; expand only
  // when you actually need to dispatch/cancel or read the timestamps.
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  // Fleet buttons stay hidden unless OMNIGENT_TOKEN is set up in the user's Vault (cave-cfvv).
  const fleetEnabled = useFleetTokenEnabled();

  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const moves = NEXT_MOVES[card.lifecycle] ?? [];
  const currentFamiliar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const modelHarness = canonicalHarnessId(
    currentFamiliar?.harness ?? currentFamiliar?.defaultHarness ?? "",
  );
  const runtimeModelOptions = useRuntimeModelOptions(modelHarness, currentFamiliar?.id ?? null);
  const taskModelIsCustom = Boolean(
    card.modelOverride && !runtimeModelOptions.some((option) => option.id === card.modelOverride),
  );
  const [modelCustomMode, setModelCustomMode] = useState(false);
  const [customModelDraft, setCustomModelDraft] = useState(card.modelOverride ?? "");
  // Starting a task creates its session from the persisted card. Keep a model
  // save in flight until it settles so selecting a model and immediately
  // pressing Start work cannot create the session with the prior default.
  const pendingModelSaveRef = useRef<Promise<boolean> | null>(null);
  const persistTaskModelPatch = (patch: CardPatch) => {
    const pending = Promise.resolve(onPatch(card.id, patch))
      .then((saved) => saved !== false)
      .catch(() => false);
    pendingModelSaveRef.current = pending;
    void pending.finally(() => {
      if (pendingModelSaveRef.current === pending) pendingModelSaveRef.current = null;
    });
  };
  const openTaskWorkAfterModelSave = async () => {
    const saved = await (pendingModelSaveRef.current ?? Promise.resolve(true));
    if (saved) await onOpenTaskWork?.(card.id);
  };
  useEffect(() => {
    setCustomModelDraft(card.modelOverride ?? "");
  }, [card.modelOverride]);
  const taskModelOptions = [
    { value: "", label: "Familiar default" },
    ...runtimeModelOptions.map((option) => ({ value: option.id, label: option.label })),
    ...(runtimeModelOptions.length > 0 ? [{ value: "__custom__", label: "Custom…" }] : []),
  ];
  const resolvedFamiliarList = useResolvedFamiliars(currentFamiliar ? [currentFamiliar] : [], { includeArchived: true });
  const resolvedFamiliar = resolvedFamiliarList[0] ?? null;

  const close = () => { setClosing(true); setTimeout(onClose, 180); };

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(!closing, dialogRef, { onEscape: close });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLabel = () => {
    const l = newLabel.trim();
    if (!l || card.labels.includes(l)) return;
    onPatch(card.id, { ops: { labelOps: [{ op: "add", value: l }] } });
    setNewLabel("");
  };

  const doLifecycle = async (to: CardLifecycle, retry?: boolean) => {
    setLifecycleBusy(to); setLifecycleErr(null);
    try {
      const res = await fetch(`/api/board/${card.id}/lifecycle`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, retry }),
      });
      const json = await res.json();
      if (!json.ok) { setLifecycleErr(json.error ?? "failed"); return; }
      publishBoardChanged();
      onCardReplaced(json.card as Card);
    } catch (err) {
      setLifecycleErr(err instanceof Error ? err.message : "failed");
    } finally { setLifecycleBusy(null); }
  };

  if (typeof document === "undefined") return null;

  // Portal to <body> so the drawer's `position: fixed` resolves against the
  // viewport, NOT the `.cave-mode-fade` mode wrapper. That wrapper retains a
  // transform from its `cave-mode-in … both` animation, which silently makes
  // it the containing block for fixed descendants — so an inline drawer
  // anchored its `right:0`/`width:480px` to the (narrower, inset) detail panel
  // instead of the window. Symptoms: a right-edge gap on desktop and left-
  // clipped content on narrow viewports. Mirrors the ui/Modal portal pattern.
  return createPortal(
    <>
      <div className="board-drawer-backdrop" onClick={close} />
      <div ref={dialogRef} className={`board-drawer${closing ? " board-drawer--closing" : ""}`} role="dialog" aria-modal aria-label="Card inspector" tabIndex={-1}>
        <div className="board-drawer-header">
          <input
            className="board-drawer-title-input"
            defaultValue={card.title}
            aria-label="Card title"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== card.title) onPatch(card.id, { title: next });
              else e.target.value = card.title;
            }}
          />
          <button type="button" className="board-drawer-close" onClick={close} aria-label="Close">
            <Icon name="ph:x-bold" width={12} />
          </button>
        </div>

        <div className="board-drawer-body">
          <div className="board-drawer-meta-card">
            <div className="board-drawer-grid-2">
              <div className="board-drawer-field">
                <div className="board-drawer-field-label">Status</div>
                <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                  <span className={`board-drawer-status-dot board-drawer-status-dot--${card.status}`} aria-hidden />
                  <StandardSelect<CardStatus>
                    label="Status"
                    className="board-drawer-field-select board-drawer-field-select--styled"
                    value={card.status}
                    onChange={(next) => onMoveStatus(card.id, next)}
                    options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                    showCaret={false}
                  />
                  <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
                </div>
              </div>
              <div className="board-drawer-field">
                <div className="board-drawer-field-label">Priority</div>
                <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                  <span className={`board-drawer-priority-flag board-drawer-priority-flag--${card.priority}`} aria-hidden />
                  <StandardSelect<CardPriority>
                    label="Priority"
                    className="board-drawer-field-select board-drawer-field-select--styled"
                    value={card.priority}
                    onChange={(next) => onPatch(card.id, { priority: next })}
                    options={PRIORITIES.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
                    showCaret={false}
                  />
                  <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
                </div>
              </div>
            </div>

            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Familiar</div>
              <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                <span className="board-drawer-familiar-avatar" aria-hidden>
                  {resolvedFamiliar ? (
                    <FamiliarAvatar familiar={resolvedFamiliar} size="sm" />
                  ) : (
                    <Icon name="ph:user" width={12} className="text-[var(--text-muted)]" />
                  )}
                </span>
                <StandardSelect
                  label="Familiar"
                  className="board-drawer-field-select board-drawer-field-select--styled"
                  value={card.familiarId ?? ""}
                  onChange={(next) => {
                    setModelCustomMode(false);
                    persistTaskModelPatch({ familiarId: next || null, modelOverride: null });
                  }}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...familiars.map((f) => ({ value: f.id, label: f.display_name })),
                  ]}
                  showCaret={false}
                />
                <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
              </div>
            </div>

            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Model</div>
              {runtimeModelOptions.length > 0 && !modelCustomMode && !taskModelIsCustom ? (
                <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                  <span className="board-drawer-project-icon" aria-hidden>
                    <Icon name="ph:brain" width={12} className="text-[var(--text-muted)]" />
                  </span>
                  <StandardSelect
                    label="Model"
                    className="board-drawer-field-select board-drawer-field-select--styled"
                    value={card.modelOverride ?? ""}
                    onChange={(next) => {
                      if (next === "__custom__") {
                        setModelCustomMode(true);
                        setCustomModelDraft("");
                        return;
                      }
                      persistTaskModelPatch({ modelOverride: next || null });
                    }}
                    options={taskModelOptions}
                    disabled={!currentFamiliar || Boolean(card.sessionId)}
                    title={card.sessionId ? "Unlink work before changing the task model" : undefined}
                    showCaret={false}
                  />
                  <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
                </div>
              ) : (
                <input
                  className="board-drawer-field-input"
                  value={customModelDraft}
                  onChange={(event) => setCustomModelDraft(event.target.value)}
                  onBlur={() => {
                    setModelCustomMode(false);
                    persistTaskModelPatch({ modelOverride: customModelDraft || null });
                  }}
                  placeholder={currentFamiliar ? "provider/model (optional)" : "Assign a familiar first"}
                  disabled={!currentFamiliar || Boolean(card.sessionId)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              )}
              <p className="board-drawer-field-hint">
                {card.sessionId
                  ? "This task's linked work session keeps its current model."
                  : "Leave blank to use the familiar's configured default."}
              </p>
            </div>

            <div className="board-drawer-grid-2">
              <div className="board-drawer-field">
                <div className="board-drawer-field-label">Start date</div>
                <input
                  className="board-drawer-field-input"
                  type="date"
                  value={card.startDate ?? ""}
                  onChange={(e) => onPatch(card.id, { startDate: e.target.value || null })}
                />
              </div>
              <div className="board-drawer-field">
                <div className="board-drawer-field-label">End date</div>
                <input
                  className="board-drawer-field-input"
                  type="date"
                  value={card.endDate ?? ""}
                  onChange={(e) => onPatch(card.id, { endDate: e.target.value || null })}
                />
              </div>
            </div>

            <div className="board-drawer-field">
              <div className="board-drawer-field-label board-drawer-field-label--split">
                <span>Project</span>
                <button
                  type="button"
                  className="board-drawer-inline-link"
                  onClick={openProjectsSurface}
                  title="Open Projects"
                >
                  <Icon name="ph:folder-open" width={11} />
                  Open Projects
                </button>
              </div>
              <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                <span className="board-drawer-project-icon" aria-hidden>
                  <Icon name="ph:folder" width={12} className="text-[var(--text-muted)]" />
                </span>
                <StandardSelect
                  label="Project"
                  className="board-drawer-field-select board-drawer-field-select--styled"
                  value={card.projectId ?? ""}
                  onChange={(next) => {
                    const selectedProject = projects.find((project) => project.id === next) ?? null;
                    onPatch(card.id, { projectId: selectedProject?.id ?? null, cwd: selectedProject?.root ?? null });
                  }}
                  options={[
                    { value: "", label: "No project" },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                  showCaret={false}
                />
                <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
              </div>
              {projects.length === 0 ? (
                <p className="board-drawer-field-hint">
                  No projects yet. Open Projects to add one, then choose it here.
                </p>
              ) : null}
              {projects.length > 0 && !card.projectId && !card.cwd ? (
                <p className="board-drawer-field-hint board-drawer-field-hint--nudge">
                  No project set — task work can't start, and linked sessions won't open in the
                  right project, until you pick one.
                </p>
              ) : null}
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Work</div>
            {session ? (
              <div className="board-drawer-chat-linked-row">
                <button
                  type="button"
                  className="board-drawer-chat-card board-drawer-chat-card--linked"
                  onClick={() => void onOpenTaskWork?.(card.id)}
                >
                  <span className="board-drawer-chat-icon" aria-hidden>
                    <Icon name="ph:chat-circle-dots" width={14} />
                  </span>
                  <span className="board-drawer-chat-body">
                    <span className="board-drawer-chat-title">{session.title || "(untitled)"}</span>
                    {/* cave-32ks: live session state — dot + word — so the
                        drawer answers "is the familiar on it?" at a glance. */}
                    <span className="board-drawer-chat-desc">
                      <span
                        className={`board-drawer-chat-status-dot board-drawer-chat-status-dot--${sessionStatusTone(session.status)}`}
                        aria-hidden
                      />
                      {sessionStatusWord(session.status)} · open work
                    </span>
                  </span>
                  <Icon name="ph:arrow-right-bold" width={12} className="board-drawer-chat-trail" />
                </button>
                <button
                  type="button"
                  className="board-drawer-chat-unlink"
                  title="Unlink work session"
                  aria-label="Unlink work session"
                  onClick={() => onPatch(card.id, { sessionId: null })}
                >
                  <Icon name="ph:x" width={13} />
                </button>
              </div>
            ) : (
              <div className="board-drawer-chat-card board-drawer-chat-card--empty">
                <span className="board-drawer-chat-icon board-drawer-chat-icon--empty" aria-hidden>
                  <Icon name="ph:chat-circle-dots" width={14} />
                </span>
                <span className="board-drawer-chat-body">
                  <span className="board-drawer-chat-title">
                    {chatLinkError ? "Couldn't start work" : "No work session"}
                  </span>
                  <span className="board-drawer-chat-desc">
                    {chatLinkError
                      ? chatLinkError
                      : "Start focused work with this task's familiar."}
                  </span>
                  {(() => {
                    const failure =
                      chatLinkError && onUseHarnessFix ? parseHarnessFailure(chatLinkError) : null;
                    return failure ? (
                      <HarnessFixActions
                        failure={failure}
                        busy={chatLinking}
                        onUseHarness={onUseHarnessFix}
                        className="mt-1"
                      />
                    ) : null;
                  })()}
                </span>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="board-drawer-chat-cta"
                    disabled={chatLinking}
                    title="Start work"
                    onClick={() => void openTaskWorkAfterModelSave()}
                  >
                    {chatLinking ? "Starting…" : chatLinkError ? "Retry" : "Start work"}
                    <Icon name="ph:arrow-right-bold" width={11} />
                  </button>
                  {fleetEnabled ? (
                    <button
                      type="button"
                      className="board-drawer-chat-cta"
                      title="Run on Omnigent fleet"
                      onClick={() => {
                        void (async () => {
                          const { startOmnigentRunFromBrowser } = await import("@/lib/omnigent/browser-run");
                          const { openExternalUrl } = await import("@/lib/open-external");
                          const result = await startOmnigentRunFromBrowser({
                            prompt: card.title,
                            familiarId: card.familiarId ?? undefined,
                            boardCardId: card.id,
                            title: card.title,
                            source: "cave-board",
                          });
                          if (!result.ok) {
                            window.alert(result.error);
                            return;
                          }
                          void openExternalUrl(result.webUrl);
                        })();
                      }}
                    >
                      Fleet
                      <Icon name="ph:desktop" width={11} />
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <StepsSection card={card} onPatch={onPatch} />

          <LinksSection card={card} onPatch={onPatch} onOpenUrl={onOpenUrl} />

          <GitHubAttachSection card={card} familiars={familiars} onPatch={onPatch} onOpenUrl={onOpenUrl} />

          <AsanaAttachSection card={card} onPatch={onPatch} onOpenUrl={onOpenUrl} />

          <AttachmentsSection card={card} onPatch={onPatch} />

          <div className="board-drawer-field">
            <div className="board-drawer-field-label"><Icon name="ph:note-bold" width={11} /> Notes</div>
            <textarea
              className="board-drawer-field-textarea"
              defaultValue={card.notes}
              placeholder="Context, decisions, things to remember…"
              onBlur={(e) => { if (e.target.value !== card.notes) onPatch(card.id, { notes: e.target.value }); }}
            />
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">
              <Icon name="ph:tag-bold" width={11} /> Labels
              {card.labels.length > 0 && <span className="board-drawer-count-pill">{card.labels.length}</span>}
            </div>
            {card.labels.length > 0 && (
              <div className="board-label-chips [margin-bottom:var(--space-2)]!">
                {card.labels.map((l) => (
                  <span key={l} className="board-label-chip">
                    {l}
                    <button type="button" className="board-label-chip-remove"
                      onClick={() => onPatch(card.id, { ops: { labelOps: [{ op: "remove", value: l }] } })}
                      aria-label={`Remove ${l}`}>
                      <Icon name="ph:x-bold" width={8} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="[display:flex]! [gap:6px]!">
              <input className="board-drawer-field-input [flex:1]!" placeholder="Add label…"
                value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }} />
              <button type="button" className="board-toolbar-btn" onClick={addLabel} disabled={!newLabel.trim()}>
                <Icon name="ph:plus-bold" width={11} /> Add
              </button>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label [display:flex]! [align-items:center]! [justify-content:space-between]!">
              <span className="[display:inline-flex]! [align-items:center]! [gap:5px]!">
                Lifecycle
              </span>
              <button
                type="button"
                className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_var(--space-2)]!"
                onClick={() => setLifecycleOpen((v) => !v)}
                aria-expanded={lifecycleOpen}
                title={lifecycleOpen ? "Hide lifecycle details" : "Show lifecycle details"}
              >
                <Icon name={lifecycleOpen ? "ph:caret-up" : "ph:caret-down"} width={11} />
                {lifecycleOpen ? "Hide" : "Show"}
              </button>
            </div>
            {lifecycleOpen && (
              <>
                <div className="board-drawer-lifecycle-card">
                  <div className="board-drawer-lifecycle-row">
                    <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
                    {card.lifecycle === "running" && <TimeoutBadge runningSince={card.runningSince} timeoutMs={card.timeoutMs} />}
                    {card.retryCount > 0 && (
                      <span className="board-drawer-count-pill" title={`Retried ${card.retryCount} of ${card.maxRetries} times`}>
                        retry {card.retryCount}/{card.maxRetries}
                      </span>
                    )}
                  </div>
                  {card.lifecycleReason ? (
                    <p style={{ margin: 0, fontSize: 10.5, overflowWrap: "anywhere", color: card.lifecycle === "failed" ? "var(--color-danger)" : "var(--text-muted)" }}>
                      <span className="[margin-right:6px]! [font-size:var(--text-2xs)]! [text-transform:uppercase]! [letter-spacing:0.08em]! [color:var(--text-muted)]!">Reason</span>
                      {card.lifecycleReason}
                    </p>
                  ) : null}
                  {moves.length > 0 && (
                    <div className="board-drawer-lifecycle-actions">
                      {moves.map((m) => (
                        <button
                          key={`${m.to}-${m.retry}`}
                          type="button"
                          className={`board-drawer-lifecycle-action${m.retry ? " board-drawer-lifecycle-action--retry" : ""}${m.to === "cancelled" ? " board-drawer-lifecycle-action--danger" : ""}`}
                          disabled={lifecycleBusy !== null}
                          onClick={() => void doLifecycle(m.to, m.retry)}
                        >
                          {lifecycleBusy === m.to ? "…" : m.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {lifecycleErr && <p className="board-drawer-lifecycle-error">{lifecycleErr}</p>}
                </div>

                <div className="board-drawer-stamps">
                  <span><span className="board-drawer-stamp-label">Created</span> {`${formatDate(card.createdAt, dtPrefs, { year: true })} ${formatClock(card.createdAt, dtPrefs)}`}</span>
                  <span className="board-drawer-stamp-sep">·</span>
                  <span><span className="board-drawer-stamp-label">Updated</span> {`${formatDate(card.updatedAt, dtPrefs, { year: true })} ${formatClock(card.updatedAt, dtPrefs)}`}</span>
                  {card.lifecycleAt ? (
                    <>
                      <span className="board-drawer-stamp-sep">·</span>
                      <span><span className="board-drawer-stamp-label">State since</span> {`${formatDate(card.lifecycleAt, dtPrefs, { year: true })} ${formatClock(card.lifecycleAt, dtPrefs)}`}</span>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <BoardInspectorDebug card={card} />
        </div>

        <div className="board-drawer-footer">
          {deleteConfirm ? (
            <div className="board-drawer-confirm">
              <span className="board-drawer-confirm-text">Delete this card?</span>
              <button type="button" className="board-toolbar-btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
              <button type="button" className="board-drawer-delete-btn board-drawer-delete-btn--solid"
                onClick={async () => { await onDelete(card.id); close(); }}>
                <Icon name="ph:trash" width={11} /> Delete
              </button>
            </div>
          ) : (
            <button type="button" className="board-drawer-delete-btn" onClick={() => setDeleteConfirm(true)}>
              <Icon name="ph:trash" width={11} /> Delete
            </button>
          )}
          <button type="button" className="board-toolbar-btn" onClick={close}>Close</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatLinkLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}
