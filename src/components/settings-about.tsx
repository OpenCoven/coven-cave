"use client";

import "@/styles/settings-about.css";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OpenCovenToolsUpdate,
  type OpenCovenToolsDiagnosticsSnapshot,
} from "@/components/open-coven-tools-update";
import {
  UpdateSettingsRow,
  type UpdateSettingsActionHandle,
} from "@/components/update-available";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { settingsGroupId } from "@/components/ui/settings-group";
import {
  buildSafeToolDiagnostics,
  sanitizeAboutDiagnosticText,
} from "@/lib/about-diagnostics";
import {
  classifyAboutDaemonStatus,
  type AboutDaemonState,
} from "@/lib/about-status";
import { APP_VERSION } from "@/lib/app-version";
import { copyText } from "@/lib/clipboard";
import { exactSemver } from "@/lib/exact-semver";
import { Icon, type IconName } from "@/lib/icon";
import { openExternalUrl } from "@/lib/open-external";
import { relativeTime } from "@/lib/relative-time";

const STACK = ["Next.js", "React", "Tauri", "Tailwind"] as const;
const SIDECAR_TOKEN_STORAGE_KEY = "coven-cave:sidecar-auth-token";
const CLONE_COMMAND = "git clone https://github.com/OpenCoven/coven-cave.git";

type LinkCard = {
  label: string;
  hint: string;
  href: string;
  icon: IconName;
};

const SMALL_LINKS: LinkCard[] = [
  {
    label: "Docs",
    hint: "docs.opencoven.ai",
    href: "https://docs.opencoven.ai",
    icon: "ph:file-text",
  },
  {
    label: "X",
    hint: "@OpenCvn",
    href: "https://x.com/OpenCvn",
    icon: "ph:x-logo-bold",
  },
  {
    label: "Discord",
    hint: "the coven hall",
    href: "https://discord.gg/opencoven",
    icon: "ph:discord-logo",
  },
];

function daemonPresentation(state: AboutDaemonState): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (state.kind === "running") {
    const version = exactSemver(state.version);
    return {
      label: version ? `daemon v${version}` : "daemon running",
      detail: version ? `Running v${version}` : "Running (version unavailable)",
      tone: "success",
    };
  }
  if (state.kind === "stopped") {
    return { label: "daemon stopped", detail: "Stopped", tone: "warning" };
  }
  if (state.kind === "unreachable") {
    return { label: "daemon unreachable", detail: "Unreachable", tone: "danger" };
  }
  if (state.kind === "failed-to-check") {
    return { label: "daemon unknown", detail: "Failed to check", tone: "danger" };
  }
  return { label: "checking daemon", detail: "Checking…", tone: "muted" };
}

function safeDaemonDiagnostics(state: AboutDaemonState) {
  if (state.kind === "checking") return { state: "checking" };
  if (state.kind === "running") {
    return {
      state: "running",
      version: exactSemver(state.version),
      checkedAt: state.checkedAt,
    };
  }
  return {
    state: state.kind,
    checkedAt: state.checkedAt,
    reason: state.reason ? sanitizeAboutDiagnosticText(state.reason) : null,
  };
}

function sidecarTokenPresent(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(SIDECAR_TOKEN_STORAGE_KEY));
  } catch {
    return false;
  }
}

function AboutDaemonStatusRow({
  state,
  onRefresh,
}: {
  state: AboutDaemonState;
  onRefresh: () => void;
}) {
  const presentation = daemonPresentation(state);
  const reason =
    state.kind === "checking" || state.kind === "running" ? null : state.reason;
  const checkedAt = state.kind === "checking" ? null : state.checkedAt;

  return (
    <div className="settings-about-row settings-about-daemon-row">
      <span className="settings-about-row__label">Daemon</span>
      <div className="settings-about-row__value">
        <span
          className={`settings-about-status settings-about-status--${presentation.tone}`}
          title={reason ?? checkedAt ?? undefined}
        >
          <span className="settings-about-status__dot" aria-hidden="true" />
          {presentation.detail}
          {checkedAt ? ` · checked ${relativeTime(checkedAt)}` : ""}
        </span>
        <Button
          variant="secondary"
          size="xs"
          onClick={onRefresh}
          disabled={state.kind === "checking"}
          className="settings-tool-action"
        >
          {state.kind === "checking" ? "Checking…" : "Retry"}
        </Button>
      </div>
      {reason ? <p className="settings-about-row__reason">{reason}</p> : null}
    </div>
  );
}

function SectionRule({
  children,
  aside,
}: {
  children: string;
  aside?: string;
}) {
  return (
    <div className="settings-about-rule">
      <h2>{children}</h2>
      {aside ? <span>{aside}</span> : null}
      <i aria-hidden="true" />
    </div>
  );
}

function ElsewhereCard({
  card,
}: {
  card: LinkCard;
}) {
  return (
    <Button
      variant="ghost"
      className="settings-about-link-card settings-about-link-card--small focus-ring"
      onClick={() => openExternalUrl(card.href)}
      aria-label={`Open ${card.label}`}
    >
      <span className="settings-about-link-card__glyph" aria-hidden="true">
        <Icon name={card.icon} width={16} />
      </span>
      <span className="settings-about-link-card__copy">
        <strong>{card.label}</strong>
        <small>{card.hint}</small>
      </span>
    </Button>
  );
}

export function AboutSection() {
  const { announce } = useAnnouncer();
  const updateActionRef = useRef<UpdateSettingsActionHandle>(null);
  const daemonRequestRef = useRef<AbortController | null>(null);
  const diagnosticsResetRef = useRef<number | null>(null);
  const [updateCheckAvailable, setUpdateCheckAvailable] = useState(false);
  const [daemonState, setDaemonState] = useState<AboutDaemonState>({
    kind: "checking",
  });
  const [toolSnapshot, setToolSnapshot] =
    useState<OpenCovenToolsDiagnosticsSnapshot>({
      tools: [],
      checking: true,
      error: null,
      lastSuccessfulCheckedAt: null,
      installJobs: {},
      installResults: {},
    });
  const toolSnapshotRef = useRef(toolSnapshot);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const [sigilPokes, setSigilPokes] = useState(0);
  const sigilOpen = sigilPokes >= 5;

  const refreshDaemon = useCallback(() => {
    daemonRequestRef.current?.abort();
    const controller = new AbortController();
    daemonRequestRef.current = controller;
    setDaemonState({ kind: "checking" });
    void fetch("/api/daemon/status", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        setDaemonState(
          classifyAboutDaemonStatus({
            responseOk: response.ok,
            payload,
            checkedAt: new Date().toISOString(),
          }),
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDaemonState(
          classifyAboutDaemonStatus({
            responseOk: false,
            payload: null,
            checkedAt: new Date().toISOString(),
            error:
              error instanceof Error ? error.message : "status request failed",
          }),
        );
      });
  }, []);

  const handleToolSnapshot = useCallback(
    (snapshot: OpenCovenToolsDiagnosticsSnapshot) => {
      toolSnapshotRef.current = snapshot;
      setToolSnapshot(snapshot);
    },
    [],
  );

  useEffect(() => {
    refreshDaemon();
    return () => {
      daemonRequestRef.current?.abort();
      if (diagnosticsResetRef.current !== null) {
        window.clearTimeout(diagnosticsResetRef.current);
      }
    };
  }, [refreshDaemon]);

  const handleCopyDiagnostics = useCallback(async () => {
    if (diagnosticsStatus === "copying") return;
    setDiagnosticsStatus("copying");
    const snapshot = toolSnapshotRef.current;
    const safeToolDiagnostics = JSON.parse(
      buildSafeToolDiagnostics({
        tools: snapshot.tools,
        checking: snapshot.checking,
        error: snapshot.error,
        lastSuccessfulCheckedAt: snapshot.lastSuccessfulCheckedAt,
        installJobs: snapshot.installJobs,
        installResults: snapshot.installResults,
        href: window.location.href,
        sidecarTokenPresent: sidecarTokenPresent(),
        tauriInternalsPresent: "__TAURI_INTERNALS__" in window,
      }),
    ) as Record<string, unknown>;
    const text = JSON.stringify(
      {
        ...safeToolDiagnostics,
        application: {
          name: "CovenCave",
          version: APP_VERSION,
          builtWith: STACK,
        },
        daemon: safeDaemonDiagnostics(daemonState),
      },
      null,
      2,
    );
    const copied = await copyText(text);
    setDiagnosticsStatus(copied ? "copied" : "failed");
    announce(
      copied
        ? "Safe About diagnostics copied."
        : "About diagnostics could not be copied.",
    );
    if (diagnosticsResetRef.current !== null) {
      window.clearTimeout(diagnosticsResetRef.current);
    }
    diagnosticsResetRef.current = window.setTimeout(
      () => setDiagnosticsStatus("idle"),
      1800,
    );
  }, [
    announce,
    daemonState,
    diagnosticsStatus,
  ]);

  const pokeSigil = () => {
    const next = Math.min(sigilPokes + 1, 5);
    setSigilPokes(next);
    if (next === 5 && sigilPokes < 5) {
      announce("The sigil yields its build marks.");
    }
  };

  const daemon = daemonPresentation(daemonState);
  const readyTools = toolSnapshot.tools.filter(
    (tool) =>
      tool.installed &&
      tool.compatible &&
      tool.packageVerified &&
      tool.executableVerified,
  ).length;
  const toolsChip =
    toolSnapshot.checking && toolSnapshot.tools.length === 0
      ? "checking tools"
      : toolSnapshot.error && toolSnapshot.tools.length === 0
        ? "tools unavailable"
        : `${readyTools}/${toolSnapshot.tools.length} tools ready`;
  const toolsTone =
    toolSnapshot.error || readyTools < toolSnapshot.tools.length
      ? "warning"
      : "success";
  const diagnosticsLabel =
    diagnosticsStatus === "copied"
      ? "Copied"
      : diagnosticsStatus === "failed"
        ? "Copy failed"
        : "Copy diagnostics";

  return (
    <section
      className="settings-about"
      aria-labelledby="settings-about-title"
    >
      <header className="settings-about-hero">
        <Button
          variant="ghost"
          className="settings-about-sigil focus-ring"
          onClick={pokeSigil}
          data-pokes={sigilPokes}
          aria-expanded={sigilOpen}
          aria-controls="settings-about-build-sigil"
          title="Poke the sigil"
        >
          <Icon name="ph:sparkle" width={20} aria-hidden />
          <span className="sr-only">Poke the sigil</span>
        </Button>
        <div className="settings-about-hero__identity">
          <p className="settings-about-hero__kicker">Settings · About</p>
          <h1 id="settings-about-title">About</h1>
          <div className="settings-about-hero__chips">
            <span className="settings-about-chip">
              <i aria-hidden="true" />
              v{APP_VERSION}
            </span>
            <span
              className={`settings-about-chip settings-about-chip--${daemon.tone}`}
            >
              <i aria-hidden="true" />
              {daemon.label}
            </span>
            <span
              className={`settings-about-chip settings-about-chip--${toolsTone}`}
            >
              <i aria-hidden="true" />
              {toolsChip}
            </span>
          </div>
        </div>
        <div className="settings-about-hero__actions">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={
              diagnosticsStatus === "copied"
                ? "ph:check-bold"
                : diagnosticsStatus === "failed"
                  ? "ph:warning"
                  : "ph:copy"
            }
            loading={diagnosticsStatus === "copying"}
            onClick={() => void handleCopyDiagnostics()}
          >
            {diagnosticsLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:arrow-clockwise-bold"
            disabled={!updateCheckAvailable}
            onClick={() => {
              if (updateActionRef.current?.check()) {
                announce("Checking for Cave updates.");
              }
            }}
          >
            Check for updates
          </Button>
        </div>
      </header>

      <div className="settings-about-control-grid">
        <div
          id={settingsGroupId("CovenCave")}
          data-settings-group
          className="settings-about-control"
        >
          <SectionRule aside="This build">CovenCave</SectionRule>
          <div className="settings-about-sheet">
            <div className="settings-about-row">
              <span className="settings-about-row__label">App version</span>
              <code className="settings-about-row__code">v{APP_VERSION}</code>
            </div>
            <UpdateSettingsRow
              actionRef={updateActionRef}
              onCheckAvailabilityChange={setUpdateCheckAvailable}
            />
            <AboutDaemonStatusRow
              state={daemonState}
              onRefresh={refreshDaemon}
            />
            <div className="settings-about-row settings-about-row--stack">
              <span className="settings-about-row__label">Built with</span>
              <span className="settings-about-stack">
                {STACK.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </span>
            </div>
            {sigilOpen ? (
              <div
                id="settings-about-build-sigil"
                className="settings-about-build-sigil"
                role="status"
              >
                <strong>Build sigil</strong>
                <span>
                  CovenCave v{APP_VERSION} · {STACK.join(" + ")}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div
          id={settingsGroupId("OpenCoven tools")}
          data-settings-group
          className="settings-about-control"
        >
          <SectionRule
            aside={
              toolSnapshot.checking
                ? "Checking"
                : toolSnapshot.error
                  ? "Check incomplete"
                  : `${readyTools} ready`
            }
          >
            OpenCoven tools
          </SectionRule>
          <div className="settings-about-sheet settings-about-tools">
            <OpenCovenToolsUpdate
              showDiagnosticsAction={false}
              onSnapshotChange={handleToolSnapshot}
            />
          </div>
        </div>
      </div>

      <div
        id={settingsGroupId("Links")}
        data-settings-group
        className="settings-about-elsewhere"
      >
        <SectionRule aside="6 places">The Coven, elsewhere</SectionRule>
        <div className="settings-about-links-grid">
          <Button
            variant="ghost"
            className="settings-about-link-card settings-about-link-card--grimoire focus-ring"
            onClick={() => openExternalUrl("https://mind.opencoven.ai")}
            aria-label="Open the Grimoire"
          >
            <span className="settings-about-grimoire-art" aria-hidden="true">
              <span className="settings-about-grimoire-mark">
                <Icon name="ph:book-open" width={24} />
              </span>
            </span>
            <span className="settings-about-link-card__copy">
              <small>Grimoire</small>
              <strong>The shared knowledge base</strong>
              <span>
                Every familiar reads from it. Pages bind from chat, and
                citations survive the session.
              </span>
            </span>
          </Button>

          <Button
            variant="ghost"
            className="settings-about-link-card settings-about-link-card--github focus-ring"
            onClick={() =>
              openExternalUrl("https://github.com/OpenCoven/coven-cave")
            }
            aria-label="Open CovenCave on GitHub"
          >
            <span className="settings-about-link-card__heading">
              <Icon name="ph:github-logo" width={16} aria-hidden />
              <strong>GitHub</strong>
              <small>source · issues</small>
            </span>
            <code>{CLONE_COMMAND}</code>
          </Button>

          {SMALL_LINKS.map((card) => (
            <ElsewhereCard key={card.href} card={card} />
          ))}

          <Button
            variant="ghost"
            className="settings-about-link-card settings-about-link-card--podcast focus-ring"
            onClick={() => openExternalUrl("https://pod.opencoven.ai")}
            aria-label="Listen to the OpenCoven podcast"
          >
            <span className="settings-about-podcast-art" aria-hidden="true">
              <Icon name="ph:waveform-bold" width={24} />
              <small>OCW</small>
            </span>
            <span className="settings-about-link-card__copy">
              <small>Podcast</small>
              <strong>Open Coven Weekly</strong>
              <span>Shipping notes, every Friday.</span>
            </span>
            <span className="settings-about-link-card__action">Listen</span>
          </Button>

          <div className="settings-about-release-card">
            <div>
              <small>Release notes · v{APP_VERSION}</small>
              <strong>What changed in this Cave</strong>
            </div>
            <ul>
              <li>Features and fixes</li>
              <li>Signed desktop installers</li>
              <li>Upgrade guidance</li>
            </ul>
            <Button
              variant="secondary"
              size="xs"
              trailingIcon="ph:arrow-square-out"
              onClick={() =>
                openExternalUrl(
                  "https://github.com/OpenCoven/coven-cave/releases/latest",
                )
              }
            >
              View latest release
            </Button>
          </div>
        </div>
      </div>

      <p
        className="settings-about-copy-status sr-only"
        role="status"
        aria-live="polite"
      >
        {diagnosticsStatus === "copied"
          ? "Safe diagnostics copied."
          : diagnosticsStatus === "failed"
            ? "Diagnostics could not be copied."
            : ""}
      </p>
    </section>
  );
}
