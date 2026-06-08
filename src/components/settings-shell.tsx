"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type DaemonStatus = {
  running: boolean;
  covenVersion?: string;
  apiVersion?: string;
  workspacePath?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

type Section = "general" | "daemon" | "familiars" | "addons" | "appearance" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general",    label: "General",    icon: "ph:sliders-horizontal" },
  { id: "daemon",     label: "Daemon",     icon: "ph:terminal-window" },
  { id: "familiars",  label: "Familiars",  icon: "ph:users-three" },
  { id: "addons",     label: "Add-ons",    icon: "ph:puzzle-piece" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush" },
  { id: "about",      label: "About",      icon: "ph:info" },
];

// ─── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("general");

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-left" width={13} />
          Back
        </button>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Settings</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="w-[200px] shrink-0 border-r border-[var(--border-hairline)] py-3">
          <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Settings
          </p>
          <div className="space-y-px px-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] text-left text-[12px] transition-colors ${
                  section === s.id
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                }`}
              >
                <Icon
                  name={s.icon as Parameters<typeof Icon>[0]["name"]}
                  width={13}
                  className={section === s.id ? "text-white/70" : "text-[var(--text-muted)]"}
                />
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {section === "general" && <GeneralSection />}
          {section === "daemon"   && <DaemonSection />}
          {section === "familiars" && <FamiliarsSection />}
          {section === "addons"   && <AddonsSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "about"    && <AboutSection />}
        </main>
      </div>
    </div>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection() {
  return (
    <SettingsPage title="General" description="App-wide preferences.">
      <SettingsGroup label="Workspace">
        <SettingsRow label="Workspace path" description="Where Coven stores familiar workspaces.">
          <WorkspacePathField />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup label="Startup">
        <SettingsRow label="Launch at login" description="Start CovenCave when you log in." comingSoon />
        <SettingsRow label="Open to" description="Which view to show on launch." comingSoon />
      </SettingsGroup>
    </SettingsPage>
  );
}

function WorkspacePathField() {
  const [path, setPath] = useState("");
  useEffect(() => {
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { workspacePath?: string }) => { if (j.workspacePath) setPath(j.workspacePath); })
      .catch(() => {});
  }, []);
  return (
    <input
      value={path}
      readOnly
      className="w-full max-w-sm rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none"
    />
  );
}

// ─── Section: Daemon ──────────────────────────────────────────────────────────

function DaemonSection() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaemonStatus) => { setStatus(j); setLoading(false); })
      .catch(() => { setStatus({ running: false }); setLoading(false); });
  };

  useEffect(refresh, []);

  const startDaemon = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      refresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "daemon did not start");
    } finally {
      setStarting(false);
    }
  };

  return (
    <SettingsPage title="Daemon" description="The coven daemon manages familiar sessions and the workspace.">
      <SettingsGroup label="Status">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            loading ? "animate-pulse bg-[var(--text-muted)]"
            : status?.running ? "bg-[var(--color-success)]"
            : "bg-red-400"
          }`} />
          <span className="text-[13px] font-medium">
            {loading ? "Checking…" : status?.running ? "Running" : "Offline"}
          </span>
          {status?.running && status.daemon && (
            <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
              pid {status.daemon.pid}
            </span>
          )}
          {!loading && !status?.running && (
            <button
              type="button"
              onClick={startDaemon}
              disabled={starting}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              title="coven daemon start"
            >
              <Icon name="ph:rocket-launch-bold" width={12} />
              {starting ? "Starting..." : "Start daemon"}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className={`${status?.running ? "ml-auto" : ""} flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]`}
          >
            <Icon name="ph:arrow-clockwise" width={11} />
            Refresh
          </button>
          {startError && <p className="basis-full text-[11px] text-[var(--color-danger)]">{startError}</p>}
        </div>
      </SettingsGroup>

      {status?.running && (
        <SettingsGroup label="Info">
          <SettingsKV label="Coven version" value={status.covenVersion ?? "—"} />
          <SettingsKV label="API version"   value={status.apiVersion   ?? "—"} />
          <SettingsKV label="Socket"        value={status.daemon?.socket ?? "—"} mono />
          <SettingsKV label="Started"       value={status.daemon?.startedAt ? new Date(status.daemon.startedAt).toLocaleString() : "—"} />
          <SettingsKV label="Workspace"     value={status.workspacePath ?? "—"} mono />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

// ─── Section: Add-ons ─────────────────────────────────────────────────────────────

type AddonKey = "github" | "library";

const ADDON_ROWS: Array<{
  key: AddonKey;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    key: "github",
    label: "GitHub",
    icon: "ph:github-logo",
    description: "Browse open issues and pull requests, attach them to tasks, and hand off to a familiar.",
  },
  {
    key: "library",
    label: "Library",
    icon: "ph:books",
    description: "Save links, notes, and references for your familiars to draw from.",
  },
];

function AddonsSection() {
  const [addons, setAddons] = useState<Record<AddonKey, boolean>>({
    github: false,
    library: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; config?: { addons?: { github?: boolean; library?: boolean } } }) => {
        if (j.ok && j.config?.addons) {
          setAddons({
            github: j.config.addons.github ?? false,
            library: j.config.addons.library ?? false,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (key: AddonKey) => {
    const newValue = !addons[key];
    // Optimistic update
    setAddons((prev) => ({ ...prev, [key]: newValue }));
    try {
      await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addons: { [key]: newValue } }),
      });
    } catch {
      // Revert on failure
      setAddons((prev) => ({ ...prev, [key]: !newValue }));
    }
  };

  return (
    <SettingsPage title="Add-ons" description="Optional integrations. Disabled add-ons are hidden from the sidebar.">
      <SettingsGroup label="Integrations">
        {loading ? (
          <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">Loading…</div>
        ) : (
          ADDON_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Icon
                  name={row.icon as Parameters<typeof Icon>[0]["name"]}
                  width={18}
                  className="shrink-0 text-[var(--text-muted)]"
                />
                <div className="min-w-0">
                  <p className="text-[13px] text-[var(--text-primary)]">{row.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{row.description}</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={addons[row.key]}
                onClick={() => void toggle(row.key)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 focus:outline-none ${
                  addons[row.key]
                    ? "bg-[var(--accent-presence)]"
                    : "bg-[var(--bg-elevated)]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
                    addons[row.key] ? "translate-x-4" : "translate-x-0.5"
                  } mt-0.5`}
                />
              </button>
            </div>
          ))
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: Familiars ───────────────────────────────────────────────────────

function FamiliarsSection() {
  return (
    <SettingsPage title="Familiars" description="Configure which familiars are visible and their defaults.">
      <SettingsGroup label="Familiars">
        <p className="text-[12px] text-[var(--text-muted)]">
          Familiar configuration lives in the daemon workspace. Edit familiar TOML files directly for now — a UI is coming.
        </p>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Theme helpers ───────────────────────────────────────────────────────────────────────

type PresetTheme = "mood-c" | "midnight" | "orchid" | "sky";
type ActiveTheme = PresetTheme | "custom";

interface CustomThemeData {
  name: string;
  cssVars: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
}

function clearCustomCssVars(html: HTMLElement) {
  const style = html.getAttribute("style") ?? "";
  const cleaned = style.replace(/--[\w-]+\s*:[^;]+;?/g, "").trim();
  if (cleaned) html.setAttribute("style", cleaned);
  else html.removeAttribute("style");
}

function applyPreset(theme: PresetTheme) {
  const html = document.documentElement;
  clearCustomCssVars(html);

  if (theme === "mood-c") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", theme);
  }
  localStorage.setItem("coven-theme", theme);
}

function applyCustomVars(cssVars: CustomThemeData["cssVars"]) {
  const html = document.documentElement;
  html.removeAttribute("data-theme");
  clearCustomCssVars(html);

  const apply = (group?: Record<string, string>) => {
    if (!group) return;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value !== "string" || !name) continue;
      // tweakcn returns bare names ("background", "font-sans"); shadcn schema
      // does not prefix with --. We prefix here when needed.
      const cssName = name.startsWith("--") ? name : `--${name}`;
      html.style.setProperty(cssName, value);
    }
  };
  // theme: mode-agnostic vars (fonts, radius, shadows, tracking).
  // dark: mode-specific colors (the app runs dark-only).
  apply(cssVars.theme);
  apply(cssVars.dark);
}

function clearCustomTheme() {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  localStorage.removeItem("coven-custom-theme");
  localStorage.setItem("coven-theme", "mood-c");
}

// ─── Preset cards ─────────────────────────────────────────────────────────────────────────────

interface ThemePreset {
  id: PresetTheme;
  label: string;
  description: string;
  swatches: { bg: string; accent: string; border: string };
}

const PRESETS: ThemePreset[] = [
  {
    id: "mood-c",
    label: "Mood C",
    description: "Arcane field manual — dark violet glass",
    swatches: { bg: "oklch(0.16 0.022 293)", accent: "#9a8ecd", border: "oklch(1 0 0 / 6%)" },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep black, near-zero chroma, minimal",
    swatches: { bg: "oklch(0.10 0.004 293)", accent: "#7B73BD", border: "oklch(1 0 0 / 5%)" },
  },
  {
    id: "orchid",
    label: "Orchid",
    description: "Warm violet, lighter surface",
    swatches: { bg: "oklch(0.13 0.030 293)", accent: "#D26BFF", border: "oklch(1 0 0 / 7%)" },
  },
  {
    id: "sky",
    label: "Sky",
    description: "Cool slate-blue night, daybreak accent",
    swatches: { bg: "oklch(0.15 0.028 245)", accent: "#6DA9FF", border: "oklch(1 0 0 / 7%)" },
  },
];

function ThemePresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: ThemePreset;
  active: boolean;
  onSelect: (id: PresetTheme) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-pressed={active}
      className={`relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)] ring-1 ring-[var(--accent-presence)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-base)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
      }`}
    >
      {/* Swatch row */}
      <div className="flex items-center gap-1.5">
        <span
          className="h-5 w-5 rounded-full border border-white/10"
          style={{ background: preset.swatches.bg }}
          title="Background"
        />
        <span
          className="h-5 w-5 rounded-full"
          style={{ background: preset.swatches.accent }}
          title="Accent"
        />
        <span
          className="h-5 w-5 rounded-full border-2"
          style={{ background: preset.swatches.bg, borderColor: preset.swatches.accent + "40" }}
          title="Border"
        />
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{preset.label}</p>
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">{preset.description}</p>
      </div>

      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-presence)] text-white">
          <Icon name="ph:check-bold" width={11} />
        </span>
      )}
    </button>
  );
}

// ─── Section: Appearance ───────────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const [activeTheme, setActiveTheme] = useState<ActiveTheme>("mood-c");
  const [customData, setCustomData] = useState<CustomThemeData | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Read persisted theme on mount
  useEffect(() => {
    const saved = localStorage.getItem("coven-theme") as ActiveTheme | null;
    if (saved) setActiveTheme(saved);
    if (saved === "custom") {
      const raw = localStorage.getItem("coven-custom-theme");
      if (raw) {
        try {
          setCustomData(JSON.parse(raw) as CustomThemeData);
        } catch {
          // malformed — ignore
        }
      }
    }
  }, []);

  const handleSelectPreset = (id: PresetTheme) => {
    setActiveTheme(id);
    setCustomData(null);
    applyPreset(id);
  };

  const handleResetCustom = () => {
    clearCustomTheme();
    setActiveTheme("mood-c");
    setCustomData(null);
  };

  function normalizeTweakcnUrl(raw: string): string | null {
    try {
      const url = new URL(raw.trim());
      const hostname = url.hostname.toLowerCase();
      if (!(hostname === "tweakcn.com" || hostname.endsWith(".tweakcn.com")))
        return null;
      if (url.pathname.startsWith("/r/themes/")) {
        const themeId = url.pathname.replace("/r/themes/", "").split("/")[0];
        if (themeId)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeId)}`;
      }
      if (url.pathname.startsWith("/themes/")) {
        const themeId = url.pathname.replace("/themes/", "").split("/")[0];
        if (themeId)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeId)}`;
      }
      if (url.pathname.startsWith("/editor/theme")) {
        const themeName = url.searchParams.get("theme")?.trim();
        if (themeName)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeName)}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  const handleImport = async () => {
    setImportError(null);
    const canonical = normalizeTweakcnUrl(importUrl);
    if (!canonical) {
      setImportError(
        "Invalid tweakcn URL. Expected https://tweakcn.com/themes/{id}, /r/themes/{id}, or /editor/theme?theme={name}.",
      );
      return;
    }

    setImporting(true);
    try {
      const res = await fetch(canonical);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

      // biome-ignore lint/suspicious/noExplicitAny: tweakcn response shape
      const json = (await res.json()) as any;
      const cssVars = json?.cssVars;
      const hasTheme = cssVars?.theme && typeof cssVars.theme === "object";
      const hasDark = cssVars?.dark && typeof cssVars.dark === "object";
      const hasLight = cssVars?.light && typeof cssVars.light === "object";
      if (!cssVars || (!hasTheme && !hasDark && !hasLight)) {
        throw new Error("Response missing cssVars — not a valid tweakcn theme JSON.");
      }

      const data: CustomThemeData = {
        name: (json.name as string) || canonical.split("/").pop() || "custom",
        cssVars: cssVars as CustomThemeData["cssVars"],
      };

      applyCustomVars(data.cssVars);
      localStorage.setItem("coven-custom-theme", JSON.stringify(data));
      localStorage.setItem("coven-theme", "custom");
      setCustomData(data);
      setActiveTheme("custom");
      setImportUrl("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsPage title="Appearance" description="Colors and visual style.">
      {/* ── Preset themes ── */}
      <SettingsGroup label="Theme">
        {/* Custom theme chip */}
        {activeTheme === "custom" && customData && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-hairline)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-3 py-0.5 text-[11px] font-medium text-[var(--accent-presence)]">
              <Icon name="ph:sparkle" width={11} />
              Custom: {customData.name}
              <button
                type="button"
                onClick={handleResetCustom}
                className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-70 hover:opacity-100"
                aria-label="Reset to Mood C"
              >
                <Icon name="ph:x-bold" width={9} />
              </button>
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Active — presets below will override.
            </span>
          </div>
        )}

        {/* Preset grid */}
        <div className="grid grid-cols-3 gap-3 p-4">
          {PRESETS.map((p) => (
            <ThemePresetCard
              key={p.id}
              preset={p}
              active={activeTheme === p.id}
              onSelect={handleSelectPreset}
            />
          ))}
        </div>
      </SettingsGroup>

      {/* ── tweakcn import ── */}
      <SettingsGroup label="Import from tweakcn">
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[12px] text-[var(--text-muted)]">
            Paste a tweakcn URL to apply a community theme. Supports{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[11px]">
              /themes/&#123;id&#125;
            </code>
            ,{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[11px]">
              /r/themes/&#123;id&#125;
            </code>
            , and{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[11px]">
              /editor/theme?theme=&#123;name&#125;
            </code>
            .
          </p>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => {
                setImportUrl(e.target.value);
                setImportError(null);
              }}
              placeholder="https://tweakcn.com/r/themes/amethyst-haze"
              className="flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleImport();
              }}
            />
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing || !importUrl.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <Icon name="ph:arrows-clockwise-bold" width={12} className="animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Icon name="ph:arrow-down-bold" width={12} />
                  Import
                </>
              )}
            </button>
          </div>
          {importError && (
            <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-danger)]">
              <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0" />
              {importError}
            </p>
          )}
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
// ─── Section: About ───────────────────────────────────────────────────────────

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaemonStatus) => { if (j.covenVersion) setVersion(j.covenVersion); })
      .catch(() => {});
  }, []);

  return (
    <SettingsPage title="About" description="Version and build information.">
      <SettingsGroup label="CovenCave">
        <SettingsKV label="App version" value="0.0.46" />
        <SettingsKV label="Daemon version" value={version ?? "—"} />
        <SettingsKV label="Built with" value="Next.js · React · Tauri · Tailwind" />
      </SettingsGroup>
      <SettingsGroup label="Links">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "GitHub", href: "https://github.com/OpenCoven/coven-cave" },
            { label: "Docs",   href: "https://docs.openclaw.ai" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-square-out" width={12} />
              {l.label}
            </a>
          ))}
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SettingsPage({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</h1>
        {description && <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
      <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({ label, description, comingSoon, children }: { label: string; description?: string; comingSoon?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] text-[var(--text-primary)]">{label}</p>
        {description && <p className="text-[11px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">Soon</span>
      ) : children}
    </div>
  );
}

function SettingsKV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className={`text-right text-[12px] text-[var(--text-muted)] ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
