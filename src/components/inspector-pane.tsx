"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import { SyntaxBlock, MarkdownBlock } from "@/components/message-bubble";
import { EvalLoopPanel } from "@/components/eval-loop-panel";
import { MemoryInspectorPanel } from "@/components/memory-inspector-panel";

type Tab = "memory" | "capabilities" | "inbox";

type Harness = {
  id: string;
  label: string;
  binary: string;
  installed: boolean;
  path: string | null;
  version: string | null;
};

type CapSectionState = {
  open: boolean;
};

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
  capabilities: "Capabilities",
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
        {(["memory", "capabilities", "inbox"] as const).map((t) => (
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
        {tab === "capabilities" ? <CapabilitiesTab familiar={familiar} /> : null}
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

        {openPath.endsWith(".md") ? (
          <MarkdownBlock
            text={openFile?.text ?? "loading…"}
            className="min-h-0 flex-1 overflow-auto px-4 py-4"
          />
        ) : (
          <SyntaxBlock
            text={openFile?.text ?? "loading…"}
            className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[11px]"
          />
        )}
      </div>
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
                ? "bg-purple-600/80 text-white"
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
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-purple-600"
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

/* ---------- Capabilities tab ----------
 *
 * What this familiar has access to right now: skills, tools (via harness),
 * MCP servers, hooks. Issue #19. Reads existing daemon endpoints +
 * package metadata — no new state, no edits (config concern).
 */
function CapabilitiesTab({ familiar }: { familiar: Familiar | null }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [harnessesError, setHarnessesError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) setSkillsError(json.error ?? "skills unavailable");
        else setSkills(json.skills ?? []);
      } catch (err) {
        setSkillsError(err instanceof Error ? err.message : "fetch failed");
      }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) setHarnessesError(json.error ?? "harnesses unavailable");
        else setHarnesses(json.harnesses ?? []);
      } catch (err) {
        setHarnessesError(err instanceof Error ? err.message : "fetch failed");
      }
    })();
  }, []);

  const harness = familiar?.harness
    ? harnesses.find((h) => h.id === familiar.harness) ?? null
    : null;

  if (!familiar) {
    return (
      <p className="p-4 text-xs text-[var(--text-muted)]">
        Select a familiar to see its capabilities.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <CapSection
        title="Skills"
        scope={skillsError ? `error: ${skillsError}` : `${skills.length} attached`}
        empty={!skillsError && skills.length === 0}
        emptyText={`No skills attached to ${familiar.display_name}.`}
      >
        <ul className="space-y-1.5">
          {skills.map((s) => (
            <li
              key={s.id}
              className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--text-primary)]">{s.name}</span>
                <span className="rounded bg-[var(--bg-raised)] px-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {scopeFor(s.owner)}
                </span>
              </div>
              {s.description ? (
                <p className="mt-1 text-[var(--text-secondary)]">{s.description}</p>
              ) : null}
              {s.tags && s.tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-purple-600/20 px-1 text-[10px] text-purple-200"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CapSection>

      <CapSection
        title="Tools"
        scope={
          harnessesError
            ? `error: ${harnessesError}`
            : harness
              ? `${harness.label} ${harness.version ?? "(version unknown)"}`
              : `harness "${familiar.harness ?? "—"}" not installed`
        }
        empty={!harness || !harness.installed}
        emptyText={
          harness
            ? `${harness.label} CLI not on PATH.`
            : "No harness bound — set one in Settings."
        }
      >
        <ul className="space-y-1">
          {harness ? (
            <>
              <CapRow label="binary" value={harness.binary} />
              <CapRow label="path" value={harness.path ?? "—"} mono />
              <CapRow label="version" value={harness.version ?? "—"} />
              <CapRow label="model" value={familiar.model ?? "—"} />
            </>
          ) : null}
        </ul>
      </CapSection>

      <CapSection
        title="MCP servers"
        scope="discovered via harness"
        empty
        emptyText="No MCP server inventory exposed by the daemon yet."
      />

      <CapSection
        title="Hooks"
        scope="registered hook events"
        empty
        emptyText="No hook inventory exposed by the daemon yet."
      />

      {familiar ? (
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
      ) : null}
    </div>
  );
}

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

function scopeFor(owner: string | undefined): string {
  if (!owner) return "workspace";
  if (owner.startsWith("familiar:")) return "familiar-bound";
  if (owner === "local" || owner === "user") return "local";
  return owner;
}
