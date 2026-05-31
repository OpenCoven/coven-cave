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

// Neutral tile chrome — Mood C reserves accent colour for presence/health,
// so harness initial tiles all read on the same hairline-card palette.
const HARNESS_TILE = "bg-muted text-foreground";

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
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top tab strip */}
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-5 text-[13px]">
          {(["plugins", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative pb-2 transition-colors ${
                tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="capitalize">{t}</span>
              {tab === t ? (
                <span className="absolute -bottom-[13px] left-0 right-0 h-px bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <button
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
            title="Manage plugins (not wired in v1)"
          >
            <Icon name="ph:gear-six-bold" className="text-muted-foreground" />
            <span>Manage</span>
          </button>
          <button
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
            title="Create plugin (not wired in v1)"
          >
            <span>Create</span>
            <span className="text-[10px] text-muted-foreground">▾</span>
          </button>
          <button
            className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
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
          <h1 className="text-center text-[34px] font-normal tracking-tight text-foreground">
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
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
              <button
                onClick={() => setFilter("more")}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 transition-colors ${
                  filter === "more"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                <span>More</span>
                <span className="text-[10px] text-muted-foreground">▾</span>
              </button>
            </div>

            <div className="relative">
              <Icon
                name="ph:magnifying-glass-bold"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                width="0.85rem"
                height="0.85rem"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "plugins" ? "Search plugins" : "Search skills"}
                className="w-56 rounded-md border border-border bg-card py-1.5 pl-7 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-border-strong"
              />
            </div>
          </div>

          {/* Featured grid */}
          <section className="mt-10">
            <h2 className="mb-4 text-[15px] font-medium text-foreground">Featured</h2>

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
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No plugins match.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((h) => {
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
            className={`group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors ${
              h.installed
                ? "hover:border-border-strong hover:bg-muted"
                : "cursor-default opacity-70"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ${HARNESS_TILE}`}
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {h.label}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{tagline}</span>
            </span>
            <span className="shrink-0">
              {h.installed ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-foreground"
                  title="Installed"
                  aria-label="Installed"
                >
                  <Icon name="ph:check-bold" />
                </span>
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors group-hover:text-foreground"
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
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        Skills unavailable: {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
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
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ${HARNESS_TILE}`}>
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {s.name}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{tagline}</span>
            </span>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground"
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
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
            <span className="block h-2.5 w-3/4 animate-pulse rounded bg-muted" />
          </span>
          <span className="h-5 w-5 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
