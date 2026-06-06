"use client";

import { useEffect, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardLifecycle, CardPriority, CardStatus } from "@/lib/cave-board-types";
import { STATUSES, PRIORITIES } from "@/lib/cave-board-types";
import { LifecycleBadge, formatTimeoutBadge } from "@/components/ui/lifecycle-badge";
import type { CardStep } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";

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

type Props = {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  onClose: () => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onDelete: (id: string) => Promise<void>;
  onCardReplaced: (card: Card) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinking?: boolean;
};

function TimeoutBadge({ runningSince, timeoutMs }: { runningSince?: string; timeoutMs?: number }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const text = formatTimeoutBadge(runningSince, timeoutMs, DEFAULT_TIMEOUT_MS);
  if (!text) return null;
  const over = runningSince ? Date.now() - new Date(runningSince).getTime() > (timeoutMs ?? DEFAULT_TIMEOUT_MS) : false;
  return (
    <span className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-widest ${over ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-border bg-card text-muted-foreground"}`}>
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
      {error && <p style={{ fontSize: 10, color: "#f87171", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
        <a href="https://github.com/settings/tokens/new?scopes=read:user,repo,notifications&description=Cave+local"
          target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: "oklch(0.65 0.18 280)", textDecoration: "none" }}>
          Generate PAT →
        </a>
        <button type="button" disabled={(!pat.trim() && !usernameInput.trim()) || saving} onClick={() => void save()}
          style={{ background: "oklch(0.65 0.18 280)", color: "#fff", border: "none", borderRadius: 6,
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
  open: "text-emerald-400",
  merged: "text-violet-400",
  closed: "text-rose-400",
};

function GitHubAttachSection({
  card,
  familiars,
  onPatch,
}: {
  card: Card;
  familiars: Familiar[];
  onPatch: (id: string, patch: Partial<Card>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

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

  const attachedUrls = new Set(card.links);

  const filtered = items.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.repo.toLowerCase().includes(q) ||
      (item.number != null && String(item.number).includes(q))
    );
  });

  const attachedItems = items.filter((i) => attachedUrls.has(i.url));

  function attach(item: GitHubItem) {
    if (attachedUrls.has(item.url)) return;
    onPatch(card.id, { links: [...card.links, item.url] });
  }

  function detach(url: string) {
    onPatch(card.id, { links: card.links.filter((l) => l !== url) });
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
        <span>GitHub</span>
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
              <Icon name={iconName(item.kind)} width={12} className={STATE_COLOR[item.state ?? ""] ?? "text-[var(--text-muted)]"} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                {item.repo}{item.number != null ? " #" + item.number : ""} — {item.title}
              </span>
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
              autoFocus
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
              <div style={{ padding: "10px", fontSize: 11, color: "#f87171" }}>{err}</div>
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
                  background: attached ? "color-mix(in oklab, oklch(0.65 0.18 280) 8%, var(--bg-raised))" : undefined,
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
                        ...(attached ? { color: "oklch(0.65 0.18 280)", borderColor: "oklch(0.65 0.18 280)" } : {}),
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
}: {
  card: Card;
  onPatch: (id: string, patch: Partial<Card>) => void;
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
    onPatch(card.id, { links: [...links, url] });
    setDraft("");
    inputRef.current?.focus();
  }

  function deleteLink(url: string) {
    onPatch(card.id, { links: links.filter((l) => l !== url) });
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
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: "var(--text-primary)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    className="link-item-anchor"
                  >
                    {formatLinkLabel(link)}
                  </a>
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
                <span style={{ opacity: 0, display: "flex" }} className="step-actions">
                  <button
                    type="button"
                    className="board-toolbar-btn"
                    style={{ padding: "1px 4px", color: "#f87171" }}
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
      <style>{".link-item-anchor:hover { text-decoration: underline; } li:hover .step-actions { opacity: 1; }"}</style>
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
          <span style={{ fontSize: 10, color: pct === 100 ? "var(--color-emerald-400, #34d399)" : "var(--text-muted)" }}>
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
            background: pct === 100 ? "oklch(0.76 0.18 150)" : "oklch(0.65 0.18 280)",
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
                background: step.done ? "color-mix(in oklab, oklch(0.76 0.18 150) 6%, var(--bg-elevated))" : "var(--bg-elevated)",
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
                  background: step.done ? "oklch(0.76 0.18 150)" : "transparent",
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
              <span style={{ display: "flex", gap: 2, flexShrink: 0, opacity: 0 }} className="step-actions">
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
                <button type="button" className="board-toolbar-btn" style={{ padding: "1px 4px", color: "#f87171" }}
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
      <style>{".step-actions { opacity: 0; transition: opacity 0.1s; } li:hover .step-actions { opacity: 1; }"}</style>
    </div>
  );
}

export function BoardInspector({ card, familiars, sessions, onClose, onPatch, onMoveStatus, onDelete, onCardReplaced, onJumpToSession, onOpenTaskChat, chatLinking = false }: Props) {
  const [closing, setClosing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState<CardLifecycle | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const moves = NEXT_MOVES[card.lifecycle] ?? [];

  const close = () => { setClosing(true); setTimeout(onClose, 180); };

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

  return (
    <>
      <div className="board-drawer-backdrop" onClick={close} />
      <div className={`board-drawer${closing ? " board-drawer--closing" : ""}`} role="dialog" aria-modal aria-label="Card inspector">
        <div className="board-drawer-header">
          <span className="board-drawer-title">{card.title}</span>
          <button type="button" className="board-drawer-close" onClick={close} aria-label="Close">
            <Icon name="ph:x-bold" width={12} />
          </button>
        </div>

        <div className="board-drawer-body">
          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Title</div>
            <input className="board-drawer-field-input" defaultValue={card.title}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== card.title) onPatch(card.id, { title: e.target.value.trim() }); }} />
          </div>

          <div className="board-drawer-grid-2">
            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Status</div>
              <select className="board-drawer-field-select" value={card.status}
                onChange={(e) => onMoveStatus(card.id, e.target.value as CardStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Priority</div>
              <select className="board-drawer-field-select" value={card.priority}
                onChange={(e) => onPatch(card.id, { priority: e.target.value as CardPriority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Familiar</div>
            <select className="board-drawer-field-select" value={card.familiarId ?? ""}
              onChange={(e) => onPatch(card.id, { familiarId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {familiars.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
            </select>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Chat</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {session ? (
                <span className="board-table-muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.title || "(untitled)"}
                </span>
              ) : (
                <span className="board-table-muted" style={{ flex: 1 }}>
                  No chat linked yet.
                </span>
              )}
              {session ? (
                <button type="button" className="board-toolbar-btn"
                  onClick={() => onJumpToSession?.(session.id, session.familiarId ?? null)}>
                  Open chat <Icon name="ph:arrow-square-out" width={11} />
                </button>
              ) : (
                <button
                  type="button"
                  className="board-toolbar-btn"
                  disabled={chatLinking}
                  onClick={() => void onOpenTaskChat?.(card.id)}
                >
                  {chatLinking ? "Starting..." : "Start chat"} <Icon name="ph:chat-circle-dots" width={11} />
                </button>
              )}
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">CWD</div>
            <input className="board-drawer-field-input" defaultValue={card.cwd ?? ""}
              placeholder="/Users/buns/Documents/GitHub/OpenCoven/coven-cave"
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if (next !== card.cwd) onPatch(card.id, { cwd: next });
              }} />
          </div>

          <StepsSection card={card} onPatch={onPatch} />

          <LinksSection card={card} onPatch={onPatch} />

          <GitHubAttachSection card={card} familiars={familiars} onPatch={onPatch} />

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Notes</div>
            <textarea className="board-drawer-field-textarea" defaultValue={card.notes}
              onBlur={(e) => { if (e.target.value !== card.notes) onPatch(card.id, { notes: e.target.value }); }} />
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Labels</div>
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
            <div style={{ display: "flex", gap: 6 }}>
              <input className="board-drawer-field-input" style={{ flex: 1 }} placeholder="Add label…"
                value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }} />
              <button type="button" className="board-toolbar-btn" onClick={addLabel}>Add</button>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Lifecycle</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
              {card.lifecycle === "running" && <TimeoutBadge runningSince={card.runningSince} timeoutMs={card.timeoutMs} />}
            </div>
            {moves.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {moves.map((m) => (
                  <button key={`${m.to}-${m.retry}`} type="button" className="board-toolbar-btn"
                    disabled={lifecycleBusy !== null}
                    onClick={() => void doLifecycle(m.to, m.retry)}>
                    {lifecycleBusy === m.to ? "…" : m.label}
                  </button>
                ))}
              </div>
            )}
            {lifecycleErr && <p style={{ fontSize: 10, color: "#f87171", marginTop: 4 }}>{lifecycleErr}</p>}
          </div>

          <div className="board-drawer-grid-2 board-table-muted">
            <div><div className="board-drawer-field-label">Created</div>{new Date(card.createdAt).toLocaleString()}</div>
            <div><div className="board-drawer-field-label">Updated</div>{new Date(card.updatedAt).toLocaleString()}</div>
          </div>
        </div>

        <div className="board-drawer-footer">
          {deleteConfirm ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Delete this card?</span>
              <button type="button" className="board-drawer-delete-btn"
                onClick={async () => { await onDelete(card.id); close(); }}>Confirm</button>
              <button type="button" className="board-toolbar-btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="board-drawer-delete-btn" onClick={() => setDeleteConfirm(true)}>Delete</button>
          )}
          <button type="button" className="board-toolbar-btn" onClick={close}>Close</button>
        </div>
      </div>
    </>
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
