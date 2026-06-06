"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { PluginCard } from "@/components/plugin-card";
import { SkillCard } from "@/components/skill-card";
import {
  SkillDetailDrawer,
  type SkillEntry as SkillEntryWithDetail,
  type FamiliarForSkill,
} from "@/components/skill-detail-drawer";

type Tab = "plugins" | "skills" | "capabilities";
type FilterChip = "curated" | "shared" | "created" | "more";

// ── Capability types (mirrors /api/capabilities) ──────────────────────────
type GlobalInstructions = {
  present: boolean;
  path?: string;
  byte_count?: number;
};
type HarnessCapSkill = { id: string; name: string; description?: string; path: string };
type HarnessCapPlugin = { id: string; name: string; kind: string; enabled: boolean; command?: string; args?: string[] };
type CapWarning = { kind: string; path: string; message: string };
type HarnessCapabilityManifest = {
  harness_id: string;
  scanned_at: string;
  global_instructions: GlobalInstructions;
  skills: HarnessCapSkill[];
  plugins: HarnessCapPlugin[];
  warnings: CapWarning[];
};
// ───────────────────────────────────────────────────────────────────────────

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
  onCreateReminder?: () => void;
  onCreateSkill?: () => void;
  onCreatePlugin?: () => void;
  familiars?: FamiliarForSkill[];
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

export function PluginsView({ onOpenChat, onCreateReminder, onCreateSkill, onCreatePlugin, familiars = [] }: Props) {
  const [tab, setTab] = useState<Tab>("plugins");
  const [filter, setFilter] = useState<FilterChip>("curated");
  const [query, setQuery] = useState("");

  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [harnessesLoaded, setHarnessesLoaded] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<HarnessCapabilityManifest[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesRefresh, setCapabilitiesRefresh] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillEntryWithDetail | null>(null);
  const createRef = useRef<HTMLDivElement | null>(null);

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
    if (tab === "capabilities" && !capabilitiesLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(`/api/capabilities${capabilitiesRefresh ? '?refresh=1' : ''}`, { cache: "no-store" });
          const json = await res.json();
          if (!cancelled) {
            if (json.ok) {
              setCapabilities(json.harness_capabilities ?? []);
              setCapabilitiesError(null);
            } else {
              setCapabilitiesError(json.error ?? "daemon offline");
            }
          }
        } catch (err) {
          if (!cancelled) setCapabilitiesError(err instanceof Error ? err.message : "fetch failed");
        } finally {
          if (!cancelled) { setCapabilitiesLoaded(true); setCapabilitiesRefresh(false); }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [tab, harnessesLoaded, skillsLoaded, capabilitiesLoaded]);

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
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      {/* Top tab strip */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
        <div className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto text-[13px]">
          {(["plugins", "skills", "capabilities"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative shrink-0 pb-2 transition-colors ${
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
        <div className="flex shrink-0 items-center gap-2 text-[12px]">
          <button
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
            title="Manage plugins (not wired in v1)"
          >
            <Icon name="ph:gear-six-bold" className="text-muted-foreground" />
            <span>Manage</span>
          </button>
          <div ref={createRef} className="relative">
            <button
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
              onClick={() => setCreateOpen((v) => !v)}
            >
              <span>Create</span>
              <Icon
                name="ph:caret-down-bold"
                className={`text-[10px] text-muted-foreground transition-transform duration-150 ${
                  createOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {createOpen && (
              <CreateDropdown
                onClose={() => setCreateOpen(false)}
                containerRef={createRef}
                onCreatePlugin={onCreatePlugin}
                onCreateSkill={onCreateSkill}
                onCreateReminder={onCreateReminder}
              />
            )}
          </div>
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
        <div className="mx-auto w-full max-w-[860px] px-3 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-12">
          {/* Headline */}
          <div className="text-center">
            <h1 className="text-[26px] font-normal tracking-tight text-[var(--text-primary)] sm:text-[34px]">
              Make Cave work your way
            </h1>
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              {tab === "plugins"
                ? "Connect harnesses and tools to extend what your familiars can do."
                : tab === "skills"
                  ? "Skills teach your familiars how to handle specific tasks consistently."
                  : "What each harness knows about — its instructions, skills, and plugins."}
            </p>
          </div>

          {/* Filter row */}
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 text-[13px]">
              {([
                { id: "curated" as const, label: "Curated by Cave" },
                { id: "shared" as const, label: "Shared with you" },
                { id: "created" as const, label: "Created by me" },
              ]).map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setFilter(chip.id)}
                  className={`shrink-0 rounded-md px-3 py-1.5 transition-colors ${
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
                className={`flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 transition-colors ${
                  filter === "more"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                <span>More</span>
                <span className="text-[10px] text-muted-foreground">▾</span>
              </button>
            </div>

            <div className="relative w-full sm:w-auto">
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
                placeholder={tab === "plugins" ? "Search plugins" : tab === "skills" ? "Search skills" : "Search capabilities"}
                className="w-full rounded-md border border-border bg-card py-1.5 pl-7 pr-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong sm:w-56"
              />
            </div>
          </div>

          {/* Featured grid */}
          <section className="mt-10">
            <h2 className="mb-4 text-[15px] font-medium text-foreground">Featured</h2>

            {tab === "plugins" ? (
              <PluginGrid items={filteredHarnesses} loaded={harnessesLoaded} onOpenChat={onOpenChat} />
            ) : tab === "skills" ? (
              <SkillGrid items={filteredSkills} loaded={skillsLoaded} error={skillsError} onSelect={(s) => setSelectedSkill(s)} />
            ) : (
              <CapabilitiesView items={capabilities.filter(c => !query || c.harness_id.toLowerCase().includes(query.toLowerCase()))} loaded={capabilitiesLoaded} error={capabilitiesError} onRefresh={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }} />
            )}
          </section>
        </div>
      </div>
      <SkillDetailDrawer
        skill={selectedSkill}
        familiars={familiars}
        onClose={() => setSelectedSkill(null)}
      />
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((h) => (
        <PluginCard key={h.id} harness={h} onLaunch={onOpenChat} />
      ))}
    </div>
  );
}

function SkillGrid({
  items,
  loaded,
  error,
  onSelect,
}: {
  items: SkillEntry[];
  loaded: boolean;
  error: string | null;
  onSelect: (s: SkillEntryWithDetail) => void;
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((s) => (
        <SkillCard
          key={s.id}
          skill={s}
          onClick={() => onSelect(s)}
        />
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
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

// ─── Create Dropdown ───────────────────────────────────────────────────────────

type CreateDropdownProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onCreatePlugin?: () => void;
  onCreateSkill?: () => void;
  onCreateReminder?: () => void;
};

const CREATE_ITEMS: {
  id: "plugin" | "skill" | "reminder";
  label: string;
  icon: IconName;
  desc: string;
}[] = [
  {
    id: "plugin",
    label: "Plugin",
    icon: "ph:puzzle-piece-bold",
    desc: "Add a new Cave plugin",
  },
  {
    id: "skill",
    label: "Skill",
    icon: "ph:sparkle-bold",
    desc: "Define a reusable familiar skill",
  },
  {
    id: "reminder",
    label: "Reminder",
    icon: "ph:bell-bold",
    desc: "Schedule a one-time or recurring alert",
  },
];

function CreateDropdown({
  containerRef,
  onClose,
  onCreatePlugin,
  onCreateSkill,
  onCreateReminder,
}: CreateDropdownProps) {
  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [containerRef, onClose]);

  const handlers: Record<string, (() => void) | undefined> = {
    plugin: onCreatePlugin,
    skill: onCreateSkill,
    reminder: onCreateReminder,
  };

  return (
    <div
      className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      role="menu"
    >
      {CREATE_ITEMS.map((item, i) => (
        <button
          key={item.id}
          role="menuitem"
          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-muted ${
            i < CREATE_ITEMS.length - 1 ? "border-b border-border" : ""
          }`}
          onClick={() => {
            handlers[item.id]?.();
            onClose();
          }}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon name={item.icon} className="text-[13px]" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-foreground">{item.label}</span>
            <span className="text-[10px] text-muted-foreground">{item.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ── CapabilitiesView ────────────────────────────────────────────────────────

function CapabilitiesView({
  items,
  loaded,
  error,
  onRefresh,
}: {
  items: HarnessCapabilityManifest[];
  loaded: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (!loaded) return <GridSkeleton />;

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-6 sm:px-5">
        <p className="mb-3 text-[13px] text-muted-foreground">
          {error === "daemon offline"
            ? "Coven daemon is offline — harness capabilities require a running daemon."
            : `Could not load capabilities: ${error}`}
        </p>
        <button
          onClick={onRefresh}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No harness capabilities found. Install Codex or Claude Code and restart the daemon.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {items.map((manifest) => (
        <HarnessCapabilityCard key={manifest.harness_id} manifest={manifest} />
      ))}
      <div className="flex items-center justify-end">
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Icon name="ph:arrows-clockwise-bold" width="0.75rem" />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}

function HarnessCapabilityCard({ manifest }: { manifest: HarnessCapabilityManifest }) {
  const label = manifest.harness_id === "codex" ? "Codex" : manifest.harness_id === "claude" ? "Claude Code" : manifest.harness_id;
  const initial = label[0]?.toUpperCase() ?? "?";
  const totalItems =
    (manifest.global_instructions.present ? 1 : 0) +
    manifest.skills.length +
    manifest.plugins.length;

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold text-foreground">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            {totalItems === 0 ? "No config found" : `${totalItems} item${totalItems === 1 ? "" : "s"} configured`}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground sm:ml-auto">
          {new Date(manifest.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Body */}
      <div className="divide-y divide-border">
        {/* Global instructions */}
        {manifest.global_instructions.present ? (
          <div className="flex items-start gap-3 px-4 py-3">
            <Icon name="ph:note-pencil" className="mt-0.5 shrink-0 text-muted-foreground" width="0.85rem" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-foreground">Global instructions</p>
              <p className="break-all text-[11px] text-muted-foreground sm:truncate">
                {manifest.global_instructions.path?.replace(/^\/Users\/[^/]+/, "~") ?? "—"}
              </p>
              {manifest.global_instructions.byte_count !== undefined && (
                <p className="text-[10px] text-muted-foreground">
                  {(manifest.global_instructions.byte_count / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 text-[12px] text-muted-foreground">
            <Icon name="ph:note-pencil" className="shrink-0" width="0.85rem" />
            <span>No global instructions file found</span>
          </div>
        )}

        {/* Skills (automations) */}
        {manifest.skills.length > 0 ? (
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Automations / skills · {manifest.skills.length}
            </p>
            <ul className="space-y-1.5">
              {manifest.skills.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  <Icon name="ph:sparkle" className="mt-0.5 shrink-0 text-muted-foreground" width="0.75rem" />
                  <div className="min-w-0">
                    <p className="break-words text-[12px] text-foreground">{s.name}</p>
                    {s.description && (
                      <p className="break-words text-[11px] text-muted-foreground">{s.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Plugins (MCP etc) */}
        {manifest.plugins.length > 0 ? (
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Plugins · {manifest.plugins.length}
            </p>
            <ul className="space-y-1.5">
              {manifest.plugins.map((p) => (
                <li key={p.id} className="flex items-start gap-2">
                  <Icon name="ph:plug" className="mt-0.5 shrink-0 text-muted-foreground" width="0.75rem" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-[12px] text-foreground">{p.name}</p>
                      <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground uppercase tracking-wide">
                        {p.kind}
                      </span>
                      {!p.enabled && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">disabled</span>
                      )}
                    </div>
                    {p.command && (
                      <p className="break-all font-mono text-[11px] text-muted-foreground sm:truncate">
                        {p.command} {p.args?.join(" ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Warnings */}
        {manifest.warnings.length > 0 ? (
          <div className="px-4 py-3">
            {manifest.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Icon name="ph:warning-fill" width={11} aria-hidden />
                <span className="min-w-0 break-words">{w.message}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
