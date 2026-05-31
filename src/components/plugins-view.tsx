"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";

type Tab = "plugins" | "skills";
type FilterChip = "curated" | "shared" | "created" | "more";

type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
};

type SkillEntry = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
};

type Props = {
  onOpenChat: () => void;
};

const HARNESS_TAGLINE: Record<string, string> = {
  codex: "Run Codex sessions from this Cave",
  claude: "Drive Claude Code from a familiar",
  openclaw: "Bring OpenClaw into the Coven",
  copilot: "Wire up GitHub Copilot CLI",
  opencode: "Run OpenCode locally",
  gemini: "Talk to Google Gemini CLI",
  hermes: "Light a Hermes runtime",
  openhands: "Open up OpenHands tasks",
  aider: "Pair with Aider in-repo",
};

const HARNESS_TINT: Record<string, string> = {
  codex: "bg-blue-500/15 text-blue-200",
  claude: "bg-amber-500/15 text-amber-200",
  openclaw: "bg-rose-500/15 text-rose-200",
  copilot: "bg-sky-500/15 text-sky-200",
  opencode: "bg-purple-500/15 text-purple-200",
  gemini: "bg-cyan-500/15 text-cyan-200",
  hermes: "bg-emerald-500/15 text-emerald-200",
  openhands: "bg-orange-500/15 text-orange-200",
  aider: "bg-zinc-500/20 text-zinc-200",
};

export function PluginsView({ onOpenChat }: Props) {
  const [tab, setTab] = useState<Tab>("plugins");
  const [filter, setFilter] = useState<FilterChip>("curated");
  const [query, setQuery] = useState("");

  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [harnessesLoaded, setHarnessesLoaded] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "plugins" && !harnessesLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/harnesses", { cache: "no-store" });
          const json = await res.json();
          if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
        } catch {
          /* leave empty */
        } finally {
          if (!cancelled) setHarnessesLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (tab === "skills" && !skillsLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/skills", { cache: "no-store" });
          const json = await res.json();
          if (!cancelled) {
            if (json.ok) {
              setSkills(json.skills ?? []);
              setSkillsError(null);
            } else {
              setSkillsError(json.error ?? "daemon offline");
            }
          }
        } catch (err) {
          if (!cancelled) setSkillsError(err instanceof Error ? err.message : "fetch failed");
        } finally {
          if (!cancelled) setSkillsLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [tab, harnessesLoaded, skillsLoaded]);

  const filteredHarnesses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return harnesses;
    return harnesses.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.id.toLowerCase().includes(q) ||
        (HARNESS_TAGLINE[h.id] ?? "").toLowerCase().includes(q),
    );
  }, [harnesses, query]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.owner ?? "").toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      {/* Top tab strip */}
      <header className="flex items-center justify-between border-b border-zinc-900 px-5 py-3">
        <div className="flex items-center gap-5 text-[13px]">
          {(["plugins", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative pb-2 transition-colors ${
                tab === t ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="capitalize">{t}</span>
              {tab === t ? (
                <span className="absolute -bottom-[13px] left-0 right-0 h-px bg-zinc-100" />
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <button
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-300 transition-colors hover:bg-zinc-800/80"
            title="Manage plugins (not wired in v1)"
          >
            <Icon name="ph:gear-six-bold" className="text-zinc-400" />
            <span>Manage</span>
          </button>
          <button
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-300 transition-colors hover:bg-zinc-800/80"
            title="Create plugin (not wired in v1)"
          >
            <span>Create</span>
            <span className="text-[10px] text-zinc-500">▾</span>
          </button>
          <button
            className="rounded-md px-2 py-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            title="More"
          >
            ⋯
          </button>
        </div>
      </header>

      {/* Scrolling content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-6 pt-12 pb-16">
          {/* Headline */}
          <h1 className="text-center text-[34px] font-normal tracking-tight text-zinc-100">
            Make Cave work your way
          </h1>

          {/* Filter row */}
          <div className="mt-10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1 text-[13px]">
              {([
                { id: "curated" as const, label: "Curated by Cave" },
                { id: "shared" as const, label: "Shared with you" },
                { id: "created" as const, label: "Created by me" },
              ]).map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setFilter(chip.id)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    filter === chip.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
              <button
                onClick={() => setFilter("more")}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 transition-colors ${
                  filter === "more"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <span>More</span>
                <span className="text-[10px] text-zinc-500">▾</span>
              </button>
            </div>

            <div className="relative">
              <Icon
                name="ph:magnifying-glass-bold"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                width="0.85rem"
                height="0.85rem"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "plugins" ? "Search plugins" : "Search skills"}
                className="w-56 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 pl-7 pr-3 text-[12px] text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-700"
              />
            </div>
          </div>

          {/* Hero banner */}
          <div className="relative mt-5 overflow-hidden rounded-2xl border border-zinc-800/80">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-700/40 via-indigo-700/30 to-blue-700/30" />
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 30% 40%, rgba(168,85,247,0.35), transparent 60%), radial-gradient(ellipse at 70% 60%, rgba(59,130,246,0.30), transparent 55%)",
              }}
            />
            <div className="relative flex h-[260px] flex-col items-center justify-center gap-4 px-6">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/80 px-4 py-2 text-[13px] text-zinc-100 shadow-lg backdrop-blur">
                <span className="font-medium text-rose-300">Codex</span>
                <span className="text-zinc-300">Draft replies for every email I&apos;m behind on</span>
              </div>
              <button
                onClick={onOpenChat}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-100 px-4 py-1.5 text-[12px] font-medium text-zinc-900 shadow-md transition-colors hover:bg-white"
              >
                <span>Try in chat</span>
              </button>
            </div>
            <div className="pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 w-1 rounded-full ${i === 1 ? "bg-zinc-200" : "bg-zinc-500/60"}`}
                />
              ))}
            </div>
          </div>

          {/* Featured grid */}
          <section className="mt-10">
            <h2 className="mb-4 text-[15px] font-medium text-zinc-200">Featured</h2>

            {tab === "plugins" ? (
              <PluginGrid items={filteredHarnesses} loaded={harnessesLoaded} onOpenChat={onOpenChat} />
            ) : (
              <SkillGrid items={filteredSkills} loaded={skillsLoaded} error={skillsError} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PluginGrid({
  items,
  loaded,
  onOpenChat,
}: {
  items: HarnessReport[];
  loaded: boolean;
  onOpenChat: () => void;
}) {
  if (!loaded) {
    return <GridSkeleton />;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/60 px-4 py-6 text-center text-[13px] text-zinc-500">
        No plugins match.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((h) => {
        const tint = HARNESS_TINT[h.id] ?? "bg-zinc-700/30 text-zinc-200";
        const initial = (h.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
        const tagline = HARNESS_TAGLINE[h.id] ?? `Run ${h.label} from a familiar`;
        return (
          <button
            key={h.id}
            onClick={h.installed && h.chatSupported ? onOpenChat : undefined}
            disabled={!h.installed}
            title={
              !h.installed
                ? `Install \`${h.binary}\` on your PATH to enable`
                : h.chatSupported
                  ? `Open a chat with ${h.label}`
                  : `${h.label} is installed but native chat isn't wired yet`
            }
            className={`group flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 text-left transition-colors ${
              h.installed
                ? "hover:border-zinc-700 hover:bg-zinc-900/80"
                : "cursor-default opacity-70"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ${tint}`}
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-zinc-100">
                {h.label}
              </span>
              <span className="block truncate text-[12px] text-zinc-400">{tagline}</span>
            </span>
            <span className="shrink-0">
              {h.installed ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300"
                  title="Installed"
                  aria-label="Installed"
                >
                  <Icon name="ph:check-bold" />
                </span>
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 transition-colors group-hover:text-zinc-200"
                  title="Add"
                >
                  +
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SkillGrid({
  items,
  loaded,
  error,
}: {
  items: SkillEntry[];
  loaded: boolean;
  error: string | null;
}) {
  if (!loaded) {
    return <GridSkeleton />;
  }
  if (error) {
    return (
      <p className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-[12px] text-amber-200">
        Skills unavailable: {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/60 px-4 py-6 text-center text-[13px] text-zinc-500">
        No skills installed yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((s) => {
        const initial = (s.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
        const tagline = [s.owner, s.category].filter(Boolean).join(" · ") || "Skill";
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-[15px] font-semibold text-purple-200">
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-zinc-100">
                {s.name}
              </span>
              <span className="block truncate text-[12px] text-zinc-400">{tagline}</span>
            </span>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-300"
              title="Available"
              aria-label="Available"
            >
              <Icon name="ph:check-bold" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3"
        >
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-zinc-800/60" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-zinc-800/60" />
            <span className="block h-2.5 w-3/4 animate-pulse rounded bg-zinc-800/40" />
          </span>
          <span className="h-5 w-5 animate-pulse rounded-full bg-zinc-800/60" />
        </div>
      ))}
    </div>
  );
}
