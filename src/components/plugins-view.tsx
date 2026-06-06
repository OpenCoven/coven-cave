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

const TAB_LABEL: Record<Tab, string> = {
  plugins: "Plugins",
  skills: "Skills",
  capabilities: "Capabilities",
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

  const capabilityCount = capabilities.length;
  const installedHarnessCount = harnesses.filter((h) => h.installed).length;
  const pageMeta =
    tab === "plugins"
      ? `${installedHarnessCount}/${harnesses.length || 0} installed`
      : tab === "skills"
        ? skillsLoaded ? `${skills.length} installed` : "Loading"
        : capabilitiesLoaded ? `${capabilityCount} manifests` : "Loading";
  const sectionTitle =
    tab === "plugins" ? "Harness plugins" : tab === "skills" ? "Installed skills" : "Harness capabilities";

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 py-4 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
                {TAB_LABEL[tab]}
              </h1>
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                {pageMeta}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <div className="relative w-full sm:w-64">
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
                placeholder={`Search ${TAB_LABEL[tab].toLowerCase()}`}
                className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong"
              />
            </div>
            {tab === "capabilities" ? (
              <button
                type="button"
                onClick={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="ph:arrows-clockwise-bold" className="text-muted-foreground" width="0.8rem" />
                <span>Refresh</span>
              </button>
            ) : null}
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
          </div>
        </div>

        <div className="mt-4 flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 text-[12px] sm:w-fit">
          {(["plugins", "skills", "capabilities"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`h-7 shrink-0 rounded-md px-3 transition-colors ${
                tab === t
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </header>

      {/* Scrolling content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[980px] px-4 pb-12 pt-6 sm:px-8">
          <section>
            <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
              {sectionTitle}
            </h2>

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
