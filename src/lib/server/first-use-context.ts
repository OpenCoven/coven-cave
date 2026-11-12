import { loadProjects } from "@/lib/cave-projects";
import { resolveFirstUseContext, type FirstUseDefaults } from "@/lib/first-use";
import { effectiveProjectAccess, loadHumanPermissionConfig, loadProjectPermissions } from "@/lib/project-permissions";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { validateCaveProjectRootAsync } from "@/lib/server/project-paths";
import { bindingFor } from "@/lib/cave-config";
import { canonicalHarnessId, isTrustedChatHarness } from "@/lib/harness-adapters";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { harnessSpawnEnv, warmHarnessSpawnPath } from "@/lib/harness-spawn-env";
import { hermesApiConfig } from "@/lib/hermes-responses-stream";
import { evaluateCovenBackedRuntimeAvailability, evaluateRuntimeAvailability, resolveHermesLaunch } from "@/lib/runtime-availability";
import { covenLaunchCommand, covenWrapperSpawnEnv } from "@/lib/coven-bin";
import { codexLaunchCommand } from "@/lib/codex-bin";
import { isCodexFamilyHarness } from "@/lib/local-codex";
import { grokLaunchCommand } from "@/lib/grok-bin";
import { openCodeAvailabilityProbe, openCodeLaunch, openCodeSpawnEnv } from "@/lib/opencode-bin";
import { openClawLaunchCommand, openClawSpawnEnv } from "@/lib/openclaw-bin";
import { openClawGatewayPairedDeviceAuthStatus } from "@/lib/openclaw-gateway";
import { copilotStreamSpec } from "@/lib/copilot-stream";
import { resolveCopilotRuntimeLaunch } from "@/lib/server/copilot-runtime-launch";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

/** Configuration and passive launch checks only; provider/remote health is checked at send. */
export async function inspectFirstUseRuntime(familiarId: string, projectId: string) {
  if (!isValidFamiliarId(familiarId)) throw new Error("Invalid familiar id");
  const roster = await loadVisibleFamiliarRoster();
  if (!roster.ok) throw new Error(roster.error);
  if (!roster.roster.some((entry) => entry.id === familiarId)) return null;
  const binding = bindingFor(roster.config, familiarId);
  const harness = canonicalHarnessId(binding.harness);
  const ssh = isSshRuntime(binding.runtime);
  const report = (transport: "ssh" | "api" | "gateway" | "local", ready: boolean) => ({ familiarId, harness, transport, state: ready ? "ready" as const : "unavailable" as const });
  // Match the send boundary's binding refusals before bypassing local launch
  // checks. An SSH binding never requires a copy of its runner on this host.
  if (!isTrustedChatHarness(harness) || binding.hasInvalidHermesProfileBinding
    || (binding.hermesProfile && (harness !== "hermes" || ssh))
    || (ssh && (harness === "grok" || harness === "openclaw"))) return report(ssh ? "ssh" : "local", false);
  if (ssh) return report("ssh", true);

  const project = (await loadProjects()).find((entry) => entry.id === projectId);
  const directory = project ? await validateCaveProjectRootAsync(project.root) : null;
  if (!directory?.ok) return report("local", false);
  const cwd = directory.root;
  // Gateway dispatch is selected before the CLI fallback in chat/send. This
  // status check never loads a device identity/token or opens a connection.
  if (harness === "openclaw"
    && (process.env.OPENCLAW_GATEWAY_DISPATCH === "1" || process.env.OPENCLAW_GATEWAY_DISPATCH === "true")
    && process.env.OPENCLAW_GATEWAY_URL?.trim()
    && openClawGatewayPairedDeviceAuthStatus().available) return report("gateway", true);

  await warmHarnessSpawnPath();
  if (harness === "openclaw") {
    try {
      const launch = openClawLaunchCommand();
      return report("local", evaluateRuntimeAvailability({ runner: "openclaw", command: launch.command, env: openClawSpawnEnv(), cwd, requiredFiles: launch.requiredFiles, unresolvedWindowsShim: launch.unresolvedWindowsShim === true }).state === "ready");
    } catch { return report("local", false); }
  }
  const env = harnessSpawnEnv(familiarId);
  if (harness === "hermes") {
    // Use exactly the familiar-scoped configuration the send route uses;
    // never contact the API, return credentials, or probe provider health.
    if (!binding.hermesProfile && hermesApiConfig({ HERMES_API_URL: env.HERMES_API_URL, HERMES_API_KEY: env.HERMES_API_KEY })) return report("api", true);
    return report("local", resolveHermesLaunch({ familiarId, env, cwd }).state === "ready");
  }
  if (harness === "copilot") {
    const stream = copilotStreamSpec();
    if (stream) {
      const launch = await resolveCopilotRuntimeLaunch(stream.executable, { spawnEnv: () => env });
      return report("local", launch.availability.state === "ready");
    }
  }
  if (harness === "opencode") {
    const scopedEnv = openCodeSpawnEnv(familiarId);
    const launch = openCodeLaunch([], process.platform, scopedEnv);
    return report("local", evaluateRuntimeAvailability(openCodeAvailabilityProbe(launch, scopedEnv)).state === "ready");
  }
  try {
    if (isCodexFamilyHarness(harness) || harness === "grok") {
      const runner = isCodexFamilyHarness(harness) ? "codex" : "grok";
      const launch = runner === "codex" ? codexLaunchCommand() : grokLaunchCommand();
      return report("local", evaluateRuntimeAvailability({ runner, command: launch.command, env, unresolvedWindowsShim: launch.unresolvedWindowsShim === true }).state === "ready");
    }
    const launch = covenLaunchCommand();
    const spawnEnv = covenWrapperSpawnEnv(env);
    const availability = harness === "claude"
      ? evaluateCovenBackedRuntimeAvailability({ runner: "claude", covenCommand: launch.command, env: spawnEnv, unresolvedCovenWindowsShim: launch.unresolvedWindowsShim === true })
      : evaluateRuntimeAvailability({ runner: "coven", command: launch.command, env: spawnEnv, unresolvedWindowsShim: launch.unresolvedWindowsShim === true });
    return report("local", availability.state === "ready");
  } catch {
    return report("local", false);
  }
}

/** Re-read registry, roster and effective grants; a saved preference is never authority. */
export async function inspectFirstUseContext(defaults: FirstUseDefaults | null) {
  if (!defaults) return {
    resolution: resolveFirstUseContext({ defaults, projectIds: [], familiarIds: [], eligibleFamiliarIds: [], runtimeAvailable: true }),
    access: [], project: null,
  };
  const [projects, roster, permissions, humanConfig] = await Promise.all([
    loadProjects(), loadVisibleFamiliarRoster(), loadProjectPermissions(), loadHumanPermissionConfig(),
  ]);
  if (!roster.ok) throw new Error(roster.error);
  const project = projects.find((entry) => entry.id === defaults.projectId) ?? null;
  const projectValid = project !== null && (await validateCaveProjectRootAsync(project.root)).ok;
  const access = defaults.familiarIds.map((familiarId) => {
    const effective = effectiveProjectAccess(permissions, familiarId, defaults.projectId);
    const supreme = humanConfig.supremeFamiliarId === familiarId;
    return { familiarId, ...effective, supreme };
  });
  const resolution = resolveFirstUseContext({
    defaults,
    projectIds: projectValid ? [defaults.projectId] : [],
    familiarIds: roster.roster.map((entry) => entry.id),
    eligibleFamiliarIds: access.filter((entry) => entry.level !== null).map((entry) => entry.familiarId),
    // Runtime readiness is checked separately by the live runtime/model-state
    // report and launch route. A valid selection never promises a runnable CLI.
    runtimeAvailable: true,
  });
  return { resolution, access, project };
}
