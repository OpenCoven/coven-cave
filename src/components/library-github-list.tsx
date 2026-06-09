"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import type { CardGitHubLink, CardStatus } from "@/lib/cave-board-types";
import type { LibraryGitHubItem, GitHubItemKind } from "@/lib/library-types";
import {
  libraryItemToTaskGitHubLink,
  mergeLinksWithGitHub,
  mergeTaskGitHubLinks,
} from "@/lib/task-github";
import { useFocusTrap } from "@/lib/use-focus-trap";

// ── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "title" | "repo" | "savedAt";
type SortDir = "asc" | "desc";
type GroupBy = "repo" | "kind" | "none";

function relTime(iso: string): string {
  try {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    const d = Math.round(s / 86400);
    return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`;
  } catch { return ""; }
}

function sortItems(items: LibraryGitHubItem[], key: SortKey, dir: SortDir): LibraryGitHubItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (key === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
    else if (key === "repo") cmp = (a.repo ?? "").localeCompare(b.repo ?? "");
    else cmp = (a.savedAt ?? "").localeCompare(b.savedAt ?? "");
    return dir === "asc" ? cmp : -cmp;
  });
}

function groupItems(items: LibraryGitHubItem[], by: GroupBy): { key: string; label: string; items: LibraryGitHubItem[] }[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const map = new Map<string, LibraryGitHubItem[]>();
  for (const item of items) {
    const key = by === "repo" ? item.repo : item.kind;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key, items }));
}

function kindIcon(kind: GitHubItemKind) {
  switch (kind) {
    case "repo":        return <Icon name="ph:github-logo" width={12} />;
    case "issue":       return <Icon name="ph:git-diff" width={12} />;
    case "pr":          return <Icon name="ph:git-pull-request" width={12} />;
    case "discussion":  return <Icon name="ph:chat-centered-text" width={12} />;
  }
}

function stateStyle(state?: LibraryGitHubItem["state"]): React.CSSProperties & { label: string } {
  if (state === "open")   return { color: "var(--color-success)", label: "open" };
  if (state === "merged") return { color: "var(--accent-presence)", label: "merged" };
  if (state === "closed") return { color: "var(--color-danger)", label: "closed" };
  return { color: "var(--text-muted)", label: "—" };
}

/**
 * Try to parse a GitHub URL into { repo, kind, number, title }.
 * Falls back gracefully if the URL doesn't match expected patterns.
 */
function parseGitHubUrl(url: string): { repo: string; kind: GitHubItemKind; number?: number } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length < 2) return null;
    const repo = `${parts[0]}/${parts[1]}`;
    if (parts.length === 2) return { repo, kind: "repo" };
    if (parts[2] === "issues" && parts[3]) return { repo, kind: "issue", number: parseInt(parts[3], 10) };
    if (parts[2] === "pull" && parts[3]) return { repo, kind: "pr", number: parseInt(parts[3], 10) };
    if (parts[2] === "discussions" && parts[3]) return { repo, kind: "discussion", number: parseInt(parts[3], 10) };
    return { repo, kind: "repo" };
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────

type Familiar = { id: string; display_name: string; emoji?: string };
type BoardCard = {
  id: string;
  title: string;
  notes?: string;
  status: string;
  familiarId?: string | null;
  links?: string[];
  github?: CardGitHubLink[];
  labels?: string[];
};

function mergeStringList(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

// ── Attach to Task modal ───────────────────────────────────────────────────

function AttachTaskModal({
  item,
  onClose,
}: {
  item: LibraryGitHubItem;
  onClose: () => void;
}) {
  const [familiars, setFamiliars]   = useState<Familiar[]>([]);
  const [cards, setCards]           = useState<BoardCard[]>([]);
  const [mode, setMode]             = useState<"new" | "existing">("new");
  const [title, setTitle]           = useState(item.title);
  const [notes, setNotes]           = useState(item.url);
  const [familiarId, setFamiliarId] = useState("");
  const [cardId, setCardId]         = useState("");
  const [status, setStatus]         = useState<CardStatus>("backlog");
  const [busy, setBusy]             = useState(false);
  const [done, setDone]             = useState<string | null>(null);
  const [err, setErr]               = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  useEffect(() => {
    void fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setFamiliars(j.familiars ?? []); })
      .catch(() => {});
    void fetch("/api/board", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setCards(j.cards ?? []); })
      .catch(() => {});
  }, []);

  // Close on Esc
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const github = [libraryItemToTaskGitHubLink(item)];
      if (mode === "new") {
        const res = await fetch("/api/board", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            notes: notes.trim() || undefined,
            status,
            familiarId: familiarId || null,
            links: mergeLinksWithGitHub([], github),
            github,
            labels: [item.kind, item.repo].filter(Boolean),
          }),
        });
        const j = await res.json() as { ok: boolean; card?: { id: string; title: string } };
        if (!j.ok) throw new Error("Failed to create task");
        setDone(`Created task "${j.card?.title ?? title}"`);
      } else {
        if (!cardId) { setErr("Select an existing task"); setBusy(false); return; }
        const existing = cards.find((c) => c.id === cardId) ?? {
          id: cardId,
          title: cardId,
          status: "",
          links: [],
          github: [],
          labels: [],
          notes: "",
        };
        const mergedGitHub = mergeTaskGitHubLinks(existing.github, libraryItemToTaskGitHubLink(item));
        const res = await fetch(`/api/board/${cardId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            links: mergeLinksWithGitHub(existing.links, mergedGitHub),
            github: mergeTaskGitHubLinks(existing.github, libraryItemToTaskGitHubLink(item)),
            labels: mergeStringList([...(existing.labels ?? []), item.kind, item.repo]),
            notes: [existing.notes, `GitHub: ${item.url}`]
              .filter(Boolean).join("\n"),
          }),
        });
        const j = await res.json() as { ok: boolean };
        if (!j.ok) throw new Error("Failed to attach to task");
        setDone(`Attached to task "${existing?.title ?? cardId}"`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="gh-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="gh-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Attach to Task"
        tabIndex={-1}
      >
        <div className="gh-modal-header">
          <Icon name="ph:clipboard-text" width={14} />
          <span>Attach to Task</span>
          <button type="button" className="gh-modal-close" onClick={onClose}>
            <Icon name="ph:x" width={13} />
          </button>
        </div>

        {done ? (
          <div className="gh-modal-done">
            <span style={{ color: "var(--color-success)", display: "grid" }}><Icon name="ph:check-circle" width={18} /></span>
            <span>{done}</span>
            <button type="button" className="gh-modal-btn gh-modal-btn--primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="gh-modal-body" onSubmit={handleSubmit}>
            {/* Source item */}
            <div className="gh-modal-source">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="gh-modal-source-link">
                {item.title}
              </a>
              <span className="gh-modal-source-meta">{item.repo}{item.number ? ` #${item.number}` : ""}</span>
            </div>

            {/* Mode tabs */}
            <div className="gh-modal-tabs">
              <button type="button" className={`gh-modal-tab${mode === "new" ? " active" : ""}`} onClick={() => setMode("new")}>New task</button>
              <button type="button" className={`gh-modal-tab${mode === "existing" ? " active" : ""}`} onClick={() => setMode("existing")}>Existing task</button>
            </div>

            {mode === "new" ? (
              <>
                <label className="gh-modal-label">Title
                  <input className="gh-modal-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <label className="gh-modal-label">Notes / URL
                  <input className="gh-modal-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <div className="gh-modal-row">
                  <label className="gh-modal-label" style={{ flex: 1 }}>Status
                    <select className="gh-modal-select" value={status} onChange={(e) => setStatus(e.target.value as CardStatus)}>
                      <option value="backlog">Backlog</option>
                      <option value="inbox">Inbox</option>
                      <option value="running">Running</option>
                    </select>
                  </label>
                  <label className="gh-modal-label" style={{ flex: 1 }}>Assign to
                    <select className="gh-modal-select" value={familiarId} onChange={(e) => setFamiliarId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {familiars.map((f) => (
                        <option key={f.id} value={f.id}>{f.display_name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <label className="gh-modal-label">Pick existing task
                <select className="gh-modal-select" value={cardId} onChange={(e) => setCardId(e.target.value)} required>
                  <option value="">— select —</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>[{c.status}] {c.title}</option>
                  ))}
                </select>
              </label>
            )}

            {err && <div className="gh-modal-err">{err}</div>}
            <div className="gh-modal-footer">
              <button type="button" className="gh-modal-btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="gh-modal-btn gh-modal-btn--primary" disabled={busy}>
                {busy ? "Saving…" : mode === "new" ? "Create task" : "Attach"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Handoff to Agent modal ─────────────────────────────────────────────────

// Scripted launch templates keyed by GitHub item kind
const LAUNCH_TEMPLATES: Record<GitHubItemKind, string> = {
  pr:         "Please review this PR and give me a concise summary of the changes, any concerns, and a go/no-go recommendation.\n\nPR: {url}\nTitle: {title}\nRepo: {repo}",
  issue:      "Please investigate this issue and suggest a fix or next steps.\n\nIssue: {url}\nTitle: {title}\nRepo: {repo}",
  discussion: "Please read this discussion and give me a summary and your take on the best path forward.\n\nDiscussion: {url}\nTitle: {title}\nRepo: {repo}",
  repo:       "Please give me an overview of this repository — its purpose, tech stack, and any areas to watch.\n\nRepo: {url}\nTitle: {title}",
};

function fillTemplate(tpl: string, item: LibraryGitHubItem): string {
  return tpl
    .replace(/\{url\}/g, item.url)
    .replace(/\{title\}/g, item.title)
    .replace(/\{repo\}/g, item.repo)
    .replace(/\{number\}/g, item.number ? `#${item.number}` : "");
}

function HandoffModal({
  item,
  onClose,
  onLaunched,
}: {
  item: LibraryGitHubItem;
  onClose: () => void;
  onLaunched?: (familiarId: string, sessionId: string | null) => void;
}) {
  const [familiars, setFamiliars]   = useState<Familiar[]>([]);
  const [familiarId, setFamiliarId] = useState("");
  const [prompt, setPrompt]         = useState(() => fillTemplate(LAUNCH_TEMPLATES[item.kind] ?? LAUNCH_TEMPLATES.repo, item));
  const [busy, setBusy]             = useState(false);
  const [done, setDone]             = useState<{ familiar: string; session: string | null } | null>(null);
  const [err, setErr]               = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  useEffect(() => {
    void fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const list: Familiar[] = j.familiars ?? [];
          setFamiliars(list);
          if (list.length > 0 && !familiarId) setFamiliarId(list[0].id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Regenerate prompt when kind changes (shouldn't happen, but defensive)
  function handleTemplateReset() {
    setPrompt(fillTemplate(LAUNCH_TEMPLATES[item.kind] ?? LAUNCH_TEMPLATES.repo, item));
  }

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!familiarId) { setErr("Pick an agent"); return; }
    setBusy(true); setErr(null);
    try {
      // Fire-and-forget via fetch with a short timeout — we don't stream here,
      // just kick off the chat. The user can follow up in the Chat view.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId, prompt: prompt.trim() }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // /api/chat/send returns SSE — read the first few events to get sessionId
      const reader = res.body?.getReader();
      let sessionId: string | null = null;
      if (reader) {
        const dec = new TextDecoder();
        let buf = "";
        let done2 = false;
        while (!done2) {
          const { value, done: d } = await reader.read();
          if (d) break;
          buf += dec.decode(value, { stream: true });
          for (const line of buf.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6)) as { kind: string; sessionId?: string };
                if (ev.kind === "session" && ev.sessionId) { sessionId = ev.sessionId; }
                if (ev.kind === "done") { done2 = true; break; }
              } catch { /* skip */ }
            }
          }
          buf = buf.split("\n").pop() ?? "";
        }
        reader.cancel();
      }
      const f = familiars.find((x) => x.id === familiarId);
      setDone({ familiar: f?.display_name ?? familiarId, session: sessionId });
      onLaunched?.(familiarId, sessionId);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setErr("Request timed out — agent may still be processing.");
      } else {
        setErr(e instanceof Error ? e.message : "Unknown error");
      }
    } finally {
      setBusy(false);
    }
  }

  const fam = familiars.find((f) => f.id === familiarId);

  return createPortal(
    <div
      className="gh-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="gh-modal gh-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Handoff to Agent"
        tabIndex={-1}
      >
        <div className="gh-modal-header">
          <Icon name="ph:share-network" width={14} />
          <span>Handoff to Agent</span>
          <button type="button" className="gh-modal-close" onClick={onClose}>
            <Icon name="ph:x" width={13} />
          </button>
        </div>

        {done ? (
          <div className="gh-modal-done">
            <span style={{ color: "var(--color-success)", display: "grid" }}><Icon name="ph:check-circle" width={18} /></span>
            <div>
              <div style={{ fontWeight: 600 }}>Handed off to {done.familiar}</div>
              {done.session && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Session: {done.session}</div>
              )}
            </div>
            <button type="button" className="gh-modal-btn gh-modal-btn--primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="gh-modal-body" onSubmit={handleLaunch}>
            {/* Source item */}
            <div className="gh-modal-source">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="gh-modal-source-link">
                {item.title}
              </a>
              <span className="gh-modal-source-meta">{item.repo}{item.number ? ` #${item.number}` : ""} · {item.kind}</span>
            </div>

            {/* Agent picker */}
            <label className="gh-modal-label">Agent
              <div className="gh-modal-agent-row">
                <select
                  className="gh-modal-select"
                  value={familiarId}
                  onChange={(e) => setFamiliarId(e.target.value)}
                  required
                >
                  <option value="">— pick an agent —</option>
                  {familiars.map((f) => (
                    <option key={f.id} value={f.id}>{f.display_name}</option>
                  ))}
                </select>
                {fam && <span className="gh-modal-agent-pill">{fam.display_name}</span>}
              </div>
            </label>

            {/* Prompt — pre-filled from template, fully editable */}
            <label className="gh-modal-label">
              <div className="gh-modal-label-row">
                <span>Launch prompt</span>
                <button type="button" className="gh-modal-reset" onClick={handleTemplateReset} title="Reset to template">
                  <Icon name="ph:arrows-clockwise" width={11} /> reset
                </button>
              </div>
              <textarea
                className="gh-modal-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={7}
                required
              />
            </label>

            {err && <div className="gh-modal-err">{err}</div>}
            <div className="gh-modal-footer">
              <button type="button" className="gh-modal-btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="gh-modal-btn gh-modal-btn--primary" disabled={busy || !familiarId}>
                {busy ? "Launching…" : "Launch handoff"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Add form ───────────────────────────────────────────────────────────────

function AddGitHubForm({ onAdd, onCancel }: {
  onAdd: (url: string, title: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  function handleUrlBlur() {
    if (url && !title) {
      const parsed = parseGitHubUrl(url);
      if (parsed) {
        const label = parsed.number ? `${parsed.repo}#${parsed.number}` : parsed.repo;
        setTitle(label);
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !title.trim()) return;
    onAdd(url.trim(), title.trim());
  }

  return (
    <form className="library-list-add-form" onSubmit={handleSubmit}>
      <input
        autoFocus
        className="board-drawer-field-input library-list-add-input"
        placeholder="https://github.com/owner/repo/issues/123"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={handleUrlBlur}
        type="url"
      />
      <input
        className="board-drawer-field-input library-list-add-input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" className="board-toolbar-btn board-toolbar-btn--active">Save</button>
      <button type="button" className="board-toolbar-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  selectedId: string | null;
  onSelect: (item: LibraryGitHubItem) => void;
  onDelete?: (id: string) => void;
};

const COLS: { key: SortKey; label: string; width?: string }[] = [
  { key: "title",   label: "Title" },
  { key: "repo",    label: "Repo",    width: "150px" },
  { key: "savedAt", label: "Saved",   width: "80px" },
];
const GITHUB_TABLE_COLUMN_COUNT = COLS.length + 4;

export function LibraryGitHubList({ selectedId, onSelect, onDelete }: Props) {
  const [items, setItems] = useState<LibraryGitHubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("savedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [attachItem, setAttachItem] = useState<LibraryGitHubItem | null>(null);
  const [handoffItem, setHandoffItem] = useState<LibraryGitHubItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library/github", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setItems(json.items ?? []);
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => sortItems(items, sortKey, sortDir), [items, sortKey, sortDir]);
  const groups = useMemo(() => groupItems(sorted, groupBy), [sorted, groupBy]);

  function handleCol(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function handleAdd(url: string, title: string) {
    setAdding(false);
    const res = await fetch("/api/library/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, title }),
    });
    const json = await res.json();
    if (json.ok) setItems((prev) => [json.item, ...prev]);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/library/github?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onDelete?.(id);
  }

  return (
    <div className="library-list-shell">
      {/* Header */}
      <div className="library-list-header">
        <span className="library-list-header-title">
          <Icon name="ph:github-logo" width={14} />
          GitHub
          <span className="board-table-group-badge">{items.length}</span>
        </span>
        <div className="library-list-header-controls">
          <select
            className="board-toolbar-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="repo">Group: Repo</option>
            <option value="kind">Group: Kind</option>
            <option value="none">No grouping</option>
          </select>
          <button type="button" className="board-toolbar-btn" onClick={() => setAdding((v) => !v)}>
            <Icon name="ph:plus" width={12} /> Add
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <AddGitHubForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {/* Table */}
      {loading ? (
        <div className="library-list-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="library-list-empty">No GitHub items saved yet. Add one above.</div>
      ) : (
        <div className="board-table-wrap">
          <table className="board-table">
            <thead>
              <tr>
                {COLS.map((col) => (
                  <th key={col.key} style={col.width ? { width: col.width } : undefined}
                    className={sortKey === col.key ? "sorted" : ""}
                    onClick={() => handleCol(col.key)}>
                    {col.label}
                    <span className="board-table-sort-icon">
                      {sortKey === col.key
                        ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                        : <Icon name="ph:caret-up-down" width={9} />}
                    </span>
                  </th>
                ))}
                <th style={{ width: "80px" }}>Kind</th>
                <th style={{ width: "70px" }}>State</th>
                <th style={{ width: "160px" }}>Labels</th>
                <th style={{ width: "32px" }} />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ key, label, items: gi }) => (
                <React.Fragment key={key}>
                  {groupBy !== "none" && (
                    <tr className="board-table-group-row" onClick={() => toggleGroup(key)}>
                      <td colSpan={GITHUB_TABLE_COLUMN_COUNT}>
                        <span className="board-table-group-caret">
                          <Icon name={collapsed.has(key) ? "ph:caret-right" : "ph:caret-down"} width={10} />
                        </span>
                        {label}
                        <span className="board-table-group-badge">{gi.length}</span>
                      </td>
                    </tr>
                  )}
                  {!collapsed.has(key) && gi.map((item) => {
                    const st = stateStyle(item.state);
                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          className={`gh-row-main${item.id === selectedId ? " selected" : ""}`}
                          onClick={() => onSelect(item)}
                        >
                          <td>
                            <span className="board-table-title">{item.title}</span>
                            {item.number && (
                              <div className="board-table-muted" style={{ marginTop: 2 }}>
                                {item.repo}#{item.number}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="board-table-muted">{item.repo}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className="board-table-muted">{relTime(item.savedAt)}</span>
                          </td>
                          <td>
                            <span className="board-table-muted library-source-type">
                              {kindIcon(item.kind)}
                              <span style={{ marginLeft: 3 }}>{item.kind}</span>
                            </span>
                          </td>
                          <td>
                            <span className="library-gh-state-dot" style={{ color: st.color }}>
                              ● {st.label}
                            </span>
                          </td>
                          <td>
                            <div className="library-tag-chips">
                              {item.labels.slice(0, 3).map((l: string) => (
                                <span key={l} className="library-doclist-tag">{l}</span>
                              ))}
                              {item.labels.length > 3 && (
                                <span className="board-table-muted">+{item.labels.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => { e.stopPropagation(); void handleDelete(item.id); }}>
                            <span className="library-row-delete" title="Remove">
                              <Icon name="ph:x" width={11} />
                            </span>
                          </td>
                        </tr>
                        <tr className={`gh-row-action-strip-row${item.id === selectedId ? " selected" : ""}`}>
                          <td colSpan={GITHUB_TABLE_COLUMN_COUNT}>
                            <div className="gh-row-actions" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="gh-row-action-btn"
                                onClick={() => setAttachItem(item)}
                              >
                                <Icon name="ph:clipboard-text" width={12} />
                                <span>Attach to task</span>
                              </button>
                              <button
                                type="button"
                                className="gh-row-action-btn"
                                onClick={() => setHandoffItem(item)}
                              >
                                <Icon name="ph:share-network" width={12} />
                                <span>Handoff to agent</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {attachItem && typeof document !== "undefined" && (
        <AttachTaskModal item={attachItem} onClose={() => setAttachItem(null)} />
      )}
      {handoffItem && typeof document !== "undefined" && (
        <HandoffModal
          item={handoffItem}
          onClose={() => setHandoffItem(null)}
          onLaunched={() => { /* could open chat pane here */ }}
        />
      )}
    </div>
  );
}
