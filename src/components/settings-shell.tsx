"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { SettingsGroup, settingsGroupId } from "@/components/ui/settings-group";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingControlRow, Segmented } from "@/components/ui/settings-controls";
import { SearchInput } from "@/components/ui/search-input";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FamiliarStudioInlinePanel } from "@/components/familiar-studio-inline";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarPinOrder } from "@/components/familiar-pin-order";
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
import { readableTextColor } from "@/lib/readable-text-color";
import { openExternalUrl } from "@/lib/open-external";

// ─── Types ────────────────────────────────────────────────────────────────────

type DaemonStatus = {
  running: boolean;
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

const MOBILE_MODE_STORAGE_KEY = "cave:mobile-mode-enabled";

function readMobileModeEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MOBILE_MODE_STORAGE_KEY) !== "false";
}

function writeMobileModeEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_MODE_STORAGE_KEY, enabled ? "true" : "false");
}

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
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_INDEX.filter((e) =>
      `${settingsSectionLabel(e.section)} ${e.group ?? ""} ${e.keywords}`.toLowerCase().includes(q));
  }, [query]);

  function goToSetting(entry: SettingsIndexEntry) {
    openSection(entry.section);
    setQuery("");
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
        setSection(hash);
        setPickerView(false);
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
      <header
        className="settings-shell__header flex shrink-0 items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-2.5"
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
        <div className="min-w-0">
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
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
                    className="focus-ring flex w-full flex-col items-start rounded-[5px] px-2.5 py-[5px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
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
                className={`settings-nav__item focus-ring flex w-full items-center rounded-[5px] px-2.5 text-left transition-colors ${
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
                <span className="flex flex-1 flex-col">
                  <span>{s.label}</span>
                  <span className="settings-nav__description">{s.description}</span>
                </span>
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
          {section === "general" && <GeneralSection />}
          {section === "daemon"   && <DaemonSection />}
          {section === "familiars" && <FamiliarsSection />}
          {section === "mobile"   && <MobileSection />}
          {section === "appearance" && <AppearanceSection />}
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

  const refresh = () => {
    setLoading(true);
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaemonStatus) => { setStatus(j); setLoading(false); })
      .catch(() => { setStatus({ running: false }); setLoading(false); });
  };

  useEffect(refresh, []);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; config?: { multiHost?: { mode?: MultiHostMode; hubUrl?: string; executorUrls?: string[] } } }) => {
        const multiHost = j.config?.multiHost;
        if (!j.ok || !multiHost) return;
        setMode(multiHost.mode === "hub" ? "hub" : "local");
        setHubUrl(multiHost.hubUrl ?? "");
        setExecutorText((multiHost.executorUrls ?? []).join("\n"));
      })
      .catch(() => {});
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
          hint={status?.target?.mode === "hub" ? `Connected through ${status.target.url ?? "server hub"}` : "Use the local sidecar daemon or a server hub on your private network."}
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
        <SettingControlRow label="Executor addresses" hint="Optional executor nodes, one per line.">
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
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => void saveConnection()}
            disabled={savingConnection}
            className="settings-touch-action focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-60"
          >
            <Icon name="ph:floppy-disk-bold" width={12} />
            {savingConnection ? "Saving..." : "Save connection"}
          </button>
          {connectionError && <span role="alert" className="text-[11px] text-[var(--color-danger)]">{connectionError}</span>}
        </div>
      </SettingsGroup>

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
          {status?.running && (
            <button
              type="button"
              onClick={restartDaemon}
              disabled={restarting}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent-presence-foreground)] hover:opacity-90 disabled:opacity-60"
              title="coven daemon start"
            >
              <Icon name="ph:arrow-clockwise" width={12} />
              {restarting ? "Restarting..." : "Restart daemon"}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className="focus-ring flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-clockwise" width={11} />
            Refresh
          </button>
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
                <button
                  type="button"
                  onClick={() => void setManualOffline(!status.travel?.manualOffline)}
                  disabled={savingTravel}
                  className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-60"
                >
                  <Icon name={status.travel.manualOffline ? "ph:plug-bold" : "ph:plug"} width={12} />
                  {status.travel.manualOffline ? "Return online" : "Manual offline"}
                </button>
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
        const res = await fetch("/api/familiars", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setRawFamiliars((json.familiars ?? []) as Familiar[]);
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
  const { announce } = useAnnouncer();
  // colorEditorBase: the preset that seeds the color editor; null = editor hidden.
  const [colorEditorBase, setColorEditorBase] = useState<PresetTheme | null>(null);
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
      localStorage.setItem(COVEN_CUSTOM_THEME_KEY, JSON.stringify(data));
      localStorage.setItem(COVEN_THEME_KEY, "custom");
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
            <p role="alert" className="flex items-start gap-1.5 text-[11px] text-[var(--color-danger)]">
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
        <SettingControlRow
          label="Top-bar style"
          hint="Show recent & pinned familiars as a row of avatars, or just the switcher dropdown."
        >
          <Segmented
            ariaLabel="Familiar switcher style"
            options={FAMILIAR_SWITCHER_STYLE_OPTIONS}
            value={familiarSwitcherStyle}
            onChange={(option) => setFamiliarSwitcherStyle(option)}
            getLabel={(option) => FAMILIAR_SWITCHER_STYLE_LABELS[option]}
          />
        </SettingControlRow>

        {/* Avatars shown + Pin order — only meaningful for the avatar strip, so
            they follow the style toggle and show only when that style is active. */}
        {familiarSwitcherStyle === "avatars" ? (
          <>
            <SettingControlRow
              label="Avatars shown"
              hint="Show only your pinned familiars in the strip, or every familiar."
              className="border-t border-[var(--border-hairline)]"
            >
              <Segmented
                ariaLabel="Familiars shown in the avatar strip"
                options={FAMILIAR_STRIP_SCOPE_OPTIONS}
                value={familiarStripScope}
                onChange={(option) => setFamiliarStripScope(option)}
                getLabel={(option) => FAMILIAR_STRIP_SCOPE_LABELS[option]}
              />
            </SettingControlRow>

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
    </SettingsPage>
  );
}

// ─── Section: Phone (connect the native mobile app) ─────────────────────────────

function MobileModeToggle() {
  const [mobileModeEnabled, setMobileModeEnabled] = useState(readMobileModeEnabled);
  const [host, setHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        error?: string;
        stderr?: string;
      };
      if (!json.ok) {
        setError(json.stderr || json.error || "Mobile mode unavailable.");
        return;
      }
      setHost(enabled ? json.nativeHost ?? null : null);
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

  return (
    <SettingsRow
      label="Mobile mode"
      description="Default on. Cave keeps the native iOS Tailscale route alive until you turn this off."
    >
      <div className="flex min-w-[220px] flex-col items-end gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={mobileModeEnabled}
          onClick={() => void onMobileModeChange(!mobileModeEnabled)}
          disabled={busy}
          className={`settings-mobile-switch rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
            mobileModeEnabled
              ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--accent-contrast)]"
              : "border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-secondary)]"
          }`}
        >
          {busy ? "Updating..." : mobileModeEnabled ? "On" : "Off"}
        </button>
        {host ? <code className="max-w-[220px] truncate text-[11px] text-[var(--text-muted)]">{host}</code> : null}
        {error ? <span className="max-w-[220px] text-right text-[11px] text-[var(--danger)]">{error}</span> : null}
      </div>
    </SettingsRow>
  );
}

function MobileSection() {
  return (
    <SettingsPage
      section="mobile"
      title="Connect on your phone"
      description="Run the native Coven Cave app on your iPhone or iPad and reach this desktop over your Tailscale network — no token, no password."
    >
      <SettingsGroup label="Mobile mode">
        <MobileModeToggle />
      </SettingsGroup>

      <SettingsGroup label="Steps">
        <SettingsRow label="1 · Same Tailscale network" description="Sign your phone and this Mac into the same tailnet." />
        <SettingsRow label="2 · Mobile mode stays on" description="Cave reconciles Tailscale Serve automatically while the switch is on." />
        <SettingsRow
          label="3 · Enter the address in the app"
          description="On the app’s connect screen, type the host shown by mobile mode (your Mac’s Tailscale name)."
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
          <button
            type="button"
            onClick={() => openExternalUrl("https://github.com/OpenCoven/coven-cave/blob/main/docs/ios-native-rebuild.md")}
            className="settings-touch-action gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:file-text" width={12} />
            Setup guide
          </button>
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
    <SettingsPage section="about" title="About" description="Version and build information.">
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
            <button
              key={l.href}
              type="button"
              onClick={() => openExternalUrl(l.href)}
              className="settings-touch-action gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name={l.icon} width={12} />
              {l.label}
            </button>
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
