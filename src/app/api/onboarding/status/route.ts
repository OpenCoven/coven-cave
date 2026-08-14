import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { callDaemon } from "@/lib/coven-daemon";
import { loadConfig } from "@/lib/cave-config";
import { caveHome } from "@/lib/coven-paths";
import {
  covenBinaryFromEnvironment,
  covenLaunchCommandForBinary,
  covenSpawnEnv,
  covenWrapperSpawnEnv,
  pickWindowsLauncher,
} from "@/lib/coven-bin";
import {
  openCovenToolReadinessStatuses,
  type OpenCovenToolReadinessStatus,
} from "@/lib/opencoven-tools-status";
import {
  COMPATIBILITY_ADAPTERS,
  covenHelpSupportsAdapterList,
  mergeAdapterReports,
  runtimeSourceSetupState,
  type AdapterReport,
  type CovenAdapterSummary,
} from "@/lib/harness-adapters";
import { listOpenClawAgents } from "@/lib/openclaw-bridge";
import {
  bindingReadinessStep,
  classifyCommandPathFailure,
  environmentDiscoveryState,
  isConfirmedMissingPath,
  onboardingStatusPayload,
  withinDeadline,
  type DeadlineResult,
  type EnvironmentDiscoveryState,
  type OnboardingStatusStep,
} from "@/lib/onboarding-status-probes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const COVEN_CLI_INSTALL_GUIDANCE = "Install Cave-managed Node.js and npm first, then use Cave's reviewed Coven CLI installer.";
const ONBOARDING_STATUS_DEADLINE_MS = 4_000;
const ONBOARDING_DISCOVERY_DEADLINE_MS = 2_000;
const OPENCLAW_ONBOARDING_DEADLINE_MS = 750;

type Step = OnboardingStatusStep;
type ProbeResult<T> =
  | { state: "ready"; value: T }
  | { state: "absent"; value: null }
  | { state: "unavailable"; value: null };
type OpenClawAgentCount =
  | { state: "ready"; count: number }
  | { state: "unavailable"; count: 0 };

function gitInstallHint(): string {
  if (process.platform === "darwin") {
    return "Install Git with `xcode-select --install` or from https://git-scm.com, then re-check.";
  }
  if (process.platform === "win32") {
    return "Install Git from https://git-scm.com/download/win, then re-check.";
  }
  return "Install Git with your package manager (e.g. `sudo apt install git`), then re-check.";
}

/**
 * Queue project selection lives on the Tasks page's Queue tab now, not in
 * onboarding — but it remains a Git-repository boundary. Cave can render some
 * surfaces without Git, yet it cannot safely initialize or load a selected
 * Queue project until Git is available.
 */
async function checkGit(
  env: NodeJS.ProcessEnv,
  deadline: number,
  discoveryState: EnvironmentDiscoveryState,
): Promise<Step> {
  const found = await commandPath("git", env, deadline, discoveryState);
  if (found.state === "ready") return { ok: true, detail: found.value };
  if (found.state === "unavailable") {
    return {
      ok: false,
      state: "unavailable",
      hint: "Couldn’t verify Git. You can continue and retry later.",
    };
  }
  return {
    ok: false,
    hint: `Git is required to select and use a Queue project. ${gitInstallHint()}`,
  };
}

function checkCovenCli(
  tool: OpenCovenToolReadinessStatus | undefined,
  pathProbe: ProbeResult<string>,
): Step {
  if (!tool || tool.discoveryError) {
    return {
      ok: false,
      state: "unavailable",
      hint: "Couldn’t verify the local Coven CLI. You can continue and retry later.",
    };
  }
  if (!tool.installed) {
    if (pathProbe.state !== "absent") {
      return {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify the local Coven CLI. You can continue and retry later.",
      };
    }
    return {
      ok: false,
      hint: `${COVEN_CLI_INSTALL_GUIDANCE} Then re-check.`,
    };
  }
  if (!tool.compatible) {
    const detail = tool.current
      ? `Update required: ${tool.current} is below ${tool.minimumVersion}`
      : "Update required";
    return {
      ok: false,
      detail,
      hint: `${COVEN_CLI_INSTALL_GUIDANCE} Then re-check.`,
    };
  }
  const location = tool.path ?? tool.binary;
  return {
    ok: true,
    detail: tool.current ? `${tool.current} at ${location}` : `${location} (version unknown)`,
  };
}

function remainingTimeout(maximum: number, deadline: number): number {
  return Math.max(1, Math.min(maximum, deadline - Date.now()));
}

async function commandPath(
  binary: string,
  env: NodeJS.ProcessEnv,
  deadline: number,
  discoveryState: EnvironmentDiscoveryState,
): Promise<ProbeResult<string>> {
  if (process.platform === "win32" && binary.toLowerCase() === "coven") {
    const found = covenBinaryFromEnvironment(env);
    return found
      ? { state: "ready", value: found }
      : discoveryState === "ready"
        ? { state: "absent", value: null }
        : { state: "unavailable", value: null };
  }
  const command = process.platform === "win32" ? "where" : "which";
  const result = await withinDeadline(async (signal) => {
    try {
      const { stdout } = await execFileAsync(command, [binary], {
        windowsHide: true,
        env,
        signal,
        timeout: remainingTimeout(1500, deadline),
      });
      const lines = stdout.split(/\r?\n/);
      const found = process.platform === "win32"
        ? pickWindowsLauncher(lines)
        : lines.map((line) => line.trim()).find(Boolean) ?? null;
      return found
        ? { state: "ready" as const, value: found }
        : discoveryState === "ready"
          ? { state: "absent" as const, value: null }
          : { state: "unavailable" as const, value: null };
    } catch (error) {
      return classifyCommandPathFailure(error, discoveryState) === "absent"
        ? { state: "absent" as const, value: null }
        : { state: "unavailable" as const, value: null };
    }
  }, deadline);
  return result.state === "ready"
    ? result.value
    : { state: "unavailable", value: null };
}

async function countOpenClawAgents(): Promise<OpenClawAgentCount> {
  const result = await withinDeadline(
    () => listOpenClawAgents(),
    Date.now() + OPENCLAW_ONBOARDING_DEADLINE_MS,
  );
  return result.state === "ready"
    ? { state: "ready", count: result.value.length }
    : { state: "unavailable", count: 0 };
}

async function checkHarnessAdapters(
  openClawProbePromise: Promise<OpenClawAgentCount>,
  env: NodeJS.ProcessEnv,
  deadline: number,
  discoveryState: EnvironmentDiscoveryState,
): Promise<{
  step: Step;
  reports: AdapterReport[];
  openClawAgentCount: number;
  evidenceState: "ready" | "unavailable";
}> {
  const [localProbes, covenAdapterSummaries, openClawProbe] = await Promise.all([
    Promise.all(
      COMPATIBILITY_ADAPTERS.map((adapter) =>
        commandPath(adapter.binary, env, deadline, discoveryState)
      ),
    ),
    loadCovenAdapterSummaries(env, deadline, discoveryState),
    openClawProbePromise,
  ]);
  const localReports: AdapterReport[] = COMPATIBILITY_ADAPTERS.map(
    (adapter, index) => {
      const probe = localProbes[index];
      const adapterPath = probe?.state === "ready" ? probe.value : null;
      return {
        id: adapter.id,
        label: adapter.label,
        binary: adapter.binary,
        chatSupported: adapter.chatSupported,
        installed: !!adapterPath,
        path: adapterPath,
        version: null,
        installHint: adapter.installHint,
        source: adapter.source,
        manifestPath: null,
      };
    },
  );
  const reports = mergeAdapterReports(
    localReports,
    covenAdapterSummaries.state === "ready" ? covenAdapterSummaries.value : [],
  );
  const openClawAgentCount = openClawProbe.count;
  const step = runtimeSourceSetupState(reports, openClawAgentCount);
  const evidenceState = localProbes.every((probe) => probe.state !== "unavailable") &&
      covenAdapterSummaries.state === "ready" &&
      openClawProbe.state === "ready"
    ? "ready"
    : "unavailable";
  if (!step.ok && evidenceState === "unavailable") {
    return {
      step: {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify every available runtime. You can continue and retry later.",
      },
      reports,
      openClawAgentCount: 0,
      evidenceState,
    };
  }
  return { step, reports, openClawAgentCount, evidenceState };
}

async function loadCovenAdapterSummaries(
  env: NodeJS.ProcessEnv,
  deadline: number,
  discoveryState: EnvironmentDiscoveryState,
): Promise<DeadlineResult<CovenAdapterSummary[]>> {
  const pathProbe = await commandPath("coven", env, deadline, discoveryState);
  if (pathProbe.state === "absent") return { state: "ready", value: [] };
  if (pathProbe.state === "unavailable") {
    return { state: "unavailable", value: null };
  }
  return withinDeadline(async (signal) => {
    const { command, fixedArgs, unresolvedWindowsShim } =
      covenLaunchCommandForBinary(pathProbe.value);
    if (unresolvedWindowsShim) throw new Error("unresolved Coven launcher");
    const wrapperEnv = covenWrapperSpawnEnv(env);
    const { stdout: helpText } = await execFileAsync(
      command,
      [...fixedArgs, "--help"],
      {
        windowsHide: true,
        env: wrapperEnv,
        signal,
        timeout: remainingTimeout(1500, deadline),
      },
    );
    if (!covenHelpSupportsAdapterList(helpText)) return [];
    if (signal.aborted || Date.now() >= deadline) {
      throw new Error("onboarding deadline expired");
    }
    const { stdout } = await execFileAsync(
      command,
      [...fixedArgs, "adapter", "list", "--json"],
      {
        windowsHide: true,
        env: wrapperEnv,
        signal,
        timeout: remainingTimeout(3000, deadline),
      },
    );
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error("unexpected adapter list");
    return parsed as CovenAdapterSummary[];
  }, deadline);
}

async function checkCovenHome(): Promise<Step> {
  const p = path.join(homedir(), ".coven");
  try {
    const s = await stat(p);
    if (s.isDirectory()) return { ok: true, detail: p };
    return { ok: false, hint: "Cave can replace the non-directory ~/.coven path." };
  } catch (error) {
    if (isConfirmedMissingPath(error)) {
      return { ok: false, hint: "Cave can create ~/.coven for you." };
    }
    return {
      ok: false,
      state: "unavailable",
      hint: "Couldn’t verify ~/.coven. You can continue and retry later.",
    };
  }
}

async function checkConfigEvidence(): Promise<"ready" | "unavailable"> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(caveHome(), "config.json"), "utf8"),
    );
    return parsed && typeof parsed === "object" ? "ready" : "unavailable";
  } catch (error) {
    return isConfirmedMissingPath(error) ? "ready" : "unavailable";
  }
}

async function checkDaemon(): Promise<Step> {
  const res = await callDaemon<{ ok?: boolean }>({
    path: "/api/v1/health",
    timeoutMs: 800,
  });
  if (res.ok) return { ok: true, detail: "daemon socket reachable" };
  if (
    res.error === "malformed response" ||
    res.error === "daemon response exceeded size limit"
  ) {
    return {
      ok: false,
      state: "unavailable",
      hint: "Couldn’t verify the daemon. You can continue and retry later.",
    };
  }
  if (
    res.error === "daemon offline" ||
    res.error === "server hub URL is not configured" ||
    res.status > 0
  ) {
    return { ok: false, hint: res.error ?? `daemon http ${res.status}` };
  }
  return {
    ok: false,
    state: "unavailable",
    hint: "Couldn’t verify the daemon. You can continue and retry later.",
  };
}

/**
 * Advisory since familiar creation moved out of the wizard: the roster count
 * still ships in the payload (Salem context and the wizard read it), but a
 * familiar-less machine is DONE with setup — the in-app Summoning Circle
 * (Familiars surface) owns creation now, so this never gates `complete`.
 */
async function checkFamiliars(): Promise<{ step: Step; count: number }> {
  const res = await callDaemon<unknown[]>({
    path: "/api/v1/familiars",
    timeoutMs: 800,
  });
  const count = Array.isArray(res.data) ? res.data.length : 0;
  if (res.ok && count > 0) {
    return {
      step: {
        ok: true,
        optional: true,
        detail: `${count} familiar${count === 1 ? "" : "s"} loaded`,
      },
      count,
    };
  }
  if (!res.ok && res.error !== "daemon offline") {
    return {
      step: {
        ok: false,
        optional: true,
        state: "unavailable",
        hint: "Couldn’t verify familiars. You can continue and retry later.",
      },
      count,
    };
  }
  return {
    step: {
      ok: false,
      optional: true,
      hint: res.ok
        ? "Summon your first familiar inside Cave — Familiars → Summon familiar."
        : "daemon offline",
    },
    count,
  };
}

function classifyStep(step: Step): Step {
  if (step.state) return step;
  return { ...step, state: step.ok ? "ready" : "action-required" };
}

export async function GET() {
  const requestDeadline = Date.now() + ONBOARDING_STATUS_DEADLINE_MS;
  const discoveryDeadline = Date.now() + ONBOARDING_DISCOVERY_DEADLINE_MS;
  let readinessEnv: NodeJS.ProcessEnv;
  let discoveryState: EnvironmentDiscoveryState;
  try {
    readinessEnv = covenSpawnEnv({ discoveryDeadline });
    discoveryState = environmentDiscoveryState(Date.now(), discoveryDeadline);
  } catch {
    const unavailable = {
      ok: false,
      state: "unavailable" as const,
      hint: "Couldn’t verify the local environment. You can continue and retry later.",
    };
    const steps: Record<string, Step> = {
      covenCli: unavailable,
      covenHome: unavailable,
      git: { ...unavailable, optional: true },
      adapters: unavailable,
      daemon: unavailable,
      familiars: { ...unavailable, optional: true },
      binding: { ...unavailable, optional: true },
    };
    return NextResponse.json(onboardingStatusPayload(steps, null));
  }
  const openClawProbePromise = countOpenClawAgents();
  const openCovenToolsPromise = withinDeadline(
    () => openCovenToolReadinessStatuses({ env: readinessEnv }),
    requestDeadline,
  );
  const adaptersPromise = withinDeadline(
    () => checkHarnessAdapters(
      openClawProbePromise,
      readinessEnv,
      requestDeadline,
      discoveryState,
    ),
    requestDeadline,
  );
  const covenPathPromise = commandPath(
    "coven",
    readinessEnv,
    requestDeadline,
    discoveryState,
  );
  const covenHomePromise = withinDeadline(() => checkCovenHome(), requestDeadline);
  const gitPromise = withinDeadline(
    () => checkGit(readinessEnv, requestDeadline, discoveryState),
    requestDeadline,
  );
  const daemonPromise = withinDeadline(() => checkDaemon(), requestDeadline);
  const familiarsPromise = withinDeadline(() => checkFamiliars(), requestDeadline);
  const configPromise = withinDeadline(() => loadConfig(), requestDeadline);
  const configEvidencePromise = withinDeadline(
    () => checkConfigEvidence(),
    requestDeadline,
  );
  const [
    openCovenToolsResult,
    adaptersResult,
    covenPathResult,
    covenHomeResult,
    gitResult,
    daemonResult,
    familiarsResult,
    configResult,
    configEvidenceResult,
  ] = await Promise.all([
    openCovenToolsPromise,
    adaptersPromise,
    covenPathPromise,
    covenHomePromise,
    gitPromise,
    daemonPromise,
    familiarsPromise,
    configPromise,
    configEvidencePromise,
  ]);
  const openCovenTools = openCovenToolsResult.state === "ready"
    ? openCovenToolsResult.value
    : null;
  const covenCli: Step = openCovenTools
    ? checkCovenCli(
        openCovenTools.find((tool) => tool.id === "coven-cli"),
        covenPathResult,
      )
    : {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify the local Coven CLI. You can continue and retry later.",
      };
  const covenHome: Step = covenHomeResult.state === "ready"
    ? covenHomeResult.value
    : {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify ~/.coven. You can continue and retry later.",
      };
  const git: Step = gitResult.state === "ready"
    ? gitResult.value
    : {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify Git. You can continue and retry later.",
      };
  const configEvidenceAvailable = configEvidenceResult.state === "ready" &&
    configEvidenceResult.value === "ready";
  const daemon: Step = daemonResult.state === "ready" && configEvidenceAvailable
    ? daemonResult.value
    : {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify the daemon. You can continue and retry later.",
      };
  const familiarsRes = familiarsResult.state === "ready" && configEvidenceAvailable
    ? familiarsResult.value
    : {
        step: {
          ok: false,
          optional: true,
          state: "unavailable" as const,
          hint: "Couldn’t verify familiars. You can continue and retry later.",
        },
        count: 0,
      };
  const adapters = adaptersResult.state === "ready"
    ? adaptersResult.value
    : {
        step: {
          ok: false,
          state: "unavailable" as const,
          hint: "Couldn’t verify every available runtime. You can continue and retry later.",
        },
        reports: [],
        openClawAgentCount: 0,
        evidenceState: "unavailable" as const,
      };
  const binding: Step = configResult.state === "unavailable" ||
      !configEvidenceAvailable ||
      familiarsRes.step.state === "unavailable"
    ? {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify familiar bindings. You can continue and retry later.",
      }
    : bindingReadinessStep({
        defaults: configResult.value.defaults,
        familiarsAvailable: familiarsRes.count > 0,
        daemonState: daemon.ok
          ? "ready"
          : daemon.state === "unavailable"
            ? "unavailable"
            : "offline",
        reports: adapters.reports,
        openClawAgentCount: adapters.openClawAgentCount,
        runtimeEvidenceState: adapters.evidenceState,
      });

  const steps: Record<string, Step> = {
    covenCli: classifyStep(covenCli),
    covenHome: classifyStep(covenHome),
    // Git is a Queue capability gate, not a prerequisite for basic Cave
    // onboarding or local familiar setup.
    git: classifyStep({ ...git, optional: true }),
    adapters: classifyStep(adapters.step),
    daemon: classifyStep(daemon),
    familiars: classifyStep(familiarsRes.step),
    // Advisory like `familiars`: creation lives in the in-app Summoning
    // Circle, so setup is complete once the infrastructure is — the binding
    // detail stays informative for the checklist and diagnostics only.
    binding: classifyStep({ ...binding, optional: true }),
  };
  return NextResponse.json(onboardingStatusPayload(steps, openCovenTools));
}
