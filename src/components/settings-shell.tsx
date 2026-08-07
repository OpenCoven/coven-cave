"use client";

import "@/styles/dashboard.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";
import { useSurfaceHistory } from "@/lib/use-surface-history";
import { relativeTime } from "@/lib/relative-time";
import { SettingsGroup, settingsGroupId } from "@/components/ui/settings-group";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingControlRow, Segmented } from "@/components/ui/settings-controls";
import { SearchInput } from "@/components/ui/search-input";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { SkeletonRows } from "@/components/ui/skeleton";
import { THEME_IDS, THEME_META, getSwatches, type ThemeId } from "@/lib/theme-palettes";
import type { Mode, ModePref } from "@/lib/theme-storage";
import { ModeToggle } from "@/components/mode-toggle";
import { useIsMobile } from "@/lib/use-viewport";
import { useIsTauriDesktop } from "@/lib/tauri-platform";
import { useCelebrationsEnabled, writeCelebrationsEnabled } from "@/lib/celebrations-pref";
import {
  STOP_PHRASE_MAX_LENGTH,
  appendStopPhrase,
  parseStopPhrases,
  removeStopPhraseAt,
  useStopPhrase,
  writeStopPhrase,
} from "@/lib/stop-phrase";
import { ColorPicker, type ColorSwatch } from "@/components/ui/color-picker";
import { Popover } from "@/components/ui/popover";
import { addRecentColor, getRecentColors } from "@/lib/recent-colors";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";
import { FontSettings } from "./settings-fonts";
import { DaemonSection } from "./settings-daemon";
import { SettingsTabbed } from "./settings-section-tabs";
import type { TabItem } from "@/components/ui/tabs";
import { ProfileSection } from "./settings-profile";
import { SettingsOverview } from "./settings-overview";
import { AboutSection } from "./settings-about";
import { PhoneSection } from "./settings-phone";
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
import { getBackupPassphraseGuidance } from "@/lib/backup-passphrase-strength";
import { BackdropSettings } from "@/components/backdrop-settings";
import { VoiceEngineSettings } from "@/components/voice-engine-settings";
import { VoiceProviderSettings } from "@/components/voice-provider-settings";
import {
  flushAppPreferences,
  readAppPreferences,
  refreshAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import {
  clearCustomThemeVariables,
  reapplyIndependentAppearance,
} from "@/lib/appearance-restore";
import type { CustomThemeData } from "@/lib/preferences-schema";
import { publishFleetTokenStatus } from "@/lib/omnigent/use-fleet-gate";
import {
  formatHostWorkspaceText,
  parseHostWorkspaceText,
} from "./settings-multihost";

// ─── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell() {
  const router = useRouter();
  const isMobile = useIsMobile();

  // Sections are navigation, not view state: Back from Appearance should land
  // on the section you came from rather than popping the whole route.
  const {
    value: section,
    select: selectSection,
    show: showSection,
  } = useSurfaceHistory<Section>({ id: "settings:section", initial: "general" });
  const setSection = showSection;
  const [suggestedHubUrl, setSuggestedHubUrl] = useState<string | null>(null);
  // Mobile drill-down: when true, render the section list full-screen
  // (no section content) — iOS-Settings-style. Tap a section → false,
  // render that section.
  const [pickerView, setPickerView] = useState(false);
  const activeSection = SECTIONS.find((s) => s.id === section);
  const showPicker = isMobile && pickerView;

  // ── Search across settings ────────────────────────────────────────────────
  const { value: query, select: selectQuery, show: setQuery } = useSurfaceHistory<string>({
    id: "settings:search",
    initial: "",
    coalesceMs: 1200,
  });
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

  /** A user picking a section — from the rail, the search results, or ⌘↓. */
  function openSection(id: Section) {
    selectSection(id);
    setPickerView(false);
  }
  function backToPicker() {
    setPickerView(true);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  // Keep the deep-link hash on whatever section is showing, including one the
  // history controls restored — openSection is no longer the only way to move.
  useEffect(() => {
    if (typeof window === "undefined" || pickerView) return;
    if (window.location.hash === `#${section}`) return;
    window.history.replaceState(null, "", `#${section}`);
  }, [section, pickerView]);

  // Support hash-based deep-linking. Read it after hydration so SSR and the
  // first client render both start on General.
  useEffect(() => {
    const applyHashSection = () => {
      const hash = window.location.hash.replace("#", "") as Section;
      if (SECTIONS.some((s) => s.id === hash)) {
        const params = new URLSearchParams(window.location.search);
        const group = params.get("group")?.trim();
        setSection(hash);
        setPickerView(false);
        setScrollTarget(group ? settingsGroupId(group) : null);
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
        className="settings-shell__header surface-compact-header shrink-0 [padding-top:calc(5px_+_var(--sai-top))]!"
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
          <p className="mb-1 px-4 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Settings
          </p>
          <div className={`mb-2 ${showPicker ? "px-3" : "px-2"}`}>
            <SearchInput
              value={query}
              onValueChange={selectQuery}
              onClear={() => setQuery("")}
              placeholder="Search settings…"
              aria-label="Search settings"
            />
          </div>
          {query.trim() ? (
            <div className={`space-y-px ${showPicker ? "px-3" : "px-2"}`} role="list" aria-label="Settings search results">
              {results.length === 0 ? (
                <p className="px-2.5 py-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">No settings match “{query.trim()}”.</p>
              ) : results.map((e) => (
                <div key={`${e.section}:${e.group ?? ""}`} role="listitem">
                  <button
                    type="button"
                    onClick={() => goToSetting(e)}
                    className="focus-ring flex w-full flex-col items-start rounded-[var(--radius-control)] px-2.5 py-[5px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                  >
                    <span className="text-[length:var(--text-sm)] font-medium">{e.group ?? settingsSectionLabel(e.section)}</span>
                    <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{settingsSectionLabel(e.section)}</span>
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
                    ? "min-h-[var(--touch-target)] gap-3 py-3 text-[length:var(--text-md)]"
                    : "gap-2 py-[6px] text-[length:var(--text-sm)]"
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
          className="settings-shell__content min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 [padding-bottom:calc(1.5rem_+_var(--sai-bottom))]!"
        >
          {section === "profile" && <ProfileSection />}
          {section === "general" && <GeneralSection />}
          {section === "voice" && <VoiceSection />}
          {section === "daemon" && (
            <DaemonSection
              suggestedHubUrl={suggestedHubUrl}
              onSuggestionConsumed={() => setSuggestedHubUrl(null)}
              omnigentSettings={<OmnigentSettingsGroup />}
            />
          )}
          {section === "mobile"   && <PhoneSection onUseAsHub={(url) => { setSuggestedHubUrl(url); openSection("daemon"); }} />}
          {section === "appearance" && <AppearanceSection scrollTarget={scrollTarget} />}
          {section === "about"    && <AboutSection />}
        </main>
      </div>
      <footer className="shrink-0 border-t border-[var(--border-hairline)] px-4 py-1.5 text-center text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        {isMobile ? (pickerView ? "Tap a section to open" : "Back returns to Settings") : "Esc back · ↑↓ navigate sections"}
      </footer>
    </div>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection() {
  return (
    <SettingsPage section="general" title="General" description="App-wide preferences." variant="control-sheet">
      <SettingsGroup label="Workspace" variant="ruled" panel={false}>
        <SettingsRow
          label="Workspace path"
          description="Where Coven stores familiar workspaces."
          variant="sheet"
        >
          <WorkspacePathField />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup label="Chat" variant="ruled" panel={false}>
        <StopPhraseField />
      </SettingsGroup>
      <SettingsGroup label="Progression" variant="ruled" panel={false}>
        <div className="settings-progression-card">
          <CelebrationsToggle />
        </div>
      </SettingsGroup>
      <BackupSettingsGroup />
      <SettingsGroup label="Startup" variant="ruled" panel={false}>
        <div className="settings-startup-grid">
          <div className="settings-startup-cell">
            <span>Launch at login</span>
            <span className="settings-startup-soon">Soon</span>
          </div>
          <div className="settings-startup-cell">
            <span>Open to</span>
            <span className="settings-startup-soon">Soon</span>
          </div>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: Voice ───────────────────────────────────────────────────────────

function VoiceSection() {
  return (
    <div className="settings-voice">
      <SettingsPage
        section="voice"
        title="Voice"
        description="Providers, models, voices, and creation defaults."
      >
        <VoiceProviderSettings localSpeechSettings={<VoiceEngineSettings />} />
      </SettingsPage>
    </div>
  );
}

// The dial-it-down switch for the renown system's louder moments. Off is a
// clean-tool mode, not a mute-with-loss: milestones still land in the inbox
// and completions still announce for AT — only the celebratory presentation
// (toasts, flourishes) stills.
function CelebrationsToggle() {
  const celebrationsEnabled = useCelebrationsEnabled();
  return (
    <SettingsRow
      label="Celebrations"
      description="Milestone toasts and completion flourishes. Off keeps milestones in the inbox only."
    >
      <button
        type="button"
        role="switch"
        aria-checked={celebrationsEnabled}
        aria-label="Celebrations"
        onClick={() => writeCelebrationsEnabled(!celebrationsEnabled)}
        className={`settings-switch focus-ring${celebrationsEnabled ? " is-on" : ""}`}
      >
        <span className="settings-switch__knob" aria-hidden />
      </button>
    </SettingsRow>
  );
}

// Stop phrases are a safety valve: while a familiar is mid-task, typing any
// one of these comma-separated phrases in a chat composer halts the run (the
// composer's busy bail otherwise swallows plain sends). Commit on blur/Enter;
// clearing the field disables interception.
function StopPhraseField() {
  const saved = useStopPhrase();
  const { announce } = useAnnouncer();
  const [draft, setDraft] = useState("");
  const phrases = parseStopPhrases(saved);

  const persist = (value: string, announcement: string) => {
    writeStopPhrase(value);
    announce(announcement);
  };

  const addDraft = () => {
    const result = appendStopPhrase(saved, draft);
    if (!result.added) {
      if (result.reason === "too-long") {
        announce(
          `Stop phrases must fit within ${STOP_PHRASE_MAX_LENGTH} characters.`,
          "assertive",
        );
      }
      if (result.reason === "duplicate") announce("That stop phrase is already saved.");
      return;
    }
    setDraft("");
    persist(result.value, `Added stop phrase ${parseStopPhrases(result.value).at(-1)}.`);
  };

  return (
    <SettingsRow
      label="Stop phrases"
      description="Typing one while a task runs stops it."
      descriptionId="general-stop-phrases-help"
      variant="sheet"
    >
      <div
        className="settings-stop-phrases"
        role="group"
        aria-label="Stop phrases"
        aria-describedby="general-stop-phrases-help"
      >
        <div className="settings-stop-phrases__editor">
          {phrases.map((phrase, index) => (
            <span key={phrase} className="settings-stop-phrase">
              {phrase}
              <IconButton
                icon="ph:x"
                size="xs"
                className="settings-stop-phrase__remove focus-ring"
                aria-label={`Remove stop phrase ${phrase}`}
                onClick={() => persist(
                  removeStopPhraseAt(saved, index),
                  `Removed stop phrase ${phrase}.`,
                )}
              />
            </span>
          ))}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim()) addDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addDraft();
              } else if (e.key === "Backspace" && !draft && phrases.length > 0) {
                persist(
                  removeStopPhraseAt(saved, phrases.length - 1),
                  `Removed stop phrase ${phrases.at(-1)}.`,
                );
              }
            }}
            aria-label="Add stop phrase"
            placeholder="Add another…"
            maxLength={STOP_PHRASE_MAX_LENGTH}
            className="settings-stop-phrases__input focus-ring"
          />
        </div>
        <div className="settings-stop-phrases__meta">
          <span>{phrases.length} {phrases.length === 1 ? "phrase" : "phrases"}</span>
          <Button
            variant="ghost"
            size="xs"
            className="settings-stop-phrases__clear focus-ring"
            disabled={phrases.length === 0}
            onClick={() => persist("", "Cleared stop phrases.")}
          >
            Clear
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}


function BackupSettingsGroup() {
  const { announce } = useAnnouncer();
  const [passphrase, setPassphrase] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const [status, setStatus] = useState<string>("");

  const canSubmit = passphrase.length >= 8;
  const backupPassphraseGuidance = getBackupPassphraseGuidance(passphrase);

  const exportBackup = async () => {
    setBusy("export");
    setStatus("");
    try {
      const res = await fetch("/api/backup/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || `export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coven-cave-backup-${new Date().toISOString().slice(0, 10)}.ccbackup`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("Encrypted backup exported. Store the file somewhere you control, like iCloud Drive.");
      announce("Encrypted backup exported.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "backup export failed";
      setStatus(message);
      announce(`Backup export failed: ${message}`, "assertive");
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async () => {
    if (!restoreFile) return;
    setBusy("restore");
    setStatus("");
    try {
      const archiveBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("could not read backup file"));
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
        };
        reader.readAsDataURL(restoreFile);
      });
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase, archiveBase64 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `restore failed (${res.status})`);
      const count = Array.isArray(json.restored) ? json.restored.length : 0;
      setStatus(`Restored ${count} files. Restart Cave so every surface reloads restored state.`);
      announce(`Restored ${count} files from backup.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "backup restore failed";
      setStatus(message);
      announce(`Backup restore failed: ${message}`, "assertive");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsGroup label="Backup" variant="ruled" panel={false}>
      <div className="settings-backup-intro">
        <h3 id="settings-backup-manual-title">Encrypted export</h3>
        <p>Tier-1 state and the vault key, wrapped with your passphrase.</p>
      </div>
      <div className="settings-backup-grid">
        <section
          className="settings-backup-manual"
          aria-labelledby="settings-backup-manual-title"
        >
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Backup passphrase"
            aria-label="Backup passphrase"
            className="settings-backup-input focus-ring"
          />
          <div
            className="settings-backup-guidance"
            aria-label="Passphrase length guidance"
            aria-live="polite"
          >
            <span className="settings-backup-guidance__track" aria-hidden="true">
              <span
                className={`settings-backup-guidance__fill is-${backupPassphraseGuidance.score}`}
              />
            </span>
            <span className={`settings-backup-guidance__label is-${backupPassphraseGuidance.score}`}>
              {backupPassphraseGuidance.label}
            </span>
          </div>
          <div className="settings-backup-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={exportBackup}
              disabled={!canSubmit || busy !== null}
              leadingIcon="ph:arrow-down"
            >
              {busy === "export" ? "Exporting…" : "Export backup"}
            </Button>
            <label className="settings-backup-file focus-ring">
              Choose backup
              <input
                type="file"
                accept=".ccbackup,application/octet-stream"
                className="sr-only"
                onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={restoreBackup}
              disabled={!canSubmit || !restoreFile || busy !== null}
              leadingIcon="ph:arrow-counter-clockwise"
            >
              {busy === "restore" ? "Restoring…" : "Restore"}
            </Button>
          </div>
          <p className="settings-backup-footnote">
            Browser profile state is not included yet.
          </p>
          {restoreFile ? (
            <p className="settings-backup-selection">Selected {restoreFile.name}</p>
          ) : null}
          {status ? <p className="settings-backup-status" role="status">{status}</p> : null}
        </section>
        <ScheduledSyncSettings />
      </div>
    </SettingsGroup>
  );
}

type BackupSyncOverview = {
  config: {
    enabled: boolean;
    directory: string | null;
    retainCount: number;
    intervalHours: number;
    onQuitPush: boolean;
  };
  status: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastSuccessFile: string | null;
    lastError: string | null;
    lastReason: string | null;
    retainedCount: number | null;
  };
  defaultDirectory: string;
  effectiveDirectory: string;
  passphraseSet: boolean;
  due: boolean;
};

// Scheduled encrypted sync (Persistence P2): a daily snapshot pushed into a
// user-owned folder (iCloud Drive by default) plus an on-quit push, so machine
// loss costs at most a day. The passphrase saves into the local encrypted
// vault for unattended runs; restoring still asks for it manually above.
function ScheduledSyncSettings() {
  const { announce } = useAnnouncer();
  const [overview, setOverview] = useState<BackupSyncOverview | null>(null);
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null);
  const [retainDraft, setRetainDraft] = useState<string | null>(null);
  const [passphraseDraft, setPassphraseDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [syncLoadState, setSyncLoadState] =
    useState<"loading" | "ready" | "error">("loading");

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setSyncLoadState("loading");
    try {
      const response = await fetch("/api/backup/sync", {
        cache: "no-store",
        signal,
      });
      const json = await response.json().catch(() => null) as
        | (BackupSyncOverview & { ok?: boolean })
        | null;
      if (!response.ok || !json?.ok) throw new Error("invalid sync response");
      if (signal?.aborted) return;
      setOverview(json);
      setSyncLoadState("ready");
    } catch {
      if (signal?.aborted) return;
      setSyncLoadState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  const update = async (patch: Record<string, unknown>, announcement: string) => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/backup/sync", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `sync update failed (${res.status})`);
      setOverview(json as BackupSyncOverview);
      window.dispatchEvent(new Event("cave:backup-sync-refresh"));
      announce(announcement);
    } catch (err) {
      const text = err instanceof Error ? err.message : "sync update failed";
      setMessage(text);
      announce(`Scheduled sync update failed: ${text}`, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/backup/sync/run", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `backup failed (${res.status})`);
      const refreshed = await fetch("/api/backup/sync", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (refreshed?.ok) setOverview(refreshed as BackupSyncOverview);
      setMessage("Snapshot saved.");
      announce("Backup snapshot saved.");
    } catch (err) {
      const text = err instanceof Error ? err.message : "backup failed";
      setMessage(text);
      announce(`Backup failed: ${text}`, "assertive");
    } finally {
      setBusy(false);
    }
  };

  if (syncLoadState === "loading") {
    return (
      <section
        className="settings-backup-card settings-backup-sync"
        aria-label="Scheduled sync"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Loading scheduled sync…</span>
        <SkeletonRows count={3} />
      </section>
    );
  }

  if (syncLoadState === "error" || !overview) {
    return (
      <section className="settings-backup-card settings-backup-sync" aria-label="Scheduled sync">
        <ErrorState
          compact
          headline="Couldn't load scheduled sync"
          subtitle="Retry after the Cave sidecar is available."
          actions={<Button size="sm" onClick={() => void loadOverview()}>Retry</Button>}
        />
      </section>
    );
  }

  const { config, status: sync } = overview;
  const enabled = config.enabled;
  const freshness = sync.lastSuccessAt
    ? `Last snapshot ${relativeTime(sync.lastSuccessAt)}${typeof sync.retainedCount === "number" ? ` · ${sync.retainedCount} kept` : ""}`
    : "No snapshots yet.";

  return (
    <section
      className="settings-backup-card settings-backup-sync"
      aria-labelledby="settings-backup-sync-title"
    >
      <div className="settings-backup-sync__header">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Scheduled sync"
          disabled={busy}
          onClick={() => update({ enabled: !enabled }, enabled ? "Scheduled sync off." : "Scheduled sync on.")}
          className={`settings-switch focus-ring${enabled ? " is-on" : ""}`}
        >
          <span className="settings-switch__knob" aria-hidden />
        </button>
        <h3 id="settings-backup-sync-title">Scheduled sync</h3>
        <span className={`settings-backup-sync__state${enabled ? " is-on" : ""}`}>
          {enabled ? "On" : "Off"}
        </span>
      </div>
      <p>Pushes an encrypted snapshot to a folder you own and again when Cave quits.</p>
      <p className="settings-backup-sync__freshness">{freshness}</p>
      {enabled ? (
        <div className="settings-backup-sync__details">
          <label className="settings-backup-field">
            <span className="settings-backup-field__label">Destination</span>
            <span className="settings-backup-field__help">
              Folder that receives snapshots. Leave empty to use iCloud Drive when available.
            </span>
            <input
              value={directoryDraft ?? config.directory ?? ""}
              onChange={(event) => setDirectoryDraft(event.target.value)}
              onBlur={() => {
                if (directoryDraft === null) return;
                const next = directoryDraft.trim();
                setDirectoryDraft(null);
                if (next === (config.directory ?? "")) return;
                void update({ directory: next || null }, "Backup destination saved.");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder={overview.defaultDirectory}
              aria-label="Backup destination folder"
              className="settings-backup-input settings-backup-input--mono focus-ring"
            />
          </label>

          <div className="settings-backup-field">
            <span className="settings-backup-field__label">Sync passphrase</span>
            <span className="settings-backup-field__help">
              Saved in the local encrypted vault for unattended snapshots.
            </span>
            <div className="settings-backup-field__controls">
              <input
                type="password"
                value={passphraseDraft}
                onChange={(event) => setPassphraseDraft(event.target.value)}
                placeholder={overview.passphraseSet ? "Passphrase saved" : "Sync passphrase"}
                aria-label="Sync passphrase"
                className="settings-backup-input focus-ring"
              />
              <Button
                size="sm"
                disabled={busy || passphraseDraft.length < 8}
                onClick={() => {
                  void update({ passphrase: passphraseDraft }, "Sync passphrase saved.").then(() => setPassphraseDraft(""));
                }}
              >
                Save passphrase
              </Button>
              {overview.passphraseSet ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => update({ clearPassphrase: true }, "Sync passphrase cleared.")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          <label className="settings-backup-field">
            <span className="settings-backup-field__label">Keep snapshots</span>
            <span className="settings-backup-field__help">
              Oldest snapshots are pruned after this limit.
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={retainDraft ?? String(config.retainCount)}
              onChange={(event) => setRetainDraft(event.target.value)}
              onBlur={() => {
                if (retainDraft === null) return;
                const next = Number(retainDraft);
                setRetainDraft(null);
                if (!Number.isFinite(next) || next === config.retainCount) return;
                void update({ retainCount: next }, "Snapshot retention saved.");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label="Snapshots to keep"
              className="settings-backup-input settings-backup-input--count focus-ring"
            />
          </label>

          <div className="settings-backup-field">
            <span className="settings-backup-field__label">Freshness</span>
            <span className="settings-backup-field__help">{freshness}</span>
            <Button
              size="sm"
              onClick={runNow}
              disabled={busy || !overview.passphraseSet}
              leadingIcon="ph:arrow-clockwise"
            >
              {busy ? "Backing up…" : "Back up now"}
            </Button>
            {!overview.passphraseSet ? (
              <p className="settings-backup-field__help">
                Save a sync passphrase to start scheduled snapshots.
              </p>
            ) : null}
            {sync.lastError ? (
              <p className="settings-backup-error" role="alert">{sync.lastError}</p>
            ) : null}
            {message ? <p className="settings-backup-status" role="status">{message}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Workspace path — read the current root, and let Browse *change* it.
 *
 * Browse used to hand the path to the OS file manager (`shell_open_path`),
 * which meant it did nothing at all on the web build and, on desktop, could
 * only ever show you the folder you already had. Choosing a different one had
 * no UI at all. It now opens the in-app folder browser — the same modal the
 * new-project flow uses, so this works identically on web and desktop with no
 * native dialog — and persists the pick through /api/config/workspace-path.
 *
 * Revealing the folder in the OS file manager is still available on desktop,
 * as its own control rather than as the meaning of "Browse".
 */
function WorkspacePathField() {
  const [path, setPath] = useState("");
  const [envPin, setEnvPin] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const desktop = useIsTauriDesktop();
  const { announce } = useAnnouncer();
  // One slot for both failures the row can surface (saving a pick, revealing
  // the folder natively) — they are mutually exclusive in practice and share
  // the same alert line.
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/config/workspace-path", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { workspacePath?: string; envPin?: string | null }) => {
        if (ctl.signal.aborted) return;
        if (j.workspacePath) setPath(j.workspacePath);
        setEnvPin(j.envPin ?? null);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const choose = async (dir: string) => {
    setPickerOpen(false);
    setSaving(true);
    setFieldError("");
    try {
      const res = await fetch("/api/config/workspace-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ dir }),
      });
      const body = (await res.json()) as { ok?: boolean; workspacePath?: string; error?: string };
      if (!res.ok || !body.ok || !body.workspacePath) {
        const message = body.error ?? "Couldn't save the workspace path.";
        setFieldError(message);
        announce(message, "assertive");
        return;
      }
      setPath(body.workspacePath);
      announce("Workspace path saved.");
    } catch {
      setFieldError("Couldn't save the workspace path.");
      announce("Couldn't save the workspace path.", "assertive");
    } finally {
      setSaving(false);
    }
  };

  const reveal = async () => {
    if (!desktop || !path) return;
    setFieldError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open_path", { path });
      announce("Workspace folder opened.");
    } catch {
      setFieldError("Couldn't open the workspace folder.");
      announce("Couldn't open the workspace folder.", "assertive");
    }
  };

  return (
    <div className="settings-workspace-control">
      <input
        value={path}
        readOnly
        aria-label="Workspace path"
        className="settings-workspace-path focus-ring"
      />
      <div className="settings-workspace-actions">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="ph:folder-open"
          disabled={Boolean(envPin) || saving}
          title={
            envPin
              ? `Pinned by ${envPin}`
              : "Choose where Coven stores familiar workspaces"
          }
          onClick={() => {
            // Don't carry a previous failure into a fresh attempt.
            setFieldError("");
            setPickerOpen(true);
          }}
        >
          {saving ? "Saving…" : "Browse"}
        </Button>
        {desktop ? (
          <IconButton
            icon="ph:arrow-square-out"
            aria-label="Open workspace folder in file manager"
            title="Open workspace folder in file manager"
            size="sm"
            disabled={!path}
            onClick={() => void reveal()}
          />
        ) : null}
      </div>
      {envPin ? (
        <p className="settings-workspace-hint">
          Pinned by the {envPin} environment variable.
        </p>
      ) : null}
      {fieldError ? <p role="alert" className="settings-workspace-error">{fieldError}</p> : null}
      <DirectoryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(dir) => void choose(dir)}
      />
    </div>
  );
}

// ─── Section: Daemon ──────────────────────────────────────────────────────────

/** Omnigent fleet connection — the config surface for the host chip and remote runs.
 *  Renders NOTHING unless OMNIGENT_SERVER_URL is set up in the user's Cave
 *  Vault: without the Vault env the group is absent from the Daemon tab
 *  entirely (fail closed while the probe is in flight). With the Vault env
 *  present the group is just an explicit enable toggle (off by default,
 *  persisted as omnigent.enabled in Cave config); the connection fields appear
 *  only after the user turns the fleet on. The Vault URL is also the active
 *  server URL — it overrides the Cave-config value. */
function OmnigentSettingsGroup() {
  const { announce } = useAnnouncer();
  // null = probe in flight → hidden; the group only appears once the status
  // endpoint proves the Vault env exists.
  const [serverUrlInVault, setServerUrlInVault] = useState<boolean | null>(null);
  // The explicit master switch (omnigent.enabled in Cave config).
  const [enabled, setEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [activeBaseUrl, setActiveBaseUrl] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [hostWorkspaceText, setHostWorkspaceText] = useState("");
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
            defaultWorkspace?: string;
            hostWorkspaceMap?: Record<string, string>;
            exposeHostsInComposer?: boolean;
          };
        };
      }) => {
        if (ctl.signal.aborted || !j.ok) return;
        const o = j.config?.omnigent;
        setWorkspace(o?.defaultWorkspace ?? "");
        setHostWorkspaceText(formatHostWorkspaceText(o?.hostWorkspaceMap));
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
        enabled?: boolean;
        serverUrlInVault?: boolean;
        baseUrl?: string;
        error?: string;
      }) => {
        if (ctl.signal.aborted) return;
        setServerUrlInVault(j.serverUrlInVault === true);
        setEnabled(j.enabled === true);
        setActiveBaseUrl(typeof j.baseUrl === "string" ? j.baseUrl : "");
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
      .catch(() => {
        if (!ctl.signal.aborted) setServerUrlInVault(false);
      });
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
          // baseUrl deliberately omitted: the Vault env supplies the server
          // URL; the shallow omnigent merge keeps any config fallback as is.
          omnigent: {
            defaultWorkspace: workspace.trim(),
            hostWorkspaceMap: parseHostWorkspaceText(hostWorkspaceText),
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

  // Flip the master switch (persisted as omnigent.enabled in Cave config).
  // Turning it on re-probes status so the URL row and status line populate;
  // turning it off immediately deactivates every fleet surface server-side.
  const setFleetEnabled = async (next: boolean) => {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ omnigent: { enabled: next } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `save failed (${res.status})`);
      }
      setEnabled(next);
      announce(next ? "Omnigent fleet enabled." : "Omnigent fleet disabled.");
      // Disabling must hide already-mounted Fleet controls immediately. Enabling
      // publishes the refreshed status below only after the server confirms the
      // token/auth gate, so dependent surfaces continue to fail closed.
      if (!next) publishFleetTokenStatus(null);
      try {
        const statusRes = await fetch("/api/omnigent/status", { cache: "no-store" });
        const st = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok || st?.ok === false) {
          throw new Error(st?.error || `status failed (${statusRes.status})`);
        }
        publishFleetTokenStatus(st);
        setActiveBaseUrl(typeof st?.baseUrl === "string" ? st.baseUrl : "");
        if (!st?.configured) setStatusLine("Not configured");
        else if (st?.online) {
          const mode = st.authMode || (st.hasToken ? "jwt" : "none");
          setStatusLine(mode === "none" ? "Online · local/unauthenticated" : `Online · auth ${mode}`);
        } else setStatusLine(st?.error ? `Offline · ${st.error}` : "Offline");
      } catch {
        // The config PATCH already succeeded, so do not report the toggle as
        // failed merely because this optional status refresh was unavailable.
        publishFleetTokenStatus(null);
        setActiveBaseUrl("");
        setStatusLine("Status unavailable · try again later");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not save";
      setError(msg);
      announce(`Couldn't ${next ? "enable" : "disable"} Omnigent fleet: ${msg}`, "assertive");
    } finally {
      setToggling(false);
    }
  };

  // Vault-gated: no OMNIGENT_SERVER_URL in the Cave Vault (or probe still in
  // flight / failed) → the Daemon tab shows no Omnigent surface whatsoever.
  if (serverUrlInVault !== true) return null;

  return (
    <SettingsGroup label="Omnigent fleet">
      <SettingControlRow
        label="Enable fleet"
        hint="Master switch (off by default). Off keeps every Omnigent surface hidden — fleet host options, Fleet buttons, per-familiar fleet defaults — and Cave contacts no Omnigent server. Available because OMNIGENT_SERVER_URL is in your Cave Vault."
      >
        <label className="flex items-center gap-2 text-[length:var(--text-sm)]">
          <input
            type="checkbox"
            checked={enabled}
            disabled={toggling}
            onChange={(e) => void setFleetEnabled(e.target.checked)}
          />
          Omnigent fleet {enabled ? "on" : "off"}
        </label>
      </SettingControlRow>
      {!enabled && error && (
        <div className="px-4 pb-2.5">
          <span role="alert" className="text-[length:var(--text-xs)] text-[var(--color-danger)]">{error}</span>
        </div>
      )}
      {enabled ? (
        <>
      <SettingControlRow
        label="Server URL"
        hint="Supplied by OMNIGENT_SERVER_URL in your Cave Vault (it overrides Cave config). Fleet UI unlocks per user: add OMNIGENT_TOKEN to your Vault. Tokens are never stored in Cave config."
      >
        <span
          className="w-full min-w-[260px] max-w-md truncate rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[length:var(--text-xs)] text-[var(--text-secondary)]"
          aria-label="Omnigent server URL (from Vault)"
          title={activeBaseUrl || undefined}
        >
          {activeBaseUrl || "—"}
        </span>
      </SettingControlRow>
      <SettingControlRow
        label="Default workspace"
        hint="Fallback absolute path when the selected host has no entry in the host workspace map."
      >
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          aria-label="Default Omnigent workspace"
          placeholder="/home/you/project"
          className="w-full min-w-[260px] max-w-md rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none"
          spellCheck={false}
        />
      </SettingControlRow>
      <SettingControlRow
        label="Host workspace map"
        hint="One path per host so MacBook, Studio, and Linux can differ. Keys: host_id, host name, or hostMap alias. Format: host=/abs/path (one per line)."
      >
        <textarea
          value={hostWorkspaceText}
          onChange={(e) => setHostWorkspaceText(e.target.value)}
          aria-label="Omnigent host workspace map"
          placeholder={"Macbook-Pro-5.local=/Users/you/Developer/1_Projects/coven-cave\nAndrews-Mac-Studio.local=/Users/you/Developer/1_Projects/hydra\nubuntu-root=/root/work"}
          rows={4}
          className="w-full min-w-[260px] max-w-md resize-y rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none"
          spellCheck={false}
        />
      </SettingControlRow>
      <SettingControlRow
        label="Show fleet in Host chip"
        hint="When on — and OMNIGENT_TOKEN is set up in your Vault — Chat and Home Host pickers list Omnigent hosts (omnigent:…) so a send can start a fleet session. Without the Vault env, no Fleet buttons appear anywhere."
      >
        <label className="flex items-center gap-2 text-[length:var(--text-sm)]">
          <input
            type="checkbox"
            checked={exposeHosts}
            onChange={(e) => setExposeHosts(e.target.checked)}
          />
          Expose Omnigent hosts in composer
        </label>
      </SettingControlRow>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 pt-0.5">
        <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{statusLine || "—"}</span>
        <div className="flex items-center gap-2">
          {error && <span role="alert" className="text-[length:var(--text-xs)] text-[var(--color-danger)]">{error}</span>}
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
        </>
      ) : null}
    </SettingsGroup>
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
 *  Manual Resync only. Change-driven publishing belongs to RemoteThemeController:
 *  every selection/edit here lands in updateAppPreferences, whose store notify
 *  runs the controller's reconcile → publish. A second on-change PUT from this
 *  section raced it — identical payloads plus a 409 window (cave-gvtw). */
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
        <p className="text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">{preset.label}</p>
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)] leading-snug">{preset.description}</p>
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
  const preferences = readAppPreferences();
  const themePreferences = preferences.appearance.theme;
  const existing: CustomThemeData | null =
    themePreferences.id === "custom" ? themePreferences.custom : null;
  const groupKey: "light" | "dark" = mode === "light" ? "light" : "dark";
  const otherGroupKey: "light" | "dark" = groupKey === "light" ? "dark" : "light";
  const group: Record<string, string> = { ...(existing?.cssVars?.[groupKey] ?? {}) };
  // Fresh fork from a preset: snapshot BOTH mode palettes while the preset CSS
  // is still applied. Seeding only the edited mode made the fork single-mode —
  // a later Light/Dark flip kept rendering this mode's colors
  // (activeCustomThemeVariables falls back to the only group) and the first
  // edit in the other mode seeded it from the wrong mode's look. Clear in-drag
  // preview inline vars first so both snapshots read the preset (the live
  // re-apply below restores the finished look); flipping data-mode +
  // getComputedStyle forces a synchronous recalc, so nothing paints mid-flip.
  // Imported customs missing one mode group keep the fill-on-first-edit
  // fallback — their preset is long gone, the current look is all there is.
  let otherSeed: Record<string, string> | null = null;
  if (!existing) {
    for (const name of THEME_FORK_SNAPSHOT_KEYS) html.style.removeProperty(name);
    Object.assign(group, resolveTokens(THEME_FORK_SNAPSHOT_KEYS));
    const restore = html.getAttribute("data-mode") ?? groupKey;
    html.setAttribute("data-mode", otherGroupKey);
    otherSeed = resolveTokens(THEME_FORK_SNAPSHOT_KEYS);
    html.setAttribute("data-mode", restore);
  } else if (Object.keys(group).length === 0) {
    Object.assign(group, resolveTokens(THEME_FORK_SNAPSHOT_KEYS));
  }
  group[key] = hex;
  Object.assign(group, deriveTokenCompanions(key, hex, mode));
  const baseTheme = html.getAttribute("data-theme");
  const forkName =
    baseTheme && baseTheme !== "custom" && (THEME_IDS as readonly string[]).includes(baseTheme)
      ? `${THEME_META[baseTheme as ThemeId].name} (custom)`
      : "Custom";
  const data: CustomThemeData = {
    name: existing?.name ?? forkName,
    cssVars: {
      ...(existing?.cssVars ?? {}),
      [groupKey]: group,
      ...(otherSeed ? { [otherGroupKey]: otherSeed } : {}),
    },
  };
  // An explicit accent pick is a statement of intent: disarm the backdrop's
  // auto-match in the same atomic patch, or applyBackdropToDocument re-fits
  // --accent-presence to the image seed on the very next reconcile and the
  // pick never renders (the backdrop settings toggle re-arms matching).
  const backdrop = preferences.appearance.backdrop;
  const disarmBackdropAccent =
    key === "--accent-presence" && backdrop.enabled && backdrop.matchAccent;
  updateAppPreferences({
    appearance: {
      theme: { id: "custom", resolvedMode: mode, custom: data },
      ...(disarmBackdropAccent ? { backdrop: { matchAccent: false } } : {}),
    },
  });
  // Live-apply the whole group — not just the edited key — so the selected
  // theme's look survives the data-theme flip. Boot (theme-init.js) replays
  // this exact group, so what you see now is what a reload restores.
  // Normalize to custom-property names: imported tweakcn groups keep raw keys
  // ("background", "radius"), and a raw setProperty would set the real CSS
  // property inline on <html>, which no cleanup path removes (cave-7eno).
  for (const [name, value] of Object.entries(group)) {
    html.style.setProperty(name.startsWith("--") ? name : `--${name}`, value);
  }
  html.setAttribute("data-theme", "custom");
}

/** Paint-only in-drag preview: writes the edited token + its companions inline
 *  so the pick renders instantly, without touching the preferences store — no
 *  reconcile, no PATCH, no cross-tab broadcast per pointer-move. Inline
 *  element.style beats whichever preset/custom CSS block is active, so no
 *  data-theme flip is needed; commit (applyTokenOverride) makes it durable. */
function previewTokenOverride(key: string, hex: string, mode: Mode) {
  const html = document.documentElement;
  html.style.setProperty(key, hex);
  for (const [name, value] of Object.entries(deriveTokenCompanions(key, hex, mode))) {
    html.style.setProperty(name, value);
  }
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
      <span className="flex-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">{label}</span>
      <code className="font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">{token}</code>
      <span className="w-[72px] shrink-0 text-right font-mono text-[length:var(--text-xs)] uppercase text-[var(--text-secondary)]" title={value}>
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

  // The picker fires onChange per pointer-move. Drags stay paint-only — each
  // rAF-coalesced frame calls previewTokenOverride (inline vars, store
  // untouched), so nothing reconciles, PATCHes, or broadcasts mid-drag. The
  // durable write (applyTokenOverride → store → PUT) happens once per finished
  // edit, at commit (popover close) or unmount.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ key: string; value: string } | null>(null);
  const dirtyRef = useRef<Set<(typeof THEME_SYNC_KEYS)[number]>>(new Set());
  const flushPendingPreview = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) previewTokenOverride(pending.key, pending.value, modeRef.current);
  }, []);
  // Persist any un-committed edit on unmount so a drag-in-progress isn't lost
  // when the user navigates away with the picker still open.
  useEffect(() => {
    return () => {
      flushPendingPreview();
      for (const key of dirtyRef.current) {
        const value = valuesRef.current[key];
        if (value) applyTokenOverride(key, value, modeRef.current);
      }
      dirtyRef.current.clear();
    };
  }, [flushPendingPreview]);

  const handlePick = (key: (typeof THEME_SYNC_KEYS)[number], hex: string) => {
    // Preserve the token's original alpha byte (hairline borders are washes).
    const next = withAlphaFrom(valuesRef.current[key], hex);
    setValues((v) => ({ ...v, [key]: next }));
    dirtyRef.current.add(key);
    pendingRef.current = { key, value: next };
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) previewTokenOverride(pending.key, pending.value, modeRef.current);
      });
    }
  };

  const handleCommit = (key: (typeof THEME_SYNC_KEYS)[number]) => {
    flushPendingPreview();
    if (!dirtyRef.current.has(key)) return; // opened + closed without a pick
    dirtyRef.current.delete(key);
    const committed = valuesRef.current[key];
    if (!committed) return;
    applyTokenOverride(key, committed, modeRef.current);
    setRecents(addRecentColor(committed.slice(0, 7)));
    onChange();
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
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

  // No on-change daemon mirror here: RemoteThemeController publishes tokens
  // whenever the canonical theme signature changes (every selection, mode flip,
  // and token commit in this section writes updateAppPreferences). A section-
  // side effect doubled each PUT /api/theme (cave-gvtw); persistThemeTokens
  // remains for the manual Resync button only.
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

  // External theme changes — the 10s /api/theme poll, another tab via the
  // preferences BroadcastChannel, a phone PATCH — land in the store and
  // repaint the app, but this section hydrated its selection state once on
  // mount, leaving the theme grid and token-row swatches stale until a full
  // reload (cave-hkfq). Follow the store. setCustomData keeps the previous
  // object when content is unchanged so unrelated store notifies don't churn
  // renders or the token rows' content-keyed reloadKey.
  useEffect(() => {
    if (!appearanceHydrated) return;
    return subscribeAppPreferences(() => {
      const theme = readAppPreferences().appearance.theme;
      setActiveTheme(readPersistedTheme());
      setMode(readPersistedMode());
      const next = theme.id === "custom" ? theme.custom : null;
      setCustomData((prev) => {
        if (prev === next) return prev;
        if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
    });
  }, [appearanceHydrated]);

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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-3 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-primary)]">
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
            <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
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
          reloadKey={`${activeTheme}:${mode}:${customData ? JSON.stringify(customData.cssVars) : "preset"}`}
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
          <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
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
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            Use Browse to open tweakcn.com in the in-app browser, then paste a theme URL to apply it. Supports{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
              /themes/&#123;id&#125;
            </code>
            ,{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
              /r/themes/&#123;id&#125;
            </code>
            , and{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
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
              className="focus-ring flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] transition-colors"
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
            <p role="alert" className="flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--color-danger)]">
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

// ─── Primitives ───────────────────────────────────────────────────────────────

function SettingsPage({
  title,
  description,
  section,
  variant = "default",
  children,
}: {
  title: string;
  description?: string;
  section?: Section;
  variant?: "default" | "control-sheet";
  children: React.ReactNode;
}) {
  const pageTitleId = section ? `settings-${section}-title` : "settings-page-title";

  if (variant === "control-sheet") {
    return (
      <section className="settings-general" aria-labelledby={pageTitleId}>
        <h2 id={pageTitleId} className="sr-only">{title}</h2>
        {section ? (
          <SettingsOverview section={section} variant="control-sheet" />
        ) : (
          <div>
            <p className="text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]">{title}</p>
            {description && <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{description}</p>}
          </div>
        )}
        {children}
      </section>
    );
  }

  return (
    <section className="max-w-none space-y-6" aria-labelledby={pageTitleId}>
      <h2 id={pageTitleId} className="sr-only">{title}</h2>
      {section ? (
        <SettingsOverview section={section} />
      ) : (
        <div>
          <p className="text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]">{title}</p>
          {description && <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}


function SettingsRow({
  label,
  description,
  descriptionId,
  comingSoon,
  variant = "default",
  children,
}: {
  label: string;
  description?: string;
  descriptionId?: string;
  comingSoon?: boolean;
  variant?: "default" | "sheet";
  children?: React.ReactNode;
}) {
  return (
    <div
      className={
        variant === "sheet"
          ? `settings-row settings-row--sheet${comingSoon ? " is-dimmed" : ""}`
          : `flex items-center justify-between gap-4 px-4 py-3 ${comingSoon ? "opacity-50" : ""}`
      }
    >
      <div className="min-w-0">
        <p className="text-[length:var(--text-base)] text-[var(--text-primary)]">{label}</p>
        {description ? (
          <p
            id={descriptionId}
            className="text-[length:var(--text-xs)] text-[var(--text-muted)]"
          >
            {description}
          </p>
        ) : null}
      </div>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">Soon</span>
      ) : children}
    </div>
  );
}
