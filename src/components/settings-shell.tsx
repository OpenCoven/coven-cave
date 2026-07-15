"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { SettingsGroup, settingsGroupId } from "@/components/ui/settings-group";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingControlRow, Segmented } from "@/components/ui/settings-controls";
import { SearchInput } from "@/components/ui/search-input";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FamiliarStudioInlinePanel } from "@/components/familiar-studio-inline";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import { OpenCovenToolsUpdate } from "@/components/open-coven-tools-update";
import { THEME_IDS, THEME_META, getSwatches, type ThemeId } from "@/lib/theme-palettes";
import type { Mode, ModePref } from "@/lib/theme-storage";
import { ModeToggle } from "@/components/mode-toggle";
import { FamiliarStudioProvider, useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { FamiliarSummoningCircle } from "@/components/familiar-summoning-circle";
import { APP_VERSION } from "@/lib/app-version";
import { UpdateSettingsRow } from "@/components/update-available";
import { classifyAboutDaemonStatus, type AboutDaemonState } from "@/lib/about-status";
import { useIsMobile } from "@/lib/use-viewport";
import { useHomeNewsEnabled, writeHomeNewsEnabled } from "@/lib/home-news-pref";
import {
  DEFAULT_STOP_PHRASE,
  STOP_PHRASE_MAX_LENGTH,
  useStopPhrase,
  writeStopPhrase,
} from "@/lib/stop-phrase";
import { readMobileModeEnabled, writeMobileModeEnabled } from "@/lib/mobile-mode-pref";
import { ColorPicker, type ColorSwatch } from "@/components/ui/color-picker";
import { Popover } from "@/components/ui/popover";
import { addRecentColor, getRecentColors } from "@/lib/recent-colors";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";
import { FontSettings } from "./settings-fonts";
import { SettingsTabbed } from "./settings-section-tabs";
import type { TabItem } from "@/components/ui/tabs";
import { ProfileSection } from "./settings-profile";
import { AccessGroupsSection } from "./access-groups-section";
import { SettingsOverview } from "./settings-overview";
import {
  SECTIONS,
  SETTINGS_INDEX,
  settingsSectionLabel,
  type Section,
  type SettingsIndexEntry,
} from "./settings-sections";
import {
  CORNER_RADIUS_OPTIONS,
  CORNER_RADIUS_LABELS,
  applyCornerRadius,
  readCornerRadius,
  type CornerRadius,
} from "@/lib/appearance-corner-radius";
import { readableTextColor } from "@/lib/readable-text-color";
import { openExternalUrl } from "@/lib/open-external";
import { copyText } from "@/lib/clipboard";
import { BackdropSettings } from "@/components/backdrop-settings";
import {
  flushAppPreferences,
  readAppPreferences,
  refreshAppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import {
  clearCustomThemeVariables,
  reapplyIndependentAppearance,
} from "@/lib/appearance-restore";
import type { CustomThemeData } from "@/lib/preferences-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

type DaemonStatus = {
  running: boolean;
  reason?: string;
  covenVersion?: string;
  apiVersion?: string;
  workspacePath?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
  executors?: Array<{
    url: string;
    healthUrl: string;
    ok: boolean;
    state: "available" | "unreachable";
    detail: string;
  }>;
  target?: {
    mode: "local" | "hub" | "unconfigured-hub";
    label: string;
    socket?: string;
    url?: string;
    error?: string;
  };
  travel?: {
    mode: "home" | "hub" | "watching-hub" | "travel" | "handoff-pending";
    authority: "local" | "hub" | "travel-local";
    reason: string;
    manualOffline: boolean;
    staleCache: boolean;
    wakeLocalSubdaemon: boolean;
    localBindHost: "127.0.0.1";
    hubUnreachableSince: string | null;
    hubUnreachableForMs: number;
    pendingQueueCount: number;
    handoffPending: boolean;
  };
};

type MultiHostMode = "local" | "hub";

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

  // ── Search across settings ────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  // One-shot studio-tab target for search results that point inside the
  // Familiars panel (see SettingsIndexEntry.familiarTab).
  const [familiarsTabTarget, setFamiliarsTabTarget] = useState<FamiliarStudioTab | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_INDEX.filter((e) =>
      `${settingsSectionLabel(e.section)} ${e.group ?? ""} ${e.keywords}`.toLowerCase().includes(q));
  }, [query]);

  function goToSetting(entry: SettingsIndexEntry) {
    openSection(entry.section);
    setQuery("");
    if (entry.familiarTab) {
      // The Familiars panel isn't a SettingsGroup — the entry targets one of
      // its studio tabs instead, activated below the provider by
      // FamiliarsSection once the roster has loaded.
      setFamiliarsTabTarget(entry.familiarTab);
      setScrollTarget(null);
      return;
    }
    setScrollTarget(entry.group ? settingsGroupId(entry.group) : null);
  }

  // After the target section renders, scroll its group into view and flash a
  // highlight so the eye lands on the right control.
  useEffect(() => {
    if (!scrollTarget) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(scrollTarget);
      if (el) {
        el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        el.classList.add("settings-group--found");
        window.setTimeout(() => el.classList.remove("settings-group--found"), 1600);
        // Move focus/reading position to the jumped-to group so keyboard and SR
        // users land on it, not just the sighted eye (the flash is visual-only).
        const focusTarget = el.querySelector<HTMLElement>(
          "input, select, textarea, button, [tabindex]",
        ) ?? el;
        if (focusTarget === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        focusTarget.focus({ preventScroll: true });
      }
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, section]);

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
    const applyHashSection = () => {
      const hash = window.location.hash.replace("#", "") as Section;
      if (SECTIONS.some((s) => s.id === hash)) {
        const params = new URLSearchParams(window.location.search);
        const group = params.get("group")?.trim();
        const familiarTab = params.get("familiarTab")?.trim() as FamiliarStudioTab | undefined;
        setSection(hash);
        setPickerView(false);
        if (familiarTab && SETTINGS_INDEX.some((entry) => entry.familiarTab === familiarTab)) {
          setFamiliarsTabTarget(familiarTab);
          setScrollTarget(null);
        } else {
          setFamiliarsTabTarget(null);
          setScrollTarget(group ? settingsGroupId(group) : null);
        }
        return;
      }
      setPickerView(true);
    };
    applyHashSection();
    window.addEventListener("hashchange", applyHashSection);
    return () => window.removeEventListener("hashchange", applyHashSection);
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
        openSection(SECTIONS[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, section]);

  return (
    <FamiliarStudioProvider>
    <div className="settings-shell flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header. On mobile the back button has two roles: from a section
          page it drops back to the picker; from the picker it pops the
          route. Desktop always pops the route. */}
      {/* The band composes the shared .surface-compact-header metrics (40px,
          hairline, family gap/padding) with .settings-shell__header, which
          keeps the gradient background and the Tauri window drag-region. The
          inline paddingTop preserves the mobile safe-area inset on top of the
          band's 5px. */}
      <header
        className="settings-shell__header surface-compact-header shrink-0"
        style={{ paddingTop: "calc(5px + var(--sai-top))" }}
        // Real window drag on the loopback webview (the CSS app-region hint is
        // inert on external URLs — see the titlebar notes in shell.tsx). The
        // Back button and other controls opt out automatically as clickables.
        data-tauri-drag-region="deep"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (isMobile && !pickerView) backToPicker();
            else router.back();
          }}
          className="settings-back-button"
          leadingIcon="ph:arrow-left"
        >
          {isMobile && !pickerView ? "Settings" : "Back"}
        </Button>
        <div className="min-w-0">
          <span className="surface-compact-title block truncate">
            {isMobile && !pickerView ? (activeSection?.label ?? "CovenCave control room") : "CovenCave control room"}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Sidebar / picker. On desktop this is a 200px rail next to
            content. On mobile it expands full-screen when in picker
            view (iOS-Settings drill-down). Once a section is picked the
            picker hides and the content fills the screen. */}
        <nav
          hidden={isMobile && !showPicker}
          className="settings-shell__sidebar shrink-0 py-3 md:w-[200px] md:border-r md:border-[var(--border-hairline)]"
          style={showPicker ? { flex: "1 1 auto", width: "100%" } : undefined}
        >
          <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Settings
          </p>
          <div className={`mb-2 ${showPicker ? "px-3" : "px-2"}`}>
            <SearchInput
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              placeholder="Search settings…"
              aria-label="Search settings"
            />
          </div>
          {query.trim() ? (
            <div className={`space-y-px ${showPicker ? "px-3" : "px-2"}`} role="list" aria-label="Settings search results">
              {results.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">No settings match “{query.trim()}”.</p>
              ) : results.map((e) => (
                <div key={`${e.section}:${e.group ?? ""}`} role="listitem">
                  <button
                    type="button"
                    onClick={() => goToSetting(e)}
                    className="focus-ring flex w-full flex-col items-start rounded-[var(--radius-control)] px-2.5 py-[5px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                  >
                    <span className="text-[12px] font-medium">{e.group ?? settingsSectionLabel(e.section)}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{settingsSectionLabel(e.section)}</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
          <div className={`space-y-px ${showPicker ? "px-3" : "px-2"}`}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openSection(s.id)}
                aria-current={section === s.id && !showPicker ? "page" : undefined}
                className={`settings-nav__item focus-ring flex w-full items-center rounded-[var(--radius-control)] px-2.5 text-left transition-colors ${
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
          )}
        </nav>

        {/* Content */}
        <main
          hidden={showPicker}
          className="settings-shell__content min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8"
          style={{ paddingBottom: "calc(1.5rem + var(--sai-bottom))" }}
        >
          {section === "profile" && <ProfileSection />}
          {section === "general" && <GeneralSection />}
          {section === "daemon"   && <DaemonSection />}
          {section === "familiars" && (
            <FamiliarsSection
              tabTarget={familiarsTabTarget}
              onTabTargetConsumed={() => setFamiliarsTabTarget(null)}
            />
          )}
          {section === "mobile"   && <MobileSection />}
          {section === "appearance" && <AppearanceSection scrollTarget={scrollTarget} />}
          {section === "about"    && <AboutSection />}
        </main>
      </div>
      <footer className="shrink-0 border-t border-[var(--border-hairline)] px-4 py-1.5 text-center text-[10px] text-[var(--text-muted)]">
        {isMobile ? (pickerView ? "Tap a section to open" : "Back returns to Settings") : "Esc back · ↑↓ navigate sections"}
      </footer>
    </div>
    </FamiliarStudioProvider>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection() {
  return (
    <SettingsPage section="general" title="General" description="App-wide preferences.">
      <SettingsGroup label="Workspace">
        <SettingsRow label="Workspace path" description="Where Coven stores familiar workspaces.">
          <WorkspacePathField />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup label="Home">
        <HomeNewsToggle />
      </SettingsGroup>
      <SettingsGroup label="Chat">
        <StopPhraseField />
      </SettingsGroup>
      <SettingsGroup label="Startup">
        <SettingsRow label="Launch at login" description="Start CovenCave when you log in." comingSoon />
        <SettingsRow label="Open to" description="Which view to show on launch." comingSoon />
      </SettingsGroup>
    </SettingsPage>
  );
}

// News on Home is opt-out here rather than dismissible inline — the carousel
// row carries no X, so this switch is the one place the choice lives (and it
// persists across visits, unlike the old per-mount dismiss). Rendered as a
// minimal track/knob switch (user-requested): the row label carries the
// meaning, so the control itself needs no On/Off text.
function HomeNewsToggle() {
  const newsEnabled = useHomeNewsEnabled();
  return (
    <SettingsRow
      label="News headlines"
      description="Show the News carousel on the Home screen's daily summary."
    >
      <button
        type="button"
        role="switch"
        aria-checked={newsEnabled}
        aria-label="News headlines"
        onClick={() => writeHomeNewsEnabled(!newsEnabled)}
        className={`settings-switch focus-ring${newsEnabled ? " is-on" : ""}`}
      >
        <span className="settings-switch__knob" aria-hidden />
      </button>
    </SettingsRow>
  );
}

// The stop phrase is a safety valve: while a familiar is mid-task, typing
// this exact phrase in any chat composer halts the run (the composer's busy
// bail otherwise swallows plain sends). Commit on blur/Enter; clearing the
// field disables interception.
function StopPhraseField() {
  const saved = useStopPhrase();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const commit = () => {
    if (draft !== null && draft.trim() !== saved) writeStopPhrase(draft);
    setDraft(null);
  };
  return (
    <SettingsRow
      label="Stop phrase"
      description="Typing this in the composer while a task is running stops it. Leave empty to disable."
    >
      <input
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        placeholder={DEFAULT_STOP_PHRASE}
        maxLength={STOP_PHRASE_MAX_LENGTH}
        aria-label="Stop phrase"
        className="focus-ring w-full max-w-sm rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none"
      />
    </SettingsRow>
  );
}

function WorkspacePathField() {
  const [path, setPath] = useState("");
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/daemon/status", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { workspacePath?: string }) => {
        if (!ctl.signal.aborted && j.workspacePath) setPath(j.workspacePath);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  return (
    <input
      value={path}
      readOnly
      aria-label="Workspace path"
      className="w-full max-w-sm rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none"
    />
  );
}

// ─── Section: Daemon ──────────────────────────────────────────────────────────

function parseExecutorUrls(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

/** Omnigent fleet connection — the config surface for the host chip and remote runs. */
function OmnigentSettingsGroup() {
  const { announce } = useAnnouncer();
  const [baseUrl, setBaseUrl] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [exposeHosts, setExposeHosts] = useState(true);
  const [statusLine, setStatusLine] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: {
        ok?: boolean;
        config?: {
          omnigent?: {
            baseUrl?: string;
            defaultWorkspace?: string;
            exposeHostsInComposer?: boolean;
          };
        };
      }) => {
        if (ctl.signal.aborted || !j.ok) return;
        const o = j.config?.omnigent;
        setBaseUrl(o?.baseUrl ?? "");
        setWorkspace(o?.defaultWorkspace ?? "");
        setExposeHosts(o?.exposeHostsInComposer !== false);
      })
      .catch(() => {});
    fetch("/api/omnigent/status", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: {
        online?: boolean;
        hasToken?: boolean;
        authMode?: string;
        configured?: boolean;
        error?: string;
      }) => {
        if (ctl.signal.aborted) return;
        if (!j.configured) setStatusLine("Not configured");
        else if (j.online) {
          const mode = j.authMode || (j.hasToken ? "jwt" : "none");
          setStatusLine(
            mode === "none"
              ? "Online · local/unauthenticated"
              : `Online · auth ${mode}`,
          );
        } else setStatusLine(j.error ? `Offline · ${j.error}` : "Offline");
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          omnigent: {
            baseUrl: baseUrl.trim(),
            defaultWorkspace: workspace.trim(),
            exposeHostsInComposer: exposeHosts,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `save failed (${res.status})`);
      }
      announce("Omnigent settings saved.");
      const st = await fetch("/api/omnigent/status", { cache: "no-store" }).then((r) => r.json());
      if (st?.online) {
        const mode = st.authMode || (st.hasToken ? "jwt" : "none");
        setStatusLine(mode === "none" ? "Online · local/unauthenticated" : `Online · auth ${mode}`);
      } else if (st?.configured) setStatusLine(st.error || "Configured");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not save";
      setError(msg);
      announce(`Couldn't save Omnigent settings: ${msg}`, "assertive");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup label="Omnigent fleet">
      <SettingControlRow
        label="Server URL"
        hint="HTTPS URL of your Omnigent server (e.g. Tailscale). Token is read from ~/.omnigent/auth_tokens.json — never stored in Cave config."
      >
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          aria-label="Omnigent server URL"
          placeholder="https://omnigent.example.ts.net"
          className="w-full min-w-[260px] max-w-md rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none"
          spellCheck={false}
        />
      </SettingControlRow>
      <SettingControlRow
        label="Default workspace"
        hint="Absolute path on the Omnigent host used when Chat/Board start a run without an override."
      >
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          aria-label="Default Omnigent workspace"
          placeholder="/home/you/project"
          className="w-full min-w-[260px] max-w-md rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none"
          spellCheck={false}
        />
      </SettingControlRow>
      <SettingControlRow
        label="Show fleet in Host chip"
        hint="When on — and an Omnigent auth token is present — Chat and Home Host pickers list Omnigent hosts (omnigent:…) so a send can start a fleet session. Without a token, no Fleet buttons appear anywhere."
      >
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={exposeHosts}
            onChange={(e) => setExposeHosts(e.target.checked)}
          />
          Expose Omnigent hosts in composer
        </label>
      </SettingControlRow>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 pt-0.5">
        <span className="text-[11px] text-[var(--text-muted)]">{statusLine || "—"}</span>
        <div className="flex items-center gap-2">
          {error && <span role="alert" className="text-[11px] text-[var(--color-danger)]">{error}</span>}
          <Button
            variant="secondary"
            size="xs"
            onClick={() => void save()}
            disabled={saving}
            leadingIcon="ph:floppy-disk-bold"
          >
            {saving ? "Saving..." : "Save Omnigent"}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}

function DaemonSection() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [mode, setMode] = useState<MultiHostMode>("local");
  const [hubUrl, setHubUrl] = useState("");
  const [executorText, setExecutorText] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const [savingTravel, setSavingTravel] = useState(false);
  const [travelError, setTravelError] = useState<string | null>(null);

  // Abort the in-flight status read on each refresh: Start/Restart/Manual-
  // Offline each trigger one, and without cancellation a slow earlier
  // response can land after a newer one and flash a stale pre-action status
  // (same guard FamiliarsSection uses for its loads).
  const refreshCtlRef = useRef<AbortController | null>(null);
  const refresh = () => {
    refreshCtlRef.current?.abort();
    const ctl = new AbortController();
    refreshCtlRef.current = ctl;
    setLoading(true);
    fetch("/api/daemon/status", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: DaemonStatus) => {
        if (ctl.signal.aborted) return;
        setStatus(j); setLoading(false);
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setStatus({ running: false }); setLoading(false);
      });
  };

  useEffect(() => {
    refresh();
    return () => refreshCtlRef.current?.abort();
    // refresh is stable-by-construction (only touches refs/setters); running
    // this once on mount is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { ok?: boolean; config?: { multiHost?: { mode?: MultiHostMode; hubUrl?: string; executorUrls?: string[] } } }) => {
        if (ctl.signal.aborted) return;
        const multiHost = j.config?.multiHost;
        if (!j.ok || !multiHost) return;
        setMode(multiHost.mode === "hub" ? "hub" : "local");
        setHubUrl(multiHost.hubUrl ?? "");
        setExecutorText((multiHost.executorUrls ?? []).join("\n"));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const saveConnection = async (nextMode = mode) => {
    setSavingConnection(true);
    setConnectionError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ multiHost: { mode: nextMode, hubUrl, executorUrls: parseExecutorUrls(executorText) } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `save failed (${res.status})`);
      }
      setMode(nextMode);
      announce("Daemon connection saved.");
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not save daemon connection";
      setConnectionError(msg);
      announce(`Couldn't save daemon connection: ${msg}`, "assertive");
    } finally {
      setSavingConnection(false);
    }
  };

  const chooseMode = (nextMode: MultiHostMode) => {
    void saveConnection(nextMode);
  };

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

  const restartDaemon = async () => {
    setRestarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not restart");
      }
      refresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "daemon did not restart");
    } finally {
      setRestarting(false);
    }
  };

  const setManualOffline = async (manualOffline: boolean) => {
    setSavingTravel(true);
    setTravelError(null);
    try {
      const res = await fetch("/api/travel/client", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manualOffline }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `travel mode save failed (${res.status})`);
      }
      refresh();
    } catch (err) {
      setTravelError(err instanceof Error ? err.message : "could not save travel mode");
    } finally {
      setSavingTravel(false);
    }
  };

  return (
    <SettingsPage section="daemon" title="Daemon" description="The coven daemon manages familiar sessions and the workspace.">
      <SettingsGroup label="Connection">
        <SettingControlRow
          label="Runtime target"
          hint={status?.target?.mode === "hub" ? `Connected through ${status.target.url ?? "server hub"}` : "Local runs everything on this machine (the default). Server hub connects to a shared daemon on another machine."}
        >
          <Segmented
            options={["local", "hub"] as const}
            value={mode}
            onChange={chooseMode}
            getLabel={(option) => option === "local" ? "Local" : "Server hub"}
            ariaLabel="Daemon runtime target"
          />
        </SettingControlRow>
        <SettingControlRow label="Server hub URL" hint="HTTP endpoint for the Linux/server hub on your private network.">
          <input
            value={hubUrl}
            onChange={(event) => setHubUrl(event.target.value)}
            onBlur={() => void saveConnection()}
            aria-label="Server hub URL"
            placeholder="http://server.tailnet:8787"
            disabled={mode !== "hub"}
            className="w-full min-w-[260px] max-w-md rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
          />
        </SettingControlRow>
        <SettingControlRow label="Executor addresses" hint="Advanced, optional: addresses of extra machines that can run familiar sessions, one per line. Leave empty unless you run a multi-machine setup.">
          <textarea
            value={executorText}
            onChange={(event) => setExecutorText(event.target.value)}
            onBlur={() => void saveConnection()}
            aria-label="Executor addresses, one per line"
            placeholder={"executor-1.tailnet:8787\nexecutor-2.tailnet:8787"}
            disabled={mode !== "hub"}
            rows={3}
            className="w-full min-w-[260px] max-w-md resize-y rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
          />
        </SettingControlRow>
        {/* Save hugs the section's bottom-right corner at the short (xs)
            control height — same as the Status row's Refresh button. */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-2.5 pt-0.5">
          {connectionError && <span role="alert" className="text-[11px] text-[var(--color-danger)]">{connectionError}</span>}
          <Button
            variant="secondary"
            size="xs"
            onClick={() => void saveConnection()}
            disabled={savingConnection}
            leadingIcon="ph:floppy-disk-bold"
          >
            {savingConnection ? "Saving..." : "Save connection"}
          </Button>
        </div>
      </SettingsGroup>

      <OmnigentSettingsGroup />

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
          {!loading && !status?.running && mode === "local" && (
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              onClick={startDaemon}
              disabled={starting}
              leadingIcon="ph:rocket-launch-bold"
              title="coven daemon start"
            >
              {starting ? "Starting..." : "Start daemon"}
            </Button>
          )}
          {status?.running && (
            <Button
              variant="primary"
              size="sm"
              onClick={restartDaemon}
              disabled={restarting}
              leadingIcon="ph:arrow-clockwise"
              title="coven daemon start"
            >
              {restarting ? "Restarting..." : "Restart daemon"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={refresh}
            leadingIcon="ph:arrow-clockwise"
          >
            Refresh
          </Button>
          {status?.target?.mode === "hub" && (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              hub {status.target.url}
            </span>
          )}
          {startError && <p className="basis-full text-[11px] text-[var(--color-danger)]">{startError}</p>}
          {!loading && !status?.running && mode === "hub" && status?.target?.mode === "hub" && (
            <p className="basis-full text-[11px] text-[var(--color-danger)]">
              {status.target.url} is not reachable from this Cave.
            </p>
          )}
          {mode === "hub" && (status?.executors?.length ?? 0) > 0 && (
            <div className="basis-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-[var(--text-secondary)]">
                <Icon name="ph:terminal-window" width={12} />
                Executor nodes
              </div>
              <div className="space-y-1">
                {status?.executors?.map((executor) => (
                  <div key={executor.url} className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
                    <span className={`h-2 w-2 rounded-full ${executor.ok ? "bg-[var(--color-success)]" : "bg-red-400"}`} />
                    <span className="min-w-0 truncate font-mono text-[var(--text-primary)]">{executor.url}</span>
                    <span className={executor.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                      {executor.detail}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {status?.travel && (
            <div className="basis-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Icon name="ph:device-mobile" width={13} />
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Travel mode</span>
                <span className="rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {status.travel.mode}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void setManualOffline(!status.travel?.manualOffline)}
                  disabled={savingTravel}
                  className="ml-auto"
                  leadingIcon={status.travel.manualOffline ? "ph:plug-bold" : "ph:plug"}
                >
                  {status.travel.manualOffline ? "Return online" : "Manual offline"}
                </Button>
              </div>
              <div className="grid gap-2 text-[11px] text-[var(--text-muted)] sm:grid-cols-3">
                <span>Reason: <strong className="font-medium text-[var(--text-primary)]">{status.travel.reason}</strong></span>
                <span>Pending queue: <strong className="font-medium text-[var(--text-primary)]">{status?.travel?.pendingQueueCount ?? 0}</strong></span>
                <span>Local bind: <strong className="font-mono font-medium text-[var(--text-primary)]">127.0.0.1</strong></span>
                <span>Stale cache: <strong className="font-medium text-[var(--text-primary)]">{status.travel.staleCache ? "yes" : "no"}</strong></span>
                <span>Wake local: <strong className="font-medium text-[var(--text-primary)]">{status.travel.wakeLocalSubdaemon ? "requested" : "standby"}</strong></span>
                <span>Handoff: <strong className="font-medium text-[var(--text-primary)]">{status.travel.handoffPending ? "pending sync" : "clear"}</strong></span>
              </div>
              {travelError && <p className="mt-2 text-[11px] text-[var(--color-danger)]">{travelError}</p>}
            </div>
          )}
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

// ─── Section: Familiars ───────────────────────────────────────────────────────

function FamiliarsSection({
  tabTarget,
  onTabTargetConsumed,
}: {
  /** Studio tab a search result asked to open; consumed once activated. */
  tabTarget?: FamiliarStudioTab | null;
  onTabTargetConsumed?: () => void;
}) {
  // Settings is a standalone route with no workspace context, so this panel
  // sources its own familiar roster and resolves cave overrides locally.
  const [rawFamiliars, setRawFamiliars] = useState<Familiar[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The roster endpoint 503s when the daemon is down — that means "unknown",
  // not "no familiars"; the two must never share an empty state.
  const [daemonDown, setDaemonDown] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const familiars = useResolvedFamiliars(rawFamiliars);
  // This renders below FamiliarStudioProvider (the shell mounts it), so the
  // studio tab state is reachable here even though the shell body can't.
  const { setActiveTab, openFamiliarStudio } = useFamiliarStudio();

  // A search result can target a specific studio tab (e.g. "voice" → Brain).
  // Activate it once the roster has settled so the tab strip exists, move
  // focus to the tab button (the panel has no SettingsGroup to flash), and
  // hand the one-shot target back to the shell.
  useEffect(() => {
    if (!tabTarget || !loaded) return;
    setActiveTab(tabTarget);
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`familiar-studio-inline-tab-${tabTarget}`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
      }
      onTabTargetConsumed?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [tabTarget, loaded, setActiveTab, onTabTargetConsumed]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/familiars", { cache: "no-store", signal });
      const json = await res.json().catch(() => null);
      if (signal?.aborted) return;
      if (json?.ok) {
        setRawFamiliars((json.familiars ?? []) as Familiar[]);
        setDaemonDown(false);
      } else if (res.status === 503) {
        setDaemonDown(true);
      }
    } catch {
      /* transient (or aborted) — keep last good list */
    } finally {
      if (!signal?.aborted) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const startDaemon = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      await load();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "daemon did not start");
    } finally {
      setStarting(false);
    }
  }, [load]);

  // Hold the panel until the first fetch settles so the "No familiars
  // configured" empty state never flashes before the roster loads.
  if (!loaded) {
    return (
      <div className="settings-familiars-panel" role="status" aria-busy="true" aria-label="Loading familiars">
        <SkeletonRows count={4} />
      </div>
    );
  }

  const createDialog = (
    <FamiliarSummoningCircle
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      existingIds={rawFamiliars.map((f) => f.id)}
      defaultHarness={rawFamiliars.find((f) => f.defaultHarness)?.defaultHarness}
      daemonRunning={!daemonDown}
      onCreated={(id) => {
        // Select the freshly created familiar (not the first in the roster);
        // the shared studio context drives the inline panel's detail pane.
        openFamiliarStudio(id);
        void load();
      }}
    />
  );

  if (daemonDown) {
    return (
      <div className="settings-familiars-panel">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            <Icon name="ph:warning-circle" width={13} aria-hidden className="mr-1.5 inline-block align-[-2px]" />
            The daemon is offline, so the familiar roster can&apos;t be read. Start it to manage
            familiars.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void startDaemon()}
              disabled={starting}
              leadingIcon="ph:rocket-launch-bold"
              title="coven daemon start"
            >
              {starting ? "Starting..." : "Start daemon"}
            </Button>
            {startError ? (
              <span role="alert" className="text-[11px] text-[var(--color-danger)]">
                {startError}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (familiars.length === 0) {
    return (
      <div className="settings-familiars-panel">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            No familiars configured yet. The circle awaits your first summoning.
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            leadingIcon="ph:magic-wand-fill"
          >
            Summon familiar
          </Button>
        </div>
        {createDialog}
      </div>
    );
  }

  return (
    <>
      {/* Summon lives in the familiar picker's fixed footer, alongside the
          roster it extends instead of floating above the Studio. */}
      <FamiliarStudioInlinePanel
        familiars={rawFamiliars}
        resolved={familiars}
        onSummon={() => setCreateOpen(true)}
        onRosterChanged={() => void load()}
      />
      {/* Cross-familiar access groups — shared base project grants at read or
          write level; per-familiar effective access renders in the studio's
          Projects tab. */}
      <div className="mt-4">
        <AccessGroupsSection familiars={familiars} />
      </div>
      {createDialog}
    </>
  );
}

// ─── Theme helpers ───────────────────────────────────────────────────────────────────────

type PresetTheme = ThemeId;
type ActiveTheme = PresetTheme | "custom";

function applyPreset(theme: PresetTheme) {
  const html = document.documentElement;
  clearCustomThemeVariables();
  html.setAttribute("data-theme", theme);
  updateAppPreferences({ appearance: { theme: { id: theme, custom: null } } });
  reapplyIndependentAppearance();
}

function resolveMode(pref: ModePref): Mode {
  if (pref === "light" || pref === "dark") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyMode(pref: ModePref) {
  const html = document.documentElement;
  const resolvedMode = resolveMode(pref);
  html.setAttribute("data-mode", resolvedMode);
  updateAppPreferences({ appearance: { theme: { modePreference: pref, resolvedMode } } });
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

/** Resolve a set of the active theme's tokens from computed style to hex. */
function resolveTokens(keys: readonly string[]): Record<string, string> {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tokens: Record<string, string> = {};
  for (const key of keys) {
    const value = cs.getPropertyValue(key).trim();
    if (value) tokens[key] = resolveTokenToHex(ctx, value);
  }
  return tokens;
}

/** Read the active theme's 8 synced tokens, resolved to hex. */
function resolveSyncTokens(): Record<string, string> {
  return resolveTokens(THEME_SYNC_KEYS);
}

/** Push the active theme + resolved tokens to the daemon for cross-device sync.
 *  Returns whether the write reached the daemon (the manual Resync button shows
 *  the result; the automatic on-change call ignores it). */
async function persistThemeTokens(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!(await flushAppPreferences())) return false;
  try {
    const preferences = readAppPreferences();
    const res = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokenOnly: true,
        tokens: resolveSyncTokens(),
        expectedSelectionRevision: preferences.appearance.theme.selectionRevision,
      }),
    });
    if (!res.ok) {
      if (res.status === 409) await refreshAppPreferences();
      return false;
    }
    await refreshAppPreferences();
    return true;
  } catch {
    return false; // best-effort sync; never block the UI
  }
}

function applyCustomVars(cssVars: CustomThemeData["cssVars"], mode: Mode) {
  const html = document.documentElement;
  clearCustomThemeVariables();
  html.setAttribute("data-theme", "custom");

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
  reapplyIndependentAppearance({ preserveCustomDefaults: true });
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
  clearCustomThemeVariables();
  document.documentElement.setAttribute("data-theme", "coven");
  updateAppPreferences({ appearance: { theme: { id: "coven", custom: null } } });
  reapplyIndependentAppearance();
}

function readPersistedTheme(): ActiveTheme {
  const raw = readAppPreferences().appearance.theme.id;
  if (raw === "custom" || (THEME_IDS as readonly string[]).includes(raw)) return raw as ActiveTheme;
  return "coven";
}

function readPersistedMode(): ModePref {
  return readAppPreferences().appearance.theme.modePreference;
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
      className={`focus-ring relative flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 text-left transition-all ${
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

// Snapshot keys captured when a token edit forks a preset into a custom theme.
// Flipping data-theme to "custom" un-applies the preset's whole CSS block, so
// beyond the 8 editable tokens the fork must pin every per-theme hardcoded
// colour (panel / hover / accent derivatives) plus the legacy shadcn-vocab
// aliases some surfaces still read (bg-background / bg-card / border-border /
// text-foreground) — otherwise editing one token silently resets the rest of
// the look to the default theme instead of layering on the selected one.
const THEME_FORK_SNAPSHOT_KEYS = [
  ...THEME_SYNC_KEYS,
  "--bg-panel",
  "--bg-hover",
  "--border-strong",
  "--accent-presence-foreground",
  "--accent-presence-soft",
  "--accent-faint",
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--border",
  "--foreground",
  "--muted-foreground",
] as const;

/** Companion tokens that must follow an edited core token so the theme stays
 *  coherent: the legacy shadcn-vocab aliases each core token maps onto, the
 *  bg-base surface ramp, and the accent-derived tints (readable foreground,
 *  faint/soft washes — same derivations as the tweakcn import path). */
function deriveTokenCompanions(key: string, value: string, mode: Mode): Record<string, string> {
  switch (key) {
    case "--bg-base": {
      const deepen = mode === "light" ? "white" : "black";
      const lift = mode === "light" ? "black" : "white";
      return {
        "--background": value,
        "--bg-panel": `color-mix(in oklch, ${value} 92%, ${deepen})`,
        "--bg-hover": `color-mix(in oklch, ${value} 84%, ${lift})`,
      };
    }
    case "--bg-raised":
      return { "--card": value, "--popover": value };
    case "--bg-elevated":
      return { "--muted": value };
    case "--text-primary":
      return { "--foreground": value };
    case "--text-secondary":
      return { "--muted-foreground": value };
    case "--border-hairline":
      return { "--border": value };
    case "--accent-presence":
      return {
        "--accent-presence-foreground": readableTextColor(value),
        "--accent-presence-soft": `color-mix(in oklch, ${value} 78%, transparent)`,
        "--accent-faint": `color-mix(in oklch, ${value} 14%, transparent)`,
      };
    default:
      return {};
  }
}

/** Keep the original value's alpha byte when replacing a translucent token
 *  (hairline borders are 12–40% washes; an opaque replacement reads heavy). */
function withAlphaFrom(prev: string | undefined, hex: string): string {
  const m = prev ? /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(prev.trim()) : null;
  return m ? `${hex}${m[1]}` : hex;
}

/** Override a single core token. Forks the active theme to a custom theme so
 *  the edit sticks (and re-syncs). Leaving a preset snapshots the preset's
 *  WHOLE look (THEME_FORK_SNAPSHOT_KEYS) — resolved BEFORE any DOM mutation —
 *  and the whole group is applied live, so only the edited token (plus its
 *  companions) changes on the selected theme. */
function applyTokenOverride(key: string, hex: string, mode: Mode) {
  const html = document.documentElement;
  const themePreferences = readAppPreferences().appearance.theme;
  let existing: CustomThemeData | null =
    themePreferences.id === "custom" ? themePreferences.custom : null;
  try {
    const raw = null;
    if (raw) existing = JSON.parse(raw) as CustomThemeData;
  } catch {
    /* malformed — treat as none */
  }
  const groupKey: "light" | "dark" = mode === "light" ? "light" : "dark";
  const group: Record<string, string> = { ...(existing?.cssVars?.[groupKey] ?? {}) };
  // Seed from the current computed look while the preset CSS is still applied
  // (also fills a missing mode group when a dark-only custom theme is edited
  // in light mode, or vice versa).
  if (Object.keys(group).length === 0) Object.assign(group, resolveTokens(THEME_FORK_SNAPSHOT_KEYS));
  group[key] = hex;
  Object.assign(group, deriveTokenCompanions(key, hex, mode));
  const baseTheme = html.getAttribute("data-theme");
  const forkName =
    baseTheme && baseTheme !== "custom" && (THEME_IDS as readonly string[]).includes(baseTheme)
      ? `${THEME_META[baseTheme as ThemeId].name} (custom)`
      : "Custom";
  const data: CustomThemeData = {
    name: existing?.name ?? forkName,
    cssVars: { ...(existing?.cssVars ?? {}), [groupKey]: group },
  };
  updateAppPreferences({
    appearance: { theme: { id: "custom", resolvedMode: mode, custom: data } },
  });
  // Live-apply the whole group — not just the edited key — so the selected
  // theme's look survives the data-theme flip. Boot (theme-init.js) replays
  // this exact group, so what you see now is what a reload restores.
  for (const [name, value] of Object.entries(group)) {
    html.style.setProperty(name, value);
  }
  html.setAttribute("data-theme", "custom");
}

/** One editable token row — swatch button opening the in-app ColorPicker
 *  (spectrum + hex field + theme/recent swatches) in a popover. */
function TokenColorRow({
  token,
  label,
  value,
  themeSwatches,
  recents,
  onChange,
  onCommit,
}: {
  token: string;
  label: string;
  value: string;
  themeSwatches: ColorSwatch[];
  recents: string[];
  onChange: (hex: string) => void;
  onCommit: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hex = value.slice(0, 7) || "#000000";
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Pick ${label} color`}
        title={`Pick ${label} color`}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring h-6 w-6 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-strong)] transition-transform hover:scale-110"
        style={{ background: value }}
      />
      <span className="flex-1 text-[12px] text-[var(--text-primary)]">{label}</span>
      <code className="font-mono text-[11px] text-[var(--text-muted)]">{token}</code>
      <span className="w-[72px] shrink-0 text-right font-mono text-[11px] uppercase text-[var(--text-secondary)]" title={value}>
        {hex}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onCommit();
        }}
        anchorRef={anchorRef}
        placement="bottom-start"
        offset={8}
        ariaLabel={`${label} color picker`}
      >
        <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
          <ColorPicker value={hex} onChange={onChange} themeSwatches={themeSwatches} recents={recents} />
        </div>
      </Popover>
    </div>
  );
}

/** Per-token override list — every core theme token with a colour swatch you can
 *  edit. Editing applies live on the selected theme, forks it to a custom theme,
 *  and re-syncs. */
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
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const themeSwatches: ColorSwatch[] = useMemo(
    () =>
      THEME_IDS.map((id) => ({
        hex: mode === "light" ? THEME_META[id].accentLight : THEME_META[id].accentDark,
        label: THEME_META[id].name,
      })),
    [mode],
  );
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(getRecentColors());
  }, []);

  // The picker fires onChange per pointer-move, and each apply rewrites ~20
  // root CSS vars + localStorage — coalesce to one apply per animation frame
  // (mirrors the removed editor's rAF throttle). The daemon sync (onChange →
  // reloadCustomData → persistThemeTokens PUT) waits for commit: one network
  // write per finished edit instead of one per move.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ key: string; value: string } | null>(null);
  const flushPendingApply = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) applyTokenOverride(pending.key, pending.value, modeRef.current);
  }, []);
  // Flush on unmount so a drag-in-progress still persists.
  useEffect(() => flushPendingApply, [flushPendingApply]);

  const handlePick = (key: (typeof THEME_SYNC_KEYS)[number], hex: string) => {
    // Preserve the token's original alpha byte (hairline borders are washes).
    const next = withAlphaFrom(valuesRef.current[key], hex);
    setValues((v) => ({ ...v, [key]: next }));
    pendingRef.current = { key, value: next };
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) applyTokenOverride(pending.key, pending.value, modeRef.current);
      });
    }
  };

  const handleCommit = (key: (typeof THEME_SYNC_KEYS)[number]) => {
    flushPendingApply();
    const committed = (valuesRef.current[key] ?? "").slice(0, 7);
    if (committed) setRecents(addRecentColor(committed));
    onChange();
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[11px] text-[var(--text-muted)]">
        Override any of the theme&apos;s core tokens. Edits apply live to the
        selected theme, fork it into a custom theme, and sync immediately.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border-hairline)] overflow-hidden rounded-lg border border-[var(--border-hairline)]">
        {THEME_SYNC_KEYS.map((key) => (
          <TokenColorRow
            key={key}
            token={key}
            label={TOKEN_LABELS[key]}
            value={values[key] ?? "#000000"}
            themeSwatches={themeSwatches}
            recents={recents}
            onChange={(hex) => handlePick(key, hex)}
            onCommit={() => handleCommit(key)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section: Appearance ───────────────────────────────────────────────────────────────────────

// Appearance stacks many groups — tab them so the common controls don't require
// a long scroll. Labels in APPEARANCE_TAB_GROUPS must match each SettingsGroup
// label so search/deep-link can switch to the right tab. Module-level (stable
// ref) so the tab effect doesn't re-run every render.
type AppearanceTab = "theme" | "colors" | "typography" | "interface";
const APPEARANCE_TABS: ReadonlyArray<TabItem<AppearanceTab>> = [
  { id: "theme", label: "Theme" },
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "interface", label: "Interface" },
];
const APPEARANCE_TAB_GROUPS: Record<AppearanceTab, readonly string[]> = {
  theme: ["Mode", "Theme", "Import from tweakcn"],
  colors: ["Theme tokens"],
  typography: ["Typography", "Reading text", "Date & time"],
  interface: ["Corners"],
};

function AppearanceSection({ scrollTarget }: { scrollTarget?: string | null }) {
  const [activeTheme, setActiveTheme] = useState<ActiveTheme>("coven");
  const [mode, setMode] = useState<ModePref>("dark");
  const [customData, setCustomData] = useState<CustomThemeData | null>(null);
  const [appearanceHydrated, setAppearanceHydrated] = useState(false);
  // Below the shell's FamiliarStudioProvider — lets the pin-order hint open
  // Familiars directly on the Lifecycle tab (the app-wide roster order lives
  // there, distinct from the avatar-strip pin order set here).
  const { setActiveTab: setStudioTab } = useFamiliarStudio();

  // Mirror the active theme + resolved tokens to the daemon on change (and mount)
  // so cross-device clients can read it. Best-effort; failures are swallowed.
  useEffect(() => {
    if (!appearanceHydrated) return;
    void persistThemeTokens();
  }, [activeTheme, mode, customData, appearanceHydrated]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; at: string } | null>(null);

  const handleResync = async () => {
    setSyncing(true);
    const ok = await persistThemeTokens();
    announce(ok ? "Theme synced to phone." : "Couldn't reach the daemon to sync.", ok ? "polite" : "assertive");
    setSyncing(false);
    setSyncResult({ ok, at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });
  };

  const reloadCustomData = () => {
    setActiveTheme("custom");
    setCustomData(readAppPreferences().appearance.theme.custom);
  };
  const [cornerRadius, setCornerRadius] = useState<CornerRadius>("default");

  // Read persisted theme + mode on mount
  useEffect(() => {
    const preferences = readAppPreferences();
    setActiveTheme(readPersistedTheme());
    setMode(readPersistedMode());
    setCornerRadius(readCornerRadius());
    const saved = preferences.appearance.theme.id;
    if (saved === "custom") {
      const raw = preferences.appearance.theme.custom;
      if (raw) {
        try {
          setCustomData(raw);
        } catch {
          /* malformed — ignore */
        }
      }
    }
    setAppearanceHydrated(true);
  }, []);

  const handleSelectPreset = (id: PresetTheme) => {
    setActiveTheme(id);
    setCustomData(null);
    applyPreset(id);
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

  // Two-step: an imported/tuned theme is unrecoverable once cleared (recovery
  // = re-import from a remembered URL), and the trigger is a ~14px X. First
  // click arms, second confirms; arming auto-disarms after a beat (cave-5lsj).
  const [resetCustomArmed, setResetCustomArmed] = useState(false);
  useEffect(() => {
    if (!resetCustomArmed) return;
    const t = window.setTimeout(() => setResetCustomArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [resetCustomArmed]);
  const handleResetCustom = () => {
    if (!resetCustomArmed) {
      setResetCustomArmed(true);
      return;
    }
    setResetCustomArmed(false);
    clearCustomTheme();
    setActiveTheme("coven");
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
      const msg = "Invalid tweakcn URL. Expected https://tweakcn.com/themes/{id}, /r/themes/{id}, or /editor/theme?theme={name}.";
      setImportError(msg);
      announce(msg, "assertive");
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
      updateAppPreferences({
        appearance: {
          theme: { id: "custom", resolvedMode: resolveMode(mode), custom: data },
        },
      });
      setCustomData(data);
      setActiveTheme("custom");
      setImportUrl("");
      announce(`Imported theme "${data.name}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      setImportError(msg);
      announce(`Theme import failed: ${msg}`, "assertive");
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsPage section="appearance" title="Appearance" description="Colors and visual style.">
      <SettingsTabbed
        ariaLabel="Appearance settings"
        tabs={APPEARANCE_TABS}
        groupsByTab={APPEARANCE_TAB_GROUPS}
        scrollTarget={scrollTarget}
      >
        {(tab) => (
          <>
      {/* ── Mode toggle ── */}
      {tab === "theme" && (
      <SettingsGroup label="Mode">
        <div className="px-4 py-3">
          <ModeToggle value={mode} onChange={handleSetMode} />
        </div>
      </SettingsGroup>
      )}

      {/* ── Preset themes ── */}
      {tab === "theme" && (
      <SettingsGroup label="Theme">
        {/* Custom theme chip */}
        {activeTheme === "custom" && customData && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-hairline)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-3 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
              <Icon name="ph:sparkle" width={11} className="text-[var(--accent-presence)]" />
              Custom: {customData.name}
              {resetCustomArmed ? (
                <Button
                  variant="danger-ghost"
                  size="xs"
                  className="ml-1"
                  onClick={handleResetCustom}
                  aria-label={`Really discard ${customData.name}? Click again to confirm`}
                >
                  Discard?
                </Button>
              ) : (
                <IconButton
                  icon="ph:x-bold"
                  size="xs"
                  className="ml-1"
                  onClick={handleResetCustom}
                  aria-label={`Discard ${customData.name}`}
                />
              )}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {resetCustomArmed
                ? "Click again to discard — re-importing needs the original URL."
                : "Active — presets below will override."}
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
              active={activeTheme === preset.id}
              onSelect={handleSelectPreset}
            />
          ))}
        </div>
      </SettingsGroup>
      )}

      {/* ── Per-token overrides + manual resync ── the single place to customize
          the selected theme's colors (the old three-color editor was redundant
          with this panel and has been removed). */}
      {tab === "colors" && (
      <SettingsGroup label="Theme tokens">
        <ThemeTokenOverrides
          mode={resolveMode(mode)}
          reloadKey={`${activeTheme}:${mode}:${customData ? "c" : "p"}`}
          onChange={reloadCustomData}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-hairline)] px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleResync()}
            loading={syncing}
            disabled={syncing}
            leadingIcon="ph:arrows-clockwise"
          >
            {syncing ? "Syncing…" : "Resync to phone"}
          </Button>
          <span className="text-[11px] text-[var(--text-muted)]">
            {syncResult
              ? syncResult.ok
                ? `Synced at ${syncResult.at}.`
                : "Couldn’t reach the daemon — is it running?"
              : "Your theme syncs to the phone automatically; resync to push it now."}
          </span>
        </div>
      </SettingsGroup>
      )}

      {/* ── tweakcn import ── */}
      {tab === "theme" && (
      <SettingsGroup label="Import from tweakcn">
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[12px] text-[var(--text-muted)]">
            Use Browse to open tweakcn.com in the in-app browser, then paste a theme URL to apply it. Supports{" "}
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
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() => openExternalUrl("https://tweakcn.com/editor/theme")}
              leadingIcon="ph:globe"
              title="Browse tweakcn themes in the in-app browser"
            >
              Browse
            </Button>
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
            <Button
              variant="primary"
              className="shrink-0"
              onClick={() => void handleImport()}
              loading={importing}
              disabled={importing || !importUrl.trim()}
              leadingIcon="ph:arrow-down-bold"
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
          {importError && (
            <p role="alert" className="flex items-start gap-1.5 text-[11px] text-[var(--color-danger)]">
              <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0" />
              {importError}
            </p>
          )}
        </div>
      </SettingsGroup>
      )}

      {tab === "typography" && <FontSettings />}

      {/* ── Backdrop ── an image behind Home + Chat with the accent tinted to
          match it (cave-backdrop.ts owns storage + the vibe derivation). */}
      <SettingsGroup label="Backdrop">
        <BackdropSettings />
      </SettingsGroup>

      {/* ── Corner radius ── a minor shape tweak (drives the shared --radius
          tokens), kept last so the primary color/theme and text controls lead. */}
      {tab === "interface" && (
      <SettingsGroup label="Corners">
        <SettingControlRow
          label="Corner radius"
          hint="Roundedness of buttons, cards, and the familiar switcher."
        >
          <Segmented
            ariaLabel="Corner radius"
            options={CORNER_RADIUS_OPTIONS}
            value={cornerRadius}
            onChange={(option) => handleSetCornerRadius(option)}
            getLabel={(option) => CORNER_RADIUS_LABELS[option]}
          />
        </SettingControlRow>
      </SettingsGroup>
      )}
          </>
        )}
      </SettingsTabbed>
    </SettingsPage>
  );
}

// ─── Section: Phone (connect the native mobile app) ─────────────────────────────

/** Plain-language framing for handoff failures. The raw error stays available
 *  behind a disclosure; the headline tells a person what to actually do. */
function describeMobileHandoffError(raw: string): { headline: string; hint: string } {
  const text = raw.toLowerCase();
  if (text.includes("pnpm dev") || text.includes("access token")) {
    return {
      headline: "Pairing runs in the packaged Cave app",
      hint: "This dev server can’t mint pairing codes — open CovenCave from Applications and pair from there.",
    };
  }
  if (
    text.includes("tailscale") &&
    (text.includes("not connected") ||
      text.includes("not running") ||
      text.includes("stopped") ||
      text.includes("unreachable") ||
      text.includes("logged out"))
  ) {
    return {
      headline: "Tailscale isn’t running",
      hint: "Open Tailscale and sign in — pairing resumes here automatically.",
    };
  }
  // Word-boundary match: backend errors mentioning a "server" must not be
  // misdiagnosed as Tailscale Serve failures (cave-gzje).
  if (/\bserve\b/.test(text)) {
    return {
      headline: "Tailscale Serve couldn’t start",
      hint: "Retry below; if it keeps failing, quit and reopen Tailscale.",
    };
  }
  return {
    headline: "Phone pairing is unavailable",
    hint: "Retry below — the technical details may help if it persists.",
  };
}

type MobileHandoffCardState = {
  nativeHost: string | null;
  inviteUrl: string | null;
  appInviteUrl: string | null;
  qrSvg: string | null;
  /** Last token-refresh beat from a paired device (cave-i74f) — pairing
   *  success used to be silent on the desktop. */
  lastSeenAt: number | null;
};

function MobileModeToggle() {
  const [mobileModeEnabled, setMobileModeEnabled] = useState(readMobileModeEnabled);
  const [handoff, setHandoff] = useState<MobileHandoffCardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "app" | "host" | null>(null);

  const reconcileMobileMode = useCallback(async (enabled: boolean, options?: { busy?: boolean }) => {
    if (options?.busy) setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: enabled ? "app-start" : "app-stop" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        nativeHost?: string | null;
        inviteUrl?: string | null;
        appInviteUrl?: string | null;
        qrSvg?: string | null;
        lastSeenAt?: number | null;
        error?: string;
        stderr?: string;
      };
      if (!json.ok) {
        setError(json.stderr || json.error || "Mobile mode unavailable.");
        return;
      }
      setHandoff(
        enabled
          ? {
              nativeHost: json.nativeHost ?? null,
              inviteUrl: json.inviteUrl ?? null,
              appInviteUrl: json.appInviteUrl ?? null,
              qrSvg: json.qrSvg ?? null,
              lastSeenAt: json.lastSeenAt ?? null,
            }
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mobile mode unavailable.");
    } finally {
      if (options?.busy) setBusy(false);
    }
  }, []);

  const onMobileModeChange = async (enabled: boolean) => {
    writeMobileModeEnabled(enabled);
    setMobileModeEnabled(enabled);
    await reconcileMobileMode(enabled, { busy: true });
  };

  useEffect(() => {
    void reconcileMobileMode(mobileModeEnabled);
  }, [mobileModeEnabled, reconcileMobileMode]);
  // Recurring reconcile only while mobile mode is on; pauses in a hidden tab.
  usePausablePoll(() => void reconcileMobileMode(true), 60_000, {
    enabled: mobileModeEnabled,
  });

  const copy = (kind: "link" | "app" | "host", value: string) => {
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
    });
  };

  const friendly = error ? describeMobileHandoffError(error) : null;
  const statusLine = busy
    ? "Updating…"
    : !mobileModeEnabled
      ? "Off — turn on to pair your iPhone."
      : friendly
        ? friendly.headline
        : handoff?.qrSvg
          ? "Ready — scan the code with your iPhone camera."
          : "Starting the tailnet route…";

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Status header + the one switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              !mobileModeEnabled
                ? "bg-[var(--text-muted)]"
                : friendly
                  ? "bg-[var(--color-warning)]"
                  : handoff?.qrSvg
                    ? "bg-[var(--color-success)]"
                    : "bg-[var(--text-muted)]"
            }`}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[var(--text-primary)]">Mobile mode</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">{statusLine}</p>
            {handoff?.lastSeenAt ? (
              <p className="truncate text-[11px] text-[var(--text-secondary)]">
                Paired · last seen {relativeTime(new Date(handoff.lastSeenAt).toISOString())}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={mobileModeEnabled}
          onClick={() => void onMobileModeChange(!mobileModeEnabled)}
          disabled={busy}
          className={`settings-mobile-switch rounded-[var(--radius-control)] border px-3 py-1.5 text-[12px] transition-colors ${
            mobileModeEnabled
              ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--accent-contrast)]"
              : "border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-secondary)]"
          }`}
        >
          {busy ? "Updating..." : mobileModeEnabled ? "On" : "Off"}
        </button>
      </div>

      {/* Humanized failure — the jargon lives behind a disclosure now. */}
      {mobileModeEnabled && friendly && error ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--color-warning)_35%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-3.5 py-3"
        >
          <p className="text-[12px] font-medium text-[var(--color-warning)]">{friendly.headline}</p>
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{friendly.hint}</p>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="secondary"
              leadingIcon="ph:arrows-clockwise"
              onClick={() => void reconcileMobileMode(true, { busy: true })}
              disabled={busy}
            >
              Retry
            </Button>
          </div>
          <details className="text-[11px] text-[var(--text-muted)]">
            <summary className="cursor-pointer">Technical details</summary>
            <code className="mt-1 block whitespace-pre-wrap break-words font-mono text-[10px]">{error}</code>
          </details>
        </div>
      ) : null}

      {/* The pairing code — one scan, no typing. */}
      {mobileModeEnabled && !friendly && handoff?.qrSvg ? (
        <div className="flex flex-col items-center gap-2.5">
          <div
            className="mobile-handoff-qr__svg overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-white p-2"
            role="img"
            aria-label="Pairing code for your iPhone camera"
            dangerouslySetInnerHTML={{ __html: handoff.qrSvg }}
          />
          <p className="text-[12px] text-[var(--text-secondary)]">
            Scan with your iPhone camera — Cave opens on your phone already paired.
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Works in Safari or the Cave app · the code refreshes itself while this switch is on.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {handoff.inviteUrl ? (
              <Button
                size="xs"
                variant="secondary"
                leadingIcon={copied === "link" ? "ph:check" : "ph:copy"}
                onClick={() => copy("link", handoff.inviteUrl ?? "")}
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
            ) : null}
            {handoff.appInviteUrl ? (
              <Button
                size="xs"
                variant="ghost"
                leadingIcon={copied === "app" ? "ph:check" : "ph:copy"}
                onClick={() => copy("app", handoff.appInviteUrl ?? "")}
              >
                {copied === "app" ? "Copied" : "Copy app link"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Everything that used to be four loud steps lives here, folded away. */}
      {mobileModeEnabled ? (
        <details className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] px-3.5 py-2.5">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-secondary)]">
            Manual setup
          </summary>
          <div className="mt-2 flex flex-col gap-2 text-[12px] text-[var(--text-secondary)]">
            {handoff?.nativeHost ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--text-muted)]">Desktop address:</span>
                <code className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">
                  {handoff.nativeHost}
                </code>
                <Button
                  size="xs"
                  variant="ghost"
                  leadingIcon={copied === "host" ? "ph:check" : "ph:copy"}
                  onClick={() => copy("host", handoff.nativeHost ?? "")}
                >
                  {copied === "host" ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : null}
            <p>
              Sign your iPhone and this Mac into the same Tailscale network, open the Cave app, and enter the
              desktop address on its connect screen. Pasting the copied link works too.
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function MobileSection() {
  return (
    <SettingsPage
      section="mobile"
      title="Connect your iPhone"
      description="One scan pairs your phone over your private Tailscale network — no typing, no password."
    >
      <SettingsGroup label="Pair">
        <MobileModeToggle />
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
          <Button
            variant="secondary"
            size="sm"
            className="settings-touch-action"
            onClick={() => openExternalUrl("https://github.com/OpenCoven/coven-cave/blob/main/docs/ios-native-rebuild.md")}
            leadingIcon="ph:file-text"
          >
            Setup guide
          </Button>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: About ───────────────────────────────────────────────────────────

function AboutDaemonStatusRow() {
  const [state, setState] = useState<AboutDaemonState>({ kind: "checking" });
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ kind: "checking" });
    void fetch("/api/daemon/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        setState(classifyAboutDaemonStatus({
          responseOk: response.ok,
          payload,
          checkedAt: new Date().toISOString(),
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState(classifyAboutDaemonStatus({
          responseOk: false,
          payload: null,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "status request failed",
        }));
      });
  }, []);

  useEffect(() => {
    refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  const detail =
    state.kind === "running"
      ? state.version ? `Running v${state.version}` : "Running (version unavailable)"
      : state.kind === "stopped"
        ? "Stopped"
        : state.kind === "unreachable"
          ? "Unreachable"
          : state.kind === "failed-to-check"
            ? "Failed to check"
            : "Checking…";
  const reason = state.kind === "checking" || state.kind === "running" ? null : state.reason;
  const checkedAt = state.kind === "checking" ? null : state.checkedAt;
  const tone =
    state.kind === "running"
      ? "text-[var(--color-success)]"
      : state.kind === "checking"
        ? "text-[var(--text-muted)]"
        : state.kind === "stopped"
          ? "text-[var(--color-warning)]"
          : "text-[var(--color-danger)]";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">Daemon</span>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`truncate text-right text-[12px] ${tone}`} title={reason ?? checkedAt ?? undefined}>
          {detail}{checkedAt ? ` · checked ${relativeTime(checkedAt)}` : ""}
        </span>
        <Button variant="secondary" size="xs" onClick={refresh} disabled={state.kind === "checking"}>
          {state.kind === "checking" ? "Checking…" : "Retry"}
        </Button>
      </div>
      {reason ? (
        <p className="basis-full text-right text-[11px] text-[var(--text-muted)]">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function AboutSection() {
  return (
    <SettingsPage section="about" title="About" description="Version and build information.">
      <SettingsGroup label="CovenCave">
        <SettingsKV label="App version" value={APP_VERSION} />
        <UpdateSettingsRow />
        <AboutDaemonStatusRow />
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
            <Button
              key={l.href}
              variant="secondary"
              size="xs"
              className="settings-touch-action settings-tool-action gap-1.5 px-2.5 text-[11px]"
              onClick={() => openExternalUrl(l.href)}
              leadingIcon={l.icon}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SettingsPage({ title, description, section, children }: { title: string; description?: string; section?: Section; children: React.ReactNode }) {
  const pageTitleId = section ? `settings-${section}-title` : "settings-page-title";
  return (
    <section className="max-w-none space-y-6" aria-labelledby={pageTitleId}>
      <h2 id={pageTitleId} className="sr-only">{title}</h2>
      {section ? (
        <SettingsOverview section={section} />
      ) : (
        <div>
          <p className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</p>
          {description && <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>}
        </div>
      )}
      {children}
    </section>
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
