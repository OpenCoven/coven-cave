"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardLifecycle, CardPriority, CardStatus } from "@/lib/cave-board-types";
import { STATUSES, PRIORITIES } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects";
import { LifecycleBadge, formatTimeoutBadge } from "@/components/ui/lifecycle-badge";
import type { CardStep } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import {
  mergeLinksWithGitHub,
  mergeTaskGitHubLinks,
  taskGitHubLinkFromGitHubItem,
} from "@/lib/task-github";
import { Icon } from "@/lib/icon";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import type { IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { useDateTimePrefs, formatDate, formatClock } from "@/lib/datetime-format";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onDelete: (id: string) => Promise<void>;
  onCardReplaced: (card: Card) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  onOpenUrl?: (url: string) => void;
  chatLinking?: boolean;
  /** Surfaces an in-drawer error when /api/board/:id/chat fails (typically
   *  daemon offline → 502). Without this the failure only appears as a
   *  small banner at the top of the board, hidden behind the open drawer. */
  chatLinkError?: string | null;
};

function TimeoutBadge({ runningSince, timeoutMs }: { runningSince?: string; timeoutMs?: number }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const text = formatTimeoutBadge(runningSince, timeoutMs, DEFAULT_TIMEOUT_MS);
  if (!text) return null;
  const over = runningSince ? Date.now() - new Date(runningSince).getTime() > (timeoutMs ?? DEFAULT_TIMEOUT_MS) : false;
  return (
    <span className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-widest ${over ? "border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]" : "border-border bg-card text-muted-foreground"}`}>
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
    <div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon name="ph:github-logo" width={14} className="text-[var(--text-muted)]" />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>Connect GitHub</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>GitHub username</label>
        <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="your-username"
          style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", borderRadius: 6,
            padding: "5px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none", width: "100%", boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>
          Personal Access Token <span style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input type="password" value={pat} onChange={(e) => setPat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="ghp_…"
          style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", borderRadius: 6,
            padding: "5px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none", width: "100%", boxSizing: "border-box" }} />
      </div>
      {error && <p style={{ fontSize: 10, color: "var(--color-danger)", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
        <a href="https://github.com/settings/tokens/new?scopes=read:user,repo,notifications&description=Cave+local"
          target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: "var(--accent-presence)", textDecoration: "none" }}>
          Generate PAT →
        </a>
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
  onPatch: (id: string, patch: Partial<Card>) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/github/assigned", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; items?: GitHubItem[]; configured?: boolean; error?: string }) => {
        if (d.ok) {
          setItems(d.items ?? []);
          setConfigured(d.configured ?? true);
        } else {
          setErr(d.error ?? "failed");
        }
      })
      .catch(() => setErr("fetch failed"))
      .finally(() => setLoading(false));
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
      <div className="board-drawer-field-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="ph:github-logo" width={11} />
          GitHub
          {attachedItems.length > 0 && <span className="board-drawer-count-pill">{attachedItems.length}</span>}
        </span>
        <button
          type="button"
          className="board-toolbar-btn"
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 10, padding: "2px 8px" }}
        >
          <Icon name={open ? "ph:caret-up" : "ph:github-logo"} width={11} />
          {open ? "Hide" : "Attach"}
        </button>
      </div>

      {attachedItems.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {attachedItems.map((item) => (
            <div key={item.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--bg-elevated)", borderRadius: 6,
              padding: "5px 8px", border: "1px solid var(--border-hairline)"
            }}>
              <button
                type="button"
                className="board-github-attachment-open"
                onClick={() => onOpenUrl?.(item.url)}
                title="Open in app browser"
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: 0,
                  padding: 0,
                  background: "transparent",
                  color: "var(--text-primary)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Icon name={iconName(item.kind)} width={12} className={STATE_COLOR[item.state ?? ""] ?? "text-[var(--text-muted)]"} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.repo}{item.number != null ? " #" + item.number : ""} — {item.title}
                </span>
              </button>
              <button
                type="button"
                className="board-toolbar-btn"
                style={{ fontSize: 10, padding: "1px 6px" }}
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
        <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, overflow: "hidden", background: "var(--bg-raised)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border-hairline)" }}>
            <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" />
            <input
              autoFocus={!coarse}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PRs, issues…"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--text-primary)" }}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                <Icon name="ph:x" width={11} />
              </button>
            )}
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {loading && (
              <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>Loading…</div>
            )}
            {err && (
              <div style={{ padding: "10px", fontSize: 11, color: "var(--color-danger)" }}>{err}</div>
            )}
            {!loading && !err && configured === false && (
              <InlinePATSetup onSaved={() => { setItems([]); setConfigured(null); setFetchKey((k) => k + 1); }} />
            )}
            {!loading && !err && configured !== false && filtered.length === 0 && items.length === 0 && (
              <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                No open issues, PRs, or review requests assigned to you.
              </div>
            )}
            {!loading && !err && configured !== false && items.length > 0 && filtered.length === 0 && (
              <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>No matches.</div>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.repo}{item.number != null ? " #" + item.number : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {fam && (
                      <button
                        type="button"
                        className="board-toolbar-btn"
                        style={{ fontSize: 10, padding: "2px 7px" }}
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



// ── Links ────────────────────────────────────────────────────────────────────
function LinksSection({
  card,
  onPatch,
  onOpenUrl,
}: {
  card: Card;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [savedToLibrary, setSavedToLibrary] = useState<Record<string, "saving" | "done" | "error">>({});

  const links = card.links ?? [];

  function isValidUrl(value: string): boolean {
    return value.startsWith("http://") || value.startsWith("https://");
  }

  function addLink() {
    const url = draft.trim();
    if (!url || !isValidUrl(url)) return;
    if (links.includes(url)) return;
    onPatch(card.id, { links: [...links, url] });
    setDraft("");
    inputRef.current?.focus();
  }

  function deleteLink(url: string) {
    onPatch(card.id, { links: links.filter((l) => l !== url) });
  }

  async function saveToLibrary(url: string) {
    setSavedToLibrary((prev) => ({ ...prev, [url]: "saving" }));
    try {
      let title = url;
      try { title = new URL(url).hostname.replace(/^www./, ""); } catch { /* use url */ }
      const res = await fetch("/api/library/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, title, tags: card.labels ?? [] }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setSavedToLibrary((prev) => ({ ...prev, [url]: "done" }));
        setTimeout(() => setSavedToLibrary((prev) => {
          const next = { ...prev }; delete next[url]; return next;
        }), 2000);
      } else {
        setSavedToLibrary((prev) => ({ ...prev, [url]: "error" }));
        setTimeout(() => setSavedToLibrary((prev) => {
          const next = { ...prev }; delete next[url]; return next;
        }), 3000);
      }
    } catch {
      setSavedToLibrary((prev) => ({ ...prev, [url]: "error" }));
      setTimeout(() => setSavedToLibrary((prev) => {
        const next = { ...prev }; delete next[url]; return next;
      }), 3000);
    }
  }

  return (
    <div className="board-drawer-field">
      {/* Header row */}
      <div className="board-drawer-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="ph:link-simple" width={12} />
        Links
        {links.length > 0 && (
          <span style={{
            fontSize: 10,
            color: "var(--text-muted)",
            background: "var(--bg-elevated)",
            borderRadius: 8,
            padding: "1px 6px",
          }}>
            {links.length}
          </span>
        )}
      </div>

      {/* Link list */}
      {links.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
          {links.map((link) => {
            const href = safeHref(link);
            const saveState = savedToLibrary[link];
            return (
              <li
                key={link}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-hairline)",
                }}
              >
                <Icon name="ph:link-simple" width={10} className="shrink-0 text-[var(--text-muted)]" />
                {href ? (
                  <button
                    type="button"
                    onClick={() => onOpenUrl?.(href)}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: "var(--text-primary)",
                      textDecoration: "none",
                      textAlign: "left",
                      border: 0,
                      padding: 0,
                      background: "transparent",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title="Open in app browser"
                    className="link-item-anchor"
                  >
                    {formatLinkLabel(link)}
                  </button>
                ) : (
                  <span style={{
                    flex: 1,
                    fontSize: 12,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {link}
                  </span>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 2 }} className="step-actions">
                  {saveState === "error" ? (
                    <span style={{ fontSize: 10, color: "var(--color-danger)" }} title="Save failed">
                      err
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="board-toolbar-btn"
                      style={{ padding: "1px 4px", color: saveState === "done" ? "var(--color-success, #16a34a)" : "var(--text-muted)" }}
                      onClick={() => { if (!saveState) void saveToLibrary(link); }}
                      title={saveState === "done" ? "Saved to Library" : "Save to Library"}
                      disabled={saveState === "saving"}
                    >
                      <Icon name={saveState === "done" ? "ph:check" : "ph:bookmark-simple"} width={10} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="board-toolbar-btn"
                    style={{ padding: "1px 4px", color: "var(--color-danger)" }}
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
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addLink(); } }}
          placeholder="Paste a URL…"
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-hairline)",
            borderRadius: 6,
            padding: "5px 9px",
            fontSize: 12,
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="board-toolbar-btn"
          onClick={addLink}
          disabled={!draft.trim() || !isValidUrl(draft.trim())}
          style={{ padding: "4px 10px", fontSize: 11 }}
        >
          <Icon name="ph:plus-bold" width={11} />
          Add
        </button>
      </div>

      {/* CSS for hover reveal on link actions */}
      <style>{".link-item-anchor:hover { text-decoration: underline; } .step-actions { opacity: 0; transition: opacity 0.1s; } li:hover .step-actions, li:focus-within .step-actions { opacity: 1; }"}</style>
    </div>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────
function StepsSection({
  card,
  onPatch,
}: {
  card: Card;
  onPatch: (id: string, patch: Partial<Card>) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const steps = card.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  function addStep() {
    const text = draft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const next: CardStep = {
      id: crypto.randomUUID(),
      text,
      done: false,
      addedAt: now,
    };
    onPatch(card.id, { steps: [...steps, next] });
    setDraft("");
    inputRef.current?.focus();
  }

  function toggleStep(id: string) {
    const now = new Date().toISOString();
    onPatch(card.id, {
      steps: steps.map((s) =>
        s.id === id
          ? { ...s, done: !s.done, doneAt: !s.done ? now : undefined }
          : s
      ),
    });
  }

  function deleteStep(id: string) {
    onPatch(card.id, { steps: steps.filter((s) => s.id !== id) });
  }

  function reorderStep(id: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...steps];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onPatch(card.id, { steps: next });
  }

  return (
    <div className="board-drawer-field">
      {/* Header row */}
      <div className="board-drawer-field-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="ph:list-checks-bold" width={12} />
          Steps
          {total > 0 && (
            <span style={{
              fontSize: 10,
              color: "var(--text-muted)",
              background: "var(--bg-elevated)",
              borderRadius: 8,
              padding: "1px 6px",
            }}>
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
        <div style={{
          height: 2,
          borderRadius: 2,
          background: "var(--border-hairline)",
          marginBottom: 8,
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: pct + "%",
            background: pct === 100 ? "var(--color-success)" : "var(--accent-presence)",
            transition: "width 0.2s ease, background 0.2s ease",
          }} />
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
          {steps.map((step, i) => (
            <li
              key={step.id}
              style={{
                display: "flex",
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
                  transition: "background 0.15s",
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
              <span style={{ display: "flex", gap: 2, flexShrink: 0 }} className="step-actions">
                {i > 0 && (
                  <button type="button" className="board-toolbar-btn" style={{ padding: "1px 4px" }}
                    onClick={() => reorderStep(step.id, -1)} title="Move up">
                    <Icon name="ph:arrow-up-bold" width={9} />
                  </button>
                )}
                {i < steps.length - 1 && (
                  <button type="button" className="board-toolbar-btn" style={{ padding: "1px 4px" }}
                    onClick={() => reorderStep(step.id, 1)} title="Move down">
                    <Icon name="ph:arrow-down-bold" width={9} />
                  </button>
                )}
                <button type="button" className="board-toolbar-btn" style={{ padding: "1px 4px", color: "var(--color-danger)" }}
                  onClick={() => deleteStep(step.id)} title="Delete step">
                  <Icon name="ph:x-bold" width={9} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Add step input */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addStep(); } }}
          placeholder="Add a step…"
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-hairline)",
            borderRadius: 6,
            padding: "5px 9px",
            fontSize: 12,
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="board-toolbar-btn"
          onClick={addStep}
          disabled={!draft.trim()}
          style={{ padding: "4px 10px", fontSize: 11 }}
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

export function BoardInspector({ card, familiars, sessions, projects, onClose, onPatch, onMoveStatus, onDelete, onCardReplaced, onJumpToSession, onOpenTaskChat, onOpenUrl, chatLinking = false, chatLinkError }: Props) {
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

  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const moves = NEXT_MOVES[card.lifecycle] ?? [];
  const currentFamiliar = familiars.find((f) => f.id === card.familiarId) ?? null;
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
    onPatch(card.id, { labels: [...card.labels, l] });
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
                  <select
                    className="board-drawer-field-select board-drawer-field-select--styled"
                    value={card.status}
                    onChange={(e) => onMoveStatus(card.id, e.target.value as CardStatus)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                  <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
                </div>
              </div>
              <div className="board-drawer-field">
                <div className="board-drawer-field-label">Priority</div>
                <div className="board-drawer-select-shell board-drawer-select-shell--with-leading">
                  <span className={`board-drawer-priority-flag board-drawer-priority-flag--${card.priority}`} aria-hidden />
                  <select
                    className="board-drawer-field-select board-drawer-field-select--styled"
                    value={card.priority}
                    onChange={(e) => onPatch(card.id, { priority: e.target.value as CardPriority })}
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
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
                <select
                  className="board-drawer-field-select board-drawer-field-select--styled"
                  value={card.familiarId ?? ""}
                  onChange={(e) => onPatch(card.id, { familiarId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {familiars.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
                </select>
                <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
              </div>
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
                <select
                  className="board-drawer-field-select board-drawer-field-select--styled"
                  value={card.projectId ?? ""}
                  onChange={(e) => {
                    const selectedProject = projects.find((project) => project.id === e.target.value) ?? null;
                    onPatch(card.id, { projectId: selectedProject?.id ?? null, cwd: selectedProject?.root ?? null });
                  }}
                >
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <Icon name="ph:caret-up-down-bold" width={11} className="board-drawer-select-caret" />
              </div>
              {projects.length === 0 ? (
                <p className="board-drawer-field-hint">
                  No projects yet. Open Projects to add one, then choose it here.
                </p>
              ) : null}
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Chat</div>
            {session ? (
              <button
                type="button"
                className="board-drawer-chat-card board-drawer-chat-card--linked"
                onClick={() => onJumpToSession?.(session.id, session.familiarId ?? null)}
              >
                <span className="board-drawer-chat-icon" aria-hidden>
                  <Icon name="ph:chat-circle-dots" width={14} />
                </span>
                <span className="board-drawer-chat-body">
                  <span className="board-drawer-chat-title">{session.title || "(untitled)"}</span>
                  <span className="board-drawer-chat-desc">Open conversation</span>
                </span>
                <Icon name="ph:arrow-square-out" width={12} className="board-drawer-chat-trail" />
              </button>
            ) : (
              <div className="board-drawer-chat-card board-drawer-chat-card--empty">
                <span className="board-drawer-chat-icon board-drawer-chat-icon--empty" aria-hidden>
                  <Icon name="ph:chat-circle-dots" width={14} />
                </span>
                <span className="board-drawer-chat-body">
                  <span className="board-drawer-chat-title">
                    {chatLinkError ? "Couldn't start chat" : "No chat linked"}
                  </span>
                  <span className="board-drawer-chat-desc">
                    {chatLinkError
                      ? chatLinkError
                      : "Start a conversation with this card's familiar."}
                  </span>
                </span>
                <button
                  type="button"
                  className="board-drawer-chat-cta"
                  disabled={chatLinking}
                  title="Start chat"
                  onClick={() => void onOpenTaskChat?.(card.id)}
                >
                  {chatLinking ? "Starting…" : chatLinkError ? "Retry" : "Start"}
                  <Icon name="ph:arrow-right-bold" width={11} />
                </button>
              </div>
            )}
          </div>

          <StepsSection card={card} onPatch={onPatch} />

          <LinksSection card={card} onPatch={onPatch} onOpenUrl={onOpenUrl} />

          <GitHubAttachSection card={card} familiars={familiars} onPatch={onPatch} onOpenUrl={onOpenUrl} />

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
              <div className="board-label-chips" style={{ marginBottom: 8 }}>
                {card.labels.map((l) => (
                  <span key={l} className="board-label-chip">
                    {l}
                    <button type="button" className="board-label-chip-remove"
                      onClick={() => onPatch(card.id, { labels: card.labels.filter((x) => x !== l) })}
                      aria-label={`Remove ${l}`}>
                      <Icon name="ph:x-bold" width={8} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="board-drawer-field-input" style={{ flex: 1 }} placeholder="Add label…"
                value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }} />
              <button type="button" className="board-toolbar-btn" onClick={addLabel} disabled={!newLabel.trim()}>
                <Icon name="ph:plus-bold" width={11} /> Add
              </button>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Lifecycle
              </span>
              <button
                type="button"
                className="board-toolbar-btn"
                onClick={() => setLifecycleOpen((v) => !v)}
                aria-expanded={lifecycleOpen}
                title={lifecycleOpen ? "Hide lifecycle details" : "Show lifecycle details"}
                style={{ fontSize: 10, padding: "2px 8px" }}
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
                  </div>
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
                </div>
              </>
            )}
          </div>
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
