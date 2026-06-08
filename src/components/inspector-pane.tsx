"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { SyntaxBlock, MarkdownBlock } from "@/components/message-bubble";
import { EvalLoopPanel } from "@/components/eval-loop-panel";
import { MemoryInspectorPanel } from "@/components/memory-inspector-panel";
import { VaultPanel } from "@/components/vault-panel";
import { SnoozeMenu } from "@/components/snooze-menu";
import { Icon } from "@/lib/icon";
import type { HarnessCapabilityManifest } from "@/app/api/capabilities/route";
import type { RoleEntry } from "@/app/api/roles/route";
import type { LocalSkillEntry } from "@/app/api/skills/local/route";
import type { AdapterReport } from "@/lib/harness-adapters";

type Tab = "memory" | "familiar" | "inbox" | "vault";



type MemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

type MemoryFile = {
  ok: boolean;
  path: string;
  revealed: boolean;
  text: string;
  redactions: Record<string, number>;
  rawLength: number;
  error?: string;
};


type Props = {
  familiar: Familiar | null;
  inboxItems?: InboxItem[];
  onOpenInbox?: () => void;
  onCreateReminder?: (familiarId: string) => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onInboxItemChanged?: () => void | Promise<void>;
};

const TAB_LABEL: Record<Tab, string> = {
  memory: "Memory",
  familiar: "Familiar",
  inbox: "Inbox",
  vault: "Vault",
};

function age(iso: string): string {
  const ms = Math.abs(Date.now() - new Date(iso).getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InspectorPane({
  familiar,
  inboxItems = [],
  onOpenInbox,
  onCreateReminder,
  onOpenInboxItem,
  onInboxItemChanged,
}: Props) {
  const [tab, setTab] = useState<Tab>("memory");

  const familiarInbox = useMemo(() => {
    if (!familiar) return [];
    return inboxItems
      .filter((i) => i.familiarId === familiar.id)
      .filter((i) => i.status === "pending" || i.status === "fired")
      .sort((a, b) => {
        // Fired first (loudest), then upcoming pending by fireAt asc.
        if (a.status !== b.status) return a.status === "fired" ? -1 : 1;
        if (a.status === "fired") {
          return (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt);
        }
        return (a.fireAt ?? "").localeCompare(b.fireAt ?? "");
      });
  }, [inboxItems, familiar]);

  const inboxBadge = familiarInbox.filter((i) => i.status === "fired").length;

  return (
    <aside className="flex h-full flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-raised)]/40">
      <nav className="flex border-b border-[var(--border-hairline)] text-[11px]">
        {(["memory", "familiar", "inbox", "vault"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-3 uppercase tracking-widest transition-colors ${
              tab === t
                ? "border-b-2 border-[var(--accent-presence)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {TAB_LABEL[t]}
            {t === "inbox" && inboxBadge > 0 ? (
              <span className="ml-1 rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold text-white">
                {inboxBadge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "memory" ? <MemoryTab familiar={familiar} /> : null}
        {tab === "familiar" ? <FamiliarCapabilityPanel familiar={familiar} /> : null}
        {tab === "inbox" ? (
          <InboxTab
            familiar={familiar}
            items={familiarInbox}
            onOpenInbox={onOpenInbox}
            onCreateReminder={onCreateReminder}
            onOpenInboxItem={onOpenInboxItem}
            onInboxItemChanged={onInboxItemChanged}
          />
        ) : null}
        {tab === "vault" ? <VaultPanel /> : null}
      </div>
    </aside>
  );
}

/* ---------- Inbox tab ---------- */

function InboxTab({
  familiar,
  items,
  onOpenInbox,
  onCreateReminder,
  onOpenInboxItem,
  onInboxItemChanged,
}: {
  familiar: Familiar | null;
  items: InboxItem[];
  onOpenInbox?: () => void;
  onCreateReminder?: (familiarId: string) => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onInboxItemChanged?: () => void | Promise<void>;
}) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runItemAction(
    item: InboxItem,
    action: "snooze" | "dismiss" | "done",
    untilIso?: string,
  ) {
    if (item.id.startsWith("eph:")) {
      onOpenInboxItem?.(item);
      return;
    }

    setBusyItemId(item.id);
    setError(null);
    try {
      const init: RequestInit =
        action === "snooze"
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(untilIso ? { untilIso } : { minutes: 10 }),
            }
          : { method: "POST" };
      const res = await fetch(`/api/inbox/${encodeURIComponent(item.id)}/${action}`, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? `${action} failed`);
      }
      await onInboxItemChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyItemId(null);
    }
  }

  if (!familiar) {
    return (
      <p className="p-4 text-xs text-[var(--text-muted)]">
        Select a familiar to see its reminders.
      </p>
    );
  }

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">
          {familiar.display_name} Inbox
        </div>
        <div className="text-[10px] text-[var(--text-muted)]">
          {items.length} active item{items.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpenInbox ? (
          <button
            type="button"
            onClick={onOpenInbox}
            className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Schedules
          </button>
        ) : null}
        {onCreateReminder ? (
          <button
            type="button"
            onClick={() => onCreateReminder(familiar.id)}
            className="rounded bg-[var(--accent-presence)] px-2 py-1 text-[10px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,white)]"
          >
            New
          </button>
        ) : null}
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="text-xs">
        {header}
        <div className="p-4 text-[var(--text-muted)]">
          Nothing scheduled for {familiar.display_name}.
          {onCreateReminder ? (
            <button
              type="button"
              onClick={() => onCreateReminder(familiar.id)}
              className="ml-1 text-[var(--accent-presence)] hover:text-[var(--text-primary)]"
            >
              Create one
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs">
      {header}
      {error ? (
        <div className="border-b border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-1.5 text-[10px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      <ul className="p-2">
        {items.map((it) => {
          const busy = busyItemId === it.id;
          const canOpen = !!onOpenInboxItem;
          return (
            <li
              key={it.id}
              className="mb-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex-1 truncate text-[var(--text-primary)]">{it.title}</span>
                <span
                  className={`shrink-0 rounded px-1 py-px text-[9px] uppercase tracking-widest ${
                    it.status === "fired"
                      ? "bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] text-[var(--color-warning)]"
                      : "bg-[color-mix(in_oklch,var(--accent-presence-soft)_20%,transparent)] text-[var(--accent-presence-soft)]"
                  }`}
                >
                  {it.status}
                </span>
              </div>
              {it.body ? (
                <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-muted)]">{it.body}</p>
              ) : null}
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                {it.status === "fired"
                  ? `fired ${age(it.firedAt ?? it.updatedAt)} ago`
                  : it.kind === "response-needed"
                    ? "waiting on you"
                    : `in ${age(it.fireAt ?? it.updatedAt)}`}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {canOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpenInboxItem?.(it)}
                    className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  >
                    Open
                  </button>
                ) : null}
                {it.id.startsWith("eph:") ? (
                  <span className="text-[10px] italic text-[var(--text-muted)]">
                    respond in chat to clear
                  </span>
                ) : (
                  <>
                    <SnoozeMenu
                      size="xs"
                      onSnooze={(untilIso) => runItemAction(it, "snooze", untilIso)}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runItemAction(it, "dismiss")}
                      className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                    {it.status === "fired" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runItemAction(it, "done")}
                        className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                      >
                        Done
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Memory file viewer (inline + fullscreen) ---------- */

type MemoryFileViewProps = {
  path: string;
  file: MemoryFile | null;
  reveal: boolean;
  totalRedactions: number;
  onRevealToggle: () => void;
  onBack: () => void;
};

function MemoryFileView({ path, file, reveal, totalRedactions, onRevealToggle, onBack }: MemoryFileViewProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const isMarkdown = path.endsWith(".md");
  const filename = path.split("/").slice(-2).join("/");
  const text = file?.text ?? "loading…";

  const header = (
    <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-xs">
      <button
        onClick={onBack}
        className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
      >
        ← back
      </button>
      <div className="flex-1 truncate font-mono text-[var(--text-secondary)]">{filename}</div>
      <button
        onClick={() => setFullscreen((v) => !v)}
        title={fullscreen ? "Exit fullscreen" : "Open fullscreen"}
        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
      >
        <Icon name={fullscreen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={13} />
      </button>
    </div>
  );

  const toolbar = (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3 py-1.5 text-[11px]">
      <div>
        {totalRedactions > 0 ? (
          <span className="text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
        ) : (
          <span className="text-[var(--text-muted)]">no secrets detected</span>
        )}
      </div>
      <button
        onClick={onRevealToggle}
        className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
          reveal
            ? "bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] text-white hover:bg-[var(--color-danger)]"
            : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        }`}
        title={reveal ? "Hide secrets" : "Reveal raw (shows secrets)"}
      >
        {reveal ? "hide secrets" : "reveal secrets"}
      </button>
    </div>
  );

  const body = isMarkdown ? (
    <MarkdownBlock text={text} className="min-h-0 flex-1 overflow-auto px-4 py-4" />
  ) : (
    <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[11px]" />
  );

  const inlineView = (
    <div className="flex h-full flex-col">
      {header}
      {toolbar}
      {body}
    </div>
  );

  if (!fullscreen) return inlineView;

  return (
    <>
      {inlineView}
      {createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]"
          style={{ fontFamily: "inherit" }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5 text-xs">
            <button
              onClick={() => setFullscreen(false)}
              className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              ← back
            </button>
            <div className="flex-1 truncate font-mono text-[13px] text-[var(--text-secondary)]">{filename}</div>
            <div className="flex items-center gap-2">
              {totalRedactions > 0 && (
                <span className="text-[11px] text-[var(--color-warning)]">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
              )}
              <button
                onClick={onRevealToggle}
                className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                  reveal
                    ? "bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] text-white hover:bg-[var(--color-danger)]"
                    : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                }`}
                title={reveal ? "Hide secrets" : "Reveal raw (shows secrets)"}
              >
                {reveal ? "hide secrets" : "reveal secrets"}
              </button>
              <button
                onClick={() => setFullscreen(false)}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                <Icon name="ph:arrows-in-simple" width={14} />
              </button>
            </div>
          </div>
          {isMarkdown ? (
            <MarkdownBlock text={text} className="min-h-0 flex-1 overflow-auto px-8 py-6 max-w-4xl mx-auto w-full" />
          ) : (
            <SyntaxBlock text={text} className="min-h-0 flex-1 overflow-auto px-6 py-4 text-[12px]" />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ---------- Memory tab ---------- */

type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

function MemoryTab({ familiar }: { familiar: Familiar | null }) {
  const [mode, setMode] = useState<"inspector" | "coven" | "files">("inspector");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [covenLoaded, setCovenLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<MemoryFile | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/coven-memory", { cache: "no-store" });
        const json = await res.json();
        if (json.ok) {
          const fetched: CovenMemoryEntry[] = json.entries ?? [];
          setCovenEntries(fetched);
        } else {
          /* Inspector remains the default; the legacy Coven tab can stay empty. */
        }
      } catch {
        /* Inspector remains the default; the legacy Coven tab can stay empty. */
      } finally {
        setCovenLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/memory", { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "memory list failed");
          return;
        }
        setEntries(json.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "fetch failed");
      }
    })();
  }, []);

  useEffect(() => {
    if (!openPath) {
      setOpenFile(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `/api/memory/file?path=${encodeURIComponent(openPath)}${reveal ? "&reveal=1" : ""}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as MemoryFile;
        setOpenFile(json);
      } catch (err) {
        setOpenFile({
          ok: false,
          path: openPath,
          revealed: false,
          text: "",
          redactions: {},
          rawLength: 0,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
  }, [openPath, reveal]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.relPath.toLowerCase().includes(q) || e.rootLabel.toLowerCase().includes(q));
  }, [entries, query]);

  const covenFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return covenEntries
      .filter((e) => !familiar || e.familiar_id === familiar.id)
      .filter(
        (e) =>
          !q ||
          e.title.toLowerCase().includes(q) ||
          (e.excerpt ?? "").toLowerCase().includes(q) ||
          e.familiar_id.toLowerCase().includes(q),
      )
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [covenEntries, query, familiar]);

  if (error) {
    return <p className="p-4 text-xs text-[var(--color-warning)]">Memory unavailable: {error}</p>;
  }

  if (openPath) {
    const totalRedactions = openFile
      ? Object.values(openFile.redactions).reduce((a, b) => a + b, 0)
      : 0;
    return (
      <>
        <MemoryFileView
          path={openPath}
          file={openFile}
          reveal={reveal}
          totalRedactions={totalRedactions}
          onRevealToggle={() => setReveal((v) => !v)}
          onBack={() => { setOpenPath(null); setReveal(false); }}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] px-2 py-1.5">
        {(["inspector", "coven", "files"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setQuery("");
              setMode(m);
            }}
            className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
              mode === m
                ? "bg-[color-mix(in_oklch,var(--accent-presence)_80%,transparent)] text-white"
                : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {mode === "inspector" ? "read-only" : mode === "coven" ? covenFiltered.length : filtered.length}
        </span>
      </div>
      {mode !== "inspector" ? (
      <div className="border-b border-[var(--border-hairline)] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "coven" ? "Filter coven memory…" : "Filter memory files…"}
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
        />
      </div>
      ) : null}

      {mode === "inspector" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MemoryInspectorPanel familiar={familiar} />
        </div>
      ) : null}

      {mode === "coven" ? (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
          {covenFiltered.length === 0 ? (
            <li className="px-2 py-4 text-center text-[var(--text-muted)]">
              {!covenLoaded ? (
                "Loading…"
              ) : covenEntries.length === 0 ? (
                <span>
                  Coven memory API returned nothing.
                  <br />
                  <button
                    onClick={() => setMode("files")}
                    className="mt-1 text-[var(--accent-presence)] hover:text-[var(--accent-presence)] underline"
                  >
                    Browse memory files →
                  </button>
                </span>
              ) : familiar ? (
                `No coven memory entries for ${familiar.display_name} yet.`
              ) : (
                "No coven memory entries yet."
              )}
            </li>
          ) : null}
          {covenFiltered.map((e) => (
            <li key={e.id} className="mb-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[10px] text-[var(--text-secondary)]">
                    {e.familiar_id}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">{e.title}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                  {e.updated_at}
                </span>
              </div>
              {e.excerpt ? (
                <p className="mt-1 line-clamp-3 text-[10px] leading-snug text-[var(--text-secondary)]">
                  {e.excerpt}
                </p>
              ) : null}
              <button
                onClick={() => {
                  // Open the underlying file in the redacted file viewer if it
                  // sits inside one of our allowed memory roots.
                  const guessed = e.path.startsWith("/")
                    ? e.path
                    : `${process.env.NEXT_PUBLIC_COVEN_MEMORY_ROOT ?? "/Users/buns/.coven/memory"}/${e.path}`;
                  setOpenPath(guessed);
                }}
                className="mt-1 text-[10px] text-[var(--accent-presence)] hover:text-[var(--accent-presence)]"
              >
                open file →
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "files" ? (
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {filtered.length === 0 ? (
          <li className="px-2 py-4 text-center text-[var(--text-muted)]">No matches.</li>
        ) : null}
        {filtered.slice(0, 200).map((e) => (
          <li key={e.fullPath}>
            <button
              onClick={() => setOpenPath(e.fullPath)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-raised)]/60"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[var(--text-primary)]">{e.relPath}</span>
                <span className="truncate text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {e.rootLabel}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{age(e.modified)}</span>
            </button>
          </li>
        ))}
        {filtered.length > 200 ? (
          <li className="px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
            +{filtered.length - 200} more — filter to narrow
          </li>
        ) : null}
      </ul>
      ) : null}
    </div>
  );
}

/* ---------- Tools tab ---------- */

/* ---------- Familiar Capability Panel ----------
 *
 * Full per-familiar capability picture with inheritance chain:
 *   Layer 1: Active Roles  (roles[] where active && familiar matches)
 *   Layer 2: Local Skills  (familiar-specific + global workspace skills)
 *   Layer 3: Harness       (plugins, MCP, scan metadata from capabilities scan)
 */

// ── Shared UI primitives ─────────────────────────────────────────────────────

function CapSection({
  title,
  scope,
  empty,
  emptyText,
  children,
}: {
  title: string;
  scope?: string;
  empty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          {title}
        </h3>
        {scope ? (
          <span className="text-[10px] text-[var(--text-muted)]">{scope}</span>
        ) : null}
      </header>
      {empty ? (
        <p className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-2 text-[var(--text-muted)]">
          {emptyText ?? "Nothing here."}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function CapRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={`truncate text-[var(--text-primary)] ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </span>
    </li>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const colorMap: Record<string, string> = {
    agent: "bg-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] text-[var(--accent-presence)]",
    harness: "bg-[color-mix(in_oklch,var(--accent-presence-soft)_20%,transparent)] text-[var(--accent-presence-soft)]",
    hybrid: "bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] text-[var(--color-success)]",
    mcp: "bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] text-[var(--color-warning)]",
    builtin: "bg-[var(--bg-raised)] text-[var(--text-muted)]",
  };
  const k = (kind ?? "").toLowerCase();
  const cls = colorMap[k] ?? "bg-[var(--bg-raised)] text-[var(--text-muted)]";
  return (
    <span className={`rounded px-1 text-[10px] uppercase tracking-wider ${cls}`}>
      {kind || "—"}
    </span>
  );
}

function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  accentClass,
  children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  accentClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border border-[var(--border-hairline)] ${accentClass ?? ""}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--bg-raised)]/40"
      >
        <Icon
          name={open ? "ph:caret-down" : "ph:caret-right"}
          width={10}
          className="shrink-0 text-[var(--text-muted)]"
        />
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          {title}
        </span>
        {badge ? (
          <span className="ml-auto rounded bg-[var(--bg-raised)] px-1 py-px text-[10px] text-[var(--text-muted)]">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? <div className="px-2 pb-2">{children}</div> : null}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

function FamiliarCapabilityPanel({ familiar }: { familiar: Familiar | null }) {
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkillEntry[]>([]);
  const [harnessCapabilities, setHarnessCapabilities] = useState<HarnessCapabilityManifest[]>([]);
  const [harnesses, setHarnesses] = useState<AdapterReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Collapsible state per sub-group
  const [skillsRoleOpen, setSkillsRoleOpen] = useState(true);
  const [skillsFamiliarOpen, setSkillsFamiliarOpen] = useState(true);
  const [skillsGlobalOpen, setSkillsGlobalOpen] = useState(true);

  const harnessId = familiar?.harness ?? "codex";

  useEffect(() => {
    if (!familiar) return;
    setLoading(true);
    setErrors([]);

    const errs: string[] = [];

    void Promise.all([
      fetch("/api/roles", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; roles?: RoleEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "roles fetch failed" })),
      fetch("/api/skills/local", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; skills?: LocalSkillEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "skills/local fetch failed" })),
      fetch(`/api/capabilities?harness=${encodeURIComponent(harnessId)}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harness_capabilities?: HarnessCapabilityManifest[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "capabilities fetch failed" })),
      fetch("/api/harnesses", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harnesses?: AdapterReport[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "harnesses fetch failed" })),
    ]).then(([rolesRes, skillsRes, capsRes, harnessesRes]) => {
      if (rolesRes.ok) setRoles(rolesRes.roles ?? []);
      else errs.push(rolesRes.error ?? "roles unavailable");

      if (skillsRes.ok) setLocalSkills(skillsRes.skills ?? []);
      else errs.push(skillsRes.error ?? "local skills unavailable");

      if (capsRes.ok) setHarnessCapabilities(capsRes.harness_capabilities ?? []);
      else errs.push(capsRes.error ?? "capabilities unavailable");

      if (harnessesRes.ok) setHarnesses(harnessesRes.harnesses ?? []);
      else errs.push(harnessesRes.error ?? "harnesses unavailable");

      setErrors(errs);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiar?.id]);

  if (!familiar) {
    return (
      <p className="p-4 text-xs text-[var(--text-muted)]">
        Select a familiar to see its capabilities.
      </p>
    );
  }

  if (loading) {
    return <p className="p-4 text-xs text-[var(--text-muted)]">loading…</p>;
  }

  // ── Derive inheritance layers ────────────────────────────────────────────────

  // Layer 1: Active roles for this familiar (or "all" / "global")
  const activeRoles = roles.filter(
    (r) =>
      r.active &&
      (r.familiar === familiar.id || r.familiar === "all" || r.familiar === "global"),
  );
  const roleGrantedSkillIds = new Set(activeRoles.flatMap((r) => r.skills));

  // Layer 2: Local skills
  const globalSkills = localSkills.filter((s) => s.familiar === "global");
  const familiarSkills = localSkills.filter((s) => s.familiar === familiar.id);

  // Layer 3: Harness capability manifest
  const harnessManifest =
    harnessCapabilities.find((m) => m.harness_id === harnessId) ?? null;
  const harnessPlugins = harnessManifest?.plugins ?? [];
  const mcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() === "mcp");
  const nonMcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() !== "mcp");
  const warnings = harnessManifest?.warnings ?? [];

  // The bound harness metadata
  const harnessReport = harnesses.find((h) => h.id === harnessId) ?? null;

  // Total unique skill ids across all layers
  const allSkillIds = new Set([
    ...familiarSkills.map((s) => s.id),
    ...globalSkills.map((s) => s.id),
    ...Array.from(roleGrantedSkillIds),
  ]);

  return (
    <div className="flex flex-col gap-2 p-3 text-xs">

      {/* Error banner */}
      {errors.length > 0 ? (
        <div className="rounded border border-[color-mix(in_oklch,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5">
          {errors.map((e, i) => (
            <p key={i} className="text-[10px] text-[var(--color-warning)]">{e}</p>
          ))}
        </div>
      ) : null}

      {/* ── Section 1: Roles ──────────────────────────────────────────────── */}
      <CapSection title="Roles" scope={`active: ${activeRoles.length}`}>
        {activeRoles.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-2 text-[var(--text-muted)]">
            No roles active — activate one in the Roles page.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {activeRoles.map((role) => (
              <li
                key={`${role.familiar}:${role.id}`}
                className="rounded border border-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Icon name="ph:sparkle" width={13} className="shrink-0 text-[var(--accent-presence)]" />
                  <span className="font-medium text-[var(--text-primary)]">{role.name}</span>
                  <span className="ml-auto rounded bg-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] px-1 text-[10px] text-[var(--accent-presence)]">
                    {role.familiar}
                  </span>
                  {role.skills.length > 0 ? (
                    <span className="rounded bg-[var(--bg-raised)] px-1 text-[10px] text-[var(--text-muted)]">
                      {role.skills.length} skill{role.skills.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {role.description ? (
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">
                    {role.description}
                  </p>
                ) : null}
                <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                  inherited from: roles/{role.id}/ROLE.md
                </p>
              </li>
            ))}
          </ul>
        )}
      </CapSection>

      {/* ── Section 2: Skills (3 sub-groups) ──────────────────────────────── */}
      <CapSection title="Skills" scope={`${allSkillIds.size} total`}>
        <div className="flex flex-col gap-1.5">

          {/* Role-granted */}
          {roleGrantedSkillIds.size > 0 ? (
            <CollapsibleSection
              title="Role-granted"
              badge={`${roleGrantedSkillIds.size} via active roles`}
              open={skillsRoleOpen}
              onToggle={() => setSkillsRoleOpen((v) => !v)}
              accentClass="border-l-2 border-l-[var(--accent-presence)]"
            >
              <ul className="space-y-1 pt-1">
                {Array.from(roleGrantedSkillIds).map((sid) => {
                  const skill = localSkills.find((s) => s.id === sid);
                  return (
                    <li key={sid} className="rounded bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)] px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[var(--text-primary)]">
                          {skill?.name ?? sid}
                        </span>
                        <KindBadge kind={skill?.kind ?? "agent"} />
                      </div>
                      {skill?.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">
                          {skill.description}
                        </p>
                      ) : null}
                      {skill?.tags && skill.tags.length > 0 ? (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {skill.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] px-1 text-[10px] text-[var(--accent-presence)]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CollapsibleSection>
          ) : null}

          {/* Familiar-specific */}
          <CollapsibleSection
            title="Familiar"
            badge={String(familiarSkills.length)}
            open={skillsFamiliarOpen}
            onToggle={() => setSkillsFamiliarOpen((v) => !v)}
            accentClass="border-l-2 border-l-[var(--color-success)]"
          >
            {familiarSkills.length === 0 ? (
              <p className="pt-1 text-[10px] text-[var(--text-muted)]">
                No skills in ~/.openclaw/workspace/{familiar.id}/skills/
              </p>
            ) : (
              <ul className="space-y-1 pt-1">
                {familiarSkills.map((s) => (
                  <li key={s.id} className="rounded bg-[color-mix(in_oklch,var(--color-success)_10%,transparent)] px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                      <KindBadge kind={s.kind ?? "agent"} />
                    </div>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">
                        {s.description}
                      </p>
                    ) : null}
                    {s.tags && s.tags.length > 0 ? (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] px-1 text-[10px] text-[var(--color-success)]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      ~/.openclaw/workspace/{familiar.id}/skills/
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* Global */}
          <CollapsibleSection
            title="Global"
            badge={String(globalSkills.length)}
            open={skillsGlobalOpen}
            onToggle={() => setSkillsGlobalOpen((v) => !v)}
          >
            {globalSkills.length === 0 ? (
              <p className="pt-1 text-[10px] text-[var(--text-muted)]">
                No skills in ~/.openclaw/workspace/skills/
              </p>
            ) : (
              <ul className="space-y-1 pt-1">
                {globalSkills.map((s) => (
                  <li key={s.id} className="rounded bg-[var(--bg-raised)]/60 px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                      <KindBadge kind={s.kind ?? "agent"} />
                    </div>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-muted)]">
                        {s.description}
                      </p>
                    ) : null}
                    {s.tags && s.tags.length > 0 ? (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-[var(--bg-raised)] px-1 text-[10px] text-[var(--text-secondary)]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      ~/.openclaw/workspace/skills/
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>
      </CapSection>

      {/* ── Section 3: Plugins ────────────────────────────────────────────── */}
      <CapSection title="Plugins" scope={`${nonMcpPlugins.length} from harness`}>
        {nonMcpPlugins.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-2 text-[var(--text-muted)]">
            No plugins in harness capability scan. Run /refresh in the Capabilities page.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {nonMcpPlugins.map((p) => (
              <li
                key={p.id}
                className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                  <KindBadge kind={p.kind} />
                  <span
                    className={`rounded px-1 text-[10px] uppercase tracking-wider ${
                      p.enabled
                        ? "bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] text-[var(--color-success)]"
                        : "bg-[var(--bg-raised)] text-[var(--text-muted)]"
                    }`}
                  >
                    {p.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                {p.command ? (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{p.command}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CapSection>

      {/* ── Section 4: Harness ───────────────────────────────────────────── */}
      <CapSection
        title="Harness"
        scope={
          harnessReport
            ? `${harnessReport.label} ${harnessReport.version ?? ""}`.trim()
            : harnessId
        }
      >
        <ul className="space-y-1">
          <CapRow label="harness" value={harnessId} />
          <CapRow label="binary" value={harnessReport?.binary ?? "—"} />
          <CapRow label="path" value={harnessReport?.path ?? "—"} mono />
          <CapRow label="version" value={harnessReport?.version ?? "—"} />
          <CapRow label="model" value={familiar.model ?? "—"} />
          {harnessManifest?.scanned_at ? (
            <CapRow label="scanned" value={`${age(harnessManifest.scanned_at)} ago`} />
          ) : null}
        </ul>
      </CapSection>

      {/* ── Section 5: MCP Servers ───────────────────────────────────────── */}
      <CapSection title="MCP Servers" scope={`${mcpPlugins.length} discovered`}>
        {mcpPlugins.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-2 text-[var(--text-muted)]">
            No MCP servers in capability scan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mcpPlugins.map((p) => (
              <li
                key={p.id}
                className="rounded border border-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_5%,transparent)] px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                  <KindBadge kind="mcp" />
                  <span
                    className={`rounded px-1 text-[10px] uppercase tracking-wider ${
                      p.enabled
                        ? "bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] text-[var(--color-success)]"
                        : "bg-[var(--bg-raised)] text-[var(--text-muted)]"
                    }`}
                  >
                    {p.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                {p.command ? (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{p.command}</p>
                ) : null}
                {p.args && p.args.length > 0 ? (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{p.args.join(" ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CapSection>

      {/* ── Section 6: Warnings ─────────────────────────────────────────── */}
      {warnings.length > 0 ? (
        <CapSection title="Warnings" scope={String(warnings.length)}>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 rounded bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
                <div>
                  <span className="font-medium text-[var(--color-warning)]">{w.kind}</span>
                  <p className="text-[10px] text-[var(--text-secondary)]">{w.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </CapSection>
      ) : null}

      {/* ── Section 7: Eval Loop ─────────────────────────────────────────── */}
      <section>
        <header className="mb-1.5 flex items-baseline justify-between">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            Skill: eval-loop
          </h3>
        </header>
        <EvalLoopPanel
          familiarId={familiar.id}
          familiarName={familiar.display_name}
        />
      </section>
    </div>
  );
}
