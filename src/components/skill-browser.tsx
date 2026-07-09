"use client";

// Skill Browser — a three-column view of local skills: a category rail (All /
// Claude Code / Generic with counts), a searchable card list, and a detail pane
// that renders the selected skill's SKILL.md. Replaces the old flat list + slide
// -over drawer for the Roles → Skills tab.

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";

export type SkillBrowserEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  slug?: string;
  owner?: string;
  repo?: string;
  packageName?: string;
  tags?: string[];
  topics?: string[];
  agents?: string[];
  trust?: {
    official?: boolean;
    audited?: boolean;
    source?: "registry" | "local" | "daemon" | "fallback";
  };
  installed?: boolean;
  installsAllTime?: number;
  weeklyInstalls?: number[];
  trendScore?: number;
  hotScore?: number;
  registryUrl?: string;
  sourceUrl?: string;
  source?: "registry" | "local" | "daemon" | "fallback";
  local?: {
    installed: boolean;
    path?: string;
    version?: string;
    scope?: "coven" | "claude-user" | "codex-user" | "agents-project" | "agents-user" | "other-local";
    source?: "local-match" | "local-scan";
  };
  /** Absolute path to the skill's SKILL.md (local entries only). */
  path?: string;
  /** Scan scope: "user" (~/.claude/skills), "codex-user" (~/.codex/skills),
   * "agents-project"/"agents-user" (.agents/skills), "global" (Coven shared),
   * or omitted for directory-only entries.
   */
  familiar?: string;
};

type Category = "all" | "installed" | "claude" | "generic";
type LeaderboardMode = "all-time" | "trending" | "hot";
type BrowseFilter = "all" | "official" | "audited" | "installed";
type PreviewState = {
  status: "idle" | "loading" | "loaded" | "error";
  text: string | null;
  error: string | null;
};
type BusyState = "reveal" | "delete" | "use" | "prompt" | null;

// The scan tags user skills by agent/root while installed entries get a
// first-class Installed tab.
function categoryOf(skill: SkillBrowserEntry): "installed" | "claude" | "generic" {
  if (skill.installed || skill.local?.installed) return "installed";
  return skill.familiar === "user" ? "claude" : "generic";
}
const CATEGORY_LABEL: Record<"installed" | "claude" | "generic", string> = {
  installed: "Installed",
  claude: "Claude Code",
  generic: "Generic",
};

const RAIL: { id: Category; label: string; icon: IconName }[] = [
  { id: "all", label: "All Skills", icon: "ph:squares-four" },
  { id: "installed", label: "Installed", icon: "ph:check-circle" },
  { id: "claude", label: "Claude Code", icon: "ph:terminal-window" },
  { id: "generic", label: "Generic", icon: "ph:puzzle-piece" },
];

const LEADERBOARD_MODES: { id: LeaderboardMode; label: string }[] = [
  { id: "all-time", label: "All Time" },
  { id: "trending", label: "Trending" },
  { id: "hot", label: "Hot" },
];

const BROWSE_FILTERS: { id: BrowseFilter; label: string; icon: IconName }[] = [
  { id: "all", label: "All skills", icon: "ph:magnifying-glass" },
  { id: "official", label: "Official", icon: "ph:seal-check" },
  { id: "audited", label: "Security audits", icon: "ph:shield-warning" },
  { id: "installed", label: "Installed", icon: "ph:check-circle" },
];

const SKILLS_DIRECTORY_LINKS = [
  { label: "Topics", href: "https://www.skills.sh/topic" },
  { label: "Official", href: "https://www.skills.sh/official" },
  { label: "Security audits", href: "https://www.skills.sh/audits" },
  { label: "Docs", href: "https://www.skills.sh/docs" },
] as const;

const FEATURED_AGENT_LABELS = [
  "Claude Code",
  "Cursor",
  "Codex",
  "GitHub Copilot",
  "Windsurf",
  "Gemini",
] as const;

const TOPIC_FILTERS = [
  { id: "react", label: "React", keywords: ["react"] },
  { id: "nextjs", label: "Next.js", keywords: ["next.js", "nextjs", "next-"] },
  { id: "design-ui", label: "Design & UI", keywords: ["design", "ui", "ux", "frontend", "shadcn", "interface"] },
  { id: "mobile", label: "Mobile", keywords: ["mobile", "ios", "android", "react-native", "swiftui"] },
  { id: "agent-workflows", label: "Agent workflows", keywords: ["agent", "workflow", "automation", "subagent", "prompt", "skill"] },
  { id: "databases", label: "Databases", keywords: ["database", "postgres", "sql", "supabase", "firebase"] },
  { id: "testing", label: "Testing", keywords: ["test", "testing", "tdd", "qa", "playwright", "debug"] },
  { id: "marketing", label: "Marketing", keywords: ["marketing", "seo", "copywriting", "content", "viral"] },
] as const;

function skillKey(skill: SkillBrowserEntry): string {
  const scope = skill.local ? "local" : "remote";
  const base = skill.slug ?? skill.id;
  const bucket = skill.path ?? `${skill.owner ?? ""}:${skill.repo ?? ""}`;
  return `${scope}:${base}:${bucket}`;
}

function scoreFor(skill: SkillBrowserEntry, mode: LeaderboardMode): number {
  if (mode === "trending") return skill.trendScore ?? 0;
  if (mode === "hot") return skill.hotScore ?? 0;
  return skill.installsAllTime ?? 0;
}

function formatCount(value: number | undefined): string {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function weeklyActivity(skill: SkillBrowserEntry) {
  const weekly = (skill.weeklyInstalls ?? [])
    .filter((value) => Number.isFinite(value))
    .slice(-8);
  const values = Array.from({ length: 8 }, (_, index) => weekly[index - (8 - weekly.length)] ?? 0);
  const max = Math.max(...values, 1);
  return {
    label: values.map((value) => formatCount(value)).join(", "),
    bars: values.map((value) => ({
      value,
      height: value > 0 ? Math.max(12, Math.round((value / max) * 100)) : 10,
    })),
  };
}

function sourceTarget(skill: SkillBrowserEntry): string {
  if (skill.owner && skill.repo) return `${skill.owner}/${skill.repo}`;
  if (skill.packageName) return skill.packageName;
  const parts = skill.slug?.split("/").filter(Boolean) ?? [];
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 2 && parts[0]?.includes(".")) return parts[0];
  return skill.slug ?? skill.id;
}

function sourceKey(skill: SkillBrowserEntry): string {
  return sourceTarget(skill).toLowerCase();
}

function specificSkillName(skill: SkillBrowserEntry): string | null {
  if (skill.owner && skill.repo) return skill.id;
  const parts = skill.slug?.split("/").filter(Boolean) ?? [];
  if (parts.length >= 3) return parts.slice(2).join("/");
  if (parts.length >= 2 && parts[0]?.includes(".")) return skill.id;
  return null;
}

function quoteCliArg(value: string): string {
  if (/^[A-Za-z0-9._@/:+-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function installCommand(skill: SkillBrowserEntry): string {
  const target = sourceTarget(skill);
  const specific = specificSkillName(skill);
  if (specific) return `npx skills add ${quoteCliArg(target)} --skill ${quoteCliArg(specific)}`;
  return `npx skills add ${quoteCliArg(target)}`;
}

function useCommand(skill: SkillBrowserEntry): string {
  const target = sourceTarget(skill);
  const specific = specificSkillName(skill);
  if (specific) return `npx skills use ${quoteCliArg(target)} --skill ${quoteCliArg(specific)}`;
  return `npx skills use ${quoteCliArg(target)}`;
}

// SKILL.md opens with a YAML frontmatter block (name/description/tags) already
// surfaced as the title/badges — strip it so the body reads as prose.
function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").trimStart();
}

function matchesQuery(skill: SkillBrowserEntry, query: string): boolean {
  if (!query) return true;
  const hay = [
    skill.id,
    skill.name,
    skill.description,
    skill.kind,
    skill.owner,
    skill.repo,
    skill.slug,
    skill.packageName,
    skill.familiar,
    ...(skill.tags ?? []),
    ...(skill.topics ?? []),
    ...(skill.agents ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query.toLowerCase());
}

function topicHaystack(skill: SkillBrowserEntry): string {
  return [
    skill.id,
    skill.name,
    skill.description,
    skill.owner,
    skill.repo,
    skill.slug,
    skill.packageName,
    ...(skill.tags ?? []),
    ...(skill.topics ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTopic(skill: SkillBrowserEntry, topicId: string): boolean {
  if (topicId === "all") return true;
  const explicit = [...(skill.topics ?? []), ...(skill.tags ?? [])].map((item) => item.toLowerCase());
  if (explicit.includes(topicId)) return true;
  const topic = TOPIC_FILTERS.find((item) => item.id === topicId);
  if (!topic) return true;
  const hay = topicHaystack(skill);
  return topic.keywords.some((keyword) => hay.includes(keyword));
}

function matchesBrowseFilter(skill: SkillBrowserEntry, filter: BrowseFilter): boolean {
  if (filter === "official") return Boolean(skill.trust?.official);
  if (filter === "audited") return Boolean(skill.trust?.audited);
  if (filter === "installed") return Boolean(skill.installed || skill.local?.installed);
  return true;
}

function topicCounts(skills: SkillBrowserEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const topic of TOPIC_FILTERS) {
    counts[topic.id] = skills.filter((skill) => matchesTopic(skill, topic.id)).length;
  }
  return counts;
}

function sourceSummary(source: string, skills: SkillBrowserEntry[]) {
  const entries = skills.filter((skill) => sourceKey(skill) === source.toLowerCase());
  return {
    count: entries.length,
    installs: entries.reduce((sum, skill) => sum + (skill.installsAllTime ?? 0), 0),
  };
}

function skillDecisionItems(skill: SkillBrowserEntry) {
  const installed = Boolean(skill.installed || skill.local?.installed);
  const local = Boolean(skill.local?.installed || skill.path);
  const trustValue =
    skill.trust?.official && skill.trust?.audited
      ? "Official + audited"
      : skill.trust?.official
        ? "Official"
        : skill.trust?.audited
          ? "Audited"
          : "Community";
  return [
    {
      icon: installed ? "ph:check-circle" as const : "ph:arrow-down" as const,
      label: "Install state",
      value: installed ? "Installed" : "Available",
    },
    {
      icon: skill.trust?.official ? "ph:seal-check" as const : "ph:shield-warning" as const,
      label: "Trust signal",
      value: trustValue,
    },
    {
      icon: local ? "ph:folder-open" as const : "ph:cloud-bold" as const,
      label: "Source",
      value: local ? "Local skill" : "Directory",
    },
  ];
}

// Collapse the absolute SKILL.md path to a friendly directory (drops /SKILL.md,
// tildes the home prefix) for the detail header.
function displayPath(path: string): string {
  const dir = path.replace(/\/SKILL\.md$/i, "");
  return dir.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

// Reveal a directory in the OS file manager. On desktop this shells out via
// Tauri; on the web there is no filesystem bridge, so we copy the path to the
// clipboard instead and report which happened so the UI can say so.
async function revealDir(dir: string): Promise<"revealed" | "copied"> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open", { url: dir });
      return "revealed";
    } catch {
      // fall through to clipboard
    }
  }
  await copyText(dir);
  return "copied";
}

export function SkillBrowser({
  skills,
  loaded,
  query,
  onClearQuery,
  onCreateSkill,
  onChanged,
}: {
  skills: SkillBrowserEntry[];
  loaded: boolean;
  query: string;
  onClearQuery: () => void;
  onCreateSkill?: () => void;
  /** Called after a skill is deleted so the parent can re-scan. */
  onChanged?: () => void;
}) {
  const [category, setCategory] = useState<Category>("all");
  const [mode, setMode] = useState<LeaderboardMode>("all-time");
  const [browse, setBrowse] = useState<BrowseFilter>("all");
  const [topic, setTopic] = useState("all");
  const [agent, setAgent] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle", text: null, error: null });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const { announce } = useAnnouncer();

  // Notices are transient feedback, not state — without this they lingered
  // indefinitely ("Install command copied" an hour later reads as broken).
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!copiedInstall) return;
    const t = window.setTimeout(() => setCopiedInstall(false), 1500);
    return () => window.clearTimeout(t);
  }, [copiedInstall]);

  const counts = useMemo(
    () => ({
      all: skills.length,
      installed: skills.filter((s) => categoryOf(s) === "installed").length,
      claude: skills.filter((s) => categoryOf(s) === "claude").length,
      generic: skills.filter((s) => categoryOf(s) === "generic").length,
    }),
    [skills],
  );

  const agents = useMemo(() => {
    const names = new Set<string>();
    for (const skill of skills) for (const name of skill.agents ?? []) names.add(name);
    return ["all", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [skills]);

  const topics = useMemo(() => topicCounts(skills), [skills]);

  const visible = useMemo(
    () =>
      skills.filter(
        (s) =>
          (category === "all" || categoryOf(s) === category) &&
          matchesBrowseFilter(s, browse) &&
          matchesTopic(s, topic) &&
          (agent === "all" || (s.agents ?? []).includes(agent)) &&
          matchesQuery(s, query),
      ),
    [skills, category, browse, topic, agent, query],
  );

  const rankedVisible = useMemo(
    () => [...visible].sort((a, b) => scoreFor(b, mode) - scoreFor(a, mode) || a.name.localeCompare(b.name)),
    [visible, mode],
  );

  // Keep a valid selection: fall back to the first visible skill when the
  // current pick is filtered out (or nothing is selected yet).
  const selected = useMemo(
    () => rankedVisible.find((s) => skillKey(s) === selectedKey) ?? rankedVisible[0] ?? null,
    [rankedVisible, selectedKey],
  );
  const selectedPath = selected?.local?.path ?? selected?.path ?? null;
  const selectedPreviewKey = selected ? skillKey(selected) : null;
  const selectedHasLocalPath = Boolean(selected?.local?.installed && selectedPath);
  const selectedSource = selected ? sourceTarget(selected) : "";
  const selectedDecisionItems = useMemo(() => (selected ? skillDecisionItems(selected) : []), [selected]);
  const selectedSourceSummary = useMemo(
    () => (selectedSource ? sourceSummary(selectedSource, skills) : { count: 0, installs: 0 }),
    [selectedSource, skills],
  );
  const relatedSourceSkills = useMemo(
    () =>
      selected
        ? rankedVisible
            .filter((skill) => sourceKey(skill) === sourceKey(selected) && skillKey(skill) !== skillKey(selected))
            .slice(0, 4)
        : [],
    [rankedVisible, selected],
  );
  const ecosystemCommand = selected ? installCommand(selected) : "npx skills add <owner/repo>";

  // Load the selected skill's SKILL.md for the detail pane. Only paths under the
  // allow-listed roots return content; anything else 403s → fall back to the
  // scanned description so the pane never goes blank.
  useEffect(() => {
    if (!selected) {
      setPreview({ status: "idle", text: null, error: null });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading", text: null, error: null });
    void (async () => {
      try {
        const source = sourceTarget(selected);
        const url = selectedPath
          ? `/api/skills/file?path=${encodeURIComponent(selectedPath)}`
          : `/api/skills/directory/${encodeURIComponent(selected.id)}?source=${encodeURIComponent(source)}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; text?: string; error?: string; preview?: { text?: string } | null };
        if (cancelled) return;
        if (!json.ok) {
          setPreview({ status: "error", text: null, error: json.error ?? `http ${res.status}` });
        } else {
          setPreview({ status: "loaded", text: json.text ?? json.preview?.text ?? "", error: null });
        }
      } catch (err) {
        if (!cancelled) setPreview({ status: "error", text: null, error: err instanceof Error ? err.message : "fetch failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, selectedPath, selectedPreviewKey]);

  const body = preview.text ? stripFrontmatter(preview.text) : "";

  // Reset the transient action state whenever the selection changes so a stale
  // "confirm delete" or notice never carries over to a different skill.
  useEffect(() => {
    setConfirmingDelete(false);
    setNotice(null);
  }, [selectedPreviewKey, selectedPath]);

  async function handleReveal() {
    if (!selectedPath || busy) return;
    setBusy("reveal");
    try {
      const dir = selectedPath.replace(/\/SKILL\.md$/i, "");
      const how = await revealDir(dir);
      setNotice(how === "revealed" ? "Opened in file manager" : "Path copied to clipboard");
    } catch {
      setNotice("Could not open folder");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyInstall() {
    if (!selected) return;
    try {
      await copyText(installCommand(selected));
      setCopiedInstall(true);
      setNotice("Install command copied");
    } catch {
      setNotice("Could not copy install command");
    }
  }

  async function requestSkillPrompt(selectedSkill: SkillBrowserEntry): Promise<string | null> {
    const res = await fetch("/api/skills/directory/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ id: selectedSkill.id, source: sourceTarget(selectedSkill) }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; prompt?: string };
    if (!res.ok || !json.ok || !json.prompt) {
      setNotice(json.error ? `Use failed: ${json.error}` : "Couldn't fetch the skill prompt. Try again.");
      return null;
    }
    return json.prompt;
  }

  async function handleUseSkill() {
    if (!selected || busy) return;
    setBusy("use");
    setNotice(null);
    try {
      const prompt = await requestSkillPrompt(selected);
      if (!prompt) return;
      window.dispatchEvent(
        new CustomEvent("cave:agents-new-chat", {
          detail: { initialPrompt: prompt },
        }),
      );
      setNotice("Opened chat with skill prompt");
    } catch (err) {
      setNotice(err instanceof Error ? `Use failed: ${err.message}` : "Use failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyPrompt() {
    if (!selected || busy) return;
    setBusy("prompt");
    setNotice(null);
    try {
      const prompt = await requestSkillPrompt(selected);
      if (!prompt) return;
      await copyText(prompt);
      setNotice("Skill prompt copied");
    } catch (err) {
      setNotice(err instanceof Error ? `Copy prompt failed: ${err.message}` : "Copy prompt failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!selectedPath || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setNotice(null);
      return;
    }
    setBusy("delete");
    try {
      const res = await fetch(`/api/skills/local?path=${encodeURIComponent(selectedPath)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setNotice(json.error ? `Delete failed: ${json.error}` : "Delete failed. Try again.");
        return;
      }
      setConfirmingDelete(false);
      setSelectedKey(null);
      // The selection jumps to the next skill and the local notice resets with
      // it, so the confirmation goes through the shared live region instead.
      announce("Skill deleted", "polite");
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? `Delete failed: ${err.message}` : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="skill-browser" role="group" aria-label="Skill browser">
      {/* ── Merged panel — leaderboard header, then the filter strip, then
             the ranked list. One panel owns discovery end-to-end; the detail
             pane sits beside it. ── */}
      <div className="skill-browser__list">
        <div className="skill-browser__leaderboard">
          <div>
            <p className="skill-browser__leaderboard-kicker">Skills Leaderboard</p>
            <p className="skill-browser__leaderboard-title">{formatCount(skills.reduce((sum, skill) => sum + (skill.installsAllTime ?? 0), 0))} installs tracked</p>
            <div className="skill-browser__modes" role="group" aria-label="Rank skills">
              {LEADERBOARD_MODES.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="xs"
                  className={`skill-browser__mode${mode === item.id ? " is-active" : ""}`}
                  aria-pressed={mode === item.id}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="skill-browser__ecosystem">
            <div className="skill-browser__ecosystem-command">
              {/* The command tracks the selection — say so, or a generic
                  "Try it now" silently changes meaning three columns over. */}
              <span>{selected ? `Install ${selected.name}` : "Try it now"}</span>
              <code title={ecosystemCommand}>{ecosystemCommand}</code>
            </div>
            <div className="skill-browser__agent-strip" aria-label="Available for these agents">
              {FEATURED_AGENT_LABELS.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <nav className="skill-browser__directory-links" aria-label="Skills directory links">
              {SKILLS_DIRECTORY_LINKS.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
        <nav className="skill-browser__rail" aria-label="Skill filters">
        {/* One Filter group replaces the old Categories + Browse pair, which
            duplicated All and Installed across two labeled rows and kept
            zero-count categories (Claude Code 0) on screen. Categories stay
            exclusive; the two badge toggles (Official / Security audits)
            compose with them and click off back to everything. */}
        <div className="skill-browser__rail-group" role="group" aria-label="Filter skills">
          <p className="skill-browser__rail-label">Filter</p>
          {RAIL.filter((cat) => cat.id === "all" || cat.id === "installed" || counts[cat.id] > 0).map((cat) => {
            const count = counts[cat.id === "all" ? "all" : cat.id];
            const active = category === cat.id;
            return (
              <Button
                key={cat.id}
                variant="ghost"
                className={`skill-browser__cat${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setCategory(cat.id)}
              >
                <Icon name={cat.icon} width={15} className="skill-browser__cat-icon" aria-hidden />
                <span className="skill-browser__cat-label">{cat.label}</span>
                <span className="skill-browser__cat-count">{count}</span>
              </Button>
            );
          })}
          <div className="skill-browser__browse" role="group" aria-label="Badge filters">
            {BROWSE_FILTERS.filter((item) => item.id === "official" || item.id === "audited").map((item) => {
              const active = browse === item.id;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="xs"
                  className={`skill-browser__browse-btn${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setBrowse(active ? "all" : item.id)}
                >
                  <Icon name={item.icon} width={13} aria-hidden />
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
        <div className="skill-browser__rail-group" role="group" aria-label="Browse by topic">
          <p className="skill-browser__rail-label">Topics</p>
          <div className="skill-browser__topics">
            <Button
              variant="ghost"
              size="xs"
              className={`skill-browser__topic${topic === "all" ? " is-active" : ""}`}
              aria-pressed={topic === "all"}
              onClick={() => setTopic("all")}
            >
              All topics
            </Button>
            {TOPIC_FILTERS.filter((item) => (topics[item.id] ?? 0) > 0).map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="xs"
                className={`skill-browser__topic${topic === item.id ? " is-active" : ""}`}
                aria-pressed={topic === item.id}
                onClick={() => setTopic(item.id)}
              >
                <span>{item.label}</span>
                <span className="skill-browser__topic-count">{topics[item.id]}</span>
              </Button>
            ))}
          </div>
        </div>
        {/* Rank moved into the leaderboard header (it ranks the leaderboard);
            the eight agent chips collapse into one compact select. */}
        {agents.length > 1 ? (
          <div className="skill-browser__rail-group skill-browser__rail-group--inline" role="group" aria-label="Filter by agent">
            <p className="skill-browser__rail-label">Agent</p>
            <StandardSelect
              label="Filter by agent"
              value={agent}
              onChange={(next) => setAgent(next)}
              className="skill-browser__agent-select"
              options={agents.map((name) => ({
                value: name,
                label: name === "all" ? "All agents" : name,
              }))}
            />
          </div>
        ) : null}
        </nav>
        {!loaded ? (
          <div className="skill-browser__note" role="status">
            Loading skills…
          </div>
        ) : skills.length === 0 ? (
          <EmptyState
            compact
            icon="ph:puzzle-piece"
            headline="No skills yet"
            subtitle="Nothing turned up in your skill roots or the directory."
            actions={
              onCreateSkill ? (
                <Button variant="secondary" size="xs" onClick={onCreateSkill}>
                  Open Capabilities
                </Button>
              ) : undefined
            }
          />
        ) : rankedVisible.length === 0 ? (
          <EmptyState
            compact
            icon="ph:magnifying-glass"
            headline={query.trim() ? `No skills match “${query.trim()}”` : "No skills match these filters"}
            subtitle="Try a different search, topic, or category."
            actions={
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  onClearQuery();
                  setCategory("all");
                  setBrowse("all");
                  setTopic("all");
                  setAgent("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          rankedVisible.map((skill, index) => {
            const key = skillKey(skill);
            const isSel = selected != null && skillKey(selected) === key;
            const score = scoreFor(skill, mode);
            const activity = weeklyActivity(skill);
            return (
              <Button
                key={key}
                variant="ghost"
                aria-pressed={isSel}
                className={`skill-browser__card${isSel ? " is-active" : ""}`}
                onClick={() => setSelectedKey(key)}
              >
                <span className="skill-browser__rank">#{index + 1}</span>
                <span className="skill-browser__card-main">
                  <span className="skill-browser__card-name">{skill.name}</span>
                  <span className="skill-browser__card-slug">{sourceTarget(skill)}</span>
                  {skill.description ? (
                    <span className="skill-browser__card-desc">{skill.description}</span>
                  ) : null}
                </span>
                <span className="skill-browser__row-stats">
                  <span
                    className="skill-browser__activity"
                    aria-label={`8 week activity: ${activity.label}`}
                    title={`8 week activity: ${activity.label}`}
                  >
                    {activity.bars.map((bar, barIndex) => (
                      <i
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed eight-week sparkline slots.
                        key={barIndex}
                        className="skill-browser__activity-bar"
                        style={{ height: `${bar.height}%` }}
                        aria-hidden
                      />
                    ))}
                  </span>
                  <span className="skill-browser__metric">
                    <span>{formatCount(score)}</span>
                    <i style={{ width: `${Math.min(100, Math.max(8, score))}%` }} aria-hidden />
                  </span>
                </span>
              </Button>
            );
          })
        )}
      </div>

      {/* ── Detail pane ──────────────────────────────────────────────── */}
      <div className="skill-browser__detail">
        {selected ? (
          <>
            <div className="skill-browser__detail-head">
              <div className="skill-browser__detail-titlerow">
                <h2 className="skill-browser__detail-name">{selected.name}</h2>
                {selectedHasLocalPath ? (
                  <div className="skill-browser__actions">
                    <IconButton
                      icon="ph:folder-open"
                      size="xs"
                      className="skill-browser__action"
                      onClick={handleReveal}
                      disabled={busy != null}
                      title="Reveal skill folder"
                      aria-label="Reveal skill folder"
                    />
                    <Button
                      variant="danger-ghost"
                      size="xs"
                      leadingIcon="ph:trash"
                      className={`skill-browser__action skill-browser__action--danger${confirmingDelete ? " is-confirming" : ""}`}
                      onClick={handleDelete}
                      disabled={busy != null}
                      title={confirmingDelete ? "Confirm delete" : "Delete skill"}
                      aria-label={confirmingDelete ? "Confirm delete skill" : "Delete skill"}
                    >
                      {confirmingDelete ? <span className="skill-browser__action-label">Delete?</span> : null}
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="skill-browser__decision" aria-label={`${selected.name} install decision summary`}>
                {selectedDecisionItems.map((item) => (
                  <div key={item.label} className="skill-browser__decision-card">
                    <span className="skill-browser__decision-label">
                      <Icon name={item.icon} width={11} aria-hidden />
                      {item.label}
                    </span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              <div className="skill-browser__install">
                {/* The CLI line is itself the copy affordance: click sweeps a
                    green fill across and flips to "Copied" (auto-resets). */}
                <button
                  type="button"
                  className={`skill-browser__cli${copiedInstall ? " is-copied" : ""}`}
                  onClick={handleCopyInstall}
                  title={copiedInstall ? "Copied!" : "Click to copy the install command"}
                  aria-label={copiedInstall ? "Install command copied" : `Copy install command: ${installCommand(selected)}`}
                >
                  <code>{installCommand(selected)}</code>
                  <span className="skill-browser__cli-fill" aria-hidden />
                  <span className="skill-browser__cli-copied" aria-hidden>
                    <Icon name="ph:check-bold" width={12} aria-hidden /> Copied
                  </span>
                </button>
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon="ph:chat-circle-dots"
                  className="skill-browser__use-button"
                  onClick={handleUseSkill}
                  disabled={busy != null}
                  title={useCommand(selected)}
                >
                  <span>{busy === "use" ? "Opening" : "Use"}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  leadingIcon="ph:clipboard-text"
                  className="skill-browser__prompt-button"
                  onClick={handleCopyPrompt}
                  disabled={busy != null}
                  title="Copy generated skill prompt"
                >
                  <span>{busy === "prompt" ? "Copying" : "Copy prompt"}</span>
                </Button>
              </div>
              <p className="skill-browser__detail-path" title={selected.path ?? selected?.source ?? "directory"}>
                {selected.path
                  ? displayPath(selected.path)
                  : sourceTarget(selected)}
              </p>
              <div className="skill-browser__detail-meta">
                <span className="skill-browser__badge">{CATEGORY_LABEL[categoryOf(selected)]}</span>
                {selected.installsAllTime ? (
                  <span className="skill-browser__badge">Installs: {selected.installsAllTime}</span>
                ) : null}
                {selected.trendScore ? <span className="skill-browser__badge">Trend: {selected.trendScore}</span> : null}
                {selected.hotScore ? <span className="skill-browser__badge">Hot: {selected.hotScore}</span> : null}
                {selected.trust?.official ? <span className="skill-browser__badge">Official</span> : null}
                {selected.trust?.audited ? <span className="skill-browser__badge">Audited</span> : null}
                {selected.version ? <span className="skill-browser__badge">v{selected.version}</span> : null}
                {(selected.tags ?? []).slice(0, 6).map((t) => (
                  <span key={t} className="skill-browser__tag">
                    {t}
                  </span>
                ))}
              </div>
              <div className="skill-browser__links">
                {selected.sourceUrl ? (
                  <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                ) : null}
                {selected.registryUrl ? (
                  <a href={selected.registryUrl} target="_blank" rel="noreferrer">
                    Registry
                  </a>
                ) : null}
                {(selected.agents ?? []).slice(0, 8).map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
              {selectedSourceSummary.count > 1 ? (
                <div className="skill-browser__source-group">
                  <div className="skill-browser__source-group-head">
                    <span>More from {selectedSource}</span>
                    <span>
                      {selectedSourceSummary.count} skills · {formatCount(selectedSourceSummary.installs)} installs
                    </span>
                  </div>
                  {relatedSourceSkills.length > 0 ? (
                    <div className="skill-browser__source-list">
                      {relatedSourceSkills.map((skill) => (
                        <Button
                          key={skillKey(skill)}
                          variant="ghost"
                          size="xs"
                          className="skill-browser__source-skill"
                          onClick={() => setSelectedKey(skillKey(skill))}
                        >
                          <span>{skill.name}</span>
                          <span>{formatCount(scoreFor(skill, mode))}</span>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <p className="skill-browser__notice" role="status">
                  {notice}
                </p>
              ) : null}
            </div>
            <div className="skill-browser__detail-body">
              {preview.status === "loading" ? (
                <div className="skill-browser__skeleton" aria-hidden>
                  {["90%", "96%", "70%", "88%", "60%"].map((w, i) => (
                    <span key={i} style={{ width: w }} />
                  ))}
                </div>
              ) : preview.status === "loaded" && body ? (
                <MarkdownBlock text={body} className="cave-md--expanded" />
              ) : (
                // 403 (path outside allow-listed roots), empty file, or error —
                // show the scanned description so the pane is never blank. For
                // a local skill whose file SHOULD be readable, say the read
                // failed instead of passing it off as "no preview".
                <p className="skill-browser__fallback">
                  {preview.status === "error" && selectedPath
                    ? `Couldn’t read this skill’s SKILL.md.${selected.description ? ` ${selected.description}` : ""}`
                    : selected.description || "No preview available for this skill."}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="skill-browser__detail-empty">Select a skill to view its details.</div>
        )}
      </div>
    </div>
  );
}
