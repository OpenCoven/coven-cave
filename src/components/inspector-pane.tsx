"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";

type Tab = "memory" | "sessions" | "tools";

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

type SessionRow = {
  id: string;
  project_root: string;
  harness: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
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

type Props = { familiar: Familiar | null };

const TAB_LABEL: Record<Tab, string> = {
  memory: "Memory",
  sessions: "Sessions",
  tools: "Tools",
};

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InspectorPane({ familiar }: Props) {
  const [tab, setTab] = useState<Tab>("memory");

  return (
    <aside className="flex h-full flex-col border-l border-zinc-800 bg-zinc-900/40">
      <nav className="flex border-b border-zinc-800 text-[11px]">
        {(["memory", "sessions", "tools"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-3 uppercase tracking-widest transition-colors ${
              tab === t
                ? "border-b-2 border-violet-500 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "memory" ? <MemoryTab /> : null}
        {tab === "sessions" ? <SessionsTab familiar={familiar} /> : null}
        {tab === "tools" ? <ToolsTab /> : null}
      </div>
    </aside>
  );
}

/* ---------- Memory tab ---------- */

function MemoryTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<MemoryFile | null>(null);
  const [reveal, setReveal] = useState(false);

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

  if (error) {
    return <p className="p-4 text-xs text-amber-300">Memory unavailable: {error}</p>;
  }

  if (openPath) {
    const totalRedactions = openFile
      ? Object.values(openFile.redactions).reduce((a, b) => a + b, 0)
      : 0;
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs">
          <button
            onClick={() => {
              setOpenPath(null);
              setReveal(false);
            }}
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
          >
            ← back
          </button>
          <div className="flex-1 truncate text-zinc-300">{openPath.split("/").slice(-2).join("/")}</div>
        </div>

        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px]">
          <div className="text-zinc-400">
            {totalRedactions > 0 ? (
              <span className="text-amber-300">{totalRedactions} secret{totalRedactions === 1 ? "" : "s"} redacted</span>
            ) : (
              <span className="text-zinc-500">no secrets matched</span>
            )}
          </div>
          <button
            onClick={() => setReveal((v) => !v)}
            className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
              reveal
                ? "bg-rose-600/80 text-white hover:bg-rose-500"
                : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
            title={reveal ? "Hide secrets again" : "Reveal raw file (dangerous)"}
          >
            {reveal ? "hide secrets" : "reveal"}
          </button>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-relaxed text-zinc-200">
          {openFile?.text ?? "loading…"}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter memory files…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-600"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {filtered.length === 0 ? (
          <li className="px-2 py-4 text-center text-zinc-600">No matches.</li>
        ) : null}
        {filtered.slice(0, 200).map((e) => (
          <li key={e.fullPath}>
            <button
              onClick={() => setOpenPath(e.fullPath)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/60"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-zinc-200">{e.relPath}</span>
                <span className="truncate text-[10px] uppercase tracking-widest text-zinc-500">
                  {e.rootLabel}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">{age(e.modified)}</span>
            </button>
          </li>
        ))}
        {filtered.length > 200 ? (
          <li className="px-2 py-2 text-center text-[10px] text-zinc-600">
            +{filtered.length - 200} more — filter to narrow
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* ---------- Sessions tab ---------- */

function SessionsTab({ familiar }: { familiar: Familiar | null }) {
  void familiar; // reserved for batch 2: filter by familiar's harness
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/sessions/list", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? "sessions load failed");
          return;
        }
        setError(null);
        setSessions(json.sessions ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch failed");
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const k = s.harness || "unknown";
      const list = map.get(k) ?? [];
      list.push(s);
      map.set(k, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);

  if (error) {
    return <p className="p-4 text-xs text-amber-300">Sessions unavailable: {error}</p>;
  }

  if (sessions.length === 0) {
    return <p className="p-4 text-xs text-zinc-500">No sessions yet.</p>;
  }

  return (
    <div className="space-y-4 p-2 text-xs">
      {grouped.map(([harness, rows]) => (
        <section key={harness}>
          <header className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">{harness}</span>
            <span className="text-[10px] text-zinc-600">{rows.length}</span>
          </header>
          <ul className="space-y-1">
            {rows.slice(0, 50).map((s) => {
              const isRunning = s.status === "running";
              return (
                <li
                  key={s.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          isRunning ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                        }`}
                      />
                      <span className="truncate text-zinc-200">{s.title || "(untitled)"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {age(s.updated_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-zinc-500">{s.project_root}</div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
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
    return <p className="p-4 text-xs text-zinc-500">No skills registered with the daemon yet.</p>;
  }

  return (
    <ul className="space-y-2 p-2 text-xs">
      {skills.map((s) => (
        <li
          key={s.id}
          className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200">{s.name}</span>
            {s.category ? (
              <span className="rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] text-violet-200">
                {s.category}
              </span>
            ) : null}
          </div>
          {s.description ? (
            <p className="mt-1 text-[11px] leading-snug text-zinc-400">{s.description}</p>
          ) : null}
          {s.tags && s.tags.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {s.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
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
