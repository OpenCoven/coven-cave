"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import {
  shouldQueueInstall,
  enqueueInstall,
  nextDrainTarget,
  shouldRequeueOn409,
} from "@/lib/onboarding-install-queue";
import type { IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAnnouncer } from "@/components/ui/live-region";
import { Button } from "@/components/ui/button";
import { SalemPathfinderEntry } from "@/components/salem/salem-pathfinder-entry";
import type { SalemPathfinderRequest } from "@/lib/salem/pathfinder-types";
import { openExternalUrl } from "@/lib/open-external";
import {
  hasVerifiedLatestVersion,
  latestCheckText,
  toolStatusText,
  type LatestCheckDisplay,
} from "@/lib/opencoven-tools-status-display";
import { requestSummonFamiliar } from "@/lib/summon-events";
import {
  openCovenToolActionTargets,
  openCovenToolsInstallCommand,
  openCovenToolsPrimaryActionLabel,
} from "@/lib/opencoven-tools-install";

// Guided onboarding: one numbered path from "nothing installed" to "ready to
// summon". Every step carries its own instructions, a one-click action where
// Cave can do the work itself, the exact manual command for users who prefer
// a terminal, and a troubleshooting block — so nobody is ever stuck staring
// at a red card with no next move. Familiar creation itself lives INSIDE the
// app (the Familiar Summoning Circle on the Familiars surface): the wizard
// stops at infrastructure — tools, home, runtime, daemon — and the workspace
// walks a familiar-less user into the circle after dismissal.

type PruneState =
  | { idle: true }
  | { counting: true }
  | { count: number }
  | { pruning: true }
  | { pruned: number }
  | { error: string };
type Step = { ok: boolean; detail?: string; hint?: string; optional?: boolean };
type PlatformId = "windows" | "linux" | "mac" | "unknown";

type OnboardingStatus = {
  complete: boolean;
  steps: {
    covenCli: Step;
    covenHome: Step;
    git?: Step;
    adapters: Step;
    daemon: Step;
    familiars: Step;
    binding: Step;
  };
  tools?: OpenCovenToolStatus[];
};

type OpenCovenToolStatus = {
  id: "coven-cli" | "coven-code";
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  path: string | null;
  current: string | null;
  latest: string | null;
  latestCheck: LatestCheckDisplay;
  outdated: boolean;
  compatible: boolean;
  minimumVersion: string;
  checkedAt?: string;
};

type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
  installHint: string;
  source: string;
  manifestPath: string | null;
};

type InstallTarget =
  | "coven-cli"
  | "coven-code"
  | "codex"
  | "claude"
  | "copilot"
  | "openclaw"
  | "hermes";

type InstallResult = {
  ok: boolean;
  detail: string;
};

type NpmLaneState = {
  target: InstallTarget;
  label: string;
};

/** Result of the codex OAuth port preflight (POST /api/onboarding/codex-port-preflight).
 *  The four outcomes mirror the route handler's response shape. UI consumes
 *  `ok` for color/icon and `detail` for the user-facing message. */
type PortPreflightResult = {
  ok: boolean;
  detail: string;
  outcome:
    | "port-free"
    | "cleared-stale-codex"
    | "held-by-other"
    | "held-unknown";
};

type InstallJobView = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
  ok?: boolean;
  binaryPath?: string | null;
  error?: string;
};

/** Mirrors the server's per-target install mechanism (route.ts INSTALL_TARGETS).
 *  npm-kind installs are mutually exclusive — the route 409s — so they share
 *  one client-side busy lock. */
const INSTALL_TARGET_KIND: Record<InstallTarget, "npm" | "script"> = {
  "coven-cli": "npm",
  "coven-code": "npm",
  codex: "npm",
  claude: "npm",
  copilot: "npm",
  openclaw: "npm",
  hermes: "script",
};
const ALL_INSTALL_TARGETS = Object.keys(INSTALL_TARGET_KIND) as InstallTarget[];
const NPM_INSTALL_TARGETS = ALL_INSTALL_TARGETS.filter(
  (target) => INSTALL_TARGET_KIND[target] === "npm",
);

function isInstallTargetValue(value: string): value is InstallTarget {
  return ALL_INSTALL_TARGETS.includes(value as InstallTarget);
}

// ~30s of 2s ticks: long enough to ride out a slow sidecar start, short
// enough that a genuinely broken /api/harnesses surfaces as a retryable
// error instead of an empty runtime grid polling silently forever.
const HARNESS_RETRY_BUDGET = 15;

const OPENCLAW_AGENT_ROOT = "~/.openclaw/agents";
const OPENCLAW_WORKSPACE_ROOT = "~/.openclaw/workspace";

/** Every chat harness Cave can install itself. `command` is the manual
 *  equivalent shown beside the button; `windowsCommand` overrides it on
 *  Windows when the official installer differs (Hermes). */
const HARNESS_ONE_CLICK: Partial<
  Record<
    string,
    {
      target: InstallTarget;
      command: string;
      windowsCommand?: string;
      afterInstall: string;
    }
  >
> = {
  codex: {
    target: "codex",
    command: "npm install -g @openai/codex",
    afterInstall: "then run `codex login` in a terminal to sign in",
  },
  claude: {
    target: "claude",
    command: "npm install -g @anthropic-ai/claude-code",
    afterInstall: "then run `claude doctor` in a terminal to finish setup",
  },
  copilot: {
    target: "copilot",
    command: "npm install -g @github/copilot",
    afterInstall:
      "then run `copilot` in a terminal and sign in with `/login` (or set GH_TOKEN)",
  },
  openclaw: {
    target: "openclaw",
    command: "npm i -g openclaw@latest",
    afterInstall:
      `then summon a familiar from an agent in ${OPENCLAW_AGENT_ROOT} once you're inside Cave (Familiars → Summon familiar)`,
  },
  "coven-code": {
    target: "coven-code",
    command: "npm i -g @opencoven/coven-code@latest",
    afterInstall:
      "then run `coven-code` in a terminal once to connect a provider",
  },
  hermes: {
    target: "hermes",
    command:
      "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    windowsCommand: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    afterInstall:
      "then run `hermes setup` in a terminal (installer can take several minutes — it bootstraps its own toolchain)",
  },
};

const PLATFORM_COPY: Record<
  PlatformId,
  {
    label: string;
    nodeSetup: string[];
    caveInstall: string[];
    cliInstall: string[];
    warning?: string;
    warningLink?: { label: string; href: string };
  }
> = {
  windows: {
    label: "Windows",
    warning:
      "The Windows build isn't code-signed yet, so Smart App Control blocks it when enabled. Check Windows Security > App & browser control: if Smart App Control is On, turn it off before downloading. On most PCs it's already Off and nothing is needed.",
    warningLink: {
      label: "What is Smart App Control?",
      href: "https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003",
    },
    nodeSetup: [
      "Install Node.js LTS from https://nodejs.org, or run winget install OpenJS.NodeJS.LTS.",
      "Restart Cave afterwards so the new PATH applies.",
      "Click the Install button again — Cave re-finds npm automatically.",
    ],
    caveInstall: [
      "Download the MSI from the official GitHub Release.",
      "Only if Smart App Control is On (see the notice above): Settings > Privacy & security > Windows Security > App & browser control > Smart App Control settings > Off.",
      "If SmartScreen shows \"Windows protected your PC\" when you open the MSI, click More info > Run anyway.",
      "Install CovenCave, then open it from Start.",
    ],
    cliInstall: [
      "Install the Coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven.exe is on PATH after the global npm install.",
      "Click Re-check after Windows can run coven from a new terminal.",
    ],
  },
  linux: {
    label: "Linux",
    nodeSetup: [
      "Install Node.js LTS from https://nodejs.org or your package manager (e.g. sudo apt install nodejs npm).",
      "Open a new terminal so PATH updates apply.",
      "Click the Install button again — Cave re-finds npm automatically.",
    ],
    caveInstall: [
      "Download the AppImage from the official GitHub Release.",
      "Run chmod +x CovenCave_*.AppImage.",
      "Launch the AppImage from your file manager or terminal.",
    ],
    cliInstall: [
      "Install the Coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven is on PATH after the global npm install.",
      "If your desktop shell has an older PATH, restart Cave after installing the tools.",
    ],
  },
  mac: {
    label: "macOS",
    nodeSetup: [
      "Install Node.js LTS from https://nodejs.org, or run brew install node.",
      "Open a new terminal so PATH updates apply.",
      "Click the Install button again — Cave re-finds npm automatically.",
    ],
    caveInstall: [
      "Download the DMG from the official GitHub Release.",
      "Open the DMG and drag CovenCave to Applications.",
      "Open CovenCave from Applications.",
    ],
    cliInstall: [
      "Install the Coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure a terminal can run coven after the global npm install.",
      "Click Re-check here after install.",
    ],
  },
  unknown: {
    label: "Your platform",
    nodeSetup: [
      "Install Node.js LTS from https://nodejs.org.",
      "Open a new terminal so PATH updates apply.",
      "Click the Install button again — Cave re-finds npm automatically.",
    ],
    caveInstall: [
      "Download the matching asset from the official GitHub Release.",
      "Install or launch the app for your OS.",
      "Open CovenCave and continue setup here.",
    ],
    cliInstall: [
      "Install the Coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven is on PATH.",
      "Click Re-check here after install.",
    ],
  },
};

type Props = {
  open: boolean;
  onDismiss: () => void;
};

function detectPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "unknown";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw =
    `${nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent}`.toLowerCase();
  if (raw.includes("win")) return "windows";
  if (raw.includes("linux")) return "linux";
  if (raw.includes("mac")) return "mac";
  return "unknown";
}

type GuidedStep = {
  key: string;
  title: string;
  ok: boolean;
  optional?: boolean;
  detail: string;
  icon: IconName;
};

type MultiHostMode = "local" | "hub";

function parseOnboardingExecutorUrls(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function OnboardingOverlay({ open, onDismiss }: Props) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [platform, setPlatform] = useState<PlatformId>("unknown");
  const [picking, setPicking] = useState<string | null>(null);
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  // Consecutive /api/harnesses failures — the empty-list retry loop gives up
  // once this hits HARNESS_RETRY_BUDGET and StepRuntimes offers a Retry.
  const [harnessFailures, setHarnessFailures] = useState(0);
  const [prune, setPrune] = useState<PruneState>({ idle: true });
  const [statusFailures, setStatusFailures] = useState(0);
  // Guided-step navigation: which step the user manually expanded. `null`
  // follows the first incomplete required step automatically.
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  // One-click installs (/api/onboarding/install)
  const [installJobs, setInstallJobs] = useState<
    Partial<Record<InstallTarget, InstallJobView>>
  >({});
  const [installResults, setInstallResults] = useState<
    Partial<Record<InstallTarget, InstallResult>>
  >({});
  const [npmLane, setNpmLane] = useState<NpmLaneState | null>(null);
  // Codex's `codex login` opens an OAuth callback server on port 1455 that
  // sometimes leaks as a stale process when the auth flow is killed mid-way.
  // The preflight POST identifies and clears the orphan; we display the
  // result inline on the codex card.
  const [codexPortPreflight, setCodexPortPreflight] =
    useState<PortPreflightResult | null>(null);
  const [codexPortPreflightBusy, setCodexPortPreflightBusy] =
    useState(false);
  // npm installs are mutually exclusive server-side (the route 409s a second
  // concurrent one), so a user who clicks "install both" otherwise gets a
  // failure on the second. Queue npm targets here and drain them one at a time.
  const [installQueue, setInstallQueue] = useState<InstallTarget[]>([]);
  const [nodeHint, setNodeHint] = useState<string | null>(null);
  const [onboardingMultiHostMode, setOnboardingMultiHostMode] =
    useState<MultiHostMode>("local");
  const [onboardingHubUrl, setOnboardingHubUrl] = useState("");
  const [onboardingExecutorText, setOnboardingExecutorText] = useState("");
  const [savingOnboardingConnection, setSavingOnboardingConnection] =
    useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, dialogRef, { onEscape: onDismiss });

  // Finishing setup ("Open Cave") records the dismissal just like "Skip for
  // now" does. Without this, the workspace auto-open effect re-launches the
  // ENTIRE wizard on the next visit as soon as status.complete flips false
  // again — which happens every time the daemon isn't running. A user who
  // completed setup once should get the lightweight daemon banner after
  // that, not the first-run flow. (Escape stays session-only on purpose: an
  // accidental Esc mid-setup shouldn't permanently hide the guide.)
  //
  // When the daemon is up and the roster is empty, the CTA's promise
  // ("summon your familiar") is kept literally: requestSummonFamiliar()
  // walks to the Familiars surface AND opens the Summoning Circle. This
  // decision uses the wizard's own 2s-fresh status instead of the
  // workspace's 5s daemonRunning poll, which can lag a just-auto-started
  // daemon and silently drop the walk (closeOnboarding keeps its gate as a
  // harmless second net). Skip/Escape stay non-pushy: no circle for them.
  const statusRef = useRef<OnboardingStatus | null>(null);
  statusRef.current = status;
  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem("cave:onboarding:dismissed", "1");
    } catch {
      /* private mode */
    }
    const s = statusRef.current?.steps;
    if (s?.daemon.ok && !s.familiars.ok) requestSummonFamiliar();
    onDismiss();
  }, [onDismiss]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status", { cache: "no-store" });
      if (!res.ok) {
        setStatusFailures((n) => n + 1);
        return;
      }
      const json = (await res.json()) as OnboardingStatus & { ok: boolean };
      setStatus(json);
      setStatusFailures(0);
    } catch {
      // Track consecutive failures so the UI can move past "checking…" once
      // we're sure the poll isn't just slow. One blip stays silent.
      setStatusFailures((n) => n + 1);
    }
  }, []);

  const refreshNpmLane = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/install", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        npmBusy?: boolean;
        npmBusyTarget?: string | null;
        npmBusyLabel?: string | null;
        npmJob?: InstallJobView;
      };
      const target = json.npmBusyTarget;
      if (!json.npmBusy || !target || !isInstallTargetValue(target)) {
        setNpmLane(null);
        return;
      }
      setNpmLane({ target, label: json.npmBusyLabel ?? target });
      if (json.npmJob?.status === "running") {
        setInstallJobs((prev) => ({ ...prev, [target]: json.npmJob! }));
      }
    } catch {
      /* Retain the last observed lane state until the next successful poll. */
    }
  }, []);

  useEffect(() => setPlatform(detectPlatform()), []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { ok?: boolean; config?: { multiHost?: { mode?: MultiHostMode; hubUrl?: string; executorUrls?: string[] } } }) => {
        const multiHost = json.config?.multiHost;
        if (!json.ok || !multiHost) return;
        setOnboardingMultiHostMode(multiHost.mode === "hub" ? "hub" : "local");
        setOnboardingHubUrl(multiHost.hubUrl ?? "");
        setOnboardingExecutorText((multiHost.executorUrls ?? []).join("\n"));
      })
      .catch(() => {});
  }, [open]);

  const loadHarnesses = useCallback(async () => {
    try {
      const res = await fetch("/api/harnesses", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        harnesses?: HarnessReport[];
      };
      if (!res.ok || json.ok === false) {
        setHarnessFailures((n) => n + 1);
        return;
      }
      setHarnesses(json.harnesses ?? []);
      setHarnessFailures(0);
    } catch {
      // Advisory, but count the failure — the empty-list retry loop below
      // gives up on a persistent error instead of spinning silently forever.
      setHarnessFailures((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    void loadHarnesses();
    void refreshNpmLane();
    pollRef.current = setInterval(() => {
      void refresh();
      void refreshNpmLane();
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh, loadHarnesses, refreshNpmLane]);

  // The harness probe races first paint: it loads once at open, so a slow or
  // failed first fetch left the runtime step's grid empty until a manual
  // Refresh. Retry on the status cadence while the list is empty — a
  // successful response always carries the bundled adapters, so the loop
  // stops after the first real load and never spins on a healthy state.
  // A failure budget stops it on a persistently broken endpoint too:
  // without one the loop spun every 2s forever while the runtime step showed
  // an empty grid with no explanation. Once spent, StepRuntimes shows a
  // retryable error (its Retry resets the budget, which restarts this loop).
  useEffect(() => {
    if (!open || harnesses.length > 0) return;
    if (harnessFailures >= HARNESS_RETRY_BUDGET) return;
    const retry = setInterval(() => void loadHarnesses(), 2000);
    return () => clearInterval(retry);
  }, [open, harnesses.length, harnessFailures, loadHarnesses]);

  const platformCopy = PLATFORM_COPY[platform];
  const chatHarnesses = harnesses.filter((adapter) => adapter.chatSupported);

  // Header-button feedback: both actions were silent, so clicks felt dead.
  // Re-check spins its icon while the status fetch is in flight (held for a
  // beat so fast responses still read as activity); Copy diagnostics flashes
  // copied/failed for 2s.
  const [rechecking, setRechecking] = useState(false);
  const [diagCopy, setDiagCopy] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const recheckNow = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await Promise.all([
        refresh(),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    } finally {
      setRechecking(false);
    }
  };

  const copyDiagnostics = async () => {
    const ok = await copyText(
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          platform,
          setupComplete: status?.complete ?? false,
          steps: status?.steps ?? null,
          // Number of consecutive /api/onboarding/status failures at capture
          // time. Non-zero here narrows "setup stuck" to "Cave can't reach
          // the local status endpoint" (vs the daemon being healthy but the
          // user hitting an unmet step).
          statusFailures,
          setupError,
          installResults,
          nodeHint,
          harnesses: harnesses.map((adapter) => ({
            id: adapter.id,
            label: adapter.label,
            installed: adapter.installed,
            path: adapter.path,
            version: adapter.version,
            chatSupported: adapter.chatSupported,
            installHint: adapter.installHint,
            source: adapter.source,
            manifestPath: adapter.manifestPath,
          })),
        },
        null,
        2,
      ),
    );
    setDiagCopy(ok ? "copied" : "failed");
    setTimeout(() => setDiagCopy("idle"), 2000);
  };

  // Guards the gap between dispatching an install POST and the running job
  // appearing in installJobs, so the drain effect can't double-start the queue.
  const installInFlightRef = useRef(false);

  const markQueued = (target: InstallTarget) => {
    setSetupError(null);
    setNodeHint(null);
    setInstallResults((prev) => ({
      ...prev,
      [target]: {
        ok: true,
        detail: "Queued — starts when the current install finishes.",
      },
    }));
  };

  // Actually dispatch the install and hand the running job to the poll effect.
  const postInstall = useCallback(async (target: InstallTarget) => {
    installInFlightRef.current = true;
    setSetupError(null);
    setNodeHint(null);
    setInstallResults((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
    try {
      const res = await fetch("/api/onboarding/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        started?: boolean;
        status?: string;
        elapsedMs?: number;
        tail?: string;
        npmMissing?: boolean;
        hint?: string;
        error?: string;
        npmBusy?: boolean;
        npmBusyTarget?: string | null;
        npmBusyLabel?: string | null;
      };
      if (
        json.npmBusy &&
        json.npmBusyTarget &&
        isInstallTargetValue(json.npmBusyTarget)
      ) {
        setNpmLane({
          target: json.npmBusyTarget,
          label: json.npmBusyLabel ?? json.npmBusyTarget,
        });
      }
      if (json.npmMissing) {
        setNodeHint(
          json.hint ??
            "Install Node.js LTS from https://nodejs.org, then try again.",
        );
        setInstallResults((prev) => ({
          ...prev,
          [target]: {
            ok: false,
            detail: "npm not found — Node.js setup needed first.",
          },
        }));
        return;
      }
      if (!res.ok) {
        // Lost the race for the single npm lane — re-queue and let the drain
        // effect retry instead of surfacing a "wait for X to finish" error.
        if (shouldRequeueOn409(INSTALL_TARGET_KIND[target], res.status)) {
          setInstallQueue((q) => enqueueInstall(q, target));
          markQueued(target);
          return;
        }
        setInstallResults((prev) => ({
          ...prev,
          [target]: {
            ok: false,
            detail: json.error ?? "install failed to start",
          },
        }));
        return;
      }
      // 202 started (or idempotent 200 for an already-running job): hand off
      // to the polling effect. Seed with the body's real elapsed/tail when
      // present (idempotent re-POST returns the live view) so the UI doesn't
      // flash back to zero on a re-POST.
      setInstallJobs((prev) => ({
        ...prev,
        [target]:
          json.status === "running" && typeof json.elapsedMs === "number"
            ? {
                status: "running",
                elapsedMs: json.elapsedMs,
                tail: json.tail ?? "",
              }
            : { status: "running", elapsedMs: 0, tail: "" },
      }));
    } catch (err) {
      setInstallResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          detail: err instanceof Error ? err.message : "install failed",
        },
      }));
    } finally {
      installInFlightRef.current = false;
    }
  }, []);

  // UI entry point. npm installs are mutually exclusive (the server 409s a
  // second concurrent one), so when the npm lane is busy or already has work
  // queued, enqueue this target and let the drain effect run it next — this is
  // what makes "install both" work instead of failing the second one.
  const runInstall = (target: InstallTarget) => {
    if (
      shouldQueueInstall({
        kind: INSTALL_TARGET_KIND[target],
        npmBusy: npmLane !== null || anyNpmInstallRunning(installJobs),
        inFlight: installInFlightRef.current,
        queuedCount: installQueue.length,
      })
    ) {
      setInstallQueue((q) => enqueueInstall(q, target));
      markQueued(target);
      return;
    }
    void postInstall(target);
  };

  // Codex CLI's `codex login` opens an OAuth callback server on port 1455
  // that sometimes leaks as an orphan process when the auth flow is killed
  // mid-way. This handler probes the port and, if a stale `codex` process is
  // holding it, clears it so the next sign-in attempt can bind. Conservative:
  // the server route refuses to kill anything that doesn't clearly identify
  // as codex.
  const runCodexPortPreflight = useCallback(async () => {
    setCodexPortPreflightBusy(true);
    setCodexPortPreflight(null);
    try {
      const res = await fetch("/api/onboarding/codex-port-preflight", {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        outcome?: PortPreflightResult["outcome"];
        message?: string;
      };
      const outcome: PortPreflightResult["outcome"] =
        json.outcome === "port-free" ||
        json.outcome === "cleared-stale-codex" ||
        json.outcome === "held-by-other" ||
        json.outcome === "held-unknown"
          ? json.outcome
          : "held-unknown";
      setCodexPortPreflight({
        ok: res.ok && json.ok !== false,
        detail: json.message ?? "Codex OAuth port preflight finished.",
        outcome,
      });
    } catch (err) {
      setCodexPortPreflight({
        ok: false,
        outcome: "held-unknown",
        detail: err instanceof Error
          ? `Preflight failed: ${err.message}`
          : "Preflight request failed.",
      });
    } finally {
      setCodexPortPreflightBusy(false);
    }
  }, []);

  // Drain the npm queue one at a time as the lane frees up.
  useEffect(() => {
    const next = nextDrainTarget(installQueue, {
      npmBusy: npmLane !== null || anyNpmInstallRunning(installJobs),
      inFlight: installInFlightRef.current,
    });
    if (next == null) return;
    setInstallQueue((q) => q.slice(1));
    void postInstall(next);
  }, [installQueue, installJobs, npmLane, postInstall]);

  // Poll cadence is keyed on WHICH targets are running, not on the job map
  // itself — every poll stores a fresh view object, and keying on the map
  // would tear down and immediately re-fire the interval (hot loop).
  const runningInstallKey = (
    Object.entries(installJobs) as [InstallTarget, InstallJobView][]
  )
    .filter(([, job]) => job.status === "running")
    .map(([target]) => target)
    .sort()
    .join(",");

  // Poll running install jobs every 2s. The interval is keyed on the sorted
  // running-target signature so storing poll results does not tear it down;
  // it only re-runs when a target starts or stops running.
  useEffect(() => {
    if (!runningInstallKey) return;
    const targets = runningInstallKey.split(",") as InstallTarget[];
    let cancelled = false;
    // Give up after ~1 min of consecutive unreachable/errored polls so a network
    // drop mid-install surfaces a failure (via the existing result/retry UI)
    // instead of an "Installing…" spinner that never resolves.
    const MAX_POLL_FAILURES = 30; // 30 × 2s ≈ 1 minute
    let failures = 0;
    const giveUp = () => {
      if (cancelled) return;
      setInstallResults((prev) => {
        const next = { ...prev };
        for (const t of targets) {
          next[t] = { ok: false, detail: "Install timed out — server unreachable. Try again." };
        }
        return next;
      });
      setInstallJobs((prev) => {
        const next = { ...prev };
        for (const t of targets) delete next[t];
        return next;
      });
    };
    const tick = async () => {
      for (const target of targets) {
        try {
          const res = await fetch(
            `/api/onboarding/install?target=${encodeURIComponent(target)}`,
          );
          if (cancelled) return;
          if (!res.ok) {
            if (++failures >= MAX_POLL_FAILURES) giveUp();
            continue;
          }
          failures = 0;
          const json = (await res.json()) as
            | { status: "idle" }
            | InstallJobView;
          if (cancelled) return;
          if (json.status === "idle") {
            // Server restarted mid-install: the job is gone; let the harness
            // refresh tell the truth about whether the binary landed.
            setInstallJobs((prev) => {
              const next = { ...prev };
              delete next[target];
              return next;
            });
            void refresh();
            continue;
          }
          setInstallJobs((prev) => ({ ...prev, [target]: json }));
          if (json.status === "done") {
            setInstallResults((prev) => ({
              ...prev,
              [target]: json.ok
                ? {
                    ok: true,
                    detail: json.binaryPath
                      ? `installed at ${json.binaryPath}`
                      : "installed",
                  }
                : { ok: false, detail: json.error ?? "install failed" },
            }));
            await refresh();
            await loadHarnesses();
          }
        } catch {
          // Network failure — retry next tick, but give up once the budget is
          // spent so the install doesn't spin forever.
          if (!cancelled && ++failures >= MAX_POLL_FAILURES) giveUp();
        }
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningInstallKey]);

  // Re-attach to server-side jobs the first time the overlay opens. The
  // overlay is always mounted (open=false hides it but doesn't unmount), so
  // firing on [] would probe 5 targets on every workspace load for users who
  // are fully onboarded. A once-ref ensures the probe runs exactly once, on
  // the first render where open is true.
  const reAttachFiredRef = useRef(false);
  useEffect(() => {
    if (!open || reAttachFiredRef.current) return;
    reAttachFiredRef.current = true;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        ALL_INSTALL_TARGETS.map(async (target) => {
          try {
            const res = await fetch(
              `/api/onboarding/install?target=${encodeURIComponent(target)}`,
            );
            if (!res.ok || cancelled) return null;
            const json = (await res.json()) as { status: string };
            return json.status === "running"
              ? ([target, json as InstallJobView] as const)
              : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const running = Object.fromEntries(
        entries.filter((entry): entry is NonNullable<typeof entry> => !!entry),
      );
      if (Object.keys(running).length > 0) {
        setInstallJobs((prev) => ({ ...running, ...prev }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const scaffoldOnly = async () => {
    setPicking("scaffold");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const startDaemon = async () => {
    setStartingDaemon(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        const detail =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "daemon start failed";
        const diagnostics = [
          json.exitCode !== undefined ? `exit code: ${json.exitCode}` : null,
          typeof json.stderr === "string" && json.stderr.trim()
            ? json.stderr.trim()
            : null,
          typeof json.stdout === "string" && json.stdout.trim()
            ? json.stdout.trim()
            : null,
        ].filter(Boolean);
        throw new Error(
          diagnostics.length > 0 ? `${detail}\n${diagnostics.join("\n")}` : detail,
        );
      }
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "daemon start failed");
    } finally {
      setStartingDaemon(false);
    }
  };

  // cave-fy1q phase 1: the daemon is the one infra step that can simply
  // happen. When the OPEN wizard reaches it (CLI, home, and runtime healthy;
  // daemon not up), attempt ONE auto-start — the primary button stays as the
  // retry affordance and the failure path is unchanged. Gated on `open`
  // because hooks run even while the overlay renders null — a veteran
  // machine with a stopped daemon must never get a surprise background
  // start on boot. The ref (not state) survives re-renders, and it latches
  // when the daemon is already up so a later crash mid-wizard never
  // auto-restarts either.
  const daemonAutoStartRef = useRef(false);
  useEffect(() => {
    if (!open || daemonAutoStartRef.current) return;
    const s = status?.steps;
    if (!s) return;
    if (s.daemon.ok) {
      daemonAutoStartRef.current = true;
      return;
    }
    if (!s.covenCli.ok || !s.covenHome.ok || !s.adapters.ok) return;
    daemonAutoStartRef.current = true;
    void startDaemon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  const saveOnboardingConnection = async () => {
    setSavingOnboardingConnection(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ multiHost: { mode: onboardingMultiHostMode, hubUrl: onboardingHubUrl, executorUrls: parseOnboardingExecutorUrls(onboardingExecutorText) } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "connection setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "connection setup failed");
    } finally {
      setSavingOnboardingConnection(false);
    }
  };


  // Server `complete` is the single source of truth for setup — the Coven CLI
  // is the only required OpenCoven tool. Coven Code is an ordinary optional
  // runtime adapter offered in the runtime step (cave-219 history: it used to
  // be "required + skippable" via a client-side AND that could diverge from
  // the workspace auto-open gate).
  const setupComplete = status?.complete ?? false;

  const steps = useMemo<GuidedStep[]>(() => {
    const s = status?.steps;
    return [
      {
        key: "covenCli",
        title: "Install the Coven CLI",
        ok: !!s?.covenCli.ok,
        detail: s?.covenCli.detail ?? s?.covenCli.hint ?? "checking…",
        icon: "ph:gear-six",
      },
      {
        key: "covenHome",
        title: "Create your Coven home",
        ok: !!s?.covenHome.ok,
        detail: s?.covenHome.detail ?? s?.covenHome.hint ?? "checking…",
        icon: "ph:folder",
      },
      {
        key: "adapters",
        title: "Install a runtime",
        ok: !!s?.adapters.ok,
        detail: s?.adapters.detail ?? s?.adapters.hint ?? "checking…",
        icon: "ph:terminal-window",
      },
      {
        key: "daemon",
        title: "Start the daemon",
        ok: !!s?.daemon.ok,
        detail: s?.daemon.detail ?? s?.daemon.hint ?? "checking…",
        icon: "ph:plug",
      },
      {
        key: "git",
        title: "Find Git (recommended)",
        optional: true,
        // Advisory: absence never blocks setup; treat "not reported" as fine.
        ok: s?.git ? s.git.ok : true,
        detail:
          s?.git?.detail ??
          s?.git?.hint ??
          "Powers the changes panel, project files, and checkpoints.",
        icon: "ph:git-branch-bold",
      },
    ];
  }, [status]);

  // The step the guide spotlights: the first required step that isn't done.
  const activeStepKey = useMemo(() => {
    const firstIncomplete = steps.find((s) => !s.optional && !s.ok);
    return firstIncomplete?.key ?? null;
  }, [steps]);

  // Steps tick themselves via the 2s status poll — visually obvious, silent
  // to screen readers. Announce spotlight moves (forward on completion,
  // backward on regression like the daemon dying mid-setup) through the
  // shared polite live region. The ref-seeded first observation keeps the
  // wizard from narrating its own opening.
  const { announce } = useAnnouncer();
  const prevActiveStepRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open || !status) {
      prevActiveStepRef.current = undefined;
      return;
    }
    const prev = prevActiveStepRef.current;
    prevActiveStepRef.current = activeStepKey;
    if (prev === undefined || prev === activeStepKey) return;
    if (activeStepKey === null) {
      announce("Setup complete — every required step is done.");
      return;
    }
    const stepIndex = steps.findIndex((s) => s.key === activeStepKey);
    const step = steps[stepIndex];
    if (!step) return;
    const prevStep = steps.find((s) => s.key === prev);
    announce(
      prevStep?.ok
        ? `${prevStep.title} — done. Next: step ${stepIndex + 1}, ${step.title}.`
        : `Now on step ${stepIndex + 1}: ${step.title}.`,
    );
  }, [open, status, activeStepKey, steps, announce]);

  // Safe machine-state context for Setup Salem — platform + detected runtime
  // health only; never secrets, tokens, or logs (design §"Privacy").
  const salemMachineState = useMemo<SalemPathfinderRequest["machineState"]>(() => ({
    platform:
      platform === "mac" ? "macos" : platform === "windows" ? "windows" : platform === "linux" ? "linux" : "unknown",
    covenCli: status ? (status.steps.covenCli.ok ? "healthy" : "missing") : "unknown",
    daemon: status ? (status.steps.daemon.ok ? "running" : "stopped") : "unknown",
    familiarCount: status?.steps.familiars.ok ? 1 : 0,
  }), [platform, status]);

  // With every required step done, rest on the daemon step (the last one) —
  // familiar creation itself lives in the app's summoning circle now.
  const openStepKey = expandedStep ?? activeStepKey ?? "daemon";

  if (!open) return null;

  const requiredSteps = steps.filter((s) => !s.optional);
  const ready = requiredSteps.filter((s) => s.ok).length;
  const total = requiredSteps.length;
  // The wizard stops at infrastructure; the roster may already be populated
  // when a veteran re-opens it. Gates the finish CTA's "summon" promise and
  // the journey strip's second beat.
  const hasFamiliars = status?.steps.familiars.ok === true;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding"
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-base)]/96 backdrop-blur-sm"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--border-hairline)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
              Set up CovenCave, step by step.
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
              Follow the numbered steps. Each one carries its own instructions,
              a one-click action where Cave can do the work for you, and the
              exact command if you&rsquo;d rather use a terminal. Finished
              steps tick themselves — status re-checks every 2 seconds.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void recheckNow()}
              disabled={rechecking}
              aria-busy={rechecking}
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-70"
            >
              <Icon
                name="ph:arrows-clockwise-bold"
                className={rechecking ? "animate-spin" : undefined}
              />
              {rechecking ? "Checking…" : "Re-check"}
            </button>
            <button
              onClick={() => void copyDiagnostics()}
              aria-live="polite"
              className={`focus-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] hover:border-[var(--border-strong)] ${
                diagCopy === "copied"
                  ? "border-[color-mix(in_oklch,var(--color-success)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                  : diagCopy === "failed"
                    ? "border-[color-mix(in_oklch,var(--color-danger)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-raised)] text-[var(--text-primary)]"
              }`}
            >
              <Icon
                name={
                  diagCopy === "copied"
                    ? "ph:check-bold"
                    : diagCopy === "failed"
                      ? "ph:warning-fill"
                      : "ph:clipboard-text"
                }
              />
              {diagCopy === "copied"
                ? "Copied"
                : diagCopy === "failed"
                  ? "Copy failed"
                  : "Copy diagnostics"}
            </button>
            <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              {ready}/{total} ready
            </div>
          </div>
        </header>

        {/* Journey strip: the wizard is beat one of a three-beat first run.
            Without it the page reads as a dead-ended infra checklist — users
            can't see that a 30-second summoning and a first chat follow. */}
        <JourneyStrip
          setupDone={setupComplete}
          familiarDone={hasFamiliars}
        />

        {setupComplete ? (
          // The finish CTA lives in the footer of a long scrolling page; when
          // the last step ticks, the counter reads 4/4 but the next action is
          // below the fold. Surface it above the fold the moment setup
          // completes so "now what?" never happens.
          <section
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_10%,transparent)] p-4"
          >
            <div className="flex items-start gap-3">
              <Icon
                name="ph:check-circle-fill"
                width={18}
                className="mt-0.5 shrink-0 text-[var(--color-success)]"
              />
              <div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Setup complete — Cave is ready.
                </div>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {hasFamiliars
                    ? "Your familiars are waiting on the roster."
                    : "One step left: summon your first familiar, then start chatting."}
                </p>
              </div>
            </div>
            <button
              onClick={finishOnboarding}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-success)_92%,#000)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[color-mix(in_oklch,var(--color-success)_82%,#000)]"
            >
              <Icon name="ph:rocket-launch-bold" />
              {hasFamiliars ? "Open Cave" : "Summon your familiar"}
            </button>
          </section>
        ) : null}

        {platformCopy.warning ? (
          <section className="mt-5 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,transparent)] p-4 text-[13px] text-[var(--color-warning)]">
            <div className="flex items-start gap-3">
              <Icon
                name="ph:warning-fill"
                width={18}
                className="mt-0.5 shrink-0 text-[var(--color-warning)]"
              />
              <div>
                <div className="font-semibold">Windows download notice</div>
                <p className="mt-1 leading-6">
                  {platformCopy.warning}
                  {platformCopy.warningLink ? (
                    <>
                      {" "}
                      <a
                        href={platformCopy.warningLink.href}
                        className="underline"
                        onClick={(event) => {
                          event.preventDefault();
                          openExternalUrl(event.currentTarget.href);
                        }}
                      >
                        {platformCopy.warningLink.label}
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {statusFailures >= 3 ? (
          <section
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-4 text-[13px] text-[var(--color-warning)]"
          >
            <div>
              <div className="font-semibold">Setup status is unreachable.</div>
              <p className="mt-1 leading-6 text-[var(--text-secondary)]">
                Cave couldn&rsquo;t reach <code className="font-mono">/api/onboarding/status</code> in {statusFailures} attempts. The Coven CLI may not be installed, or the local sidecar may be blocked. Steps will stay on &ldquo;checking…&rdquo; until this clears — step 1 below still works and is the usual fix.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="focus-ring shrink-0 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--color-warning)] hover:bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)]"
            >
              Retry now
            </button>
          </section>
        ) : null}

        {setupError ? (
          // Every setup action (scaffold, daemon start, familiar create,
          // connection save) reports through this banner — it must be a live
          // alert or screen-reader users never hear why their click did
          // nothing, and it must be dismissible so a stale error doesn't
          // outlive the retry.
          <section
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] p-4 text-[13px] text-[var(--color-danger)]"
          >
            <div>{setupError}</div>
            <button
              type="button"
              onClick={() => setSetupError(null)}
              className="focus-ring shrink-0 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)]"
            >
              Dismiss
            </button>
          </section>
        ) : null}

        {!status?.complete ? (
          <section className="mt-5" aria-label="Ask Salem for setup help">
            <SalemPathfinderEntry
              mode="setup"
              density="slim"
              defaultMessage="Help me get my first familiar running in Cave"
              machineState={salemMachineState}
              currentSurface="setup"
              onRunDoctor={() => void recheckNow()}
              onRoute={() => onDismiss()}
            />
          </section>
        ) : null}

        <main className="flex flex-1 flex-col gap-3 py-5">
          <ol className="flex flex-col gap-3" aria-label="Setup steps">
            {steps.map((step, index) => {
              const expanded = openStepKey === step.key;
              const isActive = activeStepKey === step.key;
              return (
                <li key={step.key} aria-current={isActive ? "step" : undefined}>
                  <section
                    aria-label={step.title}
                    className={`rounded-lg border ${
                      step.ok
                        ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)]"
                        : isActive
                          ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)]"
                          : "border-[var(--border-hairline)]"
                    } bg-[var(--bg-raised)]/35`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedStep(
                          expanded ? (isActive ? null : activeStepKey) : step.key,
                        )
                      }
                      aria-expanded={expanded}
                      className="focus-ring flex w-full items-center gap-3 p-3 text-left"
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-[12px] ${
                          step.ok
                            ? "border-[color-mix(in_oklch,var(--color-success)_60%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                            : isActive
                              ? "border-[color-mix(in_oklch,var(--accent-presence)_60%,transparent)] text-[var(--accent-presence)]"
                              : "border-[var(--border-strong)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {step.ok ? <Icon name="ph:check-bold" /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                          <Icon
                            name={step.icon}
                            className="text-[var(--text-muted)]"
                          />
                          {step.title}
                          {step.optional ? (
                            <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">
                              optional
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                          {step.detail}
                        </span>
                      </span>
                      <Icon
                        name={expanded ? "ph:caret-up" : "ph:caret-down"}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                    </button>

                    {expanded ? (
                      <div className="border-t border-[var(--border-hairline)] p-4">
                        {step.key === "covenCli" ? (
                          <StepCovenCli
                            platformCopy={platformCopy}
                            installJobs={installJobs}
                            installResults={installResults}
                            tools={(status?.tools ?? []).filter(
                              (tool) => tool.id === "coven-cli",
                            )}
                            nodeHint={nodeHint}
                            npmBusy={
                              npmLane !== null || anyNpmInstallRunning(installJobs)
                            }
                            npmBusyLabel={npmLane?.label ?? "another npm update"}
                            onInstall={(target) => void runInstall(target)}
                            onCopy={copyText}
                          />
                        ) : step.key === "covenHome" ? (
                          <div className="flex flex-col gap-3">
                            <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                              Cave keeps everything it creates under{" "}
                              <code className="font-mono">~/.coven</code> —
                              familiars, adapters, conversations, and memory.
                              One click creates the folders; nothing outside
                              them is touched.
                            </p>
                            <Button
                              variant="primary"
                              leadingIcon="ph:folder-open-bold"
                              onClick={scaffoldOnly}
                              disabled={picking !== null}
                              className="w-fit"
                            >
                              {picking === "scaffold"
                                ? "Creating…"
                                : "Create Coven home"}
                            </Button>
                          </div>
                        ) : step.key === "adapters" ? (
                          <StepRuntimes
                            chatHarnesses={chatHarnesses}
                            platform={platform}
                            installJobs={installJobs}
                            installResults={installResults}
                            nodeHint={nodeHint}
                            npmBusy={
                              npmLane !== null || anyNpmInstallRunning(installJobs)
                            }
                            npmBusyLabel={npmLane?.label ?? "another npm update"}
                            harnessesStuck={
                              harnesses.length === 0 &&
                              harnessFailures >= HARNESS_RETRY_BUDGET
                            }
                            onInstall={(target) => void runInstall(target)}
                            onCopy={copyText}
                            onRefresh={() => {
                              // Also resets the failure budget so the
                              // empty-list retry loop starts over.
                              setHarnessFailures(0);
                              void loadHarnesses();
                            }}
                            codexPortPreflight={codexPortPreflight}
                            codexPortPreflightBusy={codexPortPreflightBusy}
                            onCodexPortPreflight={() =>
                              void runCodexPortPreflight()
                            }
                          />
                        ) : step.key === "daemon" ? (
                          <div className="flex flex-col gap-3">
                            <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-[12px] font-medium text-[var(--text-primary)]">Daemon connection</span>
                                <button
                                  type="button"
                                  onClick={() => setOnboardingMultiHostMode("local")}
                                  className={`focus-ring rounded-md border px-2 py-1 text-[11px] ${
                                    onboardingMultiHostMode === "local"
                                      ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                                      : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                                  }`}
                                >
                                  Local
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOnboardingMultiHostMode("hub")}
                                  className={`focus-ring rounded-md border px-2 py-1 text-[11px] ${
                                    onboardingMultiHostMode === "hub"
                                      ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                                      : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                                  }`}
                                >
                                  Server hub
                                </button>
                              </div>
                              <label className="grid gap-1 text-[11px] text-[var(--text-secondary)]">
                                Server hub URL
                                <input
                                  value={onboardingHubUrl}
                                  onChange={(event) => setOnboardingHubUrl(event.target.value)}
                                  placeholder="http://server.tailnet:8787"
                                  disabled={onboardingMultiHostMode !== "hub"}
                                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
                                />
                              </label>
                              <label className="mt-2 grid gap-1 text-[11px] text-[var(--text-secondary)]">
                                Executor addresses
                                <textarea
                                  value={onboardingExecutorText}
                                  onChange={(event) => setOnboardingExecutorText(event.target.value)}
                                  placeholder={"executor-1.tailnet:8787\nexecutor-2.tailnet:8787"}
                                  disabled={onboardingMultiHostMode !== "hub"}
                                  rows={2}
                                  className="resize-y rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-50"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => void saveOnboardingConnection()}
                                disabled={savingOnboardingConnection}
                                className="focus-ring mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-60"
                              >
                                <Icon name="ph:floppy-disk-bold" width={12} />
                                {savingOnboardingConnection ? "Saving…" : "Save connection"}
                              </button>
                            </div>
                            <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                              The coven daemon runs your familiars in the
                              background. Cave starts it for you. Run this local command:{" "}
                              <code className="font-mono">
                                coven daemon start
                              </code>
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant="primary"
                                leadingIcon="ph:rocket-launch-bold"
                                onClick={startDaemon}
                                disabled={
                                  startingDaemon || !status?.steps.covenCli.ok
                                }
                                title={
                                  !status?.steps.covenCli.ok
                                    ? "Install Coven CLI first (step 1)"
                                    : "Start local daemon (coven daemon start)"
                                }
                              >
                                {startingDaemon ? "Starting…" : "Start local daemon"}
                              </Button>
                              {!status?.steps.covenCli.ok ? (
                                <span className="text-[11px] text-[var(--text-muted)]">
                                  Needs step 1 first — the daemon ships with the
                                  Coven CLI.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : step.key === "git" ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                              Chat works without Git, but the changes panel,
                              project file tree, and checkpoints all use it.
                            </p>
                            <p className="text-[12px] leading-5 text-[var(--text-muted)]">
                              {status?.steps.git?.hint ??
                                status?.steps.git?.detail ??
                                "Install Git from https://git-scm.com, then re-check."}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                </li>
              );
            })}
          </ol>

          <details className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-secondary)]">
              Installing the CovenCave app itself ({platformCopy.label})
            </summary>
            <div className="mt-3">
              <InstructionList title="" items={platformCopy.caveInstall} />
            </div>
          </details>

          <MaintenancePanel prune={prune} setPrune={setPrune} />
        </main>

        <footer className="flex items-center justify-between border-t border-[var(--border-hairline)] py-4">
          <button
            onClick={() => {
              try {
                localStorage.setItem("cave:onboarding:dismissed", "1");
              } catch {
                /* private mode */
              }
              onDismiss();
            }}
            className="focus-ring rounded text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Skip for now
          </button>
          {setupComplete ? (
            <button
              onClick={finishOnboarding}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-success)_92%,#000)] px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm shadow-[color-mix(in_oklch,var(--color-success)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-success)_82%,#000)]"
            >
              <Icon name="ph:rocket-launch-bold" />
              {hasFamiliars ? "Open Cave" : "Open Cave — summon your familiar"}
            </button>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              Status refreshes automatically every 2 seconds.
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

// ── Step bodies ───────────────────────────────────────────────────────────────

/** The three-beat first-run journey: infrastructure (this wizard) → summon a
 *  familiar (the in-app circle) → first chat. Orientation only — beats light
 *  up as phases complete but are not interactive. The chat beat has no "done"
 *  signal here by design: the wizard closes before it can happen. */
function JourneyStrip({
  setupDone,
  familiarDone,
}: {
  setupDone: boolean;
  familiarDone: boolean;
}) {
  const beats: { label: string; icon: IconName; done: boolean }[] = [
    { label: "Set up Cave", icon: "ph:gear-six", done: setupDone },
    { label: "Summon a familiar", icon: "ph:sparkle-bold", done: familiarDone },
    { label: "First chat", icon: "ph:chat-circle-dots", done: false },
  ];
  const activeIndex = beats.findIndex((beat) => !beat.done);
  return (
    <ol
      aria-label="First-run journey"
      className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      {beats.map((beat, index) => {
        const isActive = index === activeIndex;
        return (
          <li key={beat.label} className="flex items-center gap-1.5">
            {index > 0 ? (
              <Icon
                name="ph:caret-right"
                width={11}
                className="text-[var(--text-muted)]"
                aria-hidden
              />
            ) : null}
            <span
              aria-current={isActive ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                beat.done
                  ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] text-[var(--color-success)]"
                  : isActive
                    ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] font-medium text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-muted)]"
              }`}
            >
              {beat.done ? (
                <Icon name="ph:check-bold" width={11} />
              ) : (
                <Icon name={beat.icon} width={11} />
              )}
              {beat.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Last N non-empty lines of installer output (\r-heavy progress bars are
 *  normalized to line breaks first). */
function lastLines(text: string, count: number): string {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join("\n");
}

function InstallLiveTail({ tail }: { tail: string }) {
  const visible = lastLines(tail, 3);
  if (!visible) return null;
  return (
    <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
      {visible}
    </pre>
  );
}

function anyNpmInstallRunning(
  jobs: Partial<Record<InstallTarget, InstallJobView>>,
): boolean {
  return NPM_INSTALL_TARGETS.some(
    (target) => jobs[target]?.status === "running",
  );
}

function HermesSetupNext({ onCopy }: { onCopy: (text: string) => Promise<boolean> }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-[var(--text-secondary)]">
        Next step — finish setup in a terminal:
      </p>
      <CommandRow command="hermes setup" onCopy={onCopy} />
    </div>
  );
}

function CommandRow({
  command,
  onCopy,
}: {
  command: string;
  onCopy: (text: string) => Promise<boolean>;
}) {
  // Same dead-click fix as the header: flash "Copied" so the action lands.
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
        {command}
      </code>
      <button
        onClick={async () => {
          if (await onCopy(command)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
        aria-live="polite"
        className={`focus-ring shrink-0 rounded border px-2 py-1 text-[11px] ${
          copied
            ? "border-[color-mix(in_oklch,var(--color-success)_50%,transparent)] text-[var(--color-success)]"
            : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        }`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function NodeSetupNotice({
  hint,
  nodeSetup,
}: {
  hint: string;
  nodeSetup: string[];
}) {
  return (
    <div className="rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-3">
      <div className="text-[12px] font-semibold text-[var(--color-warning)]">
        Node.js is needed first
      </div>
      <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
        {hint}
      </p>
      <ol className="mt-2 space-y-1">
        {nodeSetup.map((item, index) => (
          <li
            key={item}
            className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]"
          >
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {index + 1}.
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function InstallResultNote({ result }: { result?: InstallResult }) {
  if (!result) return null;
  return (
    <p
      className={`text-[11px] leading-4 ${
        result.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
      }`}
    >
      {result.detail}
    </p>
  );
}

function openCovenToolVersionText(tool: OpenCovenToolStatus): string {
  if (!tool.installed) return "Not installed";
  if (!tool.current) return "Installed, version unknown";
  return tool.outdated && tool.latest ? `${tool.current} -> ${tool.latest}` : tool.current;
}

function openCovenToolStatusText(tool: OpenCovenToolStatus): string {
  return toolStatusText(tool);
}

function StepCovenCli({
  platformCopy,
  installJobs,
  installResults,
  tools,
  nodeHint,
  npmBusy,
  npmBusyLabel,
  onInstall,
  onCopy,
}: {
  platformCopy: (typeof PLATFORM_COPY)[PlatformId];
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  tools: OpenCovenToolStatus[];
  nodeHint: string | null;
  npmBusy: boolean;
  npmBusyLabel: string;
  onInstall: (target: "coven-cli" | "coven-code") => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const job = installJobs["coven-cli"];
  const busy = job?.status === "running";
  const actionTargets = openCovenToolActionTargets(tools);
  const manualInstallCommand = openCovenToolsInstallCommand(tools);
  const primaryActionLabel = openCovenToolsPrimaryActionLabel(tools);
  const ownInstallBusy = busy;
  const installBusy = ownInstallBusy || npmBusy;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        Cave needs one tool — the <strong>Coven CLI</strong> powers everything.
        Use the main action to install or update it — Cave runs npm installs
        one after another so they never collide — or copy the matching command
        to run it yourself.
      </p>
      {npmBusy && !ownInstallBusy ? (
        <p role="status" className="text-[11px] text-[var(--text-muted)]">
          {npmBusyLabel} is updating the shared global npm directory. Other npm updates are disabled until it finishes.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          loading={installBusy}
          leadingIcon="ph:arrow-down-bold"
          onClick={() => {
            for (const target of actionTargets) onInstall(target);
          }}
          disabled={installBusy || actionTargets.length === 0}
        >
          {ownInstallBusy
            ? "Installing…"
            : npmBusy
              ? `Waiting for ${npmBusyLabel}`
              : primaryActionLabel}
        </Button>
        {actionTargets.length > 0 ? (
          <span className="text-[11px] text-[var(--text-muted)]">
            or run it yourself:
          </span>
        ) : null}
      </div>
      {actionTargets.length > 0 ? (
        <CommandRow command={manualInstallCommand} onCopy={onCopy} />
      ) : null}
      {busy && job ? <InstallLiveTail tail={job.tail} /> : null}
      <InstallResultNote result={installResults["coven-cli"]} />
      {tools.length > 0 ? (
        <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Coven CLI
          </div>
          <div className="grid gap-2">
            {tools.map((tool) => {
              const toolJob = installJobs[tool.id];
              const toolBusy = toolJob?.status === "running";
              const toolBlockedByNpm = npmBusy && !toolBusy;
              const needsAction = !tool.installed || tool.outdated || !tool.compatible;
              const currentVerified =
                tool.installed &&
                hasVerifiedLatestVersion(tool) &&
                !tool.outdated &&
                tool.compatible;
              const result = installResults[tool.id];
              return (
                <div
                  key={tool.id}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/45 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {tool.label}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {openCovenToolVersionText(tool)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                        {latestCheckText(tool)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                          currentVerified
                            ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] text-[var(--color-success)]"
                            : "border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] text-[var(--color-warning)]"
                        }`}
                      >
                        {currentVerified ? (
                          <Icon name="ph:check-bold" />
                        ) : (
                          <Icon name="ph:warning-fill" />
                        )}
                        {openCovenToolStatusText(tool)}
                      </span>
                      {needsAction ? (
                        <button
                          type="button"
                          onClick={() => onInstall(tool.id)}
                          disabled={toolBusy || toolBlockedByNpm}
                          aria-busy={toolBusy || toolBlockedByNpm}
                          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                        >
                          {toolBusy ? (
                            <Icon name="ph:circle-notch-bold" className="animate-spin" />
                          ) : (
                            <Icon name="ph:arrow-down-bold" />
                          )}
                          {toolBusy && toolJob
                            ? `Installing… ${formatElapsed(toolJob.elapsedMs)}`
                            : toolBlockedByNpm
                              ? `Waiting for ${npmBusyLabel}`
                            : tool.outdated || !tool.compatible
                              ? "Update"
                              : "Install"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {toolBusy && toolJob ? <InstallLiveTail tail={toolJob.tail} /> : null}
                  <InstallResultNote result={result} />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {nodeHint ? (
        <NodeSetupNotice hint={nodeHint} nodeSetup={platformCopy.nodeSetup} />
      ) : null}
      <details>
        <summary className="cursor-pointer text-[12px] text-[var(--text-secondary)]">
          Still not found after installing?
        </summary>
        <div className="mt-2">
          <InstructionList title="" items={platformCopy.cliInstall} />
        </div>
      </details>
    </div>
  );
}

function StepRuntimes({
  chatHarnesses,
  platform,
  installJobs,
  installResults,
  nodeHint,
  npmBusy,
  npmBusyLabel,
  harnessesStuck,
  onInstall,
  onCopy,
  onRefresh,
  codexPortPreflight,
  codexPortPreflightBusy,
  onCodexPortPreflight,
}: {
  chatHarnesses: HarnessReport[];
  platform: PlatformId;
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  nodeHint: string | null;
  npmBusy: boolean;
  npmBusyLabel: string;
  harnessesStuck: boolean;
  onInstall: (target: InstallTarget) => void;
  onCopy: (text: string) => Promise<boolean>;
  onRefresh: () => void;
  codexPortPreflight: PortPreflightResult | null;
  codexPortPreflightBusy: boolean;
  onCodexPortPreflight: () => void;
}) {
  const npmJobRunning = npmBusy || anyNpmInstallRunning(installJobs);
  return (
    <div className="flex flex-col gap-3">
      {npmBusy ? (
        <p role="status" className="text-[11px] text-[var(--text-muted)]">
          {npmBusyLabel} is updating the shared global npm directory. Other npm updates are disabled until it finishes.
        </p>
      ) : null}
      {harnessesStuck ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-3 py-2.5 text-[12px] text-[var(--color-warning)]"
        >
          <span className="leading-5">
            Couldn&rsquo;t load the runtime list — the local server didn&rsquo;t
            answer after repeated tries.
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="focus-ring shrink-0 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--color-warning)] hover:bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)]"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
          A runtime is the agent CLI your familiar speaks through.
          You only need{" "}
          <span className="font-medium text-[var(--text-primary)]">one</span> —
          pick whichever you already use, or one-click install any of them
          below.
        </p>
        <button
          onClick={onRefresh}
          className="focus-ring shrink-0 rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        >
          Refresh
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {chatHarnesses.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border-hairline)] bg-[var(--bg-base)]/35 px-3 py-4 text-[11px] leading-5 text-[var(--text-secondary)] sm:col-span-2">
            <p className="font-medium text-[var(--text-primary)]">
              Couldn&rsquo;t load the runtime list.
            </p>
            <p className="mt-1">
              Cave couldn&rsquo;t reach the runtime probe. Click{" "}
              <span className="font-medium text-[var(--text-primary)]">
                Refresh
              </span>{" "}
              above, or restart Cave so its PATH applies — installed runtimes
              show up here once detected.
            </p>
          </div>
        ) : (
          chatHarnesses.map((adapter) => {
          const oneClick = HARNESS_ONE_CLICK[adapter.id];
          const result = oneClick ? installResults[oneClick.target] : undefined;
          const job = oneClick ? installJobs[oneClick.target] : undefined;
          const busy = job?.status === "running";
          const openClaw = adapter.id === "openclaw";
          return (
            <div
              key={adapter.id}
              className={`rounded-lg border p-3 ${
                openClaw && adapter.installed
                  ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]"
                  : openClaw
                    ? "border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)]"
                    : adapter.installed
                  ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_8%,transparent)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-base)]/45"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {adapter.label}
                  </span>
                  {openClaw ? (
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      Bridge existing OpenClaw agents into Cave.
                    </div>
                  ) : null}
                </div>
                {openClaw ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {adapter.installed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">
                        <Icon name="ph:check-bold" /> installed
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-presence)]">
                      <Icon name="ph:git-fork" /> bridge
                    </span>
                  </div>
                ) : adapter.installed ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">
                    <Icon name="ph:check-bold" /> installed
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {adapter.installed
                  ? (adapter.path ?? adapter.binary)
                  : adapter.binary}
              </div>
              {openClaw ? (
                <div className="mt-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                  Agents are discovered from{" "}
                  <code className="font-mono text-[var(--text-primary)]">
                    {OPENCLAW_AGENT_ROOT}
                  </code>
                  . Their workspaces stay under{" "}
                  <code className="font-mono text-[var(--text-primary)]">
                    {OPENCLAW_WORKSPACE_ROOT}
                  </code>
                  .
                </div>
              ) : null}
              {/* A successful in-session install flips installed=true on the harness
                  refresh, unmounting the not-installed branch's hint — keep it visible. */}
              {adapter.installed && adapter.id === "hermes" && result?.ok ? (
                <div className="mt-2">
                  <HermesSetupNext onCopy={onCopy} />
                </div>
              ) : null}
              {!adapter.installed ? (
                <div className="mt-2 flex flex-col gap-2">
                  {oneClick ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        leadingIcon="ph:arrow-down-bold"
                        onClick={() => onInstall(oneClick.target)}
                        disabled={busy || (NPM_INSTALL_TARGETS.includes(oneClick.target) && npmJobRunning)}
                        className="w-fit"
                      >
                        {busy && job
                          ? `Installing… ${formatElapsed(job.elapsedMs)}`
                          : `Install ${adapter.label}`}
                      </Button>
                      <CommandRow
                        command={
                          platform === "windows" && oneClick.windowsCommand
                            ? oneClick.windowsCommand
                            : oneClick.command
                        }
                        onCopy={onCopy}
                      />
                      {busy && job ? <InstallLiveTail tail={job.tail} /> : null}
                      <p className="text-[11px] leading-4 text-[var(--text-muted)]">
                        After install: {oneClick.afterInstall}.
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] leading-4 text-[var(--text-muted)]">
                      {adapter.installHint}
                    </p>
                  )}
                  <InstallResultNote result={result} />
                  {adapter.id === "hermes" && result?.ok ? (
                    <HermesSetupNext onCopy={onCopy} />
                  ) : null}
                  {result && !result.ok && job?.status === "done" && job.tail ? (
                    <details>
                      <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
                        Show full output
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
                        {job.tail}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {/*
                Codex-only escape hatch for the "port 1455 in use" failure.
                Codex's `codex login` opens a local OAuth callback server on
                port 1455; if a previous attempt was killed mid-flow the
                listener leaks and the next attempt crashes with EADDRINUSE.
                This button preflights the port (kills only confirmed-codex
                holders) so the user can retry. Shown whether codex is
                installed or not — the leaked-listener case lives ON TOP of
                a working install.
              */}
              {adapter.id === "codex" ? (
                <div className="mt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => onCodexPortPreflight()}
                    disabled={codexPortPreflightBusy}
                    aria-busy={codexPortPreflightBusy}
                    title="Frees Codex's OAuth callback port (1455) if a stuck process is holding it. Only kills processes clearly identified as codex."
                    className="focus-ring inline-flex w-fit items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
                  >
                    {codexPortPreflightBusy ? (
                      <Icon name="ph:circle-notch-bold" className="animate-spin" />
                    ) : (
                      <Icon name="ph:plug-bold" />
                    )}
                    {codexPortPreflightBusy
                      ? "Checking port 1455…"
                      : "Fix “port 1455 in use” error"}
                  </button>
                  {codexPortPreflight ? (
                    <p
                      className={`text-[11px] leading-4 ${
                        codexPortPreflight.ok
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-danger)]"
                      }`}
                    >
                      {codexPortPreflight.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
          })
        )}
      </div>
      {nodeHint ? (
        <p className="text-[11px] leading-4 text-[var(--color-warning)]">
          npm-based one-click installs need Node.js — see step 1 for the setup notice. (Hermes brings its own toolchain.)
        </p>
      ) : null}
    </div>
  );
}

function InstructionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      {title ? (
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
      ) : null}
      <ol className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li
            key={item}
            className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]"
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--border-hairline)] text-[10px] text-[var(--text-muted)]">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MaintenancePanel({
  prune,
  setPrune,
  className = "",
}: {
  prune: PruneState;
  setPrune: (next: PruneState) => void;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4 ${className}`}
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
        Maintenance
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--text-secondary)]">
          {"idle" in prune ? (
            "Prune stale sessions: completed, failed, or killed sessions older than 24 hours."
          ) : "counting" in prune ? (
            "Counting stale sessions…"
          ) : "count" in prune ? (
            `Found ${prune.count} stale session${prune.count === 1 ? "" : "s"}. Confirm to delete.`
          ) : "pruning" in prune ? (
            "Pruning…"
          ) : "pruned" in prune ? (
            `Done. ${prune.pruned} session${prune.pruned === 1 ? "" : "s"} removed.`
          ) : "error" in prune ? (
            <span className="text-[var(--color-danger)]">{prune.error}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {"idle" in prune || "pruned" in prune || "error" in prune ? (
            <button
              onClick={async () => {
                setPrune({ counting: true });
                try {
                  const res = await fetch("/api/sessions/prune", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ dryRun: true }),
                  });
                  const json = (await res.json()) as {
                    ok: boolean;
                    wouldPrune?: number;
                    error?: string;
                  };
                  setPrune(
                    json.ok
                      ? { count: json.wouldPrune ?? 0 }
                      : { error: json.error ?? "dry-run failed" },
                  );
                } catch (err) {
                  setPrune({
                    error: err instanceof Error ? err.message : "fetch failed",
                  });
                }
              }}
              className="focus-ring rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              Check
            </button>
          ) : null}
          {"count" in prune ? (
            <>
              <button
                onClick={() => setPrune({ idle: true })}
                className="focus-ring rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              >
                Cancel
              </button>
              {prune.count > 0 ? (
                <button
                  onClick={async () => {
                    setPrune({ pruning: true });
                    try {
                      const res = await fetch("/api/sessions/prune", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ dryRun: false }),
                      });
                      const json = (await res.json()) as {
                        ok: boolean;
                        pruned?: number;
                        error?: string;
                      };
                      setPrune(
                        json.ok
                          ? { pruned: json.pruned ?? 0 }
                          : { error: json.error ?? "prune failed" },
                      );
                    } catch (err) {
                      setPrune({
                        error:
                          err instanceof Error ? err.message : "fetch failed",
                      });
                    }
                  }}
                  className="focus-ring rounded bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] px-2.5 py-1 text-[11px] text-white hover:bg-[color-mix(in_oklch,var(--color-danger)_85%,#000)]"
                >
                  Delete {prune.count}
                </button>
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">
                  Nothing to prune.
                </span>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
