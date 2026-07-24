import type { IconName } from "@/lib/icon";
import type { LatestCheckDisplay } from "@/lib/opencoven-tools-status-display";

export type PruneState =
  | { idle: true }
  | { counting: true }
  | { count: number }
  | { pruning: true }
  | { pruned: number }
  | { error: string };
export type Step = { ok: boolean; detail?: string; hint?: string; optional?: boolean };
export type PlatformId = "windows" | "linux" | "mac" | "unknown";

export type OnboardingStatus = {
  complete: boolean;
  steps: {
    covenCli: Step;
    covenHome: Step;
    project: Step;
    git?: Step;
    adapters: Step;
    daemon: Step;
    familiars: Step;
    binding: Step;
  };
  tools?: OpenCovenToolStatus[];
};

export type OpenCovenToolStatus = {
  id: "coven-cli";
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  path: string | null;
  current: string | null;
  latest: string | null;
  latestCheck: LatestCheckDisplay | null;
  outdated: boolean;
  compatible: boolean;
  minimumVersion: string;
  checkedAt?: string | null;
};

export type OnboardingUpdatePayload = {
  ok: boolean;
  tools: OpenCovenToolStatus[];
  checkedAt: string | null;
  freshness: "fresh" | "stale" | "unavailable";
  stale: boolean;
  refreshing: boolean;
  error: string | null;
};

export type HarnessReport = {
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

export type InstallTarget =
  | "coven-cli"
  | "codex"
  | "claude"
  | "copilot"
  | "openclaw"
  | "hermes";

export type InstallResult = {
  ok: boolean;
  detail: string;
  /** Server-capped and secret-redacted terminal output retained on failure. */
  tail?: string;
};

export type NpmLaneState = {
  target: InstallTarget;
  label: string;
};

/** Result of the codex OAuth port preflight (POST /api/onboarding/codex-port-preflight).
 *  The four outcomes mirror the route handler's response shape. UI consumes
 *  `ok` for color/icon and `detail` for the user-facing message. */
export type PortPreflightResult = {
  ok: boolean;
  detail: string;
  outcome:
    | "port-free"
    | "cleared-stale-codex"
    | "held-by-other"
    | "held-unknown";
};

export type InstallJobView = {
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
export const INSTALL_TARGET_KIND: Record<InstallTarget, "npm" | "script"> = {
  "coven-cli": "npm",
  codex: "npm",
  claude: "npm",
  copilot: "npm",
  openclaw: "npm",
  hermes: "script",
};
export const ALL_INSTALL_TARGETS = Object.keys(INSTALL_TARGET_KIND) as InstallTarget[];
export const NPM_INSTALL_TARGETS = ALL_INSTALL_TARGETS.filter(
  (target) => INSTALL_TARGET_KIND[target] === "npm",
);

export function isInstallTargetValue(value: string): value is InstallTarget {
  return ALL_INSTALL_TARGETS.includes(value as InstallTarget);
}

// ~30s of 2s ticks: long enough to ride out a slow sidecar start, short
// enough that a genuinely broken /api/harnesses surfaces as a retryable
// error instead of an empty runtime grid polling silently forever.
export const HARNESS_RETRY_BUDGET = 15;

export const OPENCLAW_AGENT_ROOT = "~/.openclaw/agents";
export const OPENCLAW_WORKSPACE_ROOT = "~/.openclaw/workspace";

/** Every chat harness Cave can install itself. `command` is the manual
 *  equivalent shown beside the button; `windowsCommand` overrides it on
 *  Windows when the official installer differs (Hermes). */
export const HARNESS_ONE_CLICK: Partial<
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
  hermes: {
    target: "hermes",
    command:
      "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
    windowsCommand: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    afterInstall:
      "then run `hermes setup` in a terminal (installer can take several minutes — it bootstraps its own toolchain)",
  },
};

export const PLATFORM_COPY: Record<
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

export type GuidedStep = {
  key: string;
  title: string;
  ok: boolean;
  optional?: boolean;
  detail: string;
  icon: IconName;
};

export type MultiHostMode = "local" | "hub";

export function parseOnboardingExecutorUrls(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}
