"use client";

import "@/styles/dashboard.css";
import "@/styles/settings-familiars.css";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { observeSettingsTarget } from "@/lib/settings-search-target";
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
import { SettingControlRow } from "@/components/ui/settings-controls";
import { SearchInput } from "@/components/ui/search-input";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useIsMobile } from "@/lib/use-viewport";
import { useIsTauriDesktop } from "@/lib/tauri-platform";
import { useCelebrationsEnabled, writeCelebrationsEnabled } from "@/lib/celebrations-pref";
import { STOP_PHRASE_MAX_LENGTH, appendStopPhrase, parseStopPhrases, removeStopPhraseAt, useStopPhrase, writeStopPhrase } from "@/lib/stop-phrase";
import { SECTIONS, SETTINGS_INDEX, settingsSectionLabel, type Section, type SettingsIndexEntry } from "./settings-sections";
import { getBackupPassphraseGuidance } from "@/lib/backup-passphrase-strength";
import { publishFleetTokenStatus } from "@/lib/omnigent/use-fleet-gate";
import { formatHostWorkspaceText, parseHostWorkspaceText } from "./settings-multihost";
import { showSettingsSavedAfterPreferencesFlush, showSettingsSavedToast } from "@/lib/settings-save-feedback";

import { SettingsPage, SettingsRow } from "./settings-layout";
import { GeneralSettingsDataProvider, useGeneralSettingsData, type BackupSyncOverview } from "./settings-general-data";
const AppearanceSection = dynamic(() => import("./settings-appearance").then((m) => m.AppearanceSection), { loading: SettingsSectionFallback });

function SettingsSectionFallback() {
  return <div role="status" aria-label="Loading settings" aria-busy="true"><SkeletonRows count={6} /></div>;
}

const DaemonSection = dynamic(() => import("./settings-daemon").then((m) => m.DaemonSection), { loading: SettingsSectionFallback });
const ProfileSection = dynamic(() => import("./settings-profile").then((m) => m.ProfileSection), { loading: SettingsSectionFallback });
const AboutSection = dynamic(() => import("./settings-about").then((m) => m.AboutSection), { loading: SettingsSectionFallback });
const PhoneSection = dynamic(() => import("./settings-phone").then((m) => m.PhoneSection), { loading: SettingsSectionFallback });
const SettingsClientAccess = dynamic(() => import("./settings-client-access").then((m) => m.SettingsClientAccess), { loading: SettingsSectionFallback });
const VoiceEngineSettings = dynamic(() => import("@/components/voice-engine-settings").then((m) => m.VoiceEngineSettings), { loading: SettingsSectionFallback });
const VoiceProviderSettings = dynamic(() => import("@/components/voice-provider-settings").then((m) => m.VoiceProviderSettings), { loading: SettingsSectionFallback });

// ─── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell({ embedded = false }: { embedded?: boolean }) {
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
  const [hashHydrated, setHashHydrated] = useState(embedded);
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
  const contentRef = useRef<HTMLElement | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [searchJump, setSearchJump] = useState(0);
  const searchSection = useRef<Section | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_INDEX.filter((e) =>
      `${settingsSectionLabel(e.section)} ${e.group ?? ""} ${e.keywords}`.toLowerCase().includes(q));
  }, [query]);

  function goToSetting(entry: SettingsIndexEntry) {
    openSection(entry.section);
    searchSection.current = entry.section;
    setSearchJump((value) => value + 1);
    setQuery("");
    setScrollTarget(entry.group ? settingsGroupId(entry.group) : null);
  }

  // After the target section renders, scroll its group into view and flash a
  // highlight so the eye lands on the right control.
  useEffect(() => {
    if (!scrollTarget) return;
    if (searchSection.current !== section) {
      setScrollTarget(null);
      return;
    }
    const root = contentRef.current;
    if (!root) return;
    let raf = 0;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let found: HTMLElement | undefined;
    const stop = observeSettingsTarget(root, scrollTarget, (el) => {
      found = el;
      raf = requestAnimationFrame(() => {
        el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        el.classList.add("settings-group--found");
        highlightTimer = setTimeout(() => el.classList.remove("settings-group--found"), 1600);
        const focusTarget = el.querySelector<HTMLElement>(
          'input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)',
        ) ?? el;
        if (focusTarget === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        focusTarget.focus({ preventScroll: true });
      });
    });
    return () => {
      stop();
      cancelAnimationFrame(raf);
      clearTimeout(highlightTimer);
      found?.classList.remove("settings-group--found");
    };
  }, [scrollTarget, section, searchJump]);

  /** A user picking a section — from the rail, the search results, or ⌘↓. */
  function openSection(id: Section) {
    setScrollTarget(null);
    selectSection(id);
    setPickerView(false);
  }
  function backToPicker() {
    setPickerView(true);
    if (!embedded && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  // Keep the deep-link hash on whatever section is showing, including one the
  // history controls restored — openSection is no longer the only way to move.
  //
  // It must not run before the incoming hash has been read. On mount `section`
  // is still the "general" default while the URL already says `#about`, so an
  // ungated write rewrites the deep link to `#general` and the reader below
  // then honours the value this effect just clobbered.
  useEffect(() => {
    if (embedded || typeof window === "undefined" || !hashHydrated || pickerView) return;
    if (window.location.hash === `#${section}`) return;
    window.history.replaceState(null, "", `#${section}`);
  }, [embedded, hashHydrated, pickerView, section]);

  // Support hash-based deep-linking. Read it after hydration so SSR and the
  // first client render both start on General.
  useEffect(() => {
    if (embedded) return;
    const applyHashSection = () => {
      const hash = window.location.hash.replace("#", "") as Section;
      if (SECTIONS.some((s) => s.id === hash)) {
        const params = new URLSearchParams(window.location.search);
        const group = params.get("group")?.trim();
        setSection(hash);
        searchSection.current = hash;
        setSearchJump((value) => value + 1);
        setPickerView(false);
        setScrollTarget(group ? settingsGroupId(group) : null);
        return;
      }
      setPickerView(true);
    };
    applyHashSection();
    setHashHydrated(true);
    window.addEventListener("hashchange", applyHashSection);
    return () => window.removeEventListener("hashchange", applyHashSection);
  }, [embedded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (embedded) {
          if (isMobile && !pickerView) backToPicker();
        } else {
          router.back();
        }
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
  }, [embedded, isMobile, pickerView, router, section]);

  return (
    <div
      className={`settings-shell${embedded ? " settings-shell--embedded h-full" : " h-[100dvh]"} w-full flex flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]`}
    >
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
        data-tauri-drag-region={embedded ? undefined : "deep"}
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
          ref={contentRef}
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
          {section === "client-access" && <SettingsClientAccess />}
          {section === "appearance" && <AppearanceSection scrollTarget={scrollTarget} searchJump={searchJump} />}
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
    <GeneralSettingsDataProvider>
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
    </SettingsPage>
    </GeneralSettingsDataProvider>
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
        onClick={() => {
          writeCelebrationsEnabled(!celebrationsEnabled);
          void showSettingsSavedAfterPreferencesFlush();
        }}
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
    void showSettingsSavedAfterPreferencesFlush();
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



// Scheduled encrypted sync (Persistence P2): a daily snapshot pushed into a
// user-owned folder (iCloud Drive by default) plus an on-quit push, so machine
// loss costs at most a day. The passphrase saves into the local encrypted
// vault for unattended runs; restoring still asks for it manually above.
function ScheduledSyncSettings() {
  const { announce } = useAnnouncer();
  const { sync: syncResource } = useGeneralSettingsData()!;
  const { value: overview, status: syncLoadState, refresh: loadOverview, publish: setOverview } = syncResource;
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null);
  const [retainDraft, setRetainDraft] = useState<string | null>(null);
  const [passphraseDraft, setPassphraseDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      announce(announcement);
      showSettingsSavedToast();
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
      await loadOverview();
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

  if (syncLoadState === "loading" && !overview) {
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

  if (!overview) {
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
      {syncLoadState === "error" ? (
        <ErrorState compact headline="Scheduled sync details couldn't refresh" subtitle="Showing the last loaded settings."
          actions={<Button size="sm" onClick={() => void loadOverview()}>Retry</Button>} />
      ) : null}
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
  const { workspace } = useGeneralSettingsData()!;
  const path = workspace.value?.workspacePath ?? "";
  const envPin = workspace.value?.envPin ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const desktop = useIsTauriDesktop();
  const { announce } = useAnnouncer();
  // One slot for both failures the row can surface (saving a pick, revealing
  // the folder natively) — they are mutually exclusive in practice and share
  // the same alert line.
  const [fieldError, setFieldError] = useState("");

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
      workspace.publish({ ...workspace.value, workspacePath: body.workspacePath });
      announce("Workspace path saved.");
      showSettingsSavedToast("Workspace path saved.");
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
      showSettingsSavedToast("Omnigent settings saved.");
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
      showSettingsSavedToast();
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
            {saving ? "Saving…" : "Save Omnigent"}
          </Button>
        </div>
      </div>
        </>
      ) : null}
    </SettingsGroup>
  );
}
