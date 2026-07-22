import {
  bindingFor,
  enqueueOfflineTravelItem,
  loadConfig,
  recordSessionFamiliar,
  setSessionTitle,
  type CaveTravelQueueItem,
} from "@/lib/cave-config";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { catalogNode } from "@/lib/flow/flow-catalog";
import {
  flowRunRedactsData,
  type FlowDoc,
} from "@/lib/flow/flow-doc";
import {
  compileFlowPrompt,
  type FlowExecutionMode,
  flowExecutionOrder,
  flowPartialExecutionOrder,
  flowRunBlockReason,
  type FlowTriggerInput,
} from "@/lib/flow/flow-compile";
import { flowMissingRequiredInputs } from "@/lib/required-inputs";
import { realpath, stat } from "node:fs/promises";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { extractFlowCustomData } from "@/lib/flow/flow-execution-data";
import type { FlowRunRecord, FlowRunStepStatus } from "@/lib/flows";
import { recordFlowRun, updateFlowRun } from "@/lib/server/flow-store";
import { startCopilotFlowRun } from "@/lib/server/flow-copilot-session";
import { copilotStreamSpec } from "@/lib/copilot-stream";
import { isSshRuntime } from "@/lib/familiar-runtime";
import { isAllowedHarness, normalizeProjectRoot } from "@/lib/server/session-security";
import { travelLocalQueueStatus } from "@/lib/travel-offline-queue";

export type StartFlowSessionResult = {
  ok: boolean;
  status?: number;
  executor?: "session" | "travel-queue";
  sessionId?: string;
  run?: FlowRunRecord;
  queued?: boolean;
  queueItem?: CaveTravelQueueItem;
  unavailable?: boolean;
  error?: string;
};

/** First familiar referenced anywhere in the flow, to attribute the session. */
function flowFamiliar(flow: FlowDoc): string | null {
  for (const node of flow.nodes) {
    const familiar = node.params?.familiar;
    if (typeof familiar === "string" && familiar.trim()) return familiar.trim();
  }
  return null;
}

/**
 * The familiar's own workspace as a harness-level trust grant for the direct
 * copilot flow spawn. Flow prompts direct familiars to write memory and
 * self-reports into their workspace, but the spawn cwd is the project root —
 * and a non-interactive run can't prompt for permission, so every access to
 * an untrusted workspace hard-fails (the recurring "filesystem access to own
 * workspace" familiar self-report). Resolved conservatively: strict slug id,
 * an existing real directory, and never the spawn cwd itself (cave-n1yc).
 */
async function flowFamiliarAddDirs(
  familiarId: string | null,
  projectRoot: string,
): Promise<string[]> {
  if (!familiarId || !isValidFamiliarId(familiarId)) return [];
  try {
    const workspace = await realpath(await familiarWorkspace(familiarId));
    if (!(await stat(workspace)).isDirectory()) return [];
    let root = projectRoot;
    try {
      root = await realpath(projectRoot);
    } catch {
      /* keep the normalized form for comparison */
    }
    return workspace === root ? [] : [workspace];
  } catch {
    return [];
  }
}

function initialFlowRunStepStatus(
  flow: FlowDoc,
  stepId: string,
  seenActiveAgentStep: { value: boolean },
): FlowRunStepStatus {
  const node = flow.nodes.find((item) => item.id === stepId);
  const def = node ? catalogNode(node.type) : undefined;
  if (def?.isTrigger) return "succeeded";
  if (node?.type.startsWith("input.")) return "succeeded";
  if (!seenActiveAgentStep.value) {
    seenActiveAgentStep.value = true;
    return "running";
  }
  return "pending";
}

export async function startFlowSession(
  flow: FlowDoc,
  options: {
    projectRoot?: string | null;
    targetNodeId?: string;
    triggerInput?: FlowTriggerInput;
    mode?: FlowExecutionMode;
    /**
     * Extra directories to trust at the harness level alongside the
     * familiar's own workspace (e.g. a research mission workspace when the
     * flow runs in a different project root). Non-interactive runs can't
     * prompt, so an untrusted workspace write hard-fails.
     */
    addDirs?: string[];
  } = {},
): Promise<StartFlowSessionResult> {
  const blocked = flowRunBlockReason(flow, options.targetNodeId);
  if (!blocked.ok) return { ok: false, error: blocked.reason, status: 400 };

  const missingRequired = flowMissingRequiredInputs(flow);
  if (missingRequired.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Provide required input: ${missingRequired.map((m) => m.label).join(", ")}`,
    };
  }

  const projectRoot = normalizeProjectRoot(options.projectRoot ?? process.cwd());
  if (!projectRoot) return { ok: false, error: "invalid project root", status: 400 };

  const config = await loadConfig();
  const familiarId = flowFamiliar(flow);
  const binding = familiarId ? bindingFor(config, familiarId) : { harness: config.defaults.harness };
  if (!isAllowedHarness(binding.harness)) {
    return {
      ok: false,
      error: `harness '${binding.harness}' can't run as an agent session`,
      status: 409,
    };
  }
  const travelStatus = await travelLocalQueueStatus(config);
  if (travelStatus) {
    const order = options.targetNodeId ? flowPartialExecutionOrder(flow, options.targetNodeId) : flowExecutionOrder(flow);
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    // Record the queued placeholder run BEFORE enqueueing so its id can ride
    // in the travel payload: replay then updates this run in place instead of
    // recording a second one, keeping callers that stored the id (research
    // mission iterations) pointed at the run that actually executes.
    const run = await recordFlowRun({
      flowId: flow.id,
      flowName: flow.name,
      status: "queued",
      mode: options.mode ?? "manual",
      startedAt: new Date().toISOString(),
      steps: order.map((stepId) => ({
        id: stepId,
        type: byId.get(stepId)?.type ?? "unknown",
        status: "pending",
      })),
      summary: "queued offline",
      source: "cave",
      flowSnapshot: flow,
    });
    let queued: CaveTravelQueueItem;
    try {
      queued = await enqueueOfflineTravelItem({
        kind: "workflow",
        summary: options.targetNodeId ? `Flow step: ${flow.name} / ${options.targetNodeId}` : `Flow: ${flow.name}`,
        payload: {
          route: "flow-session",
          flow,
          options,
          familiarId,
          harness: binding.harness,
          placeholderRunId: run.id,
        },
      });
    } catch (error) {
      // Never leave an un-replayable queued run behind — it would sit in the
      // runs list (and hold a research iteration) forever.
      await updateFlowRun(run.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        summary: "offline enqueue failed",
      });
      throw error;
    }
    const stamped = await updateFlowRun(run.id, {
      startedAt: queued.createdAt,
      summary: `queued offline ${queued.id}`,
    });
    return {
      ok: true,
      executor: "travel-queue",
      queued: true,
      queueItem: queued,
      run: stamped ?? run,
    };
  }

  const prompt = compileFlowPrompt(flow, {
    targetNodeId: options.targetNodeId,
    triggerInput: options.triggerInput,
    mode: options.mode,
  });

  const finishStart = async (sessionId: string): Promise<StartFlowSessionResult> => {
    await Promise.all([
      familiarId ? recordSessionFamiliar(sessionId, familiarId) : Promise.resolve(),
      setSessionTitle(
        sessionId,
        options.targetNodeId ? `Flow step: ${flow.name} / ${options.targetNodeId}` : `Flow: ${flow.name}`,
      ),
    ]);

    const order = options.targetNodeId ? flowPartialExecutionOrder(flow, options.targetNodeId) : flowExecutionOrder(flow);
    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    const customData = extractFlowCustomData(flow);
    const redacted = flowRunRedactsData(flow, options.mode ?? "manual");
    const seenActiveAgentStep = { value: false };
    const run = await recordFlowRun({
      flowId: flow.id,
      flowName: flow.name,
      status: "running",
      mode: options.mode ?? "manual",
      ...(Object.keys(customData).length > 0 ? { customData } : {}),
      ...(redacted ? { redacted: true } : {}),
      startedAt: new Date().toISOString(),
      steps: order.map((stepId) => ({
        id: stepId,
        type: byId.get(stepId)?.type ?? "unknown",
        status: initialFlowRunStepStatus(flow, stepId, seenActiveAgentStep),
      })),
      summary: `agent session ${sessionId.slice(0, 8)}`,
      source: "cave",
      sessionId,
      flowSnapshot: flow,
    });

    return { ok: true, run, sessionId, executor: "session" };
  };

  // The daemon's nonInteractive launch mangles multi-word prompts for the
  // copilot adapter (unquoted argv split — the CLI errors with "your prompt
  // was not quoted"), which broke every copilot flow session, including
  // research-mission iterations. Chat answers the same daemon deficiency by
  // spawning the CLI directly with a real argv (cave-yesg); do the same here.
  // Local daemon authority only — hub mode must keep routing through
  // callDaemon(), where daemonTargetForConfig/loadDaemonTarget preserve the
  // configured hub execution boundary. SSH runtimes also stay on the daemon path
  // to the remote host. The run persists its transcript as a Cave conversation under the
  // session id, which is where the flow transcript endpoint and the
  // research-mission reconcile already look first.
  const sshBound = "runtime" in binding && isSshRuntime(binding.runtime);
  const hubAuthority = config.multiHost?.mode === "hub";
  if (binding.harness === "copilot" && !sshBound && !hubAuthority) {
    const spec = copilotStreamSpec();
    if (spec) {
      const { sessionId } = startCopilotFlowRun({
        spec,
        prompt,
        projectRoot,
        familiarId,
        familiarName: "display_name" in binding ? binding.display_name : undefined,
        familiarRole: "role" in binding ? binding.role : undefined,
        addDirs: [
          ...(options.addDirs ?? []),
          ...await flowFamiliarAddDirs(familiarId, projectRoot),
        ],
      });
      return finishStart(sessionId);
    }
  }

  const res = await callDaemon<{ id: string; status: string }>({
    method: "POST",
    path: "/api/v1/sessions",
    // Spawn a plain harness session (no native `familiarId`), the same way task
    // chat does. Passing `familiarId` makes some daemon setups try to run the
    // session *as* that familiar and reject it with "no familiar configured for
    // this harness" when the familiar isn't registered for that harness on the
    // daemon. Use non-interactive launch mode so the event stream contains the
    // flow prompt's assistant output and progress markers, not a fullscreen
    // harness TUI. The familiar is already described in the compiled prompt and
    // is mirrored into cave-state below via recordSessionFamiliar, so attribution
    // and the run→familiar link survive.
    body: { projectRoot, harness: binding.harness, prompt, launchMode: "nonInteractive" },
    timeoutMs: 8000,
  });

  if (!res.ok || !res.data?.id) {
    if (res.status === 0) {
      return { ok: false, unavailable: true, error: "daemon offline" };
    }
    return {
      ok: false,
      error: extractDaemonError(res) ?? res.error ?? `daemon http ${res.status}`,
      status: res.status || 502,
    };
  }

  const sessionId = res.data.id;
  return finishStart(sessionId);
}
