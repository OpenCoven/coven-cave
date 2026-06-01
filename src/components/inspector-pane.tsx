"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";

type Tab = "memory" | "tools" | "inbox";

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

type Skill = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
  description?: string;
};

type Props = {
  familiar: Familiar | null;
  inboxItems?: InboxItem[];
  onOpenInbox?: () => void;
};

const TAB_LABEL: Record<Tab, string> = {
  memory: "Memory",
  tools: "Tools",
  inbox: "Inbox",
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

export function InspectorPane({ familiar, inboxItems = [], onOpenInbox }: Props) {
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
        {(["memory", "tools", "inbox"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-3 uppercase tracking-widest transition-colors ${
              tab === t
                ? "border-b-2 border-purple-500 text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {TAB_LABEL[t]}
            {t === "inbox" && inboxBadge > 0 ? (
              <span className="ml-1 rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
                {inboxBadge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "memory" ? <MemoryTab familiar={familiar} /> : null}
        {tab === "tools" ? <ToolsTab /> : null}
        {tab === "inbox" ? (
          <InboxTab
            familiar={familiar}
            items={familiarInbox}
            onOpenInbox={onOpenInbox}
          />
        ) : null}
      </div>
    </aside>
  );
}

/* ---------- Inbox tab ---------- */

function InboxTab({
  familiar,
  items,
  onOpenInbox,
}: {
  familiar: Familiar | null;
  items: InboxItem[];
  onOpenInbox?: () => void;
}) {
  if (!familiar) {
    return (
      <p className="p-4 text-xs text-[var(--text-muted)]">
        Select a familiar to see its reminders.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-muted)]">
        Nothing scheduled for {familiar.display_name}.
        {onOpenInbox ? (
          <button
            onClick={onOpenInbox}
            className="ml-1 text-purple-300 hover:text-purple-200"
          >
            Create →
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="p-2 text-xs">
      {items.map((it) => (
        <li
          key={it.id}
          className="mb-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="flex-1 truncate text-[var(--text-primary)]">{it.title}</span>
            <span
              className={`shrink-0 rounded px-1 py-px text-[9px] uppercase tracking-widest ${
                it.status === "fired"
                  ? "bg-amber-500/20 text-amber-200"
                  : "bg-sky-500/20 text-sky-200"
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
              : `in ${age(it.fireAt ?? it.updatedAt)}`}
          </div>
          <div className="mt-1.5 flex gap-1">
            {it.id.startsWith("eph:") ? (
              <span className="text-[10px] italic text-[var(--text-muted)]">
                respond in chat to clear
              </span>
            ) : (
              <>
                <button
                  onClick={() =>
                    void fetch(`/api/inbox/${it.id}/snooze`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ minutes: 10 }),
                    })
                  }
                  className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  Snooze 10m
                </button>
                <button
                  onClick={() =>
                    void fetch(`/api/inbox/${it.id}/dismiss`, { method: "POST" })
                  }
                  className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  Dismiss
                </button>
                {it.status === "fired" ? (
                  <button
                    onClick={() =>
                      void fetch(`/api/inbox/${it.id}/done`, { method: "POST" })
                    }
                    className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  >
                    Done
                  </button>
                ) : null}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
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
  const [mode, setMode] = useState<"coven" | "files">("coven");
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
          // Auto-switch to "files" tab when daemon returns no memory entries
          // so users see something useful rather than a blank coven pane.
          if (fetched.length === 0) setMode("files");
        } else {
          // Daemon memory endpoint unavailable — fall through to file browser.
          setMode("files");
        }
      } catch {
        // Network or daemon error — fall through to file browser.
        setMode("files");
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
    return <p className="p-4 text-xs text-amber-300">Memory unavailable: {error}</p>;
  }

  if (openPath) {
    const totalRedactions = openFile
      ? Object.values(openFile.redactions).reduce((a, b) => a + b, 0)
      : 0;
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-xs">
          <button
            onClick={() => {
              setOpenPath(null);
              setReveal(false);
            }}
            className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            ← back
          </button>
          <div className="flex-1 truncate text-[var(--text-secondary)]">{openPath.split("/").slice(-2).join("/")}</div>
        </div>

        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3 py-1.5 text-[11px]">
          <div className="text-[var(--text-secondary)]">
            {totalRedactions > 0 ? (
              <span className="text-amber-300">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
            ) : (
              <span className="text-[var(--text-muted)]">no secrets matched</span>
            )}
          </div>
          <button
            onClick={() => setReveal((v) => !v)}
            className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
              reveal
                ? "bg-rose-600/80 text-white hover:bg-rose-500"
                : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            }`}
            title={reveal ? "Hide secrets again" : "Reveal raw file (dangerous)"}
          >
            {reveal ? "hide secrets" : "reveal"}
          </button>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
          {openFile?.text ?? "loading…"}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] px-2 py-1.5">
        {(["coven", "files"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setQuery("");
              setMode(m);
            }}
            className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
              mode === m
                ? "bg-purple-600/80 text-white"
                : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {mode === "coven" ? covenFiltered.length : filtered.length}
        </span>
      </div>
      <div className="border-b border-[var(--border-hairline)] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "coven" ? "Filter coven memory…" : "Filter memory files…"}
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-purple-600"
        />
      </div>

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
                    className="mt-1 text-purple-300 hover:text-purple-200 underline"
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
                className="mt-1 text-[10px] text-purple-300 hover:text-purple-200"
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

function ToolsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "skills load failed");
          return;
        }
        setSkills(json.skills ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "fetch failed");
      }
    })();
  }, []);

  if (error) {
    return <p className="p-4 text-xs text-amber-300">Skills unavailable: {error}</p>;
  }

  if (skills.length === 0) {
    return <p className="p-4 text-xs text-[var(--text-muted)]">No skills registered with the daemon yet.</p>;
  }

  return (
    <ul className="space-y-2 p-2 text-xs">
      {skills.map((s) => (
        <li
          key={s.id}
          className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--text-primary)]">{s.name}</span>
            {s.category ? (
              <span className="rounded bg-purple-600/30 px-1.5 py-0.5 text-[10px] text-purple-200">
                {s.category}
              </span>
            ) : null}
          </div>
          {s.description ? (
            <p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">{s.description}</p>
          ) : null}
          {s.tags && s.tags.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {s.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
