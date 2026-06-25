"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import type { IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { SalemPathfinderEntry } from "@/components/salem/salem-pathfinder-entry";
import type { SalemPathfinderRequest } from "@/lib/salem/pathfinder-types";
import { defaultModelForRuntime } from "@/lib/runtime-models";
import { setDemoModeEnabled } from "@/lib/demo-mode";

// Guided onboarding: one numbered path from "nothing installed" to "chatting
// with a familiar". Every step carries its own instructions, a one-click
// action where Cave can do the work itself, the exact manual command for
// users who prefer a terminal, and a troubleshooting block — so nobody is
// ever stuck staring at a red card with no next move.

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
  outdated: boolean;
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

type OpenClawAgent = {
  id: string;
  displayName: string;
  role: string;
  workspacePath: string | null;
};

type CaveFamiliar = {
  id: string;
  display_name?: string;
  role?: string;
};

type InstallTarget =
  | "coven-cli"
  | "coven-code"
  | "codex"
  | "claude"
  | "openclaw"
  | "hermes";

type InstallResult = {
  ok: boolean;
  detail: string;
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
  openclaw: "npm",
  hermes: "script",
};
const ALL_INSTALL_TARGETS = Object.keys(INSTALL_TARGET_KIND) as InstallTarget[];
const NPM_INSTALL_TARGETS = ALL_INSTALL_TARGETS.filter(
  (target) => INSTALL_TARGET_KIND[target] === "npm",
);

/** Persists the user's choice to skip the (required) Coven Code install so a
 *  failing install can't permanently strand onboarding. */
const COVEN_CODE_SKIP_KEY = "cave:onboarding:skip-coven-code";

type SshCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; detail: string }
  | { state: "fail"; detail: string };

const COVEN_CLI_INSTALL_COMMAND = "npm i -g @opencoven/cli@latest";
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
  openclaw: {
    target: "openclaw",
    command: "npm i -g openclaw@latest",
    afterInstall:
      `then connect an agent from ${OPENCLAW_AGENT_ROOT} in the familiar step`,
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
    installCommand: string;
    nodeSetup: string[];
    caveInstall: string[];
    cliInstall: string[];
    sshSetup: string[];
    warning?: string;
  }
> = {
  windows: {
    label: "Windows",
    installCommand: COVEN_CLI_INSTALL_COMMAND,
    warning:
      "For now, turn off Smart App Control before downloading or opening the Windows build.",
    nodeSetup: [
      "Install Node.js LTS from https://nodejs.org, or run winget install OpenJS.NodeJS.LTS.",
      "Restart Cave afterwards so the new PATH applies.",
      "Click the Install button again — Cave re-finds npm automatically.",
    ],
    caveInstall: [
      "Download the MSI from the official GitHub Release.",
      "Before downloading/opening, go to Settings > Privacy & security > Windows Security > App & browser control > Smart App Control, then turn Smart App Control off for now.",
      "Install CovenCave, then open it from Start.",
    ],
    cliInstall: [
      "Install the coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven.exe is on PATH after the global npm install.",
      "Click Re-check after Windows can run coven from a new terminal.",
    ],
    sshSetup: [
      "Enable the OpenSSH client: Settings > Apps > Optional features > OpenSSH Client.",
      'Create a key with ssh-keygen, then copy it to the remote with: type $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh <host> "cat >> ~/.ssh/authorized_keys".',
      "Run ssh <host> once in a terminal to accept the host key before testing here.",
    ],
  },
  linux: {
    label: "Linux",
    installCommand: COVEN_CLI_INSTALL_COMMAND,
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
      "Install the coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven is on PATH after the global npm install.",
      "If your desktop shell has an older PATH, restart Cave after installing the CLI.",
    ],
    sshSetup: [
      "Create a key with ssh-keygen -t ed25519 if you don't have one.",
      "Copy it to the remote with ssh-copy-id <host>.",
      "Run ssh <host> once to accept the host key before testing here.",
    ],
  },
  mac: {
    label: "macOS",
    installCommand: COVEN_CLI_INSTALL_COMMAND,
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
      "Install the coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure a terminal can run coven after the global npm install.",
      "Click Re-check here after install.",
    ],
    sshSetup: [
      "Create a key with ssh-keygen -t ed25519 if you don't have one.",
      "Copy it to the remote with ssh-copy-id <host>.",
      "Run ssh <host> once to accept the host key before testing here.",
    ],
  },
  unknown: {
    label: "Your platform",
    installCommand: COVEN_CLI_INSTALL_COMMAND,
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
      "Install the coven CLI with npm: npm i -g @opencoven/cli@latest.",
      "Make sure coven is on PATH.",
      "Click Re-check here after install.",
    ],
    sshSetup: [
      "Create an SSH key and copy it to the remote host (ssh-copy-id <host>).",
      "Run ssh <host> once to accept the host key before testing here.",
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

export function OnboardingOverlay({ open, onDismiss }: Props) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [platform, setPlatform] = useState<PlatformId>("unknown");
  const [picking, setPicking] = useState<string | null>(null);
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [familiarName, setFamiliarName] = useState("");
  const [familiarRole, setFamiliarRole] = useState("Familiar");
  const [familiarDescription, setFamiliarDescription] = useState("");
  const [familiarGlyph, setFamiliarGlyph] = useState("ph:sparkle-fill");
  const [openclawAgents, setOpenclawAgents] = useState<OpenClawAgent[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(
    null,
  );
  const [confirmCreateNewFamiliar, setConfirmCreateNewFamiliar] =
    useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
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
  // npm installs are mutually exclusive server-side (the route 409s a second
  // concurrent one), so a user who clicks "install both" otherwise gets a
  // failure on the second. Queue npm targets here and drain them one at a time.
  const [installQueue, setInstallQueue] = useState<InstallTarget[]>([]);
  // "Required + skippable": Coven Code is required to finish setup, but a
  // user can skip it so a failing install never permanently strands onboarding.
  const [covenCodeSkipped, setCovenCodeSkipped] = useState(false);
  const [nodeHint, setNodeHint] = useState<string | null>(null);
  // Remote (SSH) runtime for the new familiar (/api/onboarding/ssh-check)
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshCwd, setSshCwd] = useState("");
  const [sshCommand, setSshCommand] = useState("");
  const [sshCheck, setSshCheck] = useState<SshCheckState>({ state: "idle" });
  // Created familiars (final step lists them with Edit affordances)
  const [familiarsList, setFamiliarsList] = useState<CaveFamiliar[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { openFamiliarStudio } = useFamiliarStudio();

  useFocusTrap(open, dialogRef, { onEscape: onDismiss });

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
      // Track consecutive failures so the UI can move past "checking..." once
      // we're sure the poll isn't just slow. One blip stays silent.
      setStatusFailures((n) => n + 1);
    }
  }, []);

  useEffect(() => setPlatform(detectPlatform()), []);

  const loadOpenClawAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const res = await fetch("/api/openclaw-agents", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        agents?: OpenClawAgent[];
        error?: string;
      };
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "failed to load OpenClaw agents");
      const agents = json.agents ?? [];
      setOpenclawAgents(agents);
      setSelectedAgentId((current) =>
        current && agents.some((agent) => agent.id === current)
          ? current
          : null,
      );
    } catch (err) {
      setAgentsError(
        err instanceof Error ? err.message : "failed to load OpenClaw agents",
      );
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const loadHarnesses = useCallback(async () => {
    try {
      const res = await fetch("/api/harnesses", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        harnesses?: HarnessReport[];
      };
      if (!res.ok || json.ok === false) return;
      const next = json.harnesses ?? [];
      setHarnesses(next);
      setSelectedHarnessId((current) => {
        if (
          current &&
          next.some(
            (adapter) =>
              adapter.id === current && adapter.installed && adapter.chatSupported,
          )
        )
          return current;
        return null;
      });
    } catch {
      /* harness availability is advisory; step cards carry setup hints */
    }
  }, []);

  const loadFamiliars = useCallback(async () => {
    try {
      const res = await fetch("/api/familiars", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        familiars?: CaveFamiliar[];
      };
      if (!res.ok || json.ok === false) return;
      setFamiliarsList(json.familiars ?? []);
    } catch {
      /* advisory — the daemon step covers reachability */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    void loadHarnesses();
    void loadOpenClawAgents();
    void loadFamiliars();
    pollRef.current = setInterval(refresh, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh, loadHarnesses, loadOpenClawAgents, loadFamiliars]);

  // The harness probe races first paint: it loads once at open, so a slow or
  // failed first fetch left the runtime step's grid empty until a manual
  // Refresh. Retry on the status cadence while the list is empty — a
  // successful response always carries the bundled adapters, so the loop
  // stops after the first real load and never spins on a healthy state.
  useEffect(() => {
    if (!open || harnesses.length > 0) return;
    const retry = setInterval(() => void loadHarnesses(), 2000);
    return () => clearInterval(retry);
  }, [open, harnesses.length, loadHarnesses]);

  // Refresh the familiar list when the familiars step flips healthy so the
  // final step can list them for editing.
  const familiarsOk = !!status?.steps.familiars.ok;
  useEffect(() => {
    if (familiarsOk) void loadFamiliars();
  }, [familiarsOk, loadFamiliars]);

  const platformCopy = PLATFORM_COPY[platform];
  const chatHarnesses = harnesses.filter((adapter) => adapter.chatSupported);
  const selectedHarness =
    chatHarnesses.find((adapter) => adapter.id === selectedHarnessId) ?? null;

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
          agentsError,
          installResults,
          nodeHint,
          sshCheck,
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
          openclawAgents: openclawAgents.map((agent) => ({
            id: agent.id,
            displayName: agent.displayName,
            workspacePath: agent.workspacePath,
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
      };
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
        if (res.status === 409 && INSTALL_TARGET_KIND[target] === "npm") {
          setInstallQueue((q) => (q.includes(target) ? q : [...q, target]));
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
      INSTALL_TARGET_KIND[target] === "npm" &&
      (anyNpmInstallRunning(installJobs) ||
        installInFlightRef.current ||
        installQueue.length > 0)
    ) {
      setInstallQueue((q) => (q.includes(target) ? q : [...q, target]));
      markQueued(target);
      return;
    }
    void postInstall(target);
  };

  // Drain the npm queue one at a time as the lane frees up.
  useEffect(() => {
    if (installQueue.length === 0) return;
    if (installInFlightRef.current) return;
    if (anyNpmInstallRunning(installJobs)) return;
    const next = installQueue[0];
    setInstallQueue((q) => q.slice(1));
    void postInstall(next);
  }, [installQueue, installJobs, postInstall]);

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

  const testSsh = async () => {
    const host = sshHost.trim();
    if (!host) {
      setSshCheck({ state: "fail", detail: "Enter a host first." });
      return;
    }
    setSshCheck({ state: "checking" });
    try {
      const res = await fetch("/api/onboarding/ssh-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reachable?: boolean;
        covenPath?: string | null;
        hint?: string;
        error?: string;
      };
      if (json.ok && json.reachable) {
        setSshCheck({
          state: "ok",
          detail: json.covenPath
            ? `Connected — coven found at ${json.covenPath}.`
            : `Connected. ${json.hint ?? ""}`.trim(),
        });
      } else {
        setSshCheck({
          state: "fail",
          detail:
            [json.error, json.hint].filter(Boolean).join(" — ") ||
            "SSH check failed.",
        });
      }
    } catch (err) {
      setSshCheck({
        state: "fail",
        detail: err instanceof Error ? err.message : "SSH check failed.",
      });
    }
  };

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

  const createFamiliar = async () => {
    if (!status?.steps.daemon.ok) {
      setSetupError("Start the daemon before creating or connecting a familiar.");
      return;
    }
    const selectedAgent =
      openclawAgents.find((agent) => agent.id === selectedAgentId) ?? null;
    if (!selectedAgent) {
      setSetupError(
        "Pick an existing OpenClaw agent first, or create a new familiar from an installed runtime instead.",
      );
      return;
    }
    setPicking("familiar");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: selectedAgent.id,
            displayName: familiarName,
            role: familiarRole,
            description: familiarDescription,
            glyph: familiarGlyph,
            openclawAgentId: selectedAgent.id,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
      await refresh();
      await loadFamiliars();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const createLocalFamiliar = async () => {
    if (!status?.steps.daemon.ok) {
      setSetupError("Start the daemon before creating or connecting a familiar.");
      return;
    }
    const selectedHarness =
      chatHarnesses.find(
        (adapter) => adapter.id === selectedHarnessId && adapter.installed,
      ) ?? null;
    if (!selectedHarness) {
      setSetupError(
        "Pick an installed harness first, or choose an existing OpenClaw agent.",
      );
      return;
    }
    if (!confirmCreateNewFamiliar) {
      setSetupError(
        "Confirm that you want to create a new Coven familiar before continuing.",
      );
      return;
    }
    if (sshEnabled && (!sshHost.trim() || !sshCwd.trim())) {
      setSetupError(
        "Remote runtime needs a host and a remote working directory — or untick \"Runs on a remote machine\".",
      );
      return;
    }
    setPicking("local");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: `${selectedHarness.id}-local`,
            displayName: familiarName.trim() || selectedHarness.label,
            role: familiarRole.trim() || "Code Familiar",
            description:
              familiarDescription.trim() ||
              (sshEnabled
                ? `Remote ${selectedHarness.label} adapter over SSH (${sshHost.trim()}).`
                : `Local ${selectedHarness.label} adapter on this machine.`),
            glyph: familiarGlyph,
            harness: selectedHarness.id,
            model: defaultModelForRuntime(selectedHarness.id),
            ...(sshEnabled
              ? {
                  runtime: {
                    kind: "ssh",
                    host: sshHost.trim(),
                    cwd: sshCwd.trim(),
                    command: sshCommand.trim(),
                  },
                }
              : {}),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
      await refresh();
      await loadFamiliars();
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

  const editFamiliar = (id: string) => {
    // The studio renders under this overlay, so close the overlay first.
    onDismiss();
    openFamiliarStudio(id);
  };

  const enableDemoMode = () => {
    setDemoModeEnabled(true);
    try {
      localStorage.setItem("cave:onboarding:dismissed", "1");
    } catch {
      /* private mode */
    }
    onDismiss();
  };

  // Restore a prior "skip Coven Code" choice so a failing install can't trap
  // the user on this step across reloads.
  useEffect(() => {
    try {
      if (localStorage.getItem(COVEN_CODE_SKIP_KEY) === "1") setCovenCodeSkipped(true);
    } catch {
      /* private mode */
    }
  }, []);

  const skipCovenCode = () => {
    setCovenCodeSkipped(true);
    try {
      localStorage.setItem(COVEN_CODE_SKIP_KEY, "1");
    } catch {
      /* private mode */
    }
  };

  // Coven Code is a required OpenCoven tool, but skippable so a failed install
  // can never permanently strand onboarding (see covenCodeSkipped).
  const covenCodeInstalled = !!status?.tools?.find((t) => t.id === "coven-code")?.installed;
  const covenCodeSatisfied = covenCodeInstalled || covenCodeSkipped;
  // Server `complete` already requires every other step; AND-in the Coven Code
  // requirement so the finish CTA only appears once both tools are handled.
  const effectiveComplete = (status?.complete ?? false) && covenCodeSatisfied;

  const steps = useMemo<GuidedStep[]>(() => {
    const s = status?.steps;
    return [
      {
        key: "covenCli",
        title: "Install the OpenCoven tools",
        // Require both coven CLI (server step) and Coven Code (required, but
        // skippable) before this step counts as done.
        ok: !!s?.covenCli.ok && covenCodeSatisfied,
        detail: !s?.covenCli.ok
          ? (s?.covenCli.detail ?? s?.covenCli.hint ?? "checking...")
          : covenCodeSatisfied
            ? (s?.covenCli.detail ?? "Installed")
            : "coven CLI ready — Coven Code still needs installing.",
        icon: "ph:gear-six",
      },
      {
        key: "covenHome",
        title: "Create your Coven home",
        ok: !!s?.covenHome.ok,
        detail: s?.covenHome.detail ?? s?.covenHome.hint ?? "checking...",
        icon: "ph:folder",
      },
      {
        key: "adapters",
        title: "Install a runtime",
        ok: !!s?.adapters.ok,
        detail: s?.adapters.detail ?? s?.adapters.hint ?? "checking...",
        icon: "ph:terminal-window",
      },
      {
        key: "daemon",
        title: "Start the daemon",
        ok: !!s?.daemon.ok,
        detail: s?.daemon.detail ?? s?.daemon.hint ?? "checking...",
        icon: "ph:plug",
      },
      {
        key: "binding",
        title: "Create your familiar",
        ok: !!s?.binding.ok,
        detail: s?.binding.detail ?? s?.binding.hint ?? "checking...",
        icon: "ph:sparkle",
      },
      {
        key: "familiars",
        title: "Meet your familiars",
        ok: !!s?.familiars.ok,
        detail: s?.familiars.detail ?? s?.familiars.hint ?? "checking...",
        icon: "ph:user",
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
  }, [status, covenCodeSatisfied]);

  // The step the guide spotlights: the first required step that isn't done.
  const activeStepKey = useMemo(() => {
    const firstIncomplete = steps.find((s) => !s.optional && !s.ok);
    return firstIncomplete?.key ?? null;
  }, [steps]);

  // Safe machine-state context for Setup Salem — platform + detected runtime
  // health only; never secrets, tokens, or logs (design §"Privacy").
  const salemMachineState = useMemo<SalemPathfinderRequest["machineState"]>(() => ({
    platform:
      platform === "mac" ? "macos" : platform === "windows" ? "windows" : platform === "linux" ? "linux" : "unknown",
    covenCli: status ? (status.steps.covenCli.ok ? "healthy" : "missing") : "unknown",
    daemon: status ? (status.steps.daemon.ok ? "running" : "stopped") : "unknown",
    familiarCount: status?.steps.familiars.ok ? 1 : 0,
  }), [platform, status]);

  const openStepKey = expandedStep ?? activeStepKey ?? "familiars";

  if (!open) return null;

  const requiredSteps = steps.filter((s) => !s.optional);
  const ready = requiredSteps.filter((s) => s.ok).length;
  const total = requiredSteps.length;

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
                <p className="mt-1 leading-6">{platformCopy.warning}</p>
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
                Cave couldn&rsquo;t reach <code className="font-mono">/api/onboarding/status</code> in {statusFailures} attempts. The coven CLI may not be installed, or the local sidecar may be blocked. Steps will stay on &ldquo;checking…&rdquo; until this clears — step 1 below still works and is the usual fix.
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
          <section className="mt-5 rounded-lg border border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] p-4 text-[13px] text-[var(--color-danger)]">
            {setupError}
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
                <li key={step.key}>
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
                            tools={status?.tools ?? []}
                            nodeHint={nodeHint}
                            covenCodeInstalled={covenCodeInstalled}
                            covenCodeSkipped={covenCodeSkipped}
                            onSkipCovenCode={skipCovenCode}
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
                            <button
                              onClick={scaffoldOnly}
                              disabled={picking !== null}
                              className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
                            >
                              <Icon name="ph:folder-open-bold" />
                              {picking === "scaffold"
                                ? "Creating..."
                                : "Create Coven home"}
                            </button>
                          </div>
                        ) : step.key === "adapters" ? (
                          <StepRuntimes
                            chatHarnesses={chatHarnesses}
                            platform={platform}
                            installJobs={installJobs}
                            installResults={installResults}
                            nodeHint={nodeHint}
                            onInstall={(target) => void runInstall(target)}
                            onCopy={copyText}
                            onRefresh={() => void loadHarnesses()}
                          />
                        ) : step.key === "binding" ? (
                          <StepFamiliar
                            chatHarnesses={chatHarnesses}
                            daemonReady={!!status?.steps.daemon.ok}
                            selectedHarnessId={selectedHarnessId}
                            selectedHarness={selectedHarness}
                            openclawAgents={openclawAgents}
                            selectedAgentId={selectedAgentId}
                            agentsLoading={agentsLoading}
                            agentsError={agentsError}
                            familiarName={familiarName}
                            familiarRole={familiarRole}
                            familiarGlyph={familiarGlyph}
                            familiarDescription={familiarDescription}
                            confirmCreateNewFamiliar={confirmCreateNewFamiliar}
                            picking={picking}
                            sshEnabled={sshEnabled}
                            sshHost={sshHost}
                            sshCwd={sshCwd}
                            sshCommand={sshCommand}
                            sshCheck={sshCheck}
                            sshSetup={platformCopy.sshSetup}
                            setFamiliarName={setFamiliarName}
                            setFamiliarRole={setFamiliarRole}
                            setFamiliarGlyph={setFamiliarGlyph}
                            setFamiliarDescription={setFamiliarDescription}
                            setConfirmCreateNewFamiliar={
                              setConfirmCreateNewFamiliar
                            }
                            setSshEnabled={setSshEnabled}
                            setSshHost={(v) => {
                              setSshHost(v);
                              setSshCheck({ state: "idle" });
                            }}
                            setSshCwd={setSshCwd}
                            setSshCommand={setSshCommand}
                            onTestSsh={() => void testSsh()}
                            onSelectHarness={(adapter) => {
                              if (!adapter.installed) return;
                              setSelectedHarnessId(adapter.id);
                              setSelectedAgentId(null);
                              setConfirmCreateNewFamiliar(false);
                              setFamiliarName(adapter.label);
                              setFamiliarRole("Code Familiar");
                              setFamiliarDescription(
                                sshEnabled && sshHost.trim()
                                  ? `Remote ${adapter.label} adapter over SSH (${sshHost.trim()}).`
                                  : `Local ${adapter.label} adapter on this machine.`,
                              );
                            }}
                            onSelectAgent={(agent) => {
                              setSelectedAgentId(agent.id);
                              setSelectedHarnessId(null);
                              setConfirmCreateNewFamiliar(false);
                              setFamiliarName(agent.displayName);
                              setFamiliarRole(agent.role);
                              setFamiliarDescription(
                                `Connected to OpenClaw agent "${agent.id}".`,
                              );
                            }}
                            onRefreshAgents={() => void loadOpenClawAgents()}
                            onCreateLocal={() => void createLocalFamiliar()}
                            onConnectAgent={() => void createFamiliar()}
                          />
                        ) : step.key === "daemon" ? (
                          <div className="flex flex-col gap-3">
                            <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                              The coven daemon runs your familiars in the
                              background. Cave starts it for you — or run{" "}
                              <code className="font-mono">
                                coven daemon start
                              </code>{" "}
                              in any terminal.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={startDaemon}
                                disabled={
                                  startingDaemon || !status?.steps.covenCli.ok
                                }
                                className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
                                title={
                                  !status?.steps.covenCli.ok
                                    ? "Install coven CLI first (step 1)"
                                    : "coven daemon start"
                                }
                              >
                                <Icon name="ph:rocket-launch-bold" />
                                {startingDaemon ? "Starting..." : "Start daemon"}
                              </button>
                              {!status?.steps.covenCli.ok ? (
                                <span className="text-[11px] text-[var(--text-muted)]">
                                  Needs step 1 first — the daemon ships with the
                                  coven CLI.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : step.key === "familiars" ? (
                          <StepMeetFamiliars
                            familiars={familiarsList}
                            statusOk={step.ok}
                            complete={effectiveComplete}
                            onEdit={editFamiliar}
                            onOpenCave={onDismiss}
                          />
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

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Tester demo mode
                  </h2>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                    Explore Cave with sample data — no installs needed. Demo
                    data is opt-in for testers and never appears in normal
                    installs.
                  </p>
                </div>
                <Icon
                  name="ph:toggle-right-bold"
                  className="text-[var(--text-muted)]"
                />
              </div>
              <button
                type="button"
                onClick={enableDemoMode}
                className="focus-ring mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent-presence)] px-3 py-2 text-[12px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)]"
              >
                <Icon name="ph:sparkle" />
                Open demo Cave
              </button>
            </section>

            <MaintenancePanel prune={prune} setPrune={setPrune} />
          </div>
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
          {effectiveComplete ? (
            <button
              onClick={onDismiss}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-success)_92%,#000)] px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm shadow-[color-mix(in_oklch,var(--color-success)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-success)_82%,#000)]"
            >
              <Icon name="ph:rocket-launch-bold" />
              Open Cave
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
  if (!tool.installed) return "Not found";
  if (!tool.current) return "Version unknown";
  if (tool.outdated) return "Update available";
  return "Up to date";
}

function StepCovenCli({
  platformCopy,
  installJobs,
  installResults,
  tools,
  nodeHint,
  covenCodeInstalled,
  covenCodeSkipped,
  onSkipCovenCode,
  onInstall,
  onCopy,
}: {
  platformCopy: (typeof PLATFORM_COPY)[PlatformId];
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  tools: OpenCovenToolStatus[];
  nodeHint: string | null;
  covenCodeInstalled: boolean;
  covenCodeSkipped: boolean;
  onSkipCovenCode: () => void;
  onInstall: (target: "coven-cli" | "coven-code") => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const job = installJobs["coven-cli"];
  const busy = job?.status === "running";
  // Per-target busy — track coven-code's running state separately so the
  // "Install both" button reflects either job. npm installs are queued
  // client-side now, so per-target busy is enough to coordinate them.
  const covenCodeJob = installJobs["coven-code"];
  const covenCodeJobRunning = covenCodeJob?.status === "running";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        Cave needs two OpenCoven tools — the <strong>coven CLI</strong> (powers
        everything) and <strong>Coven Code</strong> (required). Install both with
        one click — Cave runs them one after another so they never collide — or
        copy the command to run it yourself.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            onInstall("coven-cli");
            onInstall("coven-code");
          }}
          disabled={busy || covenCodeJobRunning}
          aria-busy={busy || covenCodeJobRunning}
          className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
        >
          {busy || covenCodeJobRunning ? (
            <Icon name="ph:circle-notch-bold" className="animate-spin" />
          ) : (
            <Icon name="ph:arrow-down-bold" />
          )}
          {busy || covenCodeJobRunning ? "Installing…" : "Install both tools"}
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">
          or run it yourself:
        </span>
      </div>
      <CommandRow command={platformCopy.installCommand} onCopy={onCopy} />
      {busy && job ? <InstallLiveTail tail={job.tail} /> : null}
      <InstallResultNote result={installResults["coven-cli"]} />
      {tools.length > 0 ? (
        <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            OpenCoven tools
          </div>
          <div className="grid gap-2">
            {tools.map((tool) => {
              const toolJob = installJobs[tool.id];
              const toolBusy = toolJob?.status === "running";
              const needsAction = !tool.installed || tool.outdated;
              const result = installResults[tool.id];
              const isCovenCode = tool.id === "coven-code";
              const showSkip = isCovenCode && !tool.installed && !covenCodeSkipped;
              return (
                <div
                  key={tool.id}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/45 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {tool.label}
                        {isCovenCode ? (
                          <span className="rounded-full border border-[var(--border-hairline)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                            {covenCodeInstalled ? "Required" : covenCodeSkipped ? "Skipped" : "Required"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {openCovenToolVersionText(tool)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                          tool.installed && !tool.outdated
                            ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] text-[var(--color-success)]"
                            : "border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] text-[var(--color-warning)]"
                        }`}
                      >
                        {tool.installed && !tool.outdated ? (
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
                          disabled={toolBusy}
                          aria-busy={toolBusy}
                          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                        >
                          {toolBusy ? (
                            <Icon name="ph:circle-notch-bold" className="animate-spin" />
                          ) : (
                            <Icon name="ph:arrow-down-bold" />
                          )}
                          {toolBusy && toolJob
                            ? `Installing… ${formatElapsed(toolJob.elapsedMs)}`
                            : tool.outdated
                              ? "Update"
                              : "Install"}
                        </button>
                      ) : null}
                      {showSkip ? (
                        <button
                          type="button"
                          onClick={onSkipCovenCode}
                          className="focus-ring rounded-md px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:underline"
                          title="Continue setup without Coven Code — you can install it later from Settings."
                        >
                          Skip for now
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
  onInstall,
  onCopy,
  onRefresh,
}: {
  chatHarnesses: HarnessReport[];
  platform: PlatformId;
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  nodeHint: string | null;
  onInstall: (target: InstallTarget) => void;
  onCopy: (text: string) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const npmJobRunning = anyNpmInstallRunning(installJobs);
  return (
    <div className="flex flex-col gap-3">
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
        {chatHarnesses.map((adapter) => {
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
                      <button
                        onClick={() => onInstall(oneClick.target)}
                        disabled={busy || (NPM_INSTALL_TARGETS.includes(oneClick.target) && npmJobRunning)}
                        aria-busy={busy}
                        className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
                      >
                        {busy ? (
                          <Icon name="ph:circle-notch-bold" className="animate-spin" />
                        ) : (
                          <Icon name="ph:arrow-down-bold" />
                        )}
                        {busy && job
                          ? `Installing… ${formatElapsed(job.elapsedMs)}`
                          : `Install ${adapter.label}`}
                      </button>
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
            </div>
          );
        })}
      </div>
      {nodeHint ? (
        <p className="text-[11px] leading-4 text-[var(--color-warning)]">
          npm-based one-click installs need Node.js — see step 1 for the setup notice. (Hermes brings its own toolchain.)
        </p>
      ) : null}
    </div>
  );
}

function StepFamiliar(props: {
  chatHarnesses: HarnessReport[];
  daemonReady: boolean;
  selectedHarnessId: string | null;
  selectedHarness: HarnessReport | null;
  openclawAgents: OpenClawAgent[];
  selectedAgentId: string | null;
  agentsLoading: boolean;
  agentsError: string | null;
  familiarName: string;
  familiarRole: string;
  familiarGlyph: string;
  familiarDescription: string;
  confirmCreateNewFamiliar: boolean;
  picking: string | null;
  sshEnabled: boolean;
  sshHost: string;
  sshCwd: string;
  sshCommand: string;
  sshCheck: SshCheckState;
  sshSetup: string[];
  setFamiliarName: (v: string) => void;
  setFamiliarRole: (v: string) => void;
  setFamiliarGlyph: (v: string) => void;
  setFamiliarDescription: (v: string) => void;
  setConfirmCreateNewFamiliar: (v: boolean) => void;
  setSshEnabled: (v: boolean) => void;
  setSshHost: (v: string) => void;
  setSshCwd: (v: string) => void;
  setSshCommand: (v: string) => void;
  onTestSsh: () => void;
  onSelectHarness: (adapter: HarnessReport) => void;
  onSelectAgent: (agent: OpenClawAgent) => void;
  onRefreshAgents: () => void;
  onCreateLocal: () => void;
  onConnectAgent: () => void;
}) {
  const {
    chatHarnesses,
    daemonReady,
    selectedHarnessId,
    selectedHarness,
    openclawAgents,
    selectedAgentId,
    agentsLoading,
    agentsError,
    familiarName,
    familiarRole,
    familiarGlyph,
    familiarDescription,
    confirmCreateNewFamiliar,
    picking,
    sshEnabled,
    sshHost,
    sshCwd,
    sshCommand,
    sshCheck,
    sshSetup,
  } = props;
  const [agentQuery, setAgentQuery] = useState("");
  const glyphInvalid =
    familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:");
  const selectedOpenClawAgent =
    selectedAgentId != null
      ? openclawAgents.find((agent) => agent.id === selectedAgentId) ?? null
      : null;
  const openClawAgentCountLabel = agentsLoading
    ? "Scanning"
    : `${openclawAgents.length} ${openclawAgents.length === 1 ? "agent" : "agents"}`;
  // Exactly one path is ever selected — picking a harness clears the agent and
  // vice versa upstream. Drives progressive disclosure of the config form below.
  const optionChosen = selectedHarnessId != null || selectedAgentId != null;
  // Option B can list many discovered agents; surface a filter once the list is
  // long enough to be awkward to scan by eye.
  const showAgentSearch = openclawAgents.length > 6;
  const trimmedAgentQuery = agentQuery.trim().toLowerCase();
  const visibleAgents = trimmedAgentQuery
    ? openclawAgents.filter((agent) =>
        [
          agent.displayName,
          agent.id,
          agent.role ?? "",
          agent.workspacePath ?? "",
        ].some((field) => field.toLowerCase().includes(trimmedAgentQuery)),
      )
    : openclawAgents;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        A familiar is your named agent — pick what powers it, name it, and
        everything stays editable later in the Familiar Studio (Agents &rarr;
        pick a familiar &rarr; Edit).
      </p>
      {!daemonReady ? (
        <div className="rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
          Start the daemon first. Familiar creation unlocks once Cave can reach it.
        </div>
      ) : null}

      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        Choose one setup path
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
            Option A — start fresh from an installed runtime
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">
            Spin up a brand-new Coven familiar powered by a runtime installed on
            this machine.
          </p>
          <div className="mt-2 grid gap-2">
            {chatHarnesses.map((adapter) => {
              const active = selectedHarnessId === adapter.id;
              return (
                <button
                  key={adapter.id}
                  onClick={() => props.onSelectHarness(adapter)}
                  disabled={!adapter.installed}
                  className={`focus-ring rounded-lg border p-2.5 text-left ${
                    active
                      ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] text-[var(--text-primary)]"
                      : adapter.installed
                        ? "border-[var(--border-hairline)] bg-[var(--bg-base)]/45 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-base)]/35 text-[var(--text-muted)] opacity-70"
                  }`}
                  title={
                    adapter.installed
                      ? undefined
                      : `Not installed yet — see step 3. ${adapter.installHint}`
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium">
                      {adapter.label}
                    </span>
                    {active ? (
                      <Icon
                        name="ph:check-bold"
                        className="text-[var(--accent-presence)]"
                      />
                    ) : !adapter.installed ? (
                      <span className="text-[10px]">not installed</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
                  Option B — connect an existing OpenClaw agent
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-presence)]">
                  <Icon name="ph:git-fork" /> {openClawAgentCountLabel}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">
                Use an existing OpenClaw agent as a Cave familiar. Cave scans{" "}
                <code className="font-mono text-[var(--text-primary)]">
                  {OPENCLAW_AGENT_ROOT}
                </code>
                {" "}and preserves its workspace under{" "}
                <code className="font-mono text-[var(--text-primary)]">
                  {OPENCLAW_WORKSPACE_ROOT}
                </code>
                .
              </p>
            </div>
            <button
              onClick={props.onRefreshAgents}
              disabled={agentsLoading}
              className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent-presence)] disabled:opacity-50"
            >
              <Icon
                name="ph:arrows-clockwise-bold"
                className={agentsLoading ? "animate-spin" : undefined}
              />
              {agentsLoading ? "Scanning..." : "Refresh"}
            </button>
          </div>
          {agentsError ? (
            <div className="mt-2 rounded border border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {agentsError}
            </div>
          ) : openclawAgents.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] bg-[var(--bg-base)]/35 px-3 py-4 text-[12px] leading-5 text-[var(--text-secondary)]">
              <div className="flex items-start gap-2">
                <Icon
                  name="ph:magnifying-glass"
                  className="mt-0.5 shrink-0 text-[var(--accent-presence)]"
                />
                <div>
                  <p className="font-medium text-[var(--text-primary)]">
                    No OpenClaw agents found yet.
                  </p>
                  <p className="mt-1">
                    Create or sync one under{" "}
                    <code className="font-mono text-[var(--text-primary)]">
                      {OPENCLAW_AGENT_ROOT}
                    </code>
                    , then refresh this list. Option A remains available for a
                    brand-new Coven familiar.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {showAgentSearch ? (
                <div className="relative mt-3">
                  <Icon
                    name="ph:magnifying-glass"
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                  />
                  <input
                    value={agentQuery}
                    onChange={(e) => setAgentQuery(e.target.value)}
                    placeholder={`Search ${openclawAgents.length} agents by name, id, or role…`}
                    aria-label="Search OpenClaw agents"
                    className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                  />
                </div>
              ) : null}
              {visibleAgents.length === 0 ? (
                <p className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">
                  No agents match{" "}
                  <span className="font-medium text-[var(--text-primary)]">
                    {agentQuery.trim()}
                  </span>
                  .
                </p>
              ) : (
                <div className="mt-3 grid max-h-[16rem] gap-2 overflow-y-auto pr-1">
                  {visibleAgents.map((agent) => {
                    const active = selectedAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        onClick={() => props.onSelectAgent(agent)}
                        className={`focus-ring rounded-lg border p-3 text-left ${
                          active
                            ? "border-[color-mix(in_oklch,var(--accent-presence)_60%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                            : "border-[var(--border-hairline)] bg-[var(--bg-base)]/55 text-[var(--text-secondary)] hover:border-[var(--accent-presence)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-medium">
                            {agent.displayName}
                          </span>
                          {active ? (
                            <Icon
                              name="ph:check-bold"
                              className="text-[var(--accent-presence)]"
                            />
                          ) : null}
                        </div>
                        <div className="mt-1 grid gap-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                          <div className="truncate">{agent.id}</div>
                          {agent.workspacePath ? (
                            <div className="truncate">{agent.workspacePath}</div>
                          ) : null}
                        </div>
                        {agent.role ? (
                          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                            {agent.role}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Config form is revealed only once a path is chosen, and the SSH /
          confirm blocks below are scoped to Option A — so the user never sees
          fields that don't apply to their selection. */}
      {optionChosen ? (
        <>
          <div className="rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
            {selectedHarnessId ? (
              <>
                Setting up a new{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  {selectedHarness?.label}
                </span>{" "}
                familiar. Every field below is optional — sensible defaults fill
                in.
              </>
            ) : (
              <>
                Connecting{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  {selectedOpenClawAgent?.displayName}
                </span>
                . Give it a name; the rest is optional.
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Name{selectedAgentId ? " (required)" : " (optional)"}
              </span>
              <input
                value={familiarName}
                onChange={(e) => props.setFamiliarName(e.target.value)}
                placeholder="Example: Riley"
                className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Role (optional)
              </span>
              <input
                value={familiarRole}
                onChange={(e) => props.setFamiliarRole(e.target.value)}
                placeholder="Research, Code, Ops..."
                className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Glyph (optional)
              </span>
              <input
                value={familiarGlyph}
                onChange={(e) => props.setFamiliarGlyph(e.target.value)}
                placeholder="ph:sparkle-fill"
                aria-invalid={familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:")}
                className={`focus-ring mt-1 w-full rounded-md border bg-[var(--bg-base)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)] ${
                  glyphInvalid
                    ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]"
                    : "border-[var(--border-hairline)] focus:border-[var(--border-strong)]"
                }`}
              />
              {glyphInvalid ? (
                <span className="mt-1 block text-[11px] text-[var(--color-danger)]">
                  Must start with <code className="font-mono">ph:</code> — see{" "}
                  <a
                    href="https://phosphoricons.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    phosphoricons.com
                  </a>
                  .
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Description (optional)
              </span>
              <input
                value={familiarDescription}
                onChange={(e) => props.setFamiliarDescription(e.target.value)}
                placeholder="What should this familiar help with?"
                className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
              />
            </label>
          </div>

          {selectedHarnessId ? (
            <section className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={sshEnabled}
                  onChange={(e) => props.setSshEnabled(e.currentTarget.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--accent-presence)]"
                />
                <span className="text-[12px] leading-5 text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    Runs on a remote machine (SSH)
                  </span>{" "}
                  — the familiar&rsquo;s runtime uses SSH transport on another box (a
                  build server, a homelab, a VM). Cave connects non-interactively
                  with your SSH keys and never stores passwords or key material.
                </span>
              </label>
              {sshEnabled ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                        Host
                      </span>
                      <input
                        value={sshHost}
                        onChange={(e) => props.setSshHost(e.target.value)}
                        placeholder="ssh-alias or hostname"
                        className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                        Remote directory
                      </span>
                      <input
                        value={sshCwd}
                        onChange={(e) => props.setSshCwd(e.target.value)}
                        placeholder="/home/me/projects"
                        className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                        Remote coven command
                      </span>
                      <input
                        value={sshCommand}
                        onChange={(e) => props.setSshCommand(e.target.value)}
                        placeholder="coven (default)"
                        className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={props.onTestSsh}
                      disabled={sshCheck.state === "checking" || !sshHost.trim()}
                      className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:border-[var(--accent-presence)] disabled:opacity-50"
                    >
                      <Icon name="ph:plug-bold" />
                      {sshCheck.state === "checking" ? "Testing…" : "Test connection"}
                    </button>
                    {sshCheck.state === "ok" ? (
                      <span className="text-[11px] text-[var(--color-success)]">
                        {sshCheck.detail}
                      </span>
                    ) : sshCheck.state === "fail" ? (
                      <span className="text-[11px] text-[var(--color-danger)]">
                        {sshCheck.detail}
                      </span>
                    ) : null}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-[12px] text-[var(--text-secondary)]">
                      SSH key setup (one-time)
                    </summary>
                    <div className="mt-2">
                      <InstructionList title="" items={sshSetup} />
                    </div>
                  </details>
                </div>
              ) : null}
            </section>
          ) : null}

          {selectedHarnessId ? (
            <label className="flex items-start gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3 text-[12px] leading-5 text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={confirmCreateNewFamiliar}
                onChange={(e) =>
                  props.setConfirmCreateNewFamiliar(e.currentTarget.checked)
                }
                disabled={!daemonReady || !selectedHarnessId || picking !== null}
                className="mt-1 h-4 w-4 accent-[var(--accent-presence)] disabled:opacity-50"
              />
              <span>
                I understand this creates a new Coven familiar
                {selectedHarness ? (
                  <>
                    {" "}bound to the{" "}
                    <span className="font-medium text-[var(--text-primary)]">
                      {selectedHarness.label}
                    </span>{" "}runtime
                  </>
                ) : null}
                .
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {selectedHarnessId ? (
              <button
                onClick={props.onCreateLocal}
                disabled={
                  !daemonReady ||
                  picking !== null ||
                  !confirmCreateNewFamiliar ||
                  (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
                }
                className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
              >
                <Icon name="ph:terminal-window" />
                {picking === "local" ? "Creating..." : "Create new Coven familiar"}
              </button>
            ) : selectedAgentId ? (
              <button
                onClick={props.onConnectAgent}
                disabled={
                  !daemonReady ||
                  picking !== null ||
                  familiarName.trim().length === 0 ||
                  (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
                }
                className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
              >
                <Icon name="ph:git-fork" />
                {picking === "familiar"
                  ? "Connecting..."
                  : selectedOpenClawAgent
                    ? `Connect ${selectedOpenClawAgent.displayName}`
                    : "Connect OpenClaw agent"}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-[var(--border-hairline)] bg-[var(--bg-base)]/35 px-3 py-4 text-[12px] leading-5 text-[var(--text-secondary)]">
          Pick{" "}
          <span className="font-medium text-[var(--text-primary)]">Option A</span>{" "}
          or{" "}
          <span className="font-medium text-[var(--text-primary)]">Option B</span>{" "}
          above to name and create your familiar.
        </p>
      )}
    </div>
  );
}

function StepMeetFamiliars({
  familiars,
  statusOk,
  complete,
  onEdit,
  onOpenCave,
}: {
  familiars: CaveFamiliar[];
  statusOk: boolean;
  complete: boolean;
  onEdit: (id: string) => void;
  onOpenCave: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        {statusOk
          ? "Your familiars are loaded. Everything about them stays editable — name, look, brain, runtime, transport — in the Familiar Studio, any time."
          : "Once the daemon is running and a familiar exists, they appear here."}
      </p>
      {familiars.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {familiars.map((familiar) => (
            <div
              key={familiar.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {familiar.display_name ?? familiar.id}
                </div>
                <div className="truncate text-[11px] text-[var(--text-muted)]">
                  {familiar.role ?? familiar.id}
                </div>
              </div>
              <button
                onClick={() => onEdit(familiar.id)}
                className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:border-[var(--accent-presence)]"
              >
                <Icon name="ph:pencil-simple" />
                Edit
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {complete ? (
        <button
          onClick={onOpenCave}
          className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-success)_92%,#000)] px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm shadow-[color-mix(in_oklch,var(--color-success)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-success)_82%,#000)]"
        >
          <Icon name="ph:rocket-launch-bold" />
          Open Cave
        </button>
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
            "Counting stale sessions..."
          ) : "count" in prune ? (
            `Found ${prune.count} stale session${prune.count === 1 ? "" : "s"}. Confirm to delete.`
          ) : "pruning" in prune ? (
            "Pruning..."
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
