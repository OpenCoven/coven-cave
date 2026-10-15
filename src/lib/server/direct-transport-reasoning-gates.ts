// Which direct transports could forward a Thinking pick for this chat (#5905).
//
// The model-state route offers the Codex and Copilot `reasoning` controls only
// when the send route would actually launch the direct transport with the
// flag available; otherwise a chip would render whose pick the send route then
// rejects as unsupported. Both routes therefore ask the same routing helpers
// with the same probes: `prepareCodexChatRouting` (TTL-cached `codex exec
// --help` discovery) and `prepareCopilotChatRouting` (the bounded Copilot
// capability probe). This module is the model-state side of that agreement;
// the send route derives the same answers from the routing results it already
// holds for the launch.

import { prepareCodexChatRouting } from "@/app/api/chat/send/codex-routing";
import { prepareCopilotChatRouting } from "@/app/api/chat/send/copilot-routing";
import { codexLaunchCommand } from "@/lib/codex-bin";
import {
  codexProbeEnv,
  discoverCachedCodexRuntime,
  productionCodexSchemaSources,
  type CodexCapabilities,
} from "@/lib/codex-compatibility";
import { copilotStreamSpec, copilotSupportsReasoningEffort } from "@/lib/copilot-stream";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { evaluateRuntimeAvailability } from "@/lib/runtime-availability";
import { probeCopilotCapability } from "@/lib/server/copilot-capability-probe";
import { resolveCopilotRuntimeLaunch } from "@/lib/server/copilot-runtime-launch";
import { resolveRuntimeCompatibility } from "@/lib/server/runtime-compatibility-registry";

export type DirectTransportReasoningGates = {
  codex: boolean;
  copilot: boolean;
};

export const NO_DIRECT_REASONING: DirectTransportReasoningGates = { codex: false, copilot: false };

/** The Codex help contract that carries `-c model_reasoning_effort=…` for the
 *  launch shape the turn will take (fresh vs resume). */
export function codexReasoningForwardable(
  capabilities: CodexCapabilities | null | undefined,
  resuming: boolean,
): boolean {
  if (!capabilities) return false;
  return resuming ? capabilities.resumeConfig === true : capabilities.config === true;
}

export async function directTransportReasoningGates(input: {
  familiarId: string;
  harness: string;
  /** The native session the turn would resume, when one is known. */
  resumeSessionId: string | null;
}): Promise<DirectTransportReasoningGates> {
  if (input.harness === "codex") {
    return { codex: await codexGate(input), copilot: false };
  }
  if (input.harness === "copilot") {
    return { codex: false, copilot: await copilotGate(input) };
  }
  return NO_DIRECT_REASONING;
}

async function codexGate(input: { familiarId: string; resumeSessionId: string | null }): Promise<boolean> {
  let launch: ReturnType<typeof codexLaunchCommand> | null;
  try {
    launch = codexLaunchCommand();
  } catch {
    return false;
  }
  const env = harnessSpawnEnv(input.familiarId);
  const availability = evaluateRuntimeAvailability({
    runner: "codex",
    command: launch.command,
    env,
    unresolvedWindowsShim: launch.unresolvedWindowsShim === true,
  });
  const routing = await prepareCodexChatRouting({
    harness: "codex",
    isSshRuntime: false,
    resumeSessionId: input.resumeSessionId,
    probe: async () =>
      availability.state === "ready"
        ? discoverCachedCodexRuntime(
            { command: launch.command, fixedArgs: launch.fixedArgs },
            undefined,
            codexProbeEnv(env),
          )
        : null,
    resolveSources: () => productionCodexSchemaSources(),
  });
  if (routing.mode !== "direct") return false;
  return codexReasoningForwardable(routing.report.capabilities, Boolean(input.resumeSessionId));
}

async function copilotGate(input: { familiarId: string }): Promise<boolean> {
  const spec = copilotStreamSpec();
  if (!spec) return false;
  const runtimeLaunch = await resolveCopilotRuntimeLaunch(spec.executable, {
    spawnEnv: (discoveryDeadline) => harnessSpawnEnv(input.familiarId, { discoveryDeadline }),
  });
  if (runtimeLaunch.availability.state !== "ready") return false;
  const capability = await probeCopilotCapability(spec.executable, {
    resolveRuntimeLaunch: async () => runtimeLaunch,
  });
  const routing = await prepareCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: false,
    probe: async () => capability,
    resolveCompatibility: () => resolveRuntimeCompatibility("copilot"),
  });
  return routing.spec !== null && copilotSupportsReasoningEffort(capability.version ?? null);
}
