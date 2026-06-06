"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { PluginCard } from "@/components/plugin-card";
import { SkillCard } from "@/components/skill-card";
import {
  CapabilitiesView,
  type HarnessCapabilityManifest,
} from "@/components/capability-card";
import {
  SkillDetailDrawer,
  type SkillEntry as SkillEntryWithDetail,
  type FamiliarForSkill,
} from "@/components/skill-detail-drawer";

type Tab = "plugins" | "skills" | "capabilities";

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

const TAB_LABEL: Record<Tab, string> = {
  plugins: "Plugins",
  skills: "Skills",
  capabilities: "Capabilities",
};

const HERO_HEADLINE: Record<Tab, string> = {
  plugins: "Make Cave work your way",
  skills: "Harness your familiar's skills",
  capabilities: "Explore harness capabilities",
};

const HERO_SEARCH_PLACEHOLDER: Record<Tab, string> = {
  plugins: "Search plugins",
  skills: "Search skills",
  capabilities: "Search capabilities",
};

const SECTION_LABEL: Record<Tab, string> = {
  plugins: "Featured",
  skills: "Installed skills",
  capabilities: "Harness capabilities",
};

export function PluginsView({ onOpenChat, onCreateReminder, onCreateSkill, onCreatePlugin, familiars = [] }: Props) {
  const [tab, setTab] = useState<Tab>("plugins");
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

  // Reset query when switching tabs
  const handleTabChange = (t: Tab) => {
    setTab(t);
    setQuery("");
  };

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
      return () => { cancelled = true; };
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
      return () => { cancelled = true; };
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
      return () => { cancelled = true; };
    }
  }, [tab, harnessesLoaded, skillsLoaded, capabilitiesLoaded]);

  const filteredHarnesses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return harnesses;
    return harnesses.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.id.toLowerCase().includes(q),
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

  const installedHarnessCount = harnesses.filter((h) => h.installed).length;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      {/* ── Top bar: tabs left, controls right ─────────────────────────── */}
      <header className="shrink-0 border-b border-border px-4 sm:px-8">
        <div className="flex h-12 items-center justify-between gap-4">
          {/* Tabs flush left — underline style */}
          <nav className="flex h-full items-end gap-1 overflow-x-auto" aria-label="View tabs">
            {(["plugins", "skills", "capabilities"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleTabChange(t)}
                className={`relative flex h-full shrink-0 items-center px-3 text-[13px] font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-full after:transition-colors ${
                  tab === t
                    ? "text-foreground after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground after:bg-transparent"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </nav>

          {/* Controls flush right */}
          <div className="flex shrink-0 items-center gap-2 text-[12px]">
            {tab === "capabilities" ? (
              <button
                type="button"
                onClick={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="ph:arrows-clockwise-bold" className="text-muted-foreground" width="0.8rem" />
                <span>Refresh</span>
              </button>
            ) : (
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
                onClick={() => {/* manage action */}}
              >
                <Icon name="ph:sliders-bold" className="text-muted-foreground" width="0.8rem" />
                <span>Manage</span>
              </button>
            )}

            <div ref={createRef} className="relative">
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
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
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="More options"
            >
              <Icon name="ph:dots-three-bold" width="1rem" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Scrolling content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-4 pb-12 sm:px-8">

          {/* ── Hero section ─────────────────────────────────────────────── */}
          <div className="pb-8 pt-10 text-center">
            <h1 className="mb-5 text-[26px] font-semibold tracking-tight text-[var(--text-primary)]">
              {HERO_HEADLINE[tab]}
            </h1>

            {/* Search bar */}
            <div className="relative mx-auto mb-6 max-w-[560px]">
              <Icon
                name="ph:magnifying-glass-bold"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                width="0.9rem"
                height="0.9rem"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={HERO_SEARCH_PLACEHOLDER[tab]}
                className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-4 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong"
              />
            </div>

            {/* Hero banner — coven-branded gradient spotlight card */}
            <div className="mx-auto max-w-[560px] overflow-hidden rounded-2xl bg-gradient-to-r from-[#1a0a2e] via-[#3B164F] to-[#1a0a2e] px-6 py-5 text-left">
              <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-900/40 px-2.5 py-1 text-[10px] font-medium tracking-wide text-purple-200 uppercase">
                <Icon name="ph:sparkle-bold" width={10} />
                Featured
              </span>
              <p className="mt-2 text-[15px] font-semibold text-white">
                Connect a harness, command an agent
              </p>
              <p className="mt-1 text-[12px] text-purple-200/70">
                Install any CLI harness and talk to your familiars right from Cave.
              </p>
              <button
                type="button"
                onClick={onOpenChat}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-white/20"
              >
                <Icon name="ph:chat-teardrop-dots-bold" width={12} />
                Try in chat
              </button>
            </div>
          </div>

          {/* ── Section label + grid ──────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {SECTION_LABEL[tab]}
              {tab === "plugins" && harnessesLoaded && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  {installedHarnessCount}/{harnesses.length} installed
                </span>
              )}
              {tab === "skills" && skillsLoaded && !skillsError && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  {skills.length} installed
                </span>
              )}
            </h2>

            {tab === "plugins" ? (
              <PluginGrid items={filteredHarnesses} loaded={harnessesLoaded} onOpenChat={onOpenChat} />
            ) : tab === "skills" ? (
              <SkillGrid items={filteredSkills} loaded={skillsLoaded} error={skillsError} onSelect={(s) => setSelectedSkill(s)} />
            ) : (
              <CapabilitiesView
                items={capabilities.filter(c => !query || c.harness_id.toLowerCase().includes(query.toLowerCase()))}
                loaded={capabilitiesLoaded}
                error={capabilitiesError}
                onRefresh={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
              />
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          <span className="h-7 w-7 animate-pulse rounded-full bg-muted" />
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
