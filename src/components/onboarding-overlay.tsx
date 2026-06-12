"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { setDemoModeEnabled } from "@/lib/demo-mode";
import type { IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";

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

type InstallTarget = "coven-cli" | "codex" | "claude" | "openclaw" | "hermes";

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

/** Mirrors the server's npm-kind mutual exclusion (route returns 409). */
const NPM_INSTALL_TARGETS: InstallTarget[] = [
  "coven-cli",
  "codex",
  "claude",
  "openclaw",
];

const ALL_INSTALL_TARGETS: InstallTarget[] = [...NPM_INSTALL_TARGETS, "hermes"];

type SshCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; detail: string }
  | { state: "fail"; detail: string };

const COVEN_CLI_INSTALL_COMMAND = "npm i -g @opencoven/cli@latest";

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
      "then connect or create an agent under ~/.openclaw/agents (Option B in the familiar step)",
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
  const [shownPlatform, setShownPlatform] = useState<PlatformId | null>(null);
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

  const activePlatform = shownPlatform ?? platform;
  const platformCopy = PLATFORM_COPY[activePlatform];
  const chatHarnesses = harnesses.filter((adapter) => adapter.chatSupported);
  const selectedHarness =
    chatHarnesses.find((adapter) => adapter.id === selectedHarnessId) ?? null;
  const hasExistingOpenClawAgents = openclawAgents.length > 0;

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard may be blocked */
      return false;
    }
  };

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

  const runInstall = async (target: InstallTarget) => {
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
        // 409 (another npm install running) and hard start failures land here.
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
      // to the polling effect.
      setInstallJobs((prev) => ({
        ...prev,
        [target]: { status: "running", elapsedMs: 0, tail: "" },
      }));
    } catch (err) {
      setInstallResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          detail: err instanceof Error ? err.message : "install failed",
        },
      }));
    }
  };

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
    const tick = async () => {
      for (const target of targets) {
        try {
          const res = await fetch(
            `/api/onboarding/install?target=${encodeURIComponent(target)}`,
          );
          if (!res.ok || cancelled) continue;
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
          // Transient poll failure — next tick retries.
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

  // Re-attach to server-side jobs after a page refresh: one probe per target
  // on mount; only still-running jobs are adopted.
  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        ALL_INSTALL_TARGETS.map(async (target) => {
          try {
            const res = await fetch(
              `/api/onboarding/install?target=${encodeURIComponent(target)}`,
            );
            if (!res.ok) return null;
            const json = (await res.json()) as { status: string };
            return json.status === "running"
              ? ([target, json as InstallJobView] as const)
              : null;
          } catch {
            return null;
          }
        }),
      );
      const running = Object.fromEntries(
        entries.filter((entry): entry is NonNullable<typeof entry> => !!entry),
      );
      if (Object.keys(running).length > 0) {
        setInstallJobs((prev) => ({ ...running, ...prev }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const enableDemoMode = () => {
    setDemoModeEnabled(true);
    try {
      localStorage.setItem("cave:onboarding:dismissed", "1");
    } catch {
      /* private mode */
    }
    onDismiss();
  };

  const createLocalFamiliar = async () => {
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
            model: `${selectedHarness.id}-local`,
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
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "daemon start failed");
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

  const steps = useMemo<GuidedStep[]>(() => {
    const s = status?.steps;
    return [
      {
        key: "covenCli",
        title: "Install the coven CLI",
        ok: !!s?.covenCli.ok,
        detail: s?.covenCli.detail ?? s?.covenCli.hint ?? "checking...",
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
        key: "binding",
        title: "Create your familiar",
        ok: !!s?.binding.ok,
        detail: s?.binding.detail ?? s?.binding.hint ?? "checking...",
        icon: "ph:sparkle",
      },
      {
        key: "daemon",
        title: "Start the daemon",
        ok: !!s?.daemon.ok,
        detail: s?.daemon.detail ?? s?.daemon.hint ?? "checking...",
        icon: "ph:plug",
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
  }, [status]);

  // The step the guide spotlights: the first required step that isn't done.
  const activeStepKey = useMemo(() => {
    const firstIncomplete = steps.find((s) => !s.optional && !s.ok);
    return firstIncomplete?.key ?? null;
  }, [steps]);

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
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--accent-presence)]">
              <span>Welcome</span>
              <label className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 normal-case tracking-normal text-[var(--text-secondary)]">
                <span className="sr-only">Platform</span>
                <select
                  aria-label="Show instructions for platform"
                  value={activePlatform}
                  onChange={(e) =>
                    setShownPlatform(e.target.value as PlatformId)
                  }
                  className="focus-ring bg-transparent"
                >
                  <option value="mac">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                  <option value="unknown">Other</option>
                </select>
              </label>
              {process.env.NEXT_PUBLIC_DEMO === "true" ? (
                <span className="rounded-full border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-0.5 normal-case tracking-normal text-[var(--color-warning)]">
                  Demo mode
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
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
                            installResult={installResults["coven-cli"]}
                            nodeHint={nodeHint}
                            onInstall={() => void runInstall("coven-cli")}
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
                            platform={activePlatform}
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
                            selectedHarnessId={selectedHarnessId}
                            selectedHarness={selectedHarness}
                            openclawAgents={openclawAgents}
                            selectedAgentId={selectedAgentId}
                            agentsLoading={agentsLoading}
                            agentsError={agentsError}
                            hasExistingOpenClawAgents={hasExistingOpenClawAgents}
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
                            complete={!!status?.complete}
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
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Skip for now
          </button>
          {status?.complete ? (
            <button
              onClick={onDismiss}
              className="focus-ring rounded-md bg-[color-mix(in_oklch,var(--color-success)_90%,transparent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--color-success)_85%,#000)]"
            >
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

function StepCovenCli({
  platformCopy,
  installJobs,
  installResult,
  nodeHint,
  onInstall,
  onCopy,
}: {
  platformCopy: (typeof PLATFORM_COPY)[PlatformId];
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResult?: InstallResult;
  nodeHint: string | null;
  onInstall: () => void;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const npmJobRunning = NPM_INSTALL_TARGETS.some(
    (target) => installJobs[target]?.status === "running",
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        The coven CLI powers everything Cave does. Cave can install it for you
        — or copy the command and run it in any terminal.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onInstall}
          disabled={npmJobRunning}
          className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
        >
          <Icon name="ph:arrow-down-bold" />
          {installJobs["coven-cli"]?.status === "running"
            ? "Installing… (can take a minute)"
            : "Install coven CLI"}
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">
          or run it yourself:
        </span>
      </div>
      <CommandRow command={platformCopy.installCommand} onCopy={onCopy} />
      <InstallResultNote result={installResult} />
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
  const npmJobRunning = NPM_INSTALL_TARGETS.some(
    (target) => installJobs[target]?.status === "running",
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
          A runtime (harness) is the agent CLI your familiar speaks through.
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
          return (
            <div
              key={adapter.id}
              className={`rounded-lg border p-3 ${
                adapter.installed
                  ? "border-[color-mix(in_oklch,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_8%,transparent)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-base)]/45"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {adapter.label}
                </span>
                {adapter.installed ? (
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
              {!adapter.installed ? (
                <div className="mt-2 flex flex-col gap-2">
                  {oneClick ? (
                    <>
                      <button
                        onClick={() => onInstall(oneClick.target)}
                        disabled={
                          installJobs[oneClick.target]?.status === "running" ||
                          (NPM_INSTALL_TARGETS.includes(oneClick.target) && npmJobRunning)
                        }
                        className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
                      >
                        <Icon name="ph:arrow-down-bold" />
                        {installJobs[oneClick.target]?.status === "running"
                          ? "Installing…"
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
  selectedHarnessId: string | null;
  selectedHarness: HarnessReport | null;
  openclawAgents: OpenClawAgent[];
  selectedAgentId: string | null;
  agentsLoading: boolean;
  agentsError: string | null;
  hasExistingOpenClawAgents: boolean;
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
    selectedHarnessId,
    selectedHarness,
    openclawAgents,
    selectedAgentId,
    agentsLoading,
    agentsError,
    hasExistingOpenClawAgents,
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
  const glyphInvalid =
    familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        A familiar is your named agent — pick what powers it, name it, and
        everything stays editable later in the Familiar Studio (Agents &rarr;
        pick a familiar &rarr; Edit).
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
            Option A — new familiar from an installed runtime
          </h3>
          <div className="mt-2 grid gap-2">
            {chatHarnesses.map((adapter) => {
              const active = selectedHarnessId === adapter.id;
              return (
                <button
                  key={adapter.id}
                  onClick={() => props.onSelectHarness(adapter)}
                  disabled={!adapter.installed}
                  className={`rounded-lg border p-2.5 text-left ${
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

        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
              Option B — connect an existing OpenClaw agent
            </h3>
            <button
              onClick={props.onRefreshAgents}
              disabled={agentsLoading}
              className="focus-ring rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              {agentsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {agentsError ? (
            <div className="mt-2 rounded border border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {agentsError}
            </div>
          ) : openclawAgents.length === 0 ? (
            <div className="mt-2 rounded border border-dashed border-[var(--border-hairline)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
              No OpenClaw agents found under ~/.openclaw/agents — Option A is
              your path.
            </div>
          ) : (
            <div className="mt-2 grid max-h-[12rem] gap-2 overflow-y-auto pr-1">
              {openclawAgents.map((agent) => {
                const active = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => props.onSelectAgent(agent)}
                    className={`rounded-lg border p-2.5 text-left ${
                      active
                        ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] text-[var(--text-primary)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-base)]/45 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
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
                    <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {agent.id}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            Name
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
            Role
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
            Glyph
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
            Description
          </span>
          <input
            value={familiarDescription}
            onChange={(e) => props.setFamiliarDescription(e.target.value)}
            placeholder="What should this familiar help with?"
            className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
          />
        </label>
      </div>

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
            — the familiar&rsquo;s harness runs over SSH on another box (a
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

      <label className="flex items-start gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3 text-[12px] leading-5 text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={confirmCreateNewFamiliar}
          onChange={(e) =>
            props.setConfirmCreateNewFamiliar(e.currentTarget.checked)
          }
          disabled={!selectedHarnessId || picking !== null}
          className="mt-1 h-4 w-4 accent-[var(--accent-presence)] disabled:opacity-50"
        />
        <span>
          I understand this creates a new Coven familiar
          {selectedHarness ? (
            <>
              {" "}bound to the{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {selectedHarness.label}
              </span>{" "}harness
            </>
          ) : null}
          {hasExistingOpenClawAgents
            ? ", not a connection to one of the existing OpenClaw agents listed alongside"
            : ""}
          .
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={props.onCreateLocal}
          disabled={
            picking !== null ||
            !selectedHarnessId ||
            !confirmCreateNewFamiliar ||
            (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
          }
          className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
        >
          <Icon name="ph:terminal-window" />
          {picking === "local" ? "Creating..." : "Create new Coven familiar"}
        </button>
        <button
          onClick={props.onConnectAgent}
          disabled={
            picking !== null ||
            !selectedAgentId ||
            familiarName.trim().length === 0 ||
            (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
          }
          className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] px-4 py-2 text-[13px] text-[var(--text-primary)] hover:border-[var(--accent-presence)] disabled:opacity-50"
        >
          <Icon name="ph:sparkle" />
          {picking === "familiar"
            ? "Connecting..."
            : "Connect selected existing agent"}
        </button>
      </div>
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
          ? "Your familiars are loaded. Everything about them stays editable — name, look, brain, harness — in the Familiar Studio, any time."
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
          className="focus-ring inline-flex w-fit items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-success)_90%,transparent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--color-success)_85%,#000)]"
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
              className="rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
