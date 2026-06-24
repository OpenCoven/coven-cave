"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";
import { SettingsGroup } from "@/components/ui/settings-group";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FamiliarStudioInlinePanel } from "@/components/familiar-studio-inline";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarPinOrder } from "@/components/familiar-pin-order";
import { DEMO_FAMILIARS } from "@/lib/demo-seed";
import type { Familiar } from "@/lib/types";
import { OpenCovenToolsUpdate } from "@/components/open-coven-tools-update";
import { THEME_IDS, THEME_META, getSwatches, type ThemeId } from "@/lib/theme-palettes";
import { COVEN_THEME_KEY, COVEN_MODE_KEY, COVEN_CUSTOM_THEME_KEY, LEGACY_THEME_RENAME, type Mode, type ModePref } from "@/lib/theme-storage";
import { ModeToggle } from "@/components/mode-toggle";
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { APP_VERSION } from "@/lib/app-version";
import { UpdateSettingsRow } from "@/components/update-available";
import { useIsMobile } from "@/lib/use-viewport";
import { ThemeColorEditor } from "@/components/theme-color-editor";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";
import { FontSettings } from "./settings-fonts";
import {
  CORNER_RADIUS_OPTIONS,
  CORNER_RADIUS_LABELS,
  applyCornerRadius,
  readCornerRadius,
  type CornerRadius,
} from "@/lib/appearance-corner-radius";
import {
  FAMILIAR_SWITCHER_STYLE_OPTIONS,
  FAMILIAR_SWITCHER_STYLE_LABELS,
  setFamiliarSwitcherStyle,
  useFamiliarSwitcherStyle,
} from "@/lib/familiar-switcher-style";
import {
  FAMILIAR_STRIP_SCOPE_OPTIONS,
  FAMILIAR_STRIP_SCOPE_LABELS,
  setFamiliarStripScope,
  useFamiliarStripScope,
} from "@/lib/familiar-strip-scope";
import {
  DEMO_MODE_EVENT,
  clearDemoModeData,
  demoModeFetchHeaders,
  isDemoModeEnabled,
  setDemoModeEnabled,
} from "@/lib/demo-mode";
import { readableTextColor } from "@/lib/readable-text-color";

// ─── Types ────────────────────────────────────────────────────────────────────

type DaemonStatus = {
  running: boolean;
  covenVersion?: string;
  apiVersion?: string;
  workspacePath?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

type Section = "general" | "daemon" | "familiars" | "addons" | "mobile" | "appearance" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general",    label: "General",    icon: "ph:sliders-horizontal" },
  { id: "daemon",     label: "Daemon",     icon: "ph:terminal-window" },
  { id: "familiars",  label: "Familiars",  icon: "ph:users-three" },
  { id: "addons",     label: "Add-ons",    icon: "ph:puzzle-piece" },
  { id: "mobile",     label: "Phone",      icon: "ph:device-mobile" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush" },
  { id: "about",      label: "About",      icon: "ph:info" },
];

// ─── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [section, setSection] = useState<Section>("general");
  // Mobile drill-down: when true, render the section list full-screen
  // (no section content) — iOS-Settings-style. Tap a section → false,
  // render that section. Hash-deep-link (`/settings#familiars`) skips the
  // picker so the user lands directly on the target.
  const [pickerView, setPickerView] = useState(false);
  const activeSection = SECTIONS.find((s) => s.id === section);
  const showPicker = isMobile && pickerView;

  function openSection(id: Section) {
    setSection(id);
    setPickerView(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }
  function backToPicker() {
    setPickerView(true);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  // Support hash-based deep-linking, e.g. /settings#familiars. Read it after
  // hydration so SSR and the first client render both start on General.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as Section;
    if (SECTIONS.some((s) => s.id === hash)) {
      setSection(hash);
      setPickerView(false);
      return;
    }
    setPickerView(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        e.preventDefault();
        router.back();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = SECTIONS.findIndex((s) => s.id === section);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = (idx + delta + SECTIONS.length) % SECTIONS.length;
        setSection(SECTIONS[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, section]);

  return (
    <FamiliarStudioProvider>
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header. On mobile the back button has two roles: from a section
          page it drops back to the picker; from the picker it pops the
          route. Desktop always pops the route. */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-2.5"
        style={{ paddingTop: "calc(0.625rem + var(--sai-top))" }}
      >
        <button
          type="button"
          onClick={() => {
            if (isMobile && !pickerView) backToPicker();
            else router.back();
          }}
          className="settings-back-button focus-ring flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-left" width={13} />
          {isMobile && !pickerView ? "Settings" : "Back"}
        </button>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          {isMobile && !pickerView ? (activeSection?.label ?? "Settings") : "Settings"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Sidebar / picker. On desktop this is a 200px rail next to
            content. On mobile it expands full-screen when in picker
            view (iOS-Settings drill-down). Once a section is picked the
            picker hides and the content fills the screen. */}
        <nav
          className={`shrink-0 py-3 md:w-[200px] md:border-r md:border-[var(--border-hairline)] ${
            showPicker ? "flex-1 w-full" : isMobile ? "hidden" : "w-[200px]"
          }`}
        >
          <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Settings
          </p>
          <div className={`space-y-px ${showPicker ? "px-3" : "px-2"}`}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSection(s.id)}
                aria-current={section === s.id && !showPicker ? "page" : undefined}
                className={`focus-ring flex w-full items-center rounded-[5px] px-2.5 text-left transition-colors ${
                  showPicker
                    ? "min-h-[var(--touch-target)] gap-3 py-3 text-[14px]"
                    : "gap-2 py-[6px] text-[12px]"
                } ${
                  section === s.id && !showPicker
                    ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                    : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                }`}
              >
                <Icon
                  name={s.icon as Parameters<typeof Icon>[0]["name"]}
                  width={showPicker ? 18 : 13}
                  className={section === s.id && !showPicker ? "text-[var(--accent-presence-foreground)] opacity-70" : "text-[var(--text-muted)]"}
                />
                <span className="flex-1">{s.label}</span>
                {showPicker ? (
                  <Icon name="ph:caret-right" width={14} className="text-[var(--text-muted)]" />
                ) : null}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main
          className={`min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 ${
            showPicker ? "hidden md:block" : ""
          }`}
          style={{ paddingBottom: "calc(1.5rem + var(--sai-bottom))" }}
        >
          {section === "general" && <GeneralSection />}
          {section === "daemon"   && <DaemonSection />}
          {section === "familiars" && <FamiliarsSection />}
          {section === "addons"   && <AddonsSection />}
          {section === "mobile"   && <MobileSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "about"    && <AboutSection />}
        </main>
      </div>
      <footer className="shrink-0 border-t border-[var(--border-hairline)] px-4 py-1.5 text-center text-[10px] text-[var(--text-muted)]">
        Esc back · ↑↓ navigate sections
      </footer>
    </div>
    </FamiliarStudioProvider>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection() {
  // Start from the SSR-safe default (false) so the first client render matches the
  // server's; read the real localStorage value after mount to avoid an aria-pressed
  // hydration mismatch on the Demo mode toggle.
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    const sync = () => setDemoMode(isDemoModeEnabled());
    sync();
    window.addEventListener(DEMO_MODE_EVENT, sync);
    return () => window.removeEventListener(DEMO_MODE_EVENT, sync);
  }, []);

  const updateDemoMode = (enabled: boolean) => {
    setDemoModeEnabled(enabled);
    setDemoMode(enabled);
  };

  const resetDemoMode = () => {
    clearDemoModeData();
    setDemoMode(false);
  };

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
        <SettingsRow
          label="Demo mode"
          description="Use local sample familiars, board cards, and inbox items for screenshots."
        >
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => updateDemoMode(!demoMode)}
              aria-pressed={demoMode}
              className={`focus-ring rounded-md border px-3 py-1.5 text-[12px] font-medium ${
                demoMode
                  ? "border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_18%,transparent)] text-[var(--accent-presence)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              }`}
            >
              {demoMode ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={resetDemoMode}
              className="focus-ring rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              Clear demo
            </button>
          </div>
        </SettingsRow>
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
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-3">
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
              className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent-presence-foreground)] hover:opacity-90 disabled:opacity-60"
              title="coven daemon start"
            >
              <Icon name="ph:rocket-launch-bold" width={12} />
              {starting ? "Starting..." : "Start daemon"}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className={`focus-ring ${status?.running ? "ml-auto" : ""} flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]`}
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
          <SettingsKV label="Started"       value={<RelativeTime iso={status.daemon?.startedAt} fallback="—" />} />
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
  const [toggleError, setToggleError] = useState<string | null>(null);

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
    setToggleError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addons: { [key]: newValue } }),
      });
      // fetch only throws on network errors — a 4xx/5xx still "succeeds", so a
      // failed save would otherwise leave the toggle stuck in the wrong state.
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    } catch {
      // Revert + surface the failure instead of silently flipping back.
      setAddons((prev) => ({ ...prev, [key]: !newValue }));
      setToggleError("Couldn't save that change — check the daemon and try again.");
    }
  };

  return (
    <SettingsPage title="Add-ons" description="Optional integrations. Disabled add-ons are hidden from the sidebar.">
      {toggleError && (
        <p role="alert" className="mb-2 px-1 text-[12px] text-[var(--color-danger)]">{toggleError}</p>
      )}
      <SettingsGroup label="Integrations">
        {loading ? (
          <div aria-hidden className="animate-pulse space-y-3 px-4 py-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <span className="h-3 w-1/3 rounded bg-[var(--bg-hover)]" />
                <span className="h-5 w-9 rounded-full bg-[var(--bg-hover)] opacity-70" />
              </div>
            ))}
          </div>
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
                className={`focus-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
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
  // Settings is a standalone route with no workspace context, so this panel
  // sources its own familiar roster and resolves cave overrides locally.
  const [rawFamiliars, setRawFamiliars] = useState<Familiar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const familiars = useResolvedFamiliars(rawFamiliars);

  useEffect(() => {
    let cancelled = false;
    const loadFamiliars = async () => {
      try {
        const res = await fetch("/api/familiars", {
          cache: "no-store",
          headers: demoModeFetchHeaders(),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setRawFamiliars((json.familiars ?? []) as Familiar[]);
        } else if (isDemoModeEnabled()) {
          // Daemon offline but demo mode on (the toggle lives on this page) —
          // show sample familiars so the panel is never blank in demo.
          setRawFamiliars(DEMO_FAMILIARS);
        }
      } catch {
        /* transient — keep last good list */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void loadFamiliars();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hold the panel until the first fetch settles so the "No familiars
  // configured" empty state never flashes before the roster loads.
  if (!loaded) {
    return (
      <div className="settings-familiars-panel" role="status" aria-busy="true">
        <SkeletonRows count={4} />
      </div>
    );
  }

  return (
    <FamiliarStudioInlinePanel
      familiars={rawFamiliars}
      resolved={familiars}
    />
  );
}

// ─── Theme helpers ───────────────────────────────────────────────────────────────────────

type PresetTheme = ThemeId;
type ActiveTheme = PresetTheme | "custom";

const THEME_OWNED_APPEARANCE_KEYS = [
  "cave:font:sans",
  "cave:font:mono",
  "cave:corner-radius",
  "cave:reading-leading",
  "cave:reading-tracking",
  "cave:reading-weight",
] as const;

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
  for (const key of THEME_OWNED_APPEARANCE_KEYS) {
    localStorage.removeItem(key);
  }
  html.setAttribute("data-theme", theme);
  localStorage.setItem(COVEN_THEME_KEY, theme);
}

function resolveMode(pref: ModePref): Mode {
  if (pref === "light" || pref === "dark") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyMode(pref: ModePref) {
  const html = document.documentElement;
  html.setAttribute("data-mode", resolveMode(pref));
  localStorage.setItem(COVEN_MODE_KEY, pref);
}

// Color tokens mirrored to the daemon so other clients (e.g. the iOS app over
// Tailscale) can match the desktop theme via GET /api/theme.
const THEME_SYNC_KEYS = [
  "--bg-base", "--bg-raised", "--bg-elevated",
  "--text-primary", "--text-secondary", "--text-muted",
  "--border-hairline", "--accent-presence",
] as const;

/**
 * Resolve any CSS colour string to plain sRGB hex by *rasterising* it: paint the
 * colour onto a 1×1 canvas and read the pixel back. `getComputedStyle` hands
 * back a custom property's *authored* value (`lab(...)`, `oklch(...)`,
 * `color-mix(...)`), which a hex-only client (iOS `Color(hex:)`) can't read.
 *
 * NB: reading `ctx.fillStyle` back does NOT down-convert — modern engines keep
 * `lab()`/`oklch()` there (CSS Color 4). Painting forces conversion into the
 * canvas's sRGB backing store, so `getImageData` yields real sRGB bytes. Falls
 * back to the raw value if the context is unavailable or the read throws, so a
 * token is never made worse than it is today.
 */
function resolveTokenToHex(ctx: CanvasRenderingContext2D | null, raw: string): string {
  if (!ctx) return raw;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return rgbaBytesToHex(r, g, b, a);
  } catch {
    return raw;
  }
}

/** Read the active theme's 8 synced tokens, resolved to hex. */
function resolveSyncTokens(): Record<string, string> {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tokens: Record<string, string> = {};
  for (const key of THEME_SYNC_KEYS) {
    const value = cs.getPropertyValue(key).trim();
    if (value) tokens[key] = resolveTokenToHex(ctx, value);
  }
  return tokens;
}

/** Push the active theme + resolved tokens to the daemon for cross-device sync.
 *  Returns whether the write reached the daemon (the manual Resync button shows
 *  the result; the automatic on-change call ignores it). */
async function persistThemeTokens(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const html = document.documentElement;
    const res = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        themeId: html.getAttribute("data-theme") ?? "coven",
        mode: html.getAttribute("data-mode") ?? "dark",
        tokens: resolveSyncTokens(),
      }),
    });
    return res.ok;
  } catch {
    return false; // best-effort sync; never block the UI
  }
}

function applyCustomVars(cssVars: CustomThemeData["cssVars"], mode: Mode) {
  const html = document.documentElement;
  html.setAttribute("data-theme", "custom");
  clearCustomCssVars(html);

  const apply = (group?: Record<string, string>) => {
    if (!group) return;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value !== "string" || !name) continue;
      const cssName = name.startsWith("--") ? name : `--${name}`;
      html.style.setProperty(cssName, value);
    }
  };
  // theme: mode-agnostic vars (fonts, radius, shadows, tracking).
  // light/dark: mode-specific colors. Fall back to the opposite group
  // when the import only ships one mode.
  apply(cssVars.theme);
  const modeGroup =
    (mode === "light" ? cssVars.light : cssVars.dark) ??
    (mode === "light" ? cssVars.dark : cssVars.light);
  apply(modeGroup);
}

/**
 * Translate a tweakcn (shadcn) mode group into the Cave's richer semantic
 * vocabulary.
 *
 * tweakcn ships only shadcn's base tokens — `background`, `foreground`,
 * `primary`, `card`, `popover`, `border`, … The Cave UI, however, is driven
 * mostly by Issue #14 surface/accent tokens. Some of those alias from the base
 * in globals.css and so update for free (`--bg-base: var(--background)`,
 * `--bg-raised: var(--card)`, `--border-hairline: var(--border)`,
 * `--text-primary: var(--foreground)`, `--text-secondary: var(--muted-foreground)`).
 * But the most visible ones are HARDCODED per theme and do NOT alias from the
 * base, so a raw tweakcn import never touches them:
 *   --accent-presence  → every button, focus ring, active state, scrollbar,
 *                        --brand, --ring-focus and --color-info derive from it
 *   --bg-panel         → app shell / sidebar floor
 *   --bg-elevated      → dropdowns / popovers
 *   --bg-hover         → hover state
 *   --border-strong    → emphasised borders
 * Derive those here so an imported theme recolors the whole app, not just the
 * canvas and body text. Mix direction is mode-aware: in dark mode the panel
 * floor sits darker than the canvas and hovers lift lighter; light mode is the
 * inverse.
 */
function tweakcnSemanticVars(
  group: Record<string, string>,
  modeName: Mode,
): Record<string, string> {
  const pick = (key: string) => group[key] ?? group[`--${key}`];
  const accent = pick("primary") || pick("ring") || pick("accent");
  const bg = pick("background");
  const card = pick("card");
  const popover = pick("popover");
  const border = pick("border");
  // Panel = deepest floor (darker in dark mode, lighter in light mode).
  // Hover = lifted surface (lighter in dark mode, darker in light mode).
  const deepen = modeName === "light" ? "white" : "black";
  const lift = modeName === "light" ? "black" : "white";

  const out: Record<string, string> = {};
  if (accent) {
    out["--accent-presence"] = accent;
    out["--accent-presence-foreground"] =
      pick("primary-foreground") || pick("accent-foreground") || readableTextColor(accent);
    out["--accent-presence-soft"] = `color-mix(in oklch, ${accent} 78%, transparent)`;
    out["--accent-faint"] = `color-mix(in oklch, ${accent} 14%, transparent)`;
  }
  if (bg) {
    out["--bg-panel"] = `color-mix(in oklch, ${bg} 92%, ${deepen})`;
    out["--bg-hover"] = `color-mix(in oklch, ${bg} 84%, ${lift})`;
  }
  const elevated = popover || card;
  if (elevated) out["--bg-elevated"] = elevated;
  if (border) {
    out["--border-strong"] = accent
      ? `color-mix(in oklch, ${border} 62%, ${accent} 38%)`
      : border;
  }
  return out;
}

/**
 * Enrich an imported tweakcn theme with the derived Cave semantic tokens
 * (see tweakcnSemanticVars). The extra tokens are baked into each mode group so
 * BOTH the live apply path (applyCustomVars) and the flash-free boot script
 * (theme-script.tsx) replay identical data with no further logic. Raw tweakcn
 * keys are preserved (and win on the unlikely collision) by spreading last.
 */
function enrichTweakcnTheme(data: CustomThemeData): CustomThemeData {
  const enrich = (group: Record<string, string> | undefined, modeName: Mode) =>
    group ? { ...tweakcnSemanticVars(group, modeName), ...group } : group;
  const { theme, light, dark } = data.cssVars;
  return {
    name: data.name,
    cssVars: {
      ...(theme ? { theme } : {}),
      ...(light ? { light: enrich(light, "light") } : {}),
      ...(dark ? { dark: enrich(dark, "dark") } : {}),
    },
  };
}

function clearCustomTheme() {
  document.documentElement.setAttribute("data-theme", "coven");
  document.documentElement.removeAttribute("style");
  localStorage.removeItem(COVEN_CUSTOM_THEME_KEY);
  localStorage.setItem(COVEN_THEME_KEY, "coven");
}

function readPersistedTheme(): ActiveTheme {
  const raw = localStorage.getItem(COVEN_THEME_KEY);
  if (!raw) return "coven";
  if (LEGACY_THEME_RENAME[raw]) return LEGACY_THEME_RENAME[raw] as ActiveTheme;
  if (raw === "custom") return "custom";
  if ((THEME_IDS as readonly string[]).includes(raw)) return raw as ActiveTheme;
  return "coven";
}

function readPersistedMode(): ModePref {
  const raw = localStorage.getItem(COVEN_MODE_KEY);
  return raw === "light" ? "light" : raw === "system" ? "system" : "dark";
}

// ─── Preset cards ─────────────────────────────────────────────────────────────────────────────

interface ThemePresetEntry {
  id: ThemeId;
  label: string;
  description: string;
}

const PRESETS: ThemePresetEntry[] = THEME_IDS.map((id) => ({
  id,
  label: THEME_META[id].name,
  description: THEME_META[id].description,
}));

function ThemePresetCard({
  preset,
  mode,
  active,
  onSelect,
}: {
  preset: ThemePresetEntry;
  mode: Mode;
  active: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const swatches = getSwatches(preset.id, mode);
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-pressed={active}
      className={`focus-ring relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)] ring-1 ring-[var(--accent-presence)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-base)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-5 w-5 rounded-full border border-[var(--border-hairline)]"
          style={{ background: swatches.bg }}
          title="Background"
        />
        <span
          className="h-5 w-5 rounded-full"
          style={{ background: swatches.accent }}
          title="Accent"
        />
        <span
          className="h-5 w-5 rounded-full border-2"
          style={{ background: swatches.bg, borderColor: swatches.border }}
          title="Border"
        />
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{preset.label}</p>
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">{preset.description}</p>
      </div>

      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]">
          <Icon name="ph:check-bold" width={11} />
        </span>
      )}
    </button>
  );
}

// Friendly labels for the 8 overridable core tokens.
const TOKEN_LABELS: Record<(typeof THEME_SYNC_KEYS)[number], string> = {
  "--bg-base": "Background",
  "--bg-raised": "Raised surface",
  "--bg-elevated": "Elevated surface",
  "--text-primary": "Primary text",
  "--text-secondary": "Secondary text",
  "--text-muted": "Muted text",
  "--border-hairline": "Border",
  "--accent-presence": "Accent",
};

/** Override a single core token. Forks the active theme to a custom theme so the
 *  edit sticks (and re-syncs); when leaving a preset, the whole 8-token group is
 *  seeded from the current look so only the edited token changes. */
function applyTokenOverride(key: string, hex: string, mode: Mode) {
  const html = document.documentElement;
  html.style.setProperty(key, hex); // live preview
  let existing: CustomThemeData | null = null;
  try {
    const raw = localStorage.getItem(COVEN_CUSTOM_THEME_KEY);
    if (raw) existing = JSON.parse(raw) as CustomThemeData;
  } catch {
    /* malformed — treat as none */
  }
  const groupKey: "light" | "dark" = mode === "light" ? "light" : "dark";
  const group: Record<string, string> = { ...(existing?.cssVars?.[groupKey] ?? {}) };
  if (!existing) Object.assign(group, resolveSyncTokens()); // seed from current look
  group[key] = hex;
  const data: CustomThemeData = {
    name: existing?.name ?? "Custom",
    cssVars: { ...(existing?.cssVars ?? {}), [groupKey]: group },
  };
  localStorage.setItem(COVEN_CUSTOM_THEME_KEY, JSON.stringify(data));
  localStorage.setItem(COVEN_THEME_KEY, "custom");
  html.setAttribute("data-theme", "custom");
}

/** Per-token override list — every core theme token with a colour swatch you can
 *  edit. Editing applies live, forks to a custom theme, and re-syncs. */
function ThemeTokenOverrides({
  mode,
  reloadKey,
  onChange,
}: {
  mode: Mode;
  reloadKey: string;
  onChange: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues(resolveSyncTokens());
  }, [reloadKey]);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[11px] text-[var(--text-muted)]">
        Override any of the theme&apos;s core tokens. Editing one forks the active
        theme to a custom theme and applies + syncs immediately.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border-hairline)] overflow-hidden rounded-lg border border-[var(--border-hairline)]">
        {THEME_SYNC_KEYS.map((key) => {
          const hex = (values[key] ?? "#000000").slice(0, 7);
          return (
            <label key={key} className="flex items-center gap-3 px-3 py-2">
              <input
                type="color"
                value={hex}
                onChange={(e) => {
                  applyTokenOverride(key, e.target.value, mode);
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                  onChange();
                }}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border border-[var(--border-hairline)] bg-transparent p-0"
                aria-label={TOKEN_LABELS[key]}
              />
              <span className="flex-1 text-[12px] text-[var(--text-primary)]">{TOKEN_LABELS[key]}</span>
              <code className="font-mono text-[11px] text-[var(--text-muted)]">{key}</code>
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">{hex}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: Appearance ───────────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const [activeTheme, setActiveTheme] = useState<ActiveTheme>("coven");
  const [mode, setMode] = useState<ModePref>("dark");
  const [customData, setCustomData] = useState<CustomThemeData | null>(null);

  // Mirror the active theme + resolved tokens to the daemon on change (and mount)
  // so cross-device clients can read it. Best-effort; failures are swallowed.
  useEffect(() => {
    void persistThemeTokens();
  }, [activeTheme, mode, customData]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // colorEditorBase: the preset that seeds the color editor; null = editor hidden.
  const [colorEditorBase, setColorEditorBase] = useState<PresetTheme | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; at: string } | null>(null);

  const handleResync = async () => {
    setSyncing(true);
    const ok = await persistThemeTokens();
    setSyncing(false);
    setSyncResult({ ok, at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });
  };

  const reloadCustomData = () => {
    setActiveTheme("custom");
    try {
      const raw = localStorage.getItem(COVEN_CUSTOM_THEME_KEY);
      if (raw) setCustomData(JSON.parse(raw) as CustomThemeData);
    } catch {
      /* ignore */
    }
  };
  const [cornerRadius, setCornerRadius] = useState<CornerRadius>("default");
  const familiarSwitcherStyle = useFamiliarSwitcherStyle();
  const familiarStripScope = useFamiliarStripScope();

  // Read persisted theme + mode on mount
  useEffect(() => {
    setActiveTheme(readPersistedTheme());
    setMode(readPersistedMode());
    setCornerRadius(readCornerRadius());
    const saved = localStorage.getItem(COVEN_THEME_KEY);
    if (saved === "custom") {
      const raw = localStorage.getItem(COVEN_CUSTOM_THEME_KEY);
      if (raw) {
        try {
          setCustomData(JSON.parse(raw) as CustomThemeData);
        } catch {
          /* malformed — ignore */
        }
      }
    }
  }, []);

  const handleSelectPreset = (id: PresetTheme) => {
    setActiveTheme(id);
    setCustomData(null);
    applyPreset(id);
    // Selecting a preset just applies it. The color editor is opened explicitly
    // via "Customize colors" so a plain pick doesn't drop into edit mode (which
    // would flip data-theme to "custom").
    setColorEditorBase(null);
  };

  const handleSetCornerRadius = (next: CornerRadius) => {
    setCornerRadius(next);
    applyCornerRadius(next);
  };

  const handleSetMode = (next: ModePref) => {
    setMode(next);
    applyMode(next);
    // If a custom theme is active, re-apply with the new mode group.
    if (activeTheme === "custom" && customData) {
      applyCustomVars(customData.cssVars, resolveMode(next));
    }
  };

  // When following the OS ("system"), re-resolve on every prefers-color-scheme flip.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyMode("system");
      if (activeTheme === "custom" && customData) applyCustomVars(customData.cssVars, resolveMode("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, activeTheme, customData]);

  const handleResetCustom = () => {
    clearCustomTheme();
    setActiveTheme("coven");
    setCustomData(null);
    setColorEditorBase(null);
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

      const raw: CustomThemeData = {
        name: (json.name as string) || canonical.split("/").pop() || "custom",
        cssVars: cssVars as CustomThemeData["cssVars"],
      };
      // Translate shadcn base tokens into the Cave's semantic vocabulary so the
      // import recolors the accent, sidebar, popovers and hover states — not
      // just the canvas (see enrichTweakcnTheme / tweakcnSemanticVars).
      const data = enrichTweakcnTheme(raw);

      applyCustomVars(data.cssVars, resolveMode(mode));
      localStorage.setItem(COVEN_CUSTOM_THEME_KEY, JSON.stringify(data));
      localStorage.setItem(COVEN_THEME_KEY, "custom");
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
      {/* ── Mode toggle ── */}
      <SettingsGroup label="Mode">
        <div className="px-4 py-3">
          <ModeToggle value={mode} onChange={handleSetMode} />
        </div>
      </SettingsGroup>

      {/* ── Preset themes ── */}
      <SettingsGroup label="Theme">
        {/* Custom theme chip */}
        {activeTheme === "custom" && customData && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-hairline)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-3 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
              <Icon name="ph:sparkle" width={11} className="text-[var(--accent-presence)]" />
              Custom: {customData.name}
              <button
                type="button"
                onClick={handleResetCustom}
                className="focus-ring ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-70 hover:opacity-100"
                aria-label={`Reset ${customData.name}`}
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {PRESETS.map((preset) => (
            <ThemePresetCard
              key={preset.id}
              preset={preset}
              mode={resolveMode(mode)}
              active={activeTheme === preset.id || colorEditorBase === preset.id}
              onSelect={handleSelectPreset}
            />
          ))}
        </div>

        {/* Open the color editor explicitly — selecting a preset above only
            applies it, so this is the way into custom tweaking. */}
        {!colorEditorBase && (
          <div className="border-t border-[var(--border-hairline)] px-4 py-3">
            <button
              type="button"
              onClick={() => setColorEditorBase(activeTheme === "custom" ? "coven" : activeTheme)}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:paint-brush" width={13} />
              Customize colors
            </button>
          </div>
        )}

        {/* ── Color editor: shown when "Customize colors" is opened ── */}
        {colorEditorBase && (
          <div className="border-t border-[var(--border-hairline)] p-4">
            <ThemeColorEditor
              basePreset={colorEditorBase}
              mode={resolveMode(mode)}
              onSave={() => {
                setActiveTheme("custom");
                try {
                  const raw = localStorage.getItem("coven-custom-theme");
                  if (raw) setCustomData(JSON.parse(raw) as CustomThemeData);
                } catch { /* ignore */ }
              }}
              onReset={() => {
                setActiveTheme(colorEditorBase);
                setCustomData(null);
              }}
            />
          </div>
        )}
      </SettingsGroup>

      {/* ── Per-token overrides + manual resync ── */}
      <SettingsGroup label="Theme tokens">
        <ThemeTokenOverrides
          mode={resolveMode(mode)}
          reloadKey={`${activeTheme}:${mode}:${customData ? "c" : "p"}`}
          onChange={reloadCustomData}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-hairline)] px-4 py-3">
          <button
            type="button"
            onClick={() => void handleResync()}
            disabled={syncing}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <Icon name="ph:arrows-clockwise" width={13} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Syncing…" : "Resync to phone"}
          </button>
          <span className="text-[11px] text-[var(--text-muted)]">
            {syncResult
              ? syncResult.ok
                ? `Synced at ${syncResult.at}.`
                : "Couldn’t reach the daemon — is it running?"
              : "Your theme syncs to the phone automatically; resync to push it now."}
          </span>
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
              className="focus-ring flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleImport();
              }}
            />
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing || !importUrl.trim()}
              className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-4 py-2 text-[12px] font-medium text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
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

      <FontSettings />

      {/* ── Familiar switcher ── choose the top-bar familiar control: a row of
          quick-switch avatars, or just the switcher dropdown. */}
      <SettingsGroup label="Familiar switcher">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-[var(--text-secondary)]">
              Top-bar style
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Show recent &amp; pinned familiars as a row of avatars, or just the switcher dropdown.
            </div>
          </div>
          <div
            role="group"
            aria-label="Familiar switcher style"
            className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
          >
            {FAMILIAR_SWITCHER_STYLE_OPTIONS.map((option) => {
              const active = familiarSwitcherStyle === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFamiliarSwitcherStyle(option)}
                  className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {FAMILIAR_SWITCHER_STYLE_LABELS[option]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Avatars shown + Pin order — only meaningful for the avatar strip, so
            they follow the style toggle and show only when that style is active. */}
        {familiarSwitcherStyle === "avatars" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--border-hairline)] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Avatars shown
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Show only your pinned familiars in the strip, or every familiar.
                </div>
              </div>
              <div
                role="group"
                aria-label="Familiars shown in the avatar strip"
                className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
              >
                {FAMILIAR_STRIP_SCOPE_OPTIONS.map((option) => {
                  const active = familiarStripScope === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFamiliarStripScope(option)}
                      className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                        active
                          ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {FAMILIAR_STRIP_SCOPE_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[var(--border-hairline)] px-4 py-3">
              <div className="mb-2 min-w-0">
                <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Pin order
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Drag to set the order pinned familiars appear in the avatar strip.
                </div>
              </div>
              <FamiliarPinOrder />
            </div>
          </>
        ) : null}
      </SettingsGroup>

      {/* ── Corner radius ── a minor shape tweak (drives the shared --radius
          tokens), kept last so the primary color/theme and text controls lead. */}
      <SettingsGroup label="Corners">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-[var(--text-secondary)]">
              Corner radius
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Roundedness of buttons, cards, and the familiar switcher.
            </div>
          </div>
          <div
            role="group"
            aria-label="Corner radius"
            className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
          >
            {CORNER_RADIUS_OPTIONS.map((option) => {
              const active = cornerRadius === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleSetCornerRadius(option)}
                  className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {CORNER_RADIUS_LABELS[option]}
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: Phone (connect the native mobile app) ─────────────────────────────

function CopyValue({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      aria-label={`Copy ${label ?? value}`}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-left transition-colors hover:border-[var(--accent-presence)]"
    >
      <code className="min-w-0 truncate font-mono text-[12px] text-[var(--text-primary)]">{value}</code>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
        <Icon name={copied ? "ph:check" : "ph:copy"} width={13} />
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function MobileSection() {
  return (
    <SettingsPage
      title="Connect on your phone"
      description="Run the native Coven Cave app on your iPhone or iPad and reach this desktop over your Tailscale network — no token, no password."
    >
      <SettingsGroup label="Steps">
        <SettingsRow label="1 · Same Tailscale network" description="Sign your phone and this Mac into the same tailnet." />
        <div className="space-y-2 px-4 py-3">
          <div>
            <p className="text-[13px] text-[var(--text-primary)]">2 · Start the mobile server</p>
            <p className="text-[11px] text-[var(--text-muted)]">Serves this desktop to your tailnet and prints the address + a QR code. Leave it running.</p>
          </div>
          <CopyValue value="pnpm mobile:tailscale:app" label="start command" />
        </div>
        <SettingsRow
          label="3 · Enter the address in the app"
          description="On the app’s connect screen, type the https://… address the command printed (your Mac’s Tailscale name)."
        />
        <SettingsRow label="4 · Tap Connect" description="Your familiars and board load over Tailscale. Switch tabs for Chats and Tasks." />
      </SettingsGroup>

      <SettingsGroup label="Why there’s no password">
        <div className="flex items-start gap-3 px-4 py-3">
          <Icon name="ph:lock-simple-bold" width={16} className="mt-0.5 shrink-0 text-[var(--accent-presence)]" />
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            Being on your Tailscale network <em>is</em> the credential. The desktop only serves the mobile API over the
            tailnet — encrypted and private — so nothing is exposed to the public internet, and there’s no token to copy.
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Get the app">
        <SettingsRow label="Build it with Xcode" description="apps/ios/CovenCave — open in Xcode and run on your device, or install the TestFlight build." />
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <a
            href="https://github.com/OpenCoven/coven-cave/blob/main/docs/ios-native-rebuild.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:file-text" width={12} />
            Setup guide
          </a>
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
        <SettingsKV label="App version" value={APP_VERSION} />
        <UpdateSettingsRow />
        <SettingsKV label="Daemon version" value={version ?? "—"} />
        <SettingsKV label="Built with" value="Next.js · React · Tauri · Tailwind" />
      </SettingsGroup>
      <SettingsGroup label="OpenCoven tools">
        <OpenCovenToolsUpdate />
      </SettingsGroup>
      <SettingsGroup label="Links">
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {[
            { label: "GitHub",   href: "https://github.com/OpenCoven/coven-cave", icon: "ph:github-logo" as const },
            { label: "Docs",     href: "https://docs.opencoven.ai",               icon: "ph:file-text" as const },
            { label: "X",        href: "https://x.com/OpenCvn",                   icon: "ph:x-logo-bold" as const },
            { label: "Discord",  href: "https://discord.gg/opencoven",            icon: "ph:discord-logo" as const },
            { label: "Grimoire", href: "https://mind.opencoven.ai",               icon: "ph:book-open" as const },
            { label: "Podcast",  href: "https://pod.opencoven.ai",                icon: "ph:waveform-bold" as const },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name={l.icon} width={12} />
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
    <div className="max-w-none space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</h1>
        {description && <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </div>
  );
}


function SettingsRow({ label, description, comingSoon, children }: { label: string; description?: string; comingSoon?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${comingSoon ? "opacity-50" : ""}`}>
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

function SettingsKV({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className={`text-right text-[12px] text-[var(--text-muted)] ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
