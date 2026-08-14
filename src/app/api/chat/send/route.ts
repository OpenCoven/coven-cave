import { spawn, type ChildProcessByStdio, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { NextResponse } from "next/server";
import { resolveBackspaces, stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
  enqueueOfflineTravelItem,
  type CaveConfig,
  loadConfig,
  loadState,
  recordSessionFamiliar,
  setSessionTitleAutoIfOwned,
} from "@/lib/cave-config";
import { chatSummaryTitle, chatTitleFromPrompt, defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import {
  isRenameDueAtTurn,
  normalizeChatAutoRenamePolicy,
  renameTitleFromLatestExchange,
} from "@/lib/chat-auto-rename";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import type { SessionOrigin } from "@/lib/types";
import { normalizeChatAttentionOperationId } from "@/lib/chat-attention";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  toolTextCorrection,
  toPersistedTools,
  ToolCallTracker,
} from "@/lib/chat-tool-events";
import {
  COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC,
  covenLaunchCommand,
  covenWrapperSpawnEnv,
  type CovenLaunchCommand,
} from "@/lib/coven-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { sweepStuckCreatedSessions } from "@/lib/server/stuck-created-sweep";
import {
  detectBuiltinAdapterConflict,
  healBuiltinShadowedManifest,
  type BuiltinAdapterConflict,
} from "@/lib/server/adapter-conflict-heal";
import {
  buildCopilotStreamArgs,
  copilotIdentityPreamble,
  copilotProtocolDiagnostic,
  copilotStreamSpec,
  CopilotMessageTranscript,
  CopilotTextAssembler,
  isSafeCopilotResumeSessionId,
  parseCopilotChatEvent,
} from "@/lib/copilot-stream";
import { prepareCopilotChatRouting } from "./copilot-routing";
import {
  buildGrokBuildArgs,
  grokIdentityRules,
  grokResumeNeedsNewSandboxSession,
  grokSandboxProfileForPermission,
  grokShouldUseCliDefault,
  parseGrokStreamEvent,
} from "@/lib/grok-build";
import { grokLaunchCommand } from "@/lib/grok-bin";
import {
  parseGrokCompatibilityEvent,
  probeGrokRunCapabilities,
  quarantineGrokSchema,
  redactedGrokEventFingerprint,
  resolveGrokCompatibility,
} from "@/lib/grok-compatibility";
import {
  openCodeAvailabilityProbe,
  openCodeLaunch,
  openCodeSpawnEnv,
} from "@/lib/opencode-bin";
import {
  codexAdapterFailureAvailability,
  probeCodexRuntimeAvailability,
} from "@/lib/codex-runtime-availability";
import {
  codexProbeEnv,
  discoverCachedCodexRuntime,
  parseCodexStreamEvent,
  productionCodexSchemaSources,
} from "@/lib/codex-compatibility";
import { codexLaunchCommand } from "@/lib/codex-bin";
import { buildCodexExecArgs, prepareCodexChatRouting } from "./codex-routing";
import {
  evaluateCovenBackedRuntimeAvailability,
  evaluateRuntimeAvailability,
  localRuntimeLaunchError,
  missingRunnerMessage,
  RUNTIME_AVAILABILITY_ERROR_CODES,
  resolveHermesLaunch,
  runtimeLaunchDiagnostics,
  runtimeProcessFailure,
  type DirectRunnerId,
  type RuntimeAvailability,
  type RuntimeRunnerId,
} from "@/lib/runtime-availability";
import {
  isModelAllowedByRuntime,
  modelForCaveFromRuntimeEcho,
  modelForRuntimeLaunch,
  runtimeModelIdForLaunch,
} from "@/lib/runtime-models";
import {
  quarantineOpenCodeSchema,
  redactedOpenCodeEventFingerprint,
  resolveOpenCodeCompatibility,
} from "@/lib/opencode-compatibility";
import { handleOpenCodeJsonLine } from "@/lib/opencode-stream";
import {
  hasUnsupportedClaudeToolFrame,
  isClaudeStreamJsonFrame,
  parseClaudeMessageEnvelope,
  parseClaudeTextOnlyEnvelope,
} from "@/lib/claude-stream";
import { redactedEventFingerprint } from "@/lib/runtime-compatibility";
import {
  claudeCompatibilityDiagnostic,
  resolveInstalledClaudeCompatibility,
} from "@/lib/server/claude-runtime-compatibility";
import {
  HermesSseDecoder,
  hermesApiConfig,
  hermesApiCanAccessLocalFiles,
  isHermesResponsesEventName,
  isHermesMissingPreviousResponseError,
  hermesResponsesUrl,
  isHermesInvalidPreviousResponseIdError,
  parseHermesResponsesEvent,
} from "@/lib/hermes-responses-stream";
import { redactSecretText, redactSecretsDeep } from "@/lib/secret-redaction";
import { buildPromptWithCovenIdentityCanon } from "@/lib/coven-identity-canon";
import { buildPromptWithDeliveryEvidenceContract } from "@/lib/delivery-evidence-contract";
import {
  buildFamiliarContractContext,
  buildPromptWithFamiliarContract,
  familiarContractNotice,
} from "@/lib/server/familiar-contract-context";
import {
  buildPromptWithKnowledgeVault,
  listCollections,
  readKnowledgeVaultForPrompt,
} from "@/lib/server/knowledge-vault";
import { parseAgentAttachments } from "@/lib/server/agent-attachments";
import {
  markChatRunProjectionSettled,
  markChatRunTransportSettled,
  registerChatRun,
  unregisterChatRun,
  addChatRunKeys,
  type ChatRunHandle,
} from "@/lib/server/chat-stop-registry";
import { openRunBuffer, type RunBufferHandle } from "@/lib/server/chat-stream-buffer";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { ensureAdapterManifestScaffold } from "@/lib/server/adapter-manifest-scaffold";
import { probeCopilotCapability } from "@/lib/server/copilot-capability-probe";
import { resolveCopilotRuntimeLaunch } from "@/lib/server/copilot-runtime-launch";
import {
  probeReadyLocalRuntimeCapability,
  probeReadyLocalRuntimeCapabilityOutcome,
  type LocalRuntimeCapabilityPlan,
} from "@/lib/server/local-runtime-capability-gate";
import { resolveRuntimeCompatibility } from "@/lib/server/runtime-compatibility-registry";
import { loadProjects } from "@/lib/cave-projects";
import { chatProjectAccessId, taskWorktreeProjectAccessId } from "@/lib/chat-project-access";
import {
  authorizeChatProjectLaunch,
  ChatProjectLaunchError,
  projectlessGenerationLaunch,
} from "@/lib/server/chat-project-launch";
import { validateCaveProjectRoot } from "@/lib/server/project-paths";
import { resolveRuntimeSkillRoots } from "@/lib/server/skill-scan";
import { resolveBundledCopilotPluginDirs } from "@/lib/server/bundled-copilot-plugins";
import { openClawLaunchCommand, openClawSpawnEnv } from "@/lib/openclaw-bin";
import {
  dispatchOpenClawGatewayTurn,
  openClawGatewayPairedDeviceAuthStatus,
} from "@/lib/openclaw-gateway";
import {
  OpenClawAgentResolutionError,
  extractOpenClawSessionId,
  extractOpenClawText,
  hasValidOpenClawPayloadEnvelope,
  isOpenClawGatewayCredentialFailure,
  openClawAgentArgs,
  openClawCliExecutionMode,
  openClawSessionKey,
  resolveOpenClawAgentBinding,
  type OpenClawAgentJson,
} from "@/lib/openclaw-bridge";
import { isTrustedChatHarness, canonicalHarnessId } from "@/lib/harness-adapters";
import {
  type ChatTurn,
  createConversationStub,
  loadConversation,
  persistQueuedOfflineConversation,
  saveConversation,
  stripConversationStubTurn,
  withConversationLock,
} from "@/lib/cave-conversations";
import {
  captureWorkBranch,
  cwdFromConversationRuntime,
} from "@/lib/server/chat-work-branch";
import { latestPrUrlFromText } from "@/lib/chat-pr-link";
import { buildResumeRetryPrompt } from "@/lib/chat-history-fallback";
import {
  cleanModelId,
  modelApplicationForHarness,
  modelApplicationFromRun,
  modelRejectionInError,
  type ChatModelState,
} from "@/lib/chat-model-state";
import {
  RuntimeScopeError,
  buildRuntimeAccessFingerprint,
  buildPromptWithRuntimeScope,
  resolveLocalRuntimeCwd,
  type RuntimeScope,
} from "@/lib/chat-runtime-scope";
import {
  buildPromptWithBoundaryReminder,
  createBoundarySentinel,
  formatBoundaryNotice,
  recordBoundaryViolations,
} from "@/lib/chat-boundary-sentinel";
import {
  ProjectAccessDeniedError,
  assertProjectAccess,
  listAccessibleProjects,
} from "@/lib/project-permissions";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import {
  buildTaskContext,
  buildTaskAwarePrompt,
  taskCardForSession,
} from "@/lib/task-chat-context";
import {
  buildPromptWithFamiliarStartupContext,
  readFamiliarDailyMemoryStartupContext,
  buildOperatorProfileContext,
} from "@/lib/server/familiar-startup-context";
import {
  buildSshSpawnArgs,
  isSshRuntime,
} from "@/lib/familiar-runtime";
import { resolveRequestedRuntime, sshHostRegistry } from "@/lib/chat-hosts";
import {
  parseCostUsd,
  parseStreamJsonUsage,
  type TurnUsage,
} from "@/lib/usage-format";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import {
  extractChatAttentionMarker,
  extractIncompleteChatAttentionMarker,
} from "@/lib/chat-attention-marker";
import { splitReasoning } from "@/lib/chat-reasoning";
import type { StreamEvent } from "@/lib/stream-events";
import { deriveTravelClientStatus } from "@/lib/travel-client-state";
import {
  appendMentionedFilesBlock,
  cleanupStagedImageFiles,
  persistImageAttachments,
  resolveMentionedFiles,
  writeImageAttachmentsToRuntime,
} from "./chat-send-attachments";
import {
  covenRunSupportsAddDir,
  covenRunModelFlagOutcome,
  hermesChatSupportsModel,
  covenRunSupportsPermission,
  openCodeRunCapabilities,
} from "./chat-send-capabilities";
import {
  buildPromptWithResponseControls,
  modelIntentForSend,
  isModelOverrideScope,
  isValidModelOverrideIntent,
  needsClaudeOpus5Routability,
  offlineQueuedModelIntent,
  persistedTurnControls,
  persistSendModelIntent,
  resolveSendModelMetadata,
  savedModelSelectionRejection,
  turnRetryModel,
} from "./chat-send-models";
import { claudeOpus5Routability } from "@/lib/server/claude-models";
import {
  appliedModelControls,
  modelControlCapabilities,
  modelControlInputWithLegacy,
  promptOnlyModelControls,
  validateModelControlValues,
  type ModelControlValues,
} from "@/lib/model-control-capabilities";
import { chatSse, startChatSseHeartbeat } from "./chat-send-sse";
import { conversationCwd, daemonSessionCwd, resolveFamiliarWorkspace } from "./chat-send-runtime";
import { resolveOpenClawGatewayOutcome } from "./openclaw-gateway-outcome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A transport drop no longer kills the harness (deliberate Stop goes through
// /api/chat/stop), but a detached run must not outlive its usefulness forever
// — SIGTERM the child if it is still running this long after the client
// vanished. Long enough for any real reply to finish, short enough to bound
// runaway children nobody is listening to.
const CHAT_DETACH_MAX_MS = Math.max(
  60_000,
  Number(process.env.COVEN_CAVE_CHAT_DETACH_MAX_MS ?? 10 * 60_000) || 10 * 60_000,
);

type LocalRuntimePlan = LocalRuntimeCapabilityPlan & {
  command: string;
  fixedArgs: string[];
  requiredFiles?: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  unresolvedWindowsShim?: boolean;
};

function createLocalRuntimePlan(input: {
  runner: DirectRunnerId;
  launch: Pick<CovenLaunchCommand, "command" | "fixedArgs" | "unresolvedWindowsShim"> & {
    requiredFiles?: string[];
  };
  env: NodeJS.ProcessEnv;
  availability?: RuntimeAvailability;
  /** Names the runner a supplied Coven-backed availability was tagged for, so
   * the capability gate can tell a wrapper launch from a drifted plan. */
  availabilityRunner?: RuntimeRunnerId;
  cwd?: string;
}): LocalRuntimePlan {
  const availability = input.availability ?? evaluateRuntimeAvailability({
    runner: input.runner,
    command: input.launch.command,
    env: input.env,
    requiredFiles: input.launch.requiredFiles,
    unresolvedWindowsShim: input.launch.unresolvedWindowsShim === true,
    cwd: input.cwd,
  });
  return {
    runner: input.runner,
    command: input.launch.command,
    fixedArgs: input.launch.fixedArgs,
    ...(input.launch.requiredFiles ? { requiredFiles: input.launch.requiredFiles } : {}),
    env: input.env,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    availability,
    ...(input.availabilityRunner ? { availabilityRunner: input.availabilityRunner } : {}),
    ...(input.launch.unresolvedWindowsShim
      ? { unresolvedWindowsShim: true as const }
      : {}),
  };
}

function hermesLaunchFailure(plan?: LocalRuntimePlan): { code: string; message: string } {
  const availability = plan && evaluateRuntimeAvailability({
    runner: "hermes",
    command: plan.command,
    env: plan.env,
    cwd: plan.cwd,
  });
  if (availability && availability.state !== "ready") {
    return { code: availability.code, message: availability.message };
  }
  return {
    code: "runtime_unlaunchable",
    message: "Hermes failed to start. Check its installation and try again.",
  };
}

type SendBody = {
  familiarId: string;
  prompt?: string;
  /** Per-send client token for /api/chat/stop — lets Stop target this run
   *  before the server has assigned/echoed a conversation id. */
  runId?: string;
  sessionId?: string;
  /** A Board native-chat handoff reserves Cave's stable id before any harness
   * session exists. Start its first turn fresh instead of treating that id as
   * a harness resume token. */
  startNewConversation?: boolean;
  projectRoot?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session" | "runtime-default";
  reasoningEffort?: string;
  responseSpeed?: string;
  /** Selected-model capability controls. Legacy fields above are accepted for
   * historical clients but are never treated as universal provider settings. */
  modelControls?: ModelControlValues;
  /** Composer Access chip: "full" (default) or "read". Forwarded to
   *  `coven run --permission` (mapped to the harness's native sandbox flag)
   *  only when the installed CLI advertises it; "full" is left implicit so the
   *  harness keeps its default sandbox rather than being widened. */
  permissionMode?: string;
  /** Composer Host chip: "local" or a REGISTERED ssh host id from /api/hosts.
   *  Resolved against the server-side registry (config.remoteHosts ∪ familiar
   *  runtime bindings) — an unregistered host is rejected fail-closed, and the
   *  remote command always comes from the registry, never this field. Absent ⇒
   *  a conversation recorded on an ssh host stays pinned there, else the
   *  familiar's own runtime binding decides. */
  runtimeHost?: string;
  attachments?: ChatAttachment[];
  /** Repo-relative paths the user @-mentioned in the composer (CHAT-D1-04). */
  mentionedFiles?: string[];
  /** Project root the mentions are relative to — resumed sessions don't carry
   * projectRoot in the body, so the composer sends the root it knows. */
  mentionedFilesRoot?: string;
  /** Branching: when set, the new user turn is parented here (its prior
   *  sibling stays in the tree) and the new assistant turn becomes the tip.
   *  Explicit null means "branch at the root" (sibling of a root turn) and is
   *  distinct from the field being absent (a normal, non-branch send). */
  parentTurnId?: string | null;
  /** Provenance for a brand-new conversation (e.g. "eval"). Stamped on the
   *  conversation file once, when it's first created. */
  origin?: SessionOrigin;
};

type OfflineChatQueuePayload = Pick<
  SendBody,
  | "familiarId"
  | "projectRoot"
  | "runId"
  | "modelOverride"
  | "modelOverrideScope"
  | "reasoningEffort"
  | "responseSpeed"
  | "modelControls"
  | "mentionedFiles"
  | "mentionedFilesRoot"
  | "parentTurnId"
  | "origin"
> & {
  prompt: string;
  sessionId: string;
  userTurnId: string;
  attachments: ChatAttachment[];
  responseMetadata: ChatResponseMetadata;
};


// Hook-line shapes emitted by codex/claude harnesses while a tool runs.
// Examples:
//   hook: tool_use Bash {...}
//   hook: pre_tool_use Edit { ... }
//   hook: post_tool_use Bash {... exitCode: 0 ...}
const TOOL_HOOK_RE =
  /^hook:\s+(?:pre_tool_use|post_tool_use|tool_use)\s+(\S+)(?:\s+(.*))?$/;

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Chat sidebar attention (task 3): every assistant-turn persistence path
 *  calls this exactly once, immediately before building the persisted turn,
 *  so an explicit `<coven:attention reason="...">` marker becomes a durable
 *  `attentionRequest` stamp instead of leaking into the saved transcript
 *  text. Returns the marker-stripped text unconditionally and a nullable
 *  request the caller clones onto its OWN copy of `responseMetadata` — never
 *  mutate `responseMetadata` in place here, since the same object is reused
 *  for the SSE `done` event emitted right after persistence. */
function prepareAttentionRequest(args: {
  text: string;
  sessionId: string;
  turnId: string;
  requestedAt: string;
  incomplete?: boolean;
}): {
  text: string;
  reasoning?: string;
  request: ChatResponseMetadata["attentionRequest"] | null;
} {
  const { visible: visibleBody, reasoning: reasoningBody } = splitReasoning(args.text);
  const { visible, request: marker } = args.incomplete
    ? extractIncompleteChatAttentionMarker(visibleBody)
    : extractChatAttentionMarker(visibleBody);
  const { visible: cleanedReasoning } = args.incomplete
    ? extractIncompleteChatAttentionMarker(reasoningBody)
    : extractChatAttentionMarker(reasoningBody);
  return {
    text: visible,
    ...(cleanedReasoning.trim() ? { reasoning: cleanedReasoning.trim() } : {}),
    request: marker
      ? {
          sessionId: args.sessionId,
          turnId: args.turnId,
          requestedAt: args.requestedAt,
          reason: marker.reason,
        }
      : null,
  };
}

function attentionClearOperationForTurn(
  value: unknown,
): Pick<ChatTurn, "attentionClearOperationId"> {
  const operationId = normalizeChatAttentionOperationId(value);
  return operationId ? { attentionClearOperationId: operationId } : {};
}

/** Set a session title from the first-turn stub path with auto-provenance,
 *  atomically skipping when a manual title is already present. Best effort. */
async function setDefaultStubTitleAuto(sessionId: string, title: string): Promise<void> {
  const autoDefaults = new Set([defaultChatTitleForSession(sessionId)]);
  await setSessionTitleAutoIfOwned(sessionId, title, autoDefaults).catch(() => undefined);
}

/** Auto-name a thread from its first user/assistant exchange with a short
 *  summary title. Derives the title from the settled conversation first (so
 *  the ownership check never races with a manual rename made during the
 *  loadConversation await), then atomically writes only when the title is still
 *  absent, a known auto default, or auto-owned via provenance. Best effort:
 *  failures leave the default title in place. */
async function autoNameSessionFromFirstExchange(
  sessionId: string,
  promptText: string,
): Promise<void> {
  try {
    // Derive the title from the first settled exchange first, before any
    // ownership check, so stale pre-await state cannot overwrite a manual rename.
    const conversation = await loadConversation(sessionId).catch(() => null);
    const turns = conversation?.turns ?? [];
    const firstUser = turns.find((t) => t.role === "user")?.text ?? promptText;
    const firstAssistant =
      turns.find((t) => t.role === "assistant" && !t.isError)?.text ?? null;
    const summary = chatSummaryTitle({ userText: firstUser, assistantText: firstAssistant });
    if (!summary) return;

    // Atomic ownership check + write: recognizes auto-derived defaults from both
    // the stub path (chatTitleFromPrompt, chatSummaryTitle) and the neutral default,
    // so a manual rename made at any point always wins.
    const autoDefaults = new Set(
      [
        chatTitleFromPrompt(promptText),           // legacy prompt-derived default
        chatSummaryTitle({ userText: promptText }), // concise summary from prompt alone
        defaultChatTitleForSession(sessionId),      // "New chat"
      ].filter((t): t is string => Boolean(t)),
    );
    await setSessionTitleAutoIfOwned(sessionId, summary, autoDefaults);
  } catch {
    /* best effort */
  }
}

/**
 * Periodic, context-aware rename (chat-auto-rename.ts). Opt-in via the
 * `chatAutoRename` policy: once a thread reaches a multiple of `everyTurns`
 * assistant turns, re-derive its title from the LATEST exchange so a long
 * conversation's name tracks where it actually went. Never overwrites a title
 * a person set by hand (provenance in `sessionTitleAuto`). Best effort: any
 * failure leaves the current title in place. `firstPromptText` seeds the set of
 * auto-derived defaults the first-exchange name may have left behind.
 */
async function maybeAutoRenameFromContext(
  sessionId: string,
  firstPromptText: string,
): Promise<void> {
  try {
    const config = await loadConfig();
    const policy = normalizeChatAutoRenamePolicy(config.chatAutoRename);
    if (!policy.enabled) return;

    const conversation = await loadConversation(sessionId);
    const turns = conversation?.turns ?? [];
    const assistantTurns = turns.filter((t) => t.role === "assistant").length;
    if (!isRenameDueAtTurn(assistantTurns, policy.everyTurns)) return;

    const lastUser = [...turns].reverse().find((t) => t.role === "user")?.text ?? null;
    const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? null;
    const next = renameTitleFromLatestExchange({ userText: lastUser, assistantText: lastAssistant });
    if (!next) return;

    const firstPrompt = turns.find((t) => t.role === "user")?.text ?? firstPromptText;
    const autoDefaults = new Set(
      [
        defaultChatTitleForSession(sessionId),
        chatTitleFromPrompt(firstPrompt),
        chatSummaryTitle({ userText: firstPrompt }),
      ].filter(
        (t): t is string => Boolean(t),
      ),
    );
    await setSessionTitleAutoIfOwned(
      sessionId,
      next,
      autoDefaults,
      policy.preserveManualTitles,
    );
  } catch {
    /* best effort */
  }
}

async function maybeQueueOfflineChat(args: {
  body: SendBody;
  config: CaveConfig;
  promptText: string;
  persistedAttachments: ChatAttachment[];
  responseMetadata: ChatResponseMetadata;
}): Promise<Response | null> {
  const state = await loadState();
  const travelStatus = deriveTravelClientStatus({
    multiHost: args.config.multiHost,
    travel: state.travel,
    hubReachable: state.travel.hubUnreachableSince ? false : null,
  });
  if (travelStatus.authority !== "travel-local") return null;

  const sessionId = args.body.sessionId ?? crypto.randomUUID();
  const queuedUserTurnId = crypto.randomUUID();
  const queuedModelIntent = offlineQueuedModelIntent({
    body: args.body,
    responseMetadata: args.responseMetadata,
  });
  const payload: OfflineChatQueuePayload = {
    familiarId: args.body.familiarId,
    prompt: args.promptText,
    sessionId,
    userTurnId: queuedUserTurnId,
    projectRoot: args.body.projectRoot,
    runId: args.body.runId,
    modelOverride: queuedModelIntent.modelOverride,
    modelOverrideScope: queuedModelIntent.modelOverrideScope,
    reasoningEffort: args.body.reasoningEffort,
    responseSpeed: args.body.responseSpeed,
    modelControls: args.body.modelControls,
    attachments: args.persistedAttachments,
    mentionedFiles: args.body.mentionedFiles,
    mentionedFilesRoot: args.body.mentionedFilesRoot,
    parentTurnId: args.body.parentTurnId,
    origin: args.body.origin,
    responseMetadata: args.responseMetadata,
  };
  const queued = await enqueueOfflineTravelItem({
    kind: "chat",
    summary: chatTitleFromPrompt(args.promptText) ?? `Offline chat with ${args.body.familiarId}`,
    payload,
  });
  await persistQueuedOfflineConversation({
    sessionId,
    familiarId: args.body.familiarId,
    harness: args.responseMetadata.harness ?? bindingFor(args.config, args.body.familiarId).harness,
    ...(Object.prototype.hasOwnProperty.call(args.responseMetadata, "model")
      ? { model: args.responseMetadata.model ?? undefined }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(args.responseMetadata, "runtime")
      ? { runtime: args.responseMetadata.runtime ?? undefined }
      : {}),
    title: chatTitleFromPrompt(args.promptText) ?? defaultChatTitleForSession(sessionId),
    ...(args.body.origin ? { origin: args.body.origin } : {}),
    createdAt: queued.createdAt,
    userTurn: {
      id: queuedUserTurnId,
      text: args.promptText,
      ...(args.persistedAttachments.length ? { attachments: args.persistedAttachments } : {}),
      ...attentionClearOperationForTurn(args.body.runId),
      ...persistedTurnControls(args.body, args.responseMetadata.retryModel),
      ...(args.body.parentTurnId !== undefined ? { parentId: args.body.parentTurnId } : {}),
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const push = (event: StreamEvent) => controller.enqueue(chatSse(event));
      push({ kind: "session", sessionId });
      push({ kind: "user", text: args.promptText });
      push({
        kind: "progress",
        id: "queued-offline",
        label: "Queued for travel sync",
        status: "done",
        detail: `${travelStatus.reason}: ${queued.id}`,
      });
      push({
        kind: "done",
        isError: false,
        sessionId,
        responseMetadata: args.responseMetadata,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function openClawChatResponse(args: {
  req: Request;
  body: SendBody;
  promptText: string;
  harnessPrompt: string;
  attachments: ChatAttachment[];
  desiredModel: string;
  modelState: ChatModelState;
  initialModelIntent: string | null;
  ownsFirstExchangeTitle: boolean;
}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false;
      // A user "stop" aborts the request while the OpenClaw child is still
      // running; its late `close`/`error` handlers keep calling push after the
      // client stream has been cancelled. Guard every enqueue so those tail
      // events are dropped instead of throwing ERR_INVALID_STATE on a closed
      // controller (mirrors the native coven-run stream below).
      const push = (event: StreamEvent) => {
        // Tee EVERY event through the per-run ring first (cave-h40l): the
        // buffer is what makes a dropped client resumable, so it must see
        // events even after the original transport closed. The returned seq
        // rides the SSE `id:` so live clients always hold a resume cursor.
        const seq = runBuffer?.record(event);
        if (closed || args.req.signal.aborted) return;
        try {
          controller.enqueue(chatSse(event, seq));
        } catch (error) {
          closed = true;
          if (!args.req.signal.aborted) console.warn("Failed to enqueue chat stream event", error);
        }
      };
      let runBuffer: RunBufferHandle | null = null;
      const pushProgress = (
        id: string,
        label: string,
        status: "running" | "done" | "notice" | "error",
        detail?: string,
        durationMs?: number,
      ) =>
        push({
          kind: "progress",
          id,
          label,
          status,
          ...(detail ? { detail } : {}),
          ...(durationMs != null ? { durationMs } : {}),
        });
      const heartbeat = startChatSseHeartbeat(controller, () => closed || args.req.signal.aborted);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already */
        }
      };

      push({ kind: "user", text: args.promptText });

      const startedAt = Date.now();
      // New chats mint their identity here; continuing chats reuse the one
      // the client got back on the first turn. The gateway session is keyed
      // off this id, so it survives OpenClaw's internal session-id rotation.
      const conversationId = args.body.sessionId ?? crypto.randomUUID();
      const ownsFirstExchangeTitle = args.ownsFirstExchangeTitle;
      pushProgress("openclaw-resolve", "Resolving OpenClaw agent", "running");
      let agentBinding;
      try {
        agentBinding = await resolveOpenClawAgentBinding(args.body.familiarId);
      } catch (error) {
        if (error instanceof OpenClawAgentResolutionError) {
          pushProgress("openclaw-resolve", "OpenClaw agent resolution failed", "error", error.message);
          push({ kind: "error", code: error.code, message: error.message });
          push({
            kind: "done",
            durationMs: Date.now() - startedAt,
            isError: true,
          });
          close();
          return;
        }
        throw error;
      }
      const agentId = agentBinding.openclawAgentId;
      pushProgress("openclaw-resolve", "OpenClaw agent resolved", "done", `${agentId} (${agentBinding.source})`);
      let cwd: string;
      try {
        cwd = await resolveLocalRuntimeCwd(
          args.body.projectRoot ??
            (await conversationCwd(args.body.sessionId)) ??
            (await daemonSessionCwd(args.body.sessionId)),
        );
      } catch (error) {
        if (error instanceof RuntimeScopeError) {
          pushProgress("openclaw-start", "OpenClaw bridge not started", "error", error.message);
          push({ kind: "error", code: error.code, message: error.message });
          push({
            kind: "done",
            durationMs: Date.now() - startedAt,
            isError: true,
          });
          close();
          return;
        }
        throw error;
      }
      const responseMetadata: ChatResponseMetadata = {
        familiarId: args.body.familiarId,
        harness: "openclaw",
        model: args.desiredModel,
        runtime: `local:${cwd}`,
        requestedModel: args.body.modelOverride === ""
          ? ""
          : cleanModelId(args.body.modelOverride) ?? undefined,
        desiredModel: args.desiredModel,
        confirmedModel: undefined,
        retryModel: turnRetryModel({ requestedModel: args.body.modelOverride }),
        modelSource: args.modelState.source,
        modelApplicationState: args.modelState.applicationState,
        modelApplicationReason: args.modelState.reason,
        openclawAgentId: agentBinding.openclawAgentId,
        openclawAgentSource: agentBinding.source,
        caveSessionId: conversationId,
        gatewaySessionId: undefined,
        sessionKey: openClawSessionKey(conversationId),
      };

      // Gateway dispatch owns a turn only after it returns the authoritative
      // run id. Until then this branch leaves the existing CLI bridge as the
      // safe compatibility fallback; after a request might have reached the
      // Gateway it deliberately never starts a second CLI turn.
      let gatewayAssistantText = "";
      let gatewayAssistantTextEmitted = false;
      const gatewayToolTracker = new ToolCallTracker(Date.now, "openclaw:");
      let gatewayToolProjectionEnabled = true;
      let gatewayCompatibilityDiagnosticSent = false;
      const settleOpenGatewayTools = (output: string) => {
        for (const tool of gatewayToolTracker.failOpenCalls(output)) {
          push({ kind: "tool_use", ...tool });
        }
      };
      const gatewayAuth = openClawGatewayPairedDeviceAuthStatus();
      const gatewayDispatch = gatewayAuth.available
        ? await dispatchOpenClawGatewayTurn({
        sessionKey: openClawSessionKey(conversationId),
        agentId,
        message: args.harnessPrompt,
        // A direct Gateway turn is only safe when Cave has the caller's
        // stable request id. Reusing it as Gateway's idempotency key makes a
        // retry observable to the Gateway instead of creating another run.
        idempotencyKey: args.body.runId ?? "",
        onEvent: (event) => {
          if (event.kind === "compatibility") {
            if (gatewayToolProjectionEnabled) {
              gatewayToolProjectionEnabled = false;
              settleOpenGatewayTools("[OpenClaw tool activity became incompatible]");
            }
            if (gatewayCompatibilityDiagnosticSent) return;
            gatewayCompatibilityDiagnosticSent = true;
            const fingerprint =
              event.fingerprint && /^[0-9a-f]{16}$/i.test(event.fingerprint)
                ? event.fingerprint.toLowerCase()
                : undefined;
            pushProgress(
              "openclaw-tool-compatibility",
              "OpenClaw tool activity needs an update",
              "notice",
              `${event.code}${fingerprint ? ` (${fingerprint})` : ""}`,
            );
            return;
          }
          if (event.kind === "tool_start" && gatewayToolProjectionEnabled) {
            const rawInput = formatToolInputValue(redactSecretsDeep(event.input));
            const input = rawInput === undefined ? undefined : redactSecretText(rawInput);
            const tool = gatewayToolTracker.envelopeToolUse(
              event.id,
              event.name,
              input,
              gatewayAssistantText.length,
            );
            if (tool) push({ kind: "tool_use", ...tool });
            const pendingProgress = gatewayToolTracker.consumePendingEnvelopeProgress(event.id);
            if (pendingProgress) push({ kind: "tool_use", ...pendingProgress });
            const pendingResult = gatewayToolTracker.consumePendingEnvelopeResult(event.id);
            if (pendingResult) push({ kind: "tool_use", ...pendingResult });
            return;
          }
          if (event.kind === "tool_progress" && gatewayToolProjectionEnabled) {
            const safeOutput = redactSecretsDeep(event.output);
            const rawOutput = flattenToolResultContent(safeOutput) ?? formatToolInputValue(safeOutput);
            const output = rawOutput === undefined ? undefined : redactSecretText(rawOutput);
            const tool = gatewayToolTracker.envelopeToolProgress(
              event.id,
              output,
            );
            if (tool) push({ kind: "tool_use", ...tool });
            return;
          }
          if (event.kind === "tool_end" && gatewayToolProjectionEnabled) {
            const safeOutput = redactSecretsDeep(event.output);
            const rawOutput = flattenToolResultContent(safeOutput) ?? formatToolInputValue(safeOutput);
            const output = rawOutput === undefined ? undefined : redactSecretText(rawOutput);
            const tool = gatewayToolTracker.envelopeToolResult(
              event.id,
              output,
              event.isError,
            );
            if (tool) {
              push({ kind: "tool_use", ...tool });
              return;
            }
            if (!gatewayToolTracker.hasSettledEnvelopeId(event.id)) {
              const started = gatewayToolTracker.envelopeToolUse(
                event.id,
                event.name,
                undefined,
                gatewayAssistantText.length,
              );
              if (started) push({ kind: "tool_use", ...started });
              const pendingProgress = gatewayToolTracker.consumePendingEnvelopeProgress(event.id);
              if (pendingProgress) push({ kind: "tool_use", ...pendingProgress });
              const pendingResult = gatewayToolTracker.consumePendingEnvelopeResult(event.id);
              if (pendingResult) push({ kind: "tool_use", ...pendingResult });
            }
            return;
          }
          if (event.kind === "status") {
            pushProgress("openclaw-gateway", "OpenClaw Gateway", "running", event.phase);
            return;
          }
          if (event.kind === "delta") {
            if (event.replace) {
              const correction = toolTextCorrection(gatewayAssistantText, event.text);
              if (correction) {
                gatewayToolTracker.rebaseTextOffsets(correction.after, correction.delta);
              }
              gatewayAssistantText = event.text;
              gatewayAssistantTextEmitted = true;
              push({
                kind: "assistant_replace",
                text: event.text,
                ...(correction ? { toolOffsetCorrection: correction } : {}),
              });
              return;
            }
            gatewayAssistantText += event.text;
            gatewayAssistantTextEmitted = true;
            push({ kind: "assistant_chunk", text: event.text });
            return;
          }
          if (event.kind === "final" && event.text) {
            if (gatewayAssistantText !== event.text) {
              const correction = toolTextCorrection(gatewayAssistantText, event.text);
              if (correction) {
                gatewayToolTracker.rebaseTextOffsets(correction.after, correction.delta);
              }
              if (gatewayAssistantTextEmitted) {
                push({
                  kind: "assistant_replace",
                  text: event.text,
                  ...(correction ? { toolOffsetCorrection: correction } : {}),
                });
              }
            }
            gatewayAssistantText = event.text;
          }
          if (event.kind === "error") {
            settleOpenGatewayTools("[tool did not settle before the Gateway turn ended]");
            pushProgress("openclaw-gateway", "OpenClaw Gateway", "error", event.message);
          }
        },
      })
        : { kind: "unavailable" as const, reason: gatewayAuth.reason ?? "Gateway paired-device authentication is unavailable" };
      if (gatewayDispatch.kind === "indeterminate") {
        pushProgress("openclaw-gateway", "OpenClaw Gateway dispatch is indeterminate", "error", gatewayDispatch.reason);
        push({ kind: "error", code: "openclaw_gateway_indeterminate", message: gatewayDispatch.reason });
        push({ kind: "done", durationMs: Date.now() - startedAt, isError: true, responseMetadata });
        close();
        return;
      }
      if (gatewayDispatch.kind === "accepted") {
        responseMetadata.gatewaySessionId = gatewayDispatch.runId;
        pushProgress("openclaw-gateway", "OpenClaw Gateway dispatch accepted", "done", `run ${gatewayDispatch.runId}`);
        const pendingUserTurnId = crypto.randomUUID();
        const stubTitle = ownsFirstExchangeTitle
          ? chatSummaryTitle({ userText: args.promptText }) ?? defaultChatTitleForSession(conversationId)
          : defaultChatTitleForSession(conversationId);
        const stubWrite = createConversationStub({
          sessionId: conversationId,
          familiarId: args.body.familiarId,
          harness: "openclaw",
          ...(responseMetadata.model ? { model: responseMetadata.model } : {}),
          ...(responseMetadata.runtime ? { runtime: responseMetadata.runtime } : {}),
          title: stubTitle,
          ...(args.body.origin ? { origin: args.body.origin } : {}),
          modelIntent: modelIntentForSend(args.body, args.modelState),
          userTurn: {
            id: pendingUserTurnId,
            text: args.promptText,
            ...(args.attachments.length ? { attachments: args.attachments } : {}),
            ...attentionClearOperationForTurn(args.body.runId),
            ...persistedTurnControls(args.body, responseMetadata.retryModel),
          },
        }).then(async (created) => {
          if (created && ownsFirstExchangeTitle) {
            await setDefaultStubTitleAuto(conversationId, stubTitle);
          }
          return created;
        }).catch(() => false);
        const abortGateway = (toolOutcome: string) => {
          settleOpenGatewayTools(toolOutcome);
          void gatewayDispatch.abort();
        };
        const stopGateway = () => abortGateway("[tool cancelled by user]");
        const stopDetachedGateway = () => abortGateway("[tool did not settle before the Gateway turn ended]");
        const runHandle = registerChatRun([args.body.runId, conversationId], stopGateway);
        let detachKillTimer: ReturnType<typeof setTimeout> | null = null;
        let detachTimeoutFired = false;
        const armDetachKill = () => {
          if (runHandle.stopRequested || detachKillTimer != null) return;
          detachKillTimer = setTimeout(() => {
            detachTimeoutFired = true;
            stopDetachedGateway();
          }, CHAT_DETACH_MAX_MS);
        };
        runBuffer = openRunBuffer([args.body.runId, conversationId], {
          attach: () => {
            if (detachKillTimer != null) {
              clearTimeout(detachKillTimer);
              detachKillTimer = null;
            }
          },
          detach: () => {
            if (args.req.signal.aborted) armDetachKill();
          },
        });
        const onAbort = () => armDetachKill();
        args.req.signal.addEventListener("abort", onAbort, { once: true });
        pushProgress("openclaw-response", "Waiting for OpenClaw Gateway response", "running");
        const gatewayResult = await gatewayDispatch.done;
        markChatRunTransportSettled(runHandle);
        settleOpenGatewayTools(
          runHandle.stopRequested
            ? "[tool cancelled by user]"
            : "[tool did not settle before the Gateway turn ended]",
        );
        args.req.signal.removeEventListener("abort", onAbort);
        if (detachKillTimer != null) clearTimeout(detachKillTimer);
        const durationMs = Date.now() - startedAt;
        const gatewayOutcome = resolveOpenClawGatewayOutcome(
          gatewayResult,
          runHandle.stopRequested,
          detachTimeoutFired,
        );
        const { cancelledByUser } = gatewayOutcome;
        let { isError } = gatewayOutcome;
        if (!gatewayAssistantText.trim()) {
          gatewayAssistantText = gatewayOutcome.emptyText;
        }
        pushProgress(
          "openclaw-response",
          isError ? "OpenClaw Gateway response failed" : "OpenClaw Gateway response received",
          isError ? "error" : "done",
          gatewayOutcome.progressMessage,
          durationMs,
        );
        push({ kind: "session", sessionId: conversationId });
        if (!gatewayAssistantTextEmitted) push({ kind: "assistant_chunk", text: gatewayAssistantText });
        try {
          pushProgress("save-transcript", "Saving transcript", "running");
          await recordSessionFamiliar(conversationId, args.body.familiarId);
          await stubWrite;
          const existing = await loadConversation(conversationId);
          const hadFirstTurnStub = existing ? stripConversationStubTurn(existing, pendingUserTurnId) : false;
          const isFirstExchange =
            ownsFirstExchangeTitle && (!existing || hadFirstTurnStub);
          const now = new Date().toISOString();
          const chatTitle = existing?.title ?? defaultChatTitleForSession(conversationId);
          if (!existing && ownsFirstExchangeTitle) {
            await setDefaultStubTitleAuto(conversationId, chatTitle);
          }
          const branchParentId =
            args.body.parentTurnId !== undefined ? args.body.parentTurnId : existing?.activeLeafId ?? null;
          const conv = existing ?? {
            sessionId: conversationId,
            familiarId: args.body.familiarId,
            harness: "openclaw",
            model: responseMetadata.model,
            runtime: responseMetadata.runtime,
            title: chatTitle,
            ...(args.body.origin ? { origin: args.body.origin } : {}),
            createdAt: now,
            updatedAt: now,
            turns: [],
          };
          conv.model = responseMetadata.model;
          conv.runtime = responseMetadata.runtime;
          persistSendModelIntent(
            conv,
            args.body,
            args.modelState,
            args.initialModelIntent,
          );
          const workBranch = await captureWorkBranch(cwdFromConversationRuntime(conv.runtime));
          if (workBranch) conv.branch = workBranch;
          const reportedPrUrl = latestPrUrlFromText(gatewayAssistantText);
          if (reportedPrUrl) conv.prUrl = reportedPrUrl;
          const assistantTurnId = crypto.randomUUID();
          const assistantCreatedAt = new Date().toISOString();
          const leadingTrimShift =
            gatewayAssistantText.length - gatewayAssistantText.trimStart().length;
          const persistedGatewayTools = toPersistedTools(
            gatewayToolTracker.snapshot(),
            leadingTrimShift,
          );
          const gatewayAttention = prepareAttentionRequest({
            text: gatewayAssistantText,
            sessionId: conversationId,
            turnId: assistantTurnId,
            requestedAt: assistantCreatedAt,
            incomplete: cancelledByUser || isError,
          });
          conv.turns.push(
            {
              id: pendingUserTurnId,
              role: "user",
              text: args.promptText,
              ...(args.attachments.length ? { attachments: args.attachments } : {}),
              ...attentionClearOperationForTurn(args.body.runId),
              ...persistedTurnControls(args.body, responseMetadata.retryModel),
              createdAt: now,
              ...(branchParentId != null ? { parentId: branchParentId } : {}),
            },
            {
              id: assistantTurnId,
              role: "assistant",
              text: gatewayAttention.text.trim(),
              ...(gatewayAttention.reasoning ? { reasoning: gatewayAttention.reasoning } : {}),
              createdAt: assistantCreatedAt,
              durationMs,
              isError,
              parentId: pendingUserTurnId,
              responseMetadata: gatewayAttention.request
                ? { ...responseMetadata, attentionRequest: gatewayAttention.request }
                : responseMetadata,
              ...(persistedGatewayTools ? { tools: persistedGatewayTools } : {}),
              ...(cancelledByUser ? { cancelled: true } : {}),
            },
          );
          conv.activeLeafId = assistantTurnId;
          await saveConversation(conv);
          if (isFirstExchange && !isError) await autoNameSessionFromFirstExchange(conversationId, args.promptText);
          if (!isError) await maybeAutoRenameFromContext(conversationId, args.promptText);
          pushProgress("save-transcript", "Transcript saved", "done");
        } catch {
          isError = true;
          pushProgress("save-transcript", "Transcript save failed", "error");
          push({ kind: "error", code: "transcript_save_failed", message: "Cave could not save the transcript." });
        }
        markChatRunProjectionSettled(runHandle);
        unregisterChatRun(runHandle);
        push({
          kind: "done",
          durationMs,
          isError,
          sessionId: conversationId,
          ...(cancelledByUser ? { cancelled: true } : {}),
          responseMetadata,
        });
        gatewayDispatch.close();
        runBuffer?.finish();
        await sleep(20);
        close();
        return;
      }
      const openclawLaunch = openClawLaunchCommand();
      const openclawEnv = openClawSpawnEnv();
      const openclawAvailability = evaluateRuntimeAvailability({
        runner: "openclaw",
        command: openclawLaunch.command,
        env: openclawEnv,
        requiredFiles: openclawLaunch.requiredFiles,
        unresolvedWindowsShim: openclawLaunch.unresolvedWindowsShim === true,
        cwd,
      });
      if (openclawAvailability.state !== "ready") {
        pushProgress(
          "openclaw-start",
          "OpenClaw bridge not started",
          "error",
          openclawAvailability.message,
        );
        push({
          kind: "error",
          code: openclawAvailability.code,
          message: openclawAvailability.message,
        });
        push({
          kind: "done",
          durationMs: Date.now() - startedAt,
          isError: true,
        });
        close();
        return;
      }
      let executionMode = openClawCliExecutionMode();
      let child: ReturnType<typeof spawn> | null = null;
      let stdout = "";
      let stderr = "";
      let terminal = false;
      let localRecoveryAttempted = false;
      const spawnChild = (mode: "gateway" | "local") => {
        const argv = openClawAgentArgs(args.harnessPrompt, agentId, conversationId, mode);
        return spawn(/* turbopackIgnore: true */ openclawLaunch.command, [...openclawLaunch.fixedArgs, ...argv], {
          windowsHide: true,
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: openclawEnv,
          shell: false,
        });
      };
      const killChild = () => {
        try {
          child?.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };
      // Deliberate Stop arrives via /api/chat/stop (which kills through this
      // registration); a bare transport abort means the client vanished — let
      // the turn finish server-side so resync recovers the full reply, bounded
      // by the detach cap in case nothing ever comes back for it.
      const runHandle = registerChatRun([args.body.runId, conversationId], killChild);
      let detachKillTimer: ReturnType<typeof setTimeout> | null = null;
      const armDetachKill = () => {
        if (runHandle.stopRequested || detachKillTimer != null) return;
        detachKillTimer = setTimeout(killChild, CHAT_DETACH_MAX_MS);
      };
      // Re-attach (GET /api/chat/stream) cancels the pending kill; the last
      // tail dropping re-arms it — but only once the ORIGINAL request is
      // gone, so a resume tail closing can't kill a still-attached turn.
      runBuffer = openRunBuffer([args.body.runId, conversationId], {
        attach: () => {
          if (detachKillTimer != null) {
            clearTimeout(detachKillTimer);
            detachKillTimer = null;
          }
        },
        detach: () => {
          if (args.req.signal.aborted) armDetachKill();
        },
      });
      const onAbort = () => armDetachKill();
      args.req.signal.addEventListener("abort", onAbort, { once: true });

      // First-turn visibility (cave-0g2x): the OpenClaw path knows its
      // conversation id up front, so persist the stub (and the default title)
      // as soon as the bridge is running — the sessions list can surface the
      // chat during its entire first turn. Best-effort; a no-op for resumed
      // chats. The close handler strips the stub turn and re-appends the
      // authoritative one under the same id.
      const pendingUserTurnId = crypto.randomUUID();
      const stubTitle = ownsFirstExchangeTitle
        ? chatSummaryTitle({ userText: args.promptText }) ?? defaultChatTitleForSession(conversationId)
        : defaultChatTitleForSession(conversationId);
      const stubWrite = createConversationStub({
        sessionId: conversationId,
        familiarId: args.body.familiarId,
        harness: "openclaw",
        ...(responseMetadata.model ? { model: responseMetadata.model } : {}),
        ...(responseMetadata.runtime ? { runtime: responseMetadata.runtime } : {}),
        title: stubTitle,
        ...(args.body.origin ? { origin: args.body.origin } : {}),
        modelIntent: modelIntentForSend(args.body, args.modelState),
        userTurn: {
          id: pendingUserTurnId,
          text: args.promptText,
          ...(args.attachments.length ? { attachments: args.attachments } : {}),
          ...attentionClearOperationForTurn(args.body.runId),
          ...persistedTurnControls(args.body, responseMetadata.retryModel),
        },
      }).then(async (created) => {
        if (created && ownsFirstExchangeTitle) {
          await setDefaultStubTitleAuto(conversationId, stubTitle);
        }
        return created;
      }).catch(() => false);

      const failChild = (err: NodeJS.ErrnoException) => {
        if (terminal) return;
        terminal = true;
        markChatRunTransportSettled(runHandle);
        const failure = localRuntimeLaunchError("openclaw", err.code);
        pushProgress("openclaw-response", "OpenClaw bridge failed", "error", failure.message);
        push({ kind: "error", code: failure.code, message: failure.message });
        push({
          kind: "done",
          durationMs: Date.now() - startedAt,
          isError: true,
          responseMetadata,
        });
        args.req.signal.removeEventListener("abort", onAbort);
        if (detachKillTimer != null) clearTimeout(detachKillTimer);
        markChatRunProjectionSettled(runHandle);
        unregisterChatRun(runHandle);
        runBuffer?.finish();
        close();
      };
      const attachChild = (launchedChild: ReturnType<typeof spawn>) => {
        launchedChild.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });
        launchedChild.stderr?.on("data", (data: Buffer) => {
          stderr += stripAnsi(data.toString("utf8"));
        });
        launchedChild.on("error", failChild);
        launchedChild.on("close", (code) => {
          void finalizeChild(code);
        });
      };
      async function finalizeChild(code: number | null) {
        if (terminal) return;
        const cancelledByUser = runHandle.stopRequested;
        if (
          !cancelledByUser &&
          executionMode === "gateway" &&
          !localRecoveryAttempted &&
          code !== 0 &&
          !stdout.trim() &&
          isOpenClawGatewayCredentialFailure(stderr)
        ) {
          // The CLI proved it never owned a Gateway turn: its own credential
          // gate rejected the connection before assistant output. Keep valid
          // paired/remote Gateway routing on the first attempt, then recover
          // a local-only installation with one embedded retry.
          localRecoveryAttempted = true;
          executionMode = "local";
          stdout = "";
          stderr = "";
          pushProgress(
            "openclaw-local-retry",
            "Gateway CLI is unavailable; retrying embedded local OpenClaw",
            "running",
          );
          child = spawnChild(executionMode);
          attachChild(child);
          pushProgress("openclaw-local-retry", "Embedded local OpenClaw started", "done");
          return;
        }
        terminal = true;
        markChatRunTransportSettled(runHandle);
        args.req.signal.removeEventListener("abort", onAbort);
        if (detachKillTimer != null) clearTimeout(detachKillTimer);
        const durationMs = Date.now() - startedAt;
        // Identity stays cave-owned: the gateway's internal session id is
        // surfaced as diagnostics only, never adopted as the conversation
        // key (adopting it forked the chat whenever the id rotated).
        const sessionId: string = conversationId;
        let gatewaySessionId: string | null = null;
        let assistantText = "";
        let isError = code !== 0;

        pushProgress(
          "openclaw-response",
          code === 0 ? "OpenClaw response received" : "OpenClaw bridge exited with an issue",
          code === 0 ? "done" : "error",
          code == null ? undefined : `exit ${code}`,
          durationMs,
        );

        // User cancel (CHAT-D5-02): a deliberate Stop (/api/chat/stop)
        // SIGTERMs the bridge, so stdout is usually empty or truncated JSON.
        // Persist an honest cancelled marker — never raw truncated output or
        // the fabricated "returned no text" error diagnostic. A bare transport
        // abort is NOT a cancel: the turn ran to completion above and persists
        // as a normal reply the client recovers on resync.
        if (cancelledByUser) {
          assistantText = "(cancelled)";
          isError = false;
        } else if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as OpenClawAgentJson;
            if (!hasValidOpenClawPayloadEnvelope(parsed)) throw new Error("invalid OpenClaw payload envelope");
            gatewaySessionId = extractOpenClawSessionId(parsed);
            if (gatewaySessionId) responseMetadata.gatewaySessionId = gatewaySessionId;
            assistantText = extractOpenClawText(parsed);
            isError = isError || parsed.status === "error";
          } catch {
            // Never persist raw bridge output: it can contain prompts, paths,
            // or secrets. Keep the fixed diagnostic, then fall through to the
            // normal close/finalization path.
            isError = true;
            assistantText = "The OpenClaw bridge emitted an invalid response.";
            pushProgress(
              "openclaw-protocol",
              "OpenClaw response was malformed",
              "error",
              "The bridge emitted an invalid response.",
            );
          }
        }
        if (gatewaySessionId) {
          pushProgress(
            "openclaw-session",
            "Gateway session",
            "done",
            `key ${openClawSessionKey(conversationId)} · id ${gatewaySessionId}`,
          );
        }

        if (!cancelledByUser && !assistantText.trim()) {
          const tail = stderr
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-5)
            .join("\n");
          assistantText = tail
            ? `_The "openclaw" agent bridge returned no text._\n\n\`\`\`\n${tail}\n\`\`\``
            : `_The "openclaw" agent bridge returned no text._`;
          isError = true;
        }

        if (sessionId) push({ kind: "session", sessionId });
        push({ kind: "assistant_chunk", text: assistantText });

        if (sessionId) {
          try {
            pushProgress("save-transcript", "Saving transcript", "running");
            await recordSessionFamiliar(sessionId, args.body.familiarId);
            // Settle the spawn-time stub write first so it can never race (and
            // clobber) the authoritative transcript saved below.
            await stubWrite;
            const isFirstExchange = await withConversationLock(sessionId, async () => {
              const existing = await loadConversation(sessionId);
              // First-turn visibility (cave-0g2x): drop the spawn-time stub turn
              // so the authoritative user turn below re-lands under the same id.
              const hadFirstTurnStub = existing
                ? stripConversationStubTurn(existing, pendingUserTurnId)
                : false;
              const firstExchange =
                ownsFirstExchangeTitle && (!existing || hadFirstTurnStub);
              const now = new Date().toISOString();
              const userTurnId = pendingUserTurnId;
              const assistantTurnId = crypto.randomUUID();
              const chatTitle = existing?.title ?? defaultChatTitleForSession(sessionId);
              if (!existing && ownsFirstExchangeTitle) {
                await setDefaultStubTitleAuto(sessionId, chatTitle);
              }
              const branchParentId =
                args.body.parentTurnId !== undefined
                  ? args.body.parentTurnId
                  : existing?.activeLeafId ?? null;
              const conv = existing ?? {
                sessionId,
                familiarId: args.body.familiarId,
                harness: "openclaw",
                model: responseMetadata.model,
                runtime: responseMetadata.runtime,
                title: chatTitle,
                ...(args.body.origin ? { origin: args.body.origin } : {}),
                createdAt: now,
                updatedAt: now,
                turns: [],
              };
              conv.model = responseMetadata.model;
              conv.runtime = responseMetadata.runtime;
              persistSendModelIntent(
                conv,
                args.body,
                args.modelState,
                args.initialModelIntent,
              );
              const workBranch = await captureWorkBranch(cwdFromConversationRuntime(conv.runtime));
              if (workBranch) conv.branch = workBranch;
              const reportedPrUrl = latestPrUrlFromText(assistantText);
              if (reportedPrUrl) conv.prUrl = reportedPrUrl;
              const assistantCreatedAt = new Date().toISOString();
              const nativeAttention = prepareAttentionRequest({
                text: assistantText,
                sessionId,
                turnId: assistantTurnId,
                requestedAt: assistantCreatedAt,
                incomplete: cancelledByUser || isError,
              });
              conv.turns.push(
                {
                  id: userTurnId,
                  role: "user",
                  text: args.promptText,
                  ...(args.attachments.length ? { attachments: args.attachments } : {}),
                  ...attentionClearOperationForTurn(args.body.runId),
                  ...persistedTurnControls(args.body, responseMetadata.retryModel),
                  createdAt: now,
                  ...(branchParentId != null ? { parentId: branchParentId } : {}),
                },
                {
                  id: assistantTurnId,
                  role: "assistant",
                  text: nativeAttention.text.trim(),
                  ...(nativeAttention.reasoning ? { reasoning: nativeAttention.reasoning } : {}),
                  createdAt: assistantCreatedAt,
                  durationMs,
                  isError,
                  parentId: userTurnId,
                  responseMetadata: nativeAttention.request
                    ? { ...responseMetadata, attentionRequest: nativeAttention.request }
                    : responseMetadata,
                  ...(cancelledByUser ? { cancelled: true } : {}),
                },
              );
              conv.activeLeafId = assistantTurnId;
              await saveConversation(conv);
              return firstExchange;
            });
            if (isFirstExchange && !isError) {
              await autoNameSessionFromFirstExchange(sessionId, args.promptText);
            }
            if (!isError) await maybeAutoRenameFromContext(sessionId, args.promptText);
            pushProgress("save-transcript", "Transcript saved", "done");
          } catch {
            isError = true;
            pushProgress("save-transcript", "Transcript save failed", "error");
            push({ kind: "error", code: "transcript_save_failed", message: "Cave could not save the transcript." });
          }
        }

        markChatRunProjectionSettled(runHandle);
        unregisterChatRun(runHandle);
        push({
          kind: "done",
          durationMs,
          isError,
          sessionId: sessionId ?? undefined,
          responseMetadata,
        });
        runBuffer?.finish();
        await sleep(20);
        close();
      }
      pushProgress("openclaw-start", "Starting OpenClaw bridge", "running", cwd);
      child = spawnChild(executionMode);
      attachChild(child);
      pushProgress("openclaw-start", "OpenClaw bridge started", "done");
      pushProgress("openclaw-response", "Waiting for OpenClaw response", "running");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid json body" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }
  // `req.json()` happily returns a top-level string/number/boolean/null/array
  // for valid-but-non-object JSON. `SendBody` assumes an object, so the very
  // next line used to mutate it (`body.runId = ...`) — which throws a
  // TypeError on a primitive (strict-mode property assignment) instead of the
  // normal 400 below. Reject any non-object root before any mutation.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid json body" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }
  body.runId = normalizeChatAttentionOperationId(
    (body as { runId?: unknown }).runId,
  ) ?? undefined;
  const attachments = normalizeChatAttachments(body.attachments);
  const promptText = body.prompt?.trim() ?? "";
  if (!body.familiarId || (!promptText && attachments.length === 0)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "familiarId and prompt or attachments are required",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  // Model ids are untrusted input. Reject malformed or flag-shaped values at
  // the send boundary before capability probes or any runtime can spawn. The
  // empty string is the explicit runtime-default sentinel, not a model id.
  const hasModelOverride = Object.prototype.hasOwnProperty.call(body, "modelOverride");
  const requestedModel = body.modelOverride === ""
    ? ""
    : cleanModelId(body.modelOverride) ?? undefined;
  if (hasModelOverride && body.modelOverride !== "" && !requestedModel) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "invalid_model_override",
        error: "modelOverride must be a safe model id",
        modelApplicationState: "rejected",
        modelApplicationReason: "The selected model id failed launch-boundary validation.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const rawModelOverrideScope = (body as { modelOverrideScope?: unknown }).modelOverrideScope;
  if (!isModelOverrideScope(rawModelOverrideScope)) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "invalid_model_scope",
        error: "modelOverrideScope is not supported",
        modelApplicationState: "rejected",
        modelApplicationReason: "The model override scope must be next-message, session, or runtime-default.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  if (
    body.modelOverrideScope === "runtime-default" &&
    body.modelOverride !== undefined &&
    body.modelOverride !== ""
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "invalid_model_scope",
        error: "runtime-default scope cannot carry a model id",
        modelApplicationState: "rejected",
        modelApplicationReason: "Runtime-owned defaults are represented by omitting the model id.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  if (!isValidModelOverrideIntent(body)) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "invalid_model_scope",
        error: "modelOverride and modelOverrideScope must describe one complete intent",
        modelApplicationState: "rejected",
        modelApplicationReason: "Explicit model ids require session or next-message scope; clearing requires a runtime-default scope.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  // Persisted transcripts keep attachment metadata only — base64 image
  // payloads stay out of the conversation store. Images additionally get a
  // durable copy in the attachment store, and the transcript records its id,
  // so reopening the thread can show the picture again instead of degrading
  // to a filename chip (cave-cysu4).
  const persistedAttachments = await persistImageAttachments(
    stripPreviewOnlyAttachmentFields(attachments),
    attachments,
  );

  const config = await loadConfig();
  const binding = bindingFor(config, body.familiarId);
  const existingConversation = body.sessionId
    ? await loadConversation(body.sessionId).catch(() => null)
    : null;
  // Canonicalize the bound harness id up front so a familiar carrying a
  // package/alias id (e.g. "hermes-agent" for Hermes) is recognized as the
  // trusted "hermes" adapter — otherwise the trust gate below 403s and `coven
  // run` is invoked with an unknown harness name. Every downstream check and
  // the spawn use this canonical id.
  binding.harness = canonicalHarnessId(binding.harness);
  if (existingConversation && existingConversation.familiarId !== body.familiarId) {
    return new Response(
      JSON.stringify({ ok: false, error: "not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  // On resume, the persisted conversation is the execution contract: a later
  // familiar edit must not silently move an in-progress OpenClaw (or other
  // runtime) conversation to a different harness. The trust gate below still
  // rejects any malformed legacy value.
  if (existingConversation) {
    binding.harness = canonicalHarnessId(existingConversation.harness);
  }
  // Native Board handoffs reserve Cave's conversation id before the harness
  // writes its transcript. Bind that pre-transcript id to the server-owned
  // task card now, so a caller cannot use another familiar's reserved task.
  const taskCard = await taskCardForSession(body.sessionId);
  if (taskCard && taskCard.familiarId !== body.familiarId) {
    return new Response(
      JSON.stringify({ ok: false, error: "not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  // A submitted stable id is resume provenance even when its transcript still
  // exists only in the daemon. Board is the sole exception: it reserves Cave's
  // id before dispatching the first native-chat turn.
  const ownsFirstExchangeTitle =
    body.sessionId == null ||
    (
      body.startNewConversation === true &&
      existingConversation == null &&
      taskCard != null
    );
  // Host picker: an explicit allowed host wins; with no request, a conversation
  // recorded on an allowed ssh host stays pinned there; only then does the
  // familiar's own runtime binding decide. Unregistered hosts are rejected
  // fail-closed — inherited familiar runtimes are scoped to the current
  // familiar so one familiar cannot borrow another familiar's SSH binding.
  const runtimeSelection = resolveRequestedRuntime({
    requestedHost: body.runtimeHost,
    conversationRuntime: existingConversation?.runtime,
    registry: sshHostRegistry({
      remoteHosts: config.remoteHosts,
      familiarRuntimes: [config.defaults?.runtime, binding.runtime],
    }),
    currentRuntime: binding.runtime,
  });
  if (!runtimeSelection.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: runtimeSelection.error }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const effectiveRuntime = runtimeSelection.runtime ?? binding.runtime;
  const sshRuntime = isSshRuntime(effectiveRuntime) ? effectiveRuntime : null;
  if (binding.hasInvalidHermesProfileBinding) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "This familiar's Hermes profile binding is invalid. Choose a saved Hermes profile again before starting a chat.",
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }
  if (binding.hermesProfile && (binding.harness !== "hermes" || sshRuntime)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "This Hermes profile is local-only. Choose the local runtime so Cave can launch it with its explicit profile target.",
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }
  // Grok Build is a direct local integration. Do not silently send it through
  // `coven run --stream-json` on SSH: its native JSONL/session protocol is
  // different and Cave does not yet have an equivalent direct SSH bridge.
  if (binding.harness === "grok" && sshRuntime) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Grok Build chats currently run on this Cave host. Select a local runtime; SSH Grok is not routed through coven run.",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }
  // Hermes, Grok Build, OpenCode, and compatible Copilot clients run directly.
  // Resolve their passive launch vehicles before asking any of those binaries
  // (or the generic Coven transport) about optional capabilities.
  // OpenClaw's bridge has no CLI model passthrough; every other bundled
  // harness uses coven run's capability probe.
  const hermesDirect = !sshRuntime && binding.harness === "hermes";
  const openCodeDirect = !sshRuntime && binding.harness === "opencode";
  const grokDirect = !sshRuntime && binding.harness === "grok";
  const copilotDirect = !sshRuntime && binding.harness === "copilot";
  const copilotPluginDirs = copilotDirect
    ? await resolveBundledCopilotPluginDirs()
    : [];
  // Cave's Read-only control is a security promise, not a prompt hint.
  // OpenCode's one-shot CLI exposes no read-only/sandbox flag, so do not even
  // run its capability probes with the familiar-scoped credentials here.
  if (openCodeDirect && body.permissionMode === "read") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "OpenCode does not support Cave's Read-only mode yet. Switch Access to Full access to run it.",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }

  // Tool activity from Hermes is only reliable over its documented structured
  // API. The quiet CLI mode intentionally hides terminal tool previews, so it
  // remains an explicit plain-text fallback when no API server is configured.
  // Build its environment once: API configuration and any CLI fallback must
  // observe the same familiar-scoped values.
  const hermesSpawnEnvironment = hermesDirect
    ? harnessSpawnEnv(body.familiarId)
    : null;
  // Hermes's documented `-p` flag scopes the CLI process before its modules
  // load, which sets the profile's HERMES_HOME without mutating `profile use`.
  // A configured Responses endpoint has no equivalent profile selector, so a
  // profile-bound familiar deliberately uses the CLI rather than risk talking
  // to an API server for the sticky/default profile.
  const hermesApi = !binding.hermesProfile && hermesSpawnEnvironment
    ? hermesApiConfig(hermesSpawnEnvironment as {
        HERMES_API_URL?: string;
        HERMES_API_KEY?: string;
      })
    : null;

  // Resolve the direct plan in the exact familiar-scoped environment passed to
  // the child. The resolver owns bounded PATH discovery so a cold desktop
  // login-shell lookup cannot consume the launch-plan verification budget.
  // The capability probe scrubs credentials only for `--version`; it must never
  // discover a different launcher than the model spawn uses.
  const copilotManifestStream = copilotDirect ? copilotStreamSpec() : null;
  const copilotRuntimeLaunch = copilotManifestStream
    ? await resolveCopilotRuntimeLaunch(copilotManifestStream.executable, {
        spawnEnv: (discoveryDeadline) =>
          harnessSpawnEnv(body.familiarId, { discoveryDeadline }),
      })
    : null;
  const copilotCapability = copilotManifestStream && copilotRuntimeLaunch
    ? copilotRuntimeLaunch.availability.state === "ready"
      ? await probeCopilotCapability(copilotManifestStream.executable, {
          resolveRuntimeLaunch: async () => copilotRuntimeLaunch,
        })
      : {
          version: null,
          availability: copilotRuntimeLaunch.availability,
        }
    : null;
  const copilotRouting = await prepareCopilotChatRouting({
    harness: binding.harness,
    isSshRuntime: Boolean(sshRuntime),
    probe: async () => copilotCapability,
    resolveCompatibility: () => resolveRuntimeCompatibility("copilot"),
  });
  const copilotStream = copilotRouting.spec;

  // Codex tool activity (cave-53iko.1): a verified local Codex CLI streams
  // its native `codex exec --json` JSONL directly, so tool lifecycles reach
  // the chat as structured events. Every unverified, remote, prerelease, or
  // resume-incapable combination retains the existing filtered
  // `coven run codex` transport unchanged.
  const codexResumeTarget =
    binding.harness === "codex" &&
    body.sessionId &&
    !(body.startNewConversation && !existingConversation)
      ? existingConversation?.harnessSessionId ?? body.sessionId
      : null;
  const codexSpawnEnv =
    !sshRuntime && binding.harness === "codex" ? harnessSpawnEnv(body.familiarId) : null;
  const codexDirectLaunch = codexSpawnEnv
    ? (() => {
        try {
          return codexLaunchCommand();
        } catch {
          // A missing Windows CLI has no safe bare-name fallback. Preserve the
          // existing Coven-backed route, whose adapter preflight reports the
          // actionable missing-runtime diagnostic without spawning from cwd.
          return null;
        }
      })()
    : null;
  // The same passive availability contract every direct runner uses. The
  // bounded capability probe below only runs against a launch-ready plan,
  // mirroring how Copilot gates its capability probe on launch readiness.
  const codexLaunchAvailability =
    codexDirectLaunch && codexSpawnEnv
      ? evaluateRuntimeAvailability({
          runner: "codex",
          command: codexDirectLaunch.command,
          env: codexSpawnEnv,
          unresolvedWindowsShim: codexDirectLaunch.unresolvedWindowsShim === true,
        })
      : null;
  const codexRouting = await prepareCodexChatRouting({
    harness: binding.harness,
    isSshRuntime: Boolean(sshRuntime),
    resumeSessionId: codexResumeTarget,
    // TTL-cached, single-flight discovery in the scrubbed probe environment:
    // provider/vault secrets never reach `codex --version` / `--help`.
    probe: async () =>
      codexDirectLaunch && codexSpawnEnv && codexLaunchAvailability?.state === "ready"
        ? discoverCachedCodexRuntime(
            { command: codexDirectLaunch.command, fixedArgs: codexDirectLaunch.fixedArgs },
            undefined,
            codexProbeEnv(codexSpawnEnv),
          )
        : null,
    resolveSources: () => productionCodexSchemaSources(),
  });
  const codexDirect = codexRouting.mode === "direct";
  const codexSchema = codexRouting.mode === "direct" ? codexRouting.schema : null;
  const codexDirectCapabilities =
    codexRouting.mode === "direct" ? codexRouting.report.capabilities : null;

  let localRuntimePlan: LocalRuntimePlan | null = null;
  // Preserve the actual `coven adapter list --json` preflight result for a
  // later silent-exit record. A direct Codex probe is not adapter evidence.
  let codexFallbackAdapterAvailability: RuntimeAvailability | null = null;
  if (!sshRuntime && binding.harness !== "openclaw" && !(hermesDirect && hermesApi)) {
    if (
      copilotRuntimeLaunch &&
      (
        copilotRuntimeLaunch.availability.state !== "ready"
        || copilotStream
        || copilotRouting.mode === "blocked"
      )
    ) {
      localRuntimePlan = createLocalRuntimePlan({
        runner: "copilot",
        launch: copilotRuntimeLaunch,
        env: copilotRuntimeLaunch.env,
        availability: copilotRouting.mode === "blocked"
          ? copilotRouting.failure
          : copilotRuntimeLaunch.availability,
      });
    } else if (openCodeDirect) {
      const env = openCodeSpawnEnv(body.familiarId);
      const launch = openCodeLaunch([], process.platform, env);
      const availabilityProbe = openCodeAvailabilityProbe(launch, env);
      localRuntimePlan = createLocalRuntimePlan({
        runner: "opencode",
        launch: {
          command: launch.command,
          fixedArgs: launch.args,
          unresolvedWindowsShim: launch.unresolvedWindowsShim,
        },
        env,
        availability: evaluateRuntimeAvailability(availabilityProbe),
      });
    } else if (grokDirect) {
      const env = harnessSpawnEnv(body.familiarId);
      localRuntimePlan = createLocalRuntimePlan({
        runner: "grok",
        launch: grokLaunchCommand(),
        env,
      });
    } else if (codexDirect && codexDirectLaunch && codexSpawnEnv) {
      // The direct plan reuses the exact launch command and availability the
      // capability probe was gated on, so preflight, probe, and spawn cannot
      // diverge onto different executables.
      localRuntimePlan = createLocalRuntimePlan({
        runner: "codex",
        launch: codexDirectLaunch,
        env: codexSpawnEnv,
        ...(codexLaunchAvailability ? { availability: codexLaunchAvailability } : {}),
      });
    } else if (!hermesDirect) {
      const env = covenWrapperSpawnEnv(harnessSpawnEnv(body.familiarId));
      let launch: CovenLaunchCommand;
      try {
        launch = covenLaunchCommand();
      } catch {
        return new Response(
          JSON.stringify({
            ok: false,
            error: COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC,
            code: RUNTIME_AVAILABILITY_ERROR_CODES.coven_missing,
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      localRuntimePlan = createLocalRuntimePlan({
        runner: "coven",
        launch,
        env,
        availability:
          binding.harness === "claude"
            ? evaluateCovenBackedRuntimeAvailability({
                runner: "claude",
                covenCommand: launch.command,
                env,
                unresolvedCovenWindowsShim:
                  launch.unresolvedWindowsShim === true,
              })
            : undefined,
        // The Coven-backed check verifies the outer `coven` AND the Claude it
        // resolves, and tags its record with the backed runner. Declare that
        // so the capability gate reads it as a wrapper launch rather than as a
        // plan whose readiness belongs to some other runner — the latter
        // silently skipped every `coven run` probe on a Claude turn, which
        // then surfaced to users as "the saved model cannot be applied".
        ...(binding.harness === "claude"
          ? { availabilityRunner: "claude" as const }
          : {}),
      });
    }
  }
  const openCodeCapabilities = openCodeDirect
    ? await probeReadyLocalRuntimeCapability({
        plan: localRuntimePlan,
        runner: "opencode",
        probe: () => openCodeRunCapabilities(body.familiarId, undefined, localRuntimePlan?.env),
      })
    : null;
  const openCodeCompatibility = openCodeCapabilities
    ? await resolveOpenCodeCompatibility(openCodeCapabilities)
    : null;
  // Native Cave chat can drive Coven harnesses that resolve through
  // `coven run <harness> --stream-json`, including external adapter manifests.
  // Bundled adapters may opt out when they require a bridge instead of the
  // generic local runner.
  const adapter = COMPATIBILITY_ADAPTERS.find((h) => h.id === binding.harness);
  if (adapter && !adapter.chatSupported) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `${adapter.label} is not supported by native Cave chat. Use its bridge integration instead.`,
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }
  if (!isTrustedChatHarness(binding.harness)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Harness '${binding.harness}' is not trusted for native Cave chat.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
  // Claude's stream envelope is versioned independently of Cave. Resolve a
  // trusted local capability profile before streaming; an unknown client still
  // receives normal chat text, but never silently receives misleading tool
  // bubbles from an unverified envelope shape.
  const claudeCompatibility =
    !sshRuntime && binding.harness === "claude"
      ? await resolveInstalledClaudeCompatibility()
      : null;
  await ensureAdapterManifestScaffold(binding.harness);
  // Neither the Responses API nor the direct CLI exposes a documented,
  // enforceable equivalent of Cave's read-only sandbox. Reject both transports
  // rather than silently launching Hermes with full local access.
  if ((hermesDirect || hermesApi) && body.permissionMode === "read") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Hermes does not support Cave's Read-only mode yet. Switch Access to Full access to run it.",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }
  if (sshRuntime && binding.harness === "openclaw") {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "OpenClaw SSH runtime is not supported yet. Use a local OpenClaw familiar or connect the remote agent through a future OpenClaw node bridge.",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }
  // The saved conversation carries everything resume needs: the cwd it
  // started in (harness session stores are cwd-scoped) and the harness's
  // CURRENT session id (harnesses mint a new id on every resume, so the
  // client-held conversation id quickly stops matching any harness session).
  // Continued turns don't carry projectRoot — resume must run in the
  // directory the conversation started in, not homedir or the familiar
  // workspace, or `--continue <id>` misses (and the transparent retry forks
  // the chat into a fresh session).
  const conversationResumeCwd =
    !sshRuntime && !body.projectRoot && existingConversation?.runtime?.startsWith("local:")
      ? existingConversation.runtime.slice("local:".length).trim() || undefined
      : undefined;
  // Threads opened from Familiar analytics (`/#chat-<id>`) can predate any
  // Cave conversation record — the daemon spawned them, so only IT knows the
  // cwd. Its session record is the trust anchor (see daemonSessionCwd);
  // without this fallback those chats died on the 400 "projectRoot is
  // required" refusal with nowhere to go (cave-yjnr). Conversations that
  // recorded a runtime keep it authoritative (never cross an ssh: runtime
  // onto a local root).
  const resumeCwd =
    conversationResumeCwd ??
    (!sshRuntime && !body.projectRoot && existingConversation?.runtime == null
      ? await daemonSessionCwd(body.sessionId)
      : undefined);
  const projectRootForLaunch = body.projectRoot ?? resumeCwd;
  const projects = await loadProjects();
  const resolvedFamiliarWorkspace = !sshRuntime
    ? await resolveFamiliarWorkspace(body.familiarId)
    : undefined;
  // A persisted conversation owns its provenance. Never let a request relabel
  // an existing user chat as a hidden generator to bypass project checks.
  const generationOrigin = existingConversation?.origin ?? body.origin;
  // A hidden generation is exempt from the launch gate only for the familiar's
  // OWN workspace. A resume root — the conversation's persisted runtime, or a
  // daemon session's project_root (cave-yjnr) — names a real project and is
  // gated like every other root, because the daemon's session list is global
  // and its rows carry no familiar id to scope it by (cave-o3nq7).
  // Resolve symlinks before the containment test. The spawn below realpaths the
  // root and enforces only "inside $HOME", so a lexical check on the raw string
  // would let a symlink inside the familiar's own workspace — a directory the
  // familiar can write to — resolve into another project with the gate skipped.
  // An unresolvable root yields undefined, which the helper treats as gated.
  const resumeCwdResolved = resumeCwd
    ? await realpath(resumeCwd).catch(() => undefined)
    : undefined;
  const projectlessLaunch = projectlessGenerationLaunch({
    origin: generationOrigin,
    hasRequestedProjectRoot: Boolean(body.projectRoot),
    sshRuntime: Boolean(sshRuntime),
    sshHome: homedir(),
    resumeCwd,
    resumeCwdResolved,
    familiarWorkspace: resolvedFamiliarWorkspace,
  });
  // A Board task may be isolated in a worktree below its registered project.
  // The worktree itself is intentionally not a separate project record, so
  // its first native-chat turn must authorize against the card's server-owned
  // project instead of failing as an arbitrary unregistered directory. This
  // narrow exception applies only to the fresh reserved handoff, only when
  // the browser submits the exact CWD persisted on that task card, and only
  // when the symlink-resolved runtime cwd remains inside the task project.
  let authorizedProjectRoot: string;
  try {
    if (projectlessLaunch.kind === "unavailable") {
      throw new ChatProjectLaunchError(
        "project_root_required",
        400,
        "This hidden generation has no safe familiar workspace.",
      );
    }
    if (projectlessLaunch.kind === "workspace") {
      authorizedProjectRoot = projectlessLaunch.root;
    } else {
      const authorized = await authorizeChatProjectLaunch(
        {
          validateProjectRoot: validateCaveProjectRoot,
          resolveProjectId: (requestedRoot, resolvedRoot) =>
            taskWorktreeProjectAccessId({
              projects,
              startNewConversation: Boolean(body.startNewConversation),
              hasExistingConversation: Boolean(existingConversation),
              taskProjectId: taskCard?.projectId,
              taskCwd: taskCard?.cwd,
              requestedProjectRoot: requestedRoot,
              resolvedCwd: resolvedRoot,
            }) ??
            chatProjectAccessId({
              projects,
              requestedProjectRoot: requestedRoot,
              resolvedCwd: resolvedRoot,
            }),
          isProjectRegistered: (projectId) =>
            projects.some((project) => project.id === projectId),
          hasProjectAccess: async (requestedFamiliarId, projectId, surface) => {
            try {
              await assertProjectAccess({ familiarId: requestedFamiliarId }, projectId, surface);
              return true;
            } catch (error) {
              if (error instanceof ProjectAccessDeniedError) return false;
              throw error;
            }
          },
        },
        {
          familiarId: body.familiarId,
          projectRoot: projectRootForLaunch,
          surface: "chat",
        },
      );
      authorizedProjectRoot = authorized.root;
    }
  } catch (error) {
    if (error instanceof ChatProjectLaunchError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
          code: error.code,
        }),
        { status: error.status, headers: { "content-type": "application/json" } },
      );
    }
    throw error;
  }
  let cwd: string;
  try {
    cwd = sshRuntime ? homedir() : await resolveLocalRuntimeCwd(authorizedProjectRoot);
  } catch (error) {
    if (error instanceof RuntimeScopeError) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message, code: error.code }),
        { status: error.status, headers: { "content-type": "application/json" } },
      );
    }
    throw error;
  }
  // Hermes's direct plan cannot be constructed until the spawn cwd is known:
  // a scoped PATH may deliberately contain workspace-relative entries. Keep
  // the resolver's command, env, and cwd intact for help probing and spawn.
  if (hermesDirect && hermesApi === null) {
    const launch = resolveHermesLaunch({
      familiarId: body.familiarId,
      env: hermesSpawnEnvironment!,
      cwd,
    });
    localRuntimePlan = createLocalRuntimePlan({
      runner: "hermes",
      launch: {
        command: launch.state === "ready" ? launch.command : process.platform === "win32" ? "hermes.exe" : "hermes",
        fixedArgs: [],
      },
      env: launch.state === "ready" ? launch.env : hermesSpawnEnvironment!,
      cwd: launch.state === "ready" ? launch.cwd : cwd,
      availability: launch,
    });
  }
  const grokCapabilities = grokDirect
    ? await probeReadyLocalRuntimeCapability({
        plan: localRuntimePlan,
        runner: "grok",
        probe: () => probeGrokRunCapabilities(
          { command: localRuntimePlan!.command, fixedArgs: localRuntimePlan!.fixedArgs },
          localRuntimePlan!.env,
        ),
      })
    : null;
  const grokCompatibility = grokCapabilities
    ? await resolveGrokCompatibility(grokCapabilities)
    : null;
  const hermesModelCapability =
    hermesDirect && hermesApi === null && localRuntimePlan?.runner === "hermes"
      ? await probeReadyLocalRuntimeCapability({
          plan: localRuntimePlan,
          runner: "hermes",
          probe: () => hermesChatSupportsModel({
            command: localRuntimePlan!.command,
            env: localRuntimePlan!.env,
            cwd: localRuntimePlan!.cwd ?? cwd,
          }),
        })
      : null;
  // SSH retains its existing remote routing semantics through the only
  // no-local-plan bypass. Every local Coven probe requires the exact ready
  // Coven plan.
  const probeCovenCapability = <T,>(probe: () => Promise<T>) =>
    probeReadyLocalRuntimeCapability({
      plan: localRuntimePlan,
      runner: "coven",
      probe,
      allowWithoutLocalPlan: Boolean(sshRuntime),
    });
  const probeCovenCapabilityOutcome = <T,>(probe: () => Promise<T>) =>
    probeReadyLocalRuntimeCapabilityOutcome({
      plan: localRuntimePlan,
      runner: "coven",
      probe,
      allowWithoutLocalPlan: Boolean(sshRuntime),
    });
  // The Coven probe decides model forwarding only when no direct transport
  // owns this turn. Running it unconditionally would let an unrelated runtime's
  // turn report a Coven probe failure it never depended on.
  const covenModelProbeDecides =
    !hermesDirect &&
    !openCodeDirect &&
    !copilotStream &&
    !codexDirect &&
    binding.harness !== "grok" &&
    binding.harness !== "openclaw";
  const covenModelForwarding = covenModelProbeDecides
    ? await probeCovenCapabilityOutcome(covenRunModelFlagOutcome)
    : null;
  // Three outcomes, kept apart on purpose: the CLI answered and advertises
  // `--model`; the CLI answered and does not; or we never got an answer. Only
  // the middle one is a statement about the runtime's capabilities. Folding
  // the third into it is what told users their model was unsupported when the
  // probe had simply not run.
  const modelForwardingProbeFailure: { code: string; reason: string } | null =
    covenModelForwarding === null
      ? null
      : covenModelForwarding.ran === false
        ? { code: covenModelForwarding.code, reason: covenModelForwarding.reason }
        : covenModelForwarding.value.ok === false
          ? {
              code: RUNTIME_AVAILABILITY_ERROR_CODES.probe_failed,
              reason: covenModelForwarding.value.reason,
            }
          : null;
  const covenModelForwardingSupported =
    covenModelForwarding !== null &&
    covenModelForwarding.ran === true &&
    covenModelForwarding.value.ok === true &&
    covenModelForwarding.value.matched === true;
  const modelForwardingEnabled =
    hermesDirect
      ? hermesApi !== null || (hermesModelCapability ?? false)
      : openCodeDirect
        ? openCodeCompatibility?.capabilities.model ?? false
        : copilotStream
          ? true
          : codexDirect
            ? codexDirectCapabilities?.model === true
            : binding.harness === "grok" || covenModelForwardingSupported;
  const explicitModelSelection = body.modelOverride !== undefined && body.modelOverride !== "";
  if (explicitModelSelection && (!requestedModel || !isModelAllowedByRuntime(binding.harness, requestedModel))) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "unsupported_model_override",
        error: "The selected model is not allowed by this runtime.",
        requestedModel,
        modelApplicationState: "rejected",
        modelApplicationReason: "The selected runtime does not allow this model id.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  if (explicitModelSelection && !modelForwardingEnabled) {
    if (modelForwardingProbeFailure) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: "model_forwarding_probe_failed",
          error: "Could not check whether this runtime accepts a model override, so the turn was not run.",
          requestedModel,
          modelApplicationState: "rejected",
          modelApplicationReason: modelForwardingProbeFailure.reason,
          probeFailureCode: modelForwardingProbeFailure.code,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        ok: false,
        code: "unsupported_model_override",
        error: "The selected runtime cannot accept a model override.",
        requestedModel,
        modelApplicationState: "rejected",
        modelApplicationReason: "Model forwarding is unavailable for this runtime binding.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const permissionForwardingEnabled =
    !openCodeDirect &&
    binding.harness !== "openclaw" &&
    binding.harness !== "grok" &&
    binding.harness !== "hermes" &&
    ((await probeCovenCapability(covenRunSupportsPermission)) ?? false);
  const addDirForwardingEnabled =
    !openCodeDirect &&
    binding.harness !== "openclaw" &&
    binding.harness !== "grok" &&
    binding.harness !== "hermes" &&
    ((await probeCovenCapability(covenRunSupportsAddDir)) ?? false);
  const { desiredModel, modelState, invalidSavedModel, suppressedSavedModel } = resolveSendModelMetadata({
    body,
    config,
    binding,
    existingConversation,
    modelForwardingEnabled,
  });
  const savedModelRejection = savedModelSelectionRejection({
    desiredModel,
    modelState,
    harness: binding.harness,
    modelForwardingEnabled,
    invalidSavedModel,
    suppressedSavedModel,
  });
  if (savedModelRejection === "invalid") {
    return NextResponse.json({
      ok: false,
      code: "invalid_saved_model",
      error: "The saved model selection is not safe for launch.",
      desiredModel,
      modelApplicationState: "rejected",
      modelApplicationReason: "The saved model id failed launch-boundary validation.",
    }, { status: 400 });
  }
  if (savedModelRejection === "unsupported") {
    return NextResponse.json({
      ok: false,
      code: "unsupported_saved_model",
      error: "The saved model selection is not allowed by this runtime.",
      desiredModel,
      modelApplicationState: "rejected",
      modelApplicationReason: "The selected runtime does not allow this model id.",
    }, { status: 400 });
  }
  if (savedModelRejection === "forwarding") {
    // A probe that never ran, or that failed to run, is not evidence about the
    // saved model. Say what actually went wrong instead of blaming the model —
    // "unsupported model" sends people editing a setting that was never the
    // problem.
    if (modelForwardingProbeFailure) {
      return NextResponse.json({
        ok: false,
        code: "model_forwarding_probe_failed",
        error: "Could not check whether this runtime accepts the saved model, so the turn was not run.",
        desiredModel,
        modelApplicationState: "rejected",
        modelApplicationReason: modelForwardingProbeFailure.reason,
        probeFailureCode: modelForwardingProbeFailure.code,
      }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      code: "unsupported_saved_model",
      error: "The saved model selection cannot be applied by this runtime.",
      desiredModel,
      modelApplicationState: "rejected",
      modelApplicationReason: "Model forwarding is unavailable for this runtime binding.",
    }, { status: 400 });
  }
  // Opus 5 is the one selection whose launch value is an alias: it is forwarded
  // as `anthropic/opus` and the echo is mapped back to the Cave id. That is
  // only truthful while the probe that gated the picker still holds, and a
  // selection persisted to a conversation or familiar default outlives it. Ask
  // again here rather than reporting a model this install can no longer route.
  // `unknown` proceeds unchanged — a probe that could not run is not evidence
  // about the model, the same reasoning the forwarding probe applies above.
  if (needsClaudeOpus5Routability({ harness: binding.harness, desiredModel })) {
    const routability = await claudeOpus5Routability(body.familiarId);
    if (routability === "unavailable") {
      return NextResponse.json({
        ok: false,
        code: "unroutable_opus5_selection",
        error: "This Claude Code install can no longer route Claude Opus 5, so the turn was not run.",
        desiredModel,
        modelApplicationState: "rejected",
        modelApplicationReason:
          "Claude Opus 5 is selected, but this install no longer resolves the Opus alias to it. Pick another model or restore the Claude Code version and provider configuration that offered it.",
      }, { status: 400 });
    }
  }
  const grokForwardModel = grokShouldUseCliDefault({
    modelSource: modelState.source,
    globalDefaultModel: config.defaults.model,
  }) ? null : cleanModelId(desiredModel);
  const grokLaunchModel = grokDirect
    ? runtimeModelIdForLaunch("grok", grokForwardModel)
    : null;
  // Controls are negotiated after model resolution and before any prompt or
  // argv is built. A native Hermes control is available only for its verified
  // Responses API transport; the CLI path must fail closed rather than quietly
  // turning a provider setting into prompt prose.
  const controlCapabilities = modelControlCapabilities(binding.harness, desiredModel)
    .filter((capability) => capability.delivery !== "native-provider" || (hermesDirect && hermesApi !== null));
  const controlValidation = validateModelControlValues(
    controlCapabilities,
    modelControlInputWithLegacy(
      controlCapabilities,
      {
        reasoningEffort: body.reasoningEffort,
        responseSpeed: body.responseSpeed,
      },
      body.modelControls,
    ),
  );
  if (controlValidation.rejected.length > 0) {
    return NextResponse.json({
      ok: false,
      code: "model_control_unsupported",
      error: `The selected model cannot apply: ${controlValidation.rejected.join(", ")}.`,
      rejectedControlFamilies: controlValidation.rejected,
    }, { status: 400 });
  }
  body.modelControls = controlValidation.values;
  const promptModelControls = promptOnlyModelControls(controlCapabilities, controlValidation.values);
  const appliedModelControlValues = appliedModelControls(controlCapabilities, controlValidation.values);
  const hermesReasoningEffort = controlCapabilities.some(
    (capability) => capability.parameter === "reasoning.effort",
  ) ? controlValidation.values.reasoning : undefined;
  const hermesVerbosity = controlCapabilities.some(
    (capability) => capability.parameter === "text.verbosity",
  ) ? controlValidation.values.verbosity : undefined;
  // listAccessibleProjects (not just filterProjectsForFamiliar) so the
  // per-root read/write level survives into the runtime-scope preamble
  // below instead of collapsing to "has any access".
  const accessibleProjects = sshRuntime
    ? []
    : await listAccessibleProjects(projects, body.familiarId);
  const grantedProjectRoots = accessibleProjects.map((entry) => entry.project.root);
  const grantedProjectRootAccess: Record<string, ProjectAccessLevel> = Object.fromEntries(
    accessibleProjects.map((entry) => [entry.project.root, entry.access]),
  );
  const runtimeResourceRoots = sshRuntime
    ? []
    : await resolveRuntimeSkillRoots({
        coveredRoots: [
          cwd,
          ...grantedProjectRoots,
          ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
        ],
      });
  // The selected project is always the runtime root. Familiar identity files
  // are injected separately and remain an allowed side directory below.
  const runtimeScope: RuntimeScope = sshRuntime
    ? { kind: "ssh", host: sshRuntime.host, root: sshRuntime.cwd }
    : {
        kind: "local",
        root: cwd,
        allowedProjectRoots: grantedProjectRoots,
        projectRootAccess: grantedProjectRootAccess,
        readOnlyResourceRoots: runtimeResourceRoots,
      };
  // Boundary sentinel: watches the harness's streamed tool calls for paths
  // outside the granted roots. Never blocks the stream — violations surface
  // as a progress notice at turn end and steer the NEXT turn via a prompt
  // reminder (see chat-boundary-sentinel.ts). SSH runtimes stream remote
  // paths that can't be classified against local roots, so they skip it.
  const boundarySentinel = sshRuntime
    ? null
    : createBoundarySentinel({
        allowedRoots: [
          cwd,
          ...grantedProjectRoots,
          ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
          ...runtimeResourceRoots,
        ],
      });
  const responseMetadata: ChatResponseMetadata = {
    familiarId: body.familiarId,
    harness: binding.harness,
    model: desiredModel,
    runtime: sshRuntime
      ? `ssh:${sshRuntime.host}:${sshRuntime.cwd}`
      : `local:${cwd}`,
    requestedModel,
    desiredModel,
    confirmedModel: undefined,
    retryModel: turnRetryModel({ requestedModel: body.modelOverride }),
    modelSource: modelState.source,
    modelApplicationState: modelState.applicationState,
    modelApplicationReason: modelState.reason,
    requestedControls: controlValidation.values,
    forwardedControls: controlValidation.values,
    promptGuidanceControls: promptModelControls,
  };
  const offlineChatResponse = await maybeQueueOfflineChat({
    body,
    config,
    promptText,
    persistedAttachments,
    responseMetadata,
  });
  if (offlineChatResponse) return offlineChatResponse;

  // Image delivery channel: only harnesses that can read a local granted root
  // may receive image paths. Remote Hermes Responses endpoints cannot,
  // so they receive the same explicit unsupported notice as bridge/SSH runs.
  const imagesSupported = !sshRuntime && binding.harness !== "openclaw" &&
    !(hermesApi && !hermesApiCanAccessLocalFiles(hermesApi));
  const attachmentStagingRoot = resolvedFamiliarWorkspace ?? cwd;
  const imageFilePaths = imagesSupported
    ? await writeImageAttachmentsToRuntime(attachments, attachmentStagingRoot)
    : new Map<number, string>();
  // @-mentioned files share the image-delivery constraint: only local
  // coven-run harnesses can Read this machine's filesystem, so bridges and
  // SSH runtimes never get a block of unreachable absolute paths.
  const mentionedFiles = imagesSupported
    ? await resolveMentionedFiles(
        body.mentionedFiles,
        resolvedFamiliarWorkspace,
      )
    : [];
  const dailyMemoryContext = await readFamiliarDailyMemoryStartupContext(
    resolvedFamiliarWorkspace,
  );
  // Operator profile — who the human is. New sessions only: resumed sessions
  // already carry the block in their transcript.
  const operatorProfileContext = body.sessionId
    ? null
    : buildOperatorProfileContext(config.profile);
  // Knowledge Vault — curated, cross-harness reference knowledge, separate from
  // memory. Injected here so every harness (claude/codex/hermes/openclaw) that
  // consumes `harnessPrompt` below receives the same authoritative context.
  //
  // Except for `enhance`: that origin is the one-shot utility lane (prompt
  // enhance, reply recommendation, gh review draft, thread reflection). Those
  // runs are self-contained — their whole input is in the prompt — so curated
  // repo reference material is pure ballast. It actively corrupted the thread
  // self-report signal: reflection runs inherited the vault and then rated
  // their OWN view as `critical` context pressure ("the actual exchange is
  // truncated while a very large knowledge vault dominates the context"),
  // reporting pressure that the thread being judged never had.
  const skipKnowledgeVault = body.origin === "enhance";
  const knowledgeVaultEntries = skipKnowledgeVault
    ? []
    : await readKnowledgeVaultForPrompt(body.familiarId);
  const knowledgeVaultCollections = skipKnowledgeVault ? [] : await listCollections();

  // Familiar Contract — SOUL.md / IDENTITY.md from the familiar's own workspace.
  // The identity canon injected on every turn asserts these files define the
  // familiar; until cave-gw3iq chat never actually loaded them, so the claim was
  // unbacked in the one surface users spend most of their time in.
  //
  // New sessions only, matching the operator profile: a resumed conversation
  // already carries the block in its transcript, and re-sending several KB of
  // identity prose on every turn is exactly the imbalance this fix is meant to
  // correct — not to invert.
  //
  // `enhance` is skipped for the same reason it skips the Knowledge Vault: that
  // origin is the one-shot utility lane (prompt enhance, reply recommendation,
  // gh review draft, thread reflection), whose entire input is already in the
  // prompt. Persona prose there is pure ballast.
  //
  // MEMORY.md is deliberately excluded — see FamiliarContractBlockOptions. Chat
  // already injects today's daily memory as its own startup-context block.
  const familiarContract =
    body.sessionId || body.origin === "enhance"
      ? { block: null, loaded: [], clamped: [] }
      : await buildFamiliarContractContext(body.familiarId);
  const familiarContractBlock = familiarContract.block;

  // Reuse the task card already loaded to authorize this reserved handoff.
  // Besides avoiding a second board-store read on every chat turn, this keeps
  // the permission decision and prompt context on the same task snapshot.
  const taskContext = taskCard ? buildTaskContext(taskCard) : null;
  const scopedPrompt = buildPromptWithRuntimeScope(
    buildPromptWithDeliveryEvidenceContract(
      buildPromptWithCovenIdentityCanon(
        // Sits directly inside the canon so the files land next to the rule that
        // names them, and ahead of the vault/task/memory data blocks so persona
        // frames how the familiar reads them. The genuine runtime boundary is
        // applied outermost and therefore still leads the assembled prompt.
        buildPromptWithFamiliarContract(
          buildTaskAwarePrompt(
            buildPromptWithKnowledgeVault(
              buildPromptWithFamiliarStartupContext(
                appendMentionedFilesBlock(
                  buildPromptWithResponseControls(
                    buildPromptWithAttachments(promptText, attachments, {
                      imagesSupported,
                      imageFilePaths,
                    }),
                    { modelControls: promptModelControls },
                  ),
                  mentionedFiles,
                ),
                [operatorProfileContext, dailyMemoryContext],
              ),
              knowledgeVaultEntries,
              knowledgeVaultCollections,
            ),
            taskContext,
          ),
          familiarContractBlock,
        ),
        body.familiarId,
      ),
    ),
    runtimeScope,
  );
  // The boundary reminder rides OUTSIDE the runtime-scope wrapper: it refers
  // back to the boundary block ("listed above") and only exists when the
  // conversation's previous turn strayed out of the granted roots.
  const harnessPrompt = buildPromptWithBoundaryReminder(scopedPrompt, body.sessionId);

  if (binding.harness === "openclaw" && !sshRuntime) {
    return openClawChatResponse({
      req,
      body,
      promptText,
      harnessPrompt,
      attachments: persistedAttachments,
      desiredModel,
      modelState,
      initialModelIntent: existingConversation?.modelIntent?.model ?? null,
      ownsFirstExchangeTitle,
    });
  }

  // Build coven run argv.
  // Important: pass every flag BEFORE the prompt and add a `--` separator,
  // because `<PROMPT>...` is a variadic positional in coven's clap definition
  // and otherwise swallows trailing flags like `--stream-json` as raw text.
  // Model parity: forward the resolved model only when forwarding is enabled
  // (the installed `coven run` advertises `--model`) and the id is well-formed.
  // Emitted BEFORE the `--` separator for the same reason every other flag is.
  const selectedModel = cleanModelId(desiredModel);
  const forwardModel =
    modelForwardingEnabled && selectedModel
      ? modelForRuntimeLaunch(binding.harness, selectedModel)
      : null;
  // Direct native transports apply the same registry-owned model transform as
  // Coven. Keep `forwardModel` provider-qualified for SSH/generic delegation
  // and for persisted requested/confirmed/retry metadata below.
  const hermesLaunchModel = hermesDirect
    ? runtimeModelIdForLaunch("hermes", forwardModel)
    : null;
  const openCodeLaunchModel = openCodeDirect
    ? runtimeModelIdForLaunch("opencode", forwardModel)
    : null;
  const codexDirectLaunchModel = codexDirect
    ? runtimeModelIdForLaunch("codex", forwardModel)
    : null;
  responseMetadata.forwardedModel = (hermesDirect
    ? hermesLaunchModel
    : openCodeDirect
      ? openCodeLaunchModel
      : codexDirect
        ? codexDirectLaunchModel
        : grokDirect
          ? grokLaunchModel
          : forwardModel) ?? undefined;
  const forwardPermission =
    permissionForwardingEnabled && body.permissionMode === "read" ? "read-only" : null;
  // Directory grants: forward every granted project root — plus the familiar's
  // own workspace when it isn't the spawn cwd — so the harness actually trusts
  // the roots the runtime-scope preamble grants. The spawn cwd is already
  // trusted implicitly, so it's excluded. Gated on the `--add-dir` probe and
  // local runtimes only (SSH runtimes own their remote filesystem).
  const spawnRoot = cwd;
  const grantDirs = !sshRuntime
    ? Array.from(
        new Set(
          [
            ...grantedProjectRoots,
            ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
            ...runtimeResourceRoots,
          ]
            .map((root) => root.trim())
            .filter((root) => root && root !== spawnRoot),
        ),
      )
    : [];
  const forwardAddDirs = addDirForwardingEnabled && !sshRuntime ? grantDirs : [];
  const runtimeAccessFingerprint = buildRuntimeAccessFingerprint({
    primaryRoot: cwd,
    grantedProjectRoots,
    projectRootAccess: grantedProjectRootAccess,
    additionalRoots: resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : [],
  });
  // The accepted Hermes 1.0.3 adapter binds prompts natively with `--query`.
  // Cave still spawns Hermes directly for local chats because this path owns
  // richer local streaming, session, and optional API behavior than the
  // generic Coven transport. SSH runtimes remain on their remote Coven path.
  // Grok Build has a documented streaming-json headless protocol. It is a
  // direct local integration, deliberately independent of coven's generic
  // `run --stream-json` adapter protocol.
  const grokSandboxProfile = grokSandboxProfileForPermission(body.permissionMode);
  // The copilot session id Cave chose for the CURRENT attempt: the resume
  // target, or a pre-assigned fresh id (copilot events don't echo the id
  // until the final result frame, so the stream handler announces this one).
  let copilotSessionHint: string | null = null;
  // Grok only emits its native session id in the final JSONL event. Assign a
  // UUID for new native sessions so a stopped first turn can still be saved
  // and resumed instead of disappearing with the unreceived end frame.
  let grokSessionHint: string | null = null;
  // Set only when the current OpenCode attempt forwards a native token.
  // Fresh compatibility fallback must not retain a prior session by accident.
  let openCodeNativeResumeUsed = false;
  // `promptOverride` lets the transparent resume-retry (below) prime a fresh
  // harness session with replayed conversation history — without it the retry
  // forks a context-free session and the familiar loses the thread.
  const buildArgs = (
    resumeSessionId: string | null,
    promptOverride?: string,
  ): string[] => {
    const prompt = promptOverride ?? harnessPrompt;
    if (sshRuntime) {
      return buildSshSpawnArgs({
        runtime: sshRuntime,
        harness: binding.harness,
        familiarId: body.familiarId,
        prompt,
        sessionId: resumeSessionId,
        model: forwardModel,
      });
    }
    if (copilotStream) {
      // A rejected resume token must start a named fresh native session. If
      // argv silently omits it, retaining the invalid token here would make
      // Cave announce/persist an id the CLI never used.
      const safeResumeSessionId = isSafeCopilotResumeSessionId(resumeSessionId)
        ? resumeSessionId
        : null;
      copilotSessionHint = safeResumeSessionId ?? crypto.randomUUID();
      // The direct spawn bypasses `coven run --familiar`, so mirror coven's
      // identity preamble here — without it the familiar answers as the
      // generic Copilot CLI.
      const identity = copilotIdentityPreamble(
        body.familiarId,
        binding.display_name,
        binding.role,
      );
      return buildCopilotStreamArgs({
        spec: copilotStream,
        prompt: identity ? `${identity}\n\n${prompt}` : prompt,
        resumeSessionId: safeResumeSessionId,
        newSessionId: safeResumeSessionId ? null : copilotSessionHint,
        model: cleanModelId(desiredModel),
        permissionMode: body.permissionMode === "read" ? "read" : "full",
        // Ungated grant list (cave-n1yc): the direct spawn never goes through
        // `coven run`, so the coven CLI's --add-dir probe must not mask it.
        // Copilot's native repeatable --add-dir ships in every CLI version
        // this stream path supports, same trust basis as the manifest's
        // session/sandbox flags above.
        addDirs: grantDirs,
        pluginDirs: copilotPluginDirs,
      });
    }
    if (hermesDirect) {
      const a = binding.hermesProfile
        ? ["-p", binding.hermesProfile.id, "chat", "--source", "coven", "-Q"]
        : ["chat", "--source", "coven", "-Q"];
      if (resumeSessionId) a.push("--resume", resumeSessionId);
      if (hermesLaunchModel) a.push("--model", hermesLaunchModel);
      a.push("--query", prompt);
      return a;
    }
    if (grokDirect) {
      grokSessionHint = resumeSessionId ? null : crypto.randomUUID();
      return buildGrokBuildArgs({
        prompt,
        resumeSessionId,
        newSessionId: grokSessionHint,
        model: grokForwardModel,
        permissionMode: body.permissionMode === "read" ? "read" : "full",
        grantDirs,
        identityRules: grokIdentityRules(
          body.familiarId,
          binding.display_name,
          binding.role,
        ),
        outputFormat: grokCompatibility?.mode === "structured" ? "streaming-json" : null,
      });
    }
    if (openCodeDirect) {
      // Reset for each attempt: a later fresh-session retry must not preserve
      // the native token from an earlier failed compatibility launch.
      openCodeNativeResumeUsed = false;
      // The selected schema is capability based, never a version threshold.
      // If JSON is unavailable, preserve plain chat instead of launching with
      // an unsupported flag and losing the whole reply.
      const a = ["run"];
      if (openCodeCompatibility?.mode === "structured") {
        const launch = openCodeCompatibility.schema!.launch;
        a.push(
          launch.structuredOutput.option,
          ...(launch.structuredOutput.value === undefined ? [] : [launch.structuredOutput.value]),
          ...launch.requiredFlags,
        );
        if (resumeSessionId && launch.sessionOption) {
          a.push(launch.sessionOption, resumeSessionId);
          openCodeNativeResumeUsed = true;
        }
      } else if (resumeSessionId) {
        // Plain output can still resume a native session. Forward only the
        // exact argument-taking option confirmed by `run --help`; never guess
        // `--session` or feed an ID to a valueless "resume latest" switch.
        const options = openCodeCompatibility?.capabilities.options ?? [];
        const valueOptions = openCodeCompatibility?.capabilities.valueOptions ?? [];
        const sessionOption = options.includes("--session") && valueOptions.includes("--session")
          ? "--session"
          : options.includes("--resume") && valueOptions.includes("--resume")
            ? "--resume"
            : null;
        if (sessionOption) {
          a.push(sessionOption, resumeSessionId);
          openCodeNativeResumeUsed = true;
        }
      }
      if (openCodeLaunchModel) a.push("--model", openCodeLaunchModel);
      // OpenCode reads non-TTY stdin verbatim. Keep the full Cave prompt out
      // of argv so Windows' command-line ceiling and positional-message
      // quoting cannot truncate or rewrite it. runAttempt() writes the exact
      // per-attempt prompt after spawning this option-only launch plan.
      return a;
    }
    if (codexDirect && codexDirectCapabilities) {
      // Direct `codex exec --json`: every flag is gated on the exact probed
      // CLI contract (fresh and resume help are distinct), and the prompt is
      // a positional behind `--` so it can never be parsed as an option. The
      // routing gate already forced this turn onto the Coven path when a
      // resume was requested without JSON resume support.
      return buildCodexExecArgs({
        prompt,
        resumeSessionId,
        capabilities: codexDirectCapabilities,
        model: codexDirectLaunchModel,
        readOnly: body.permissionMode === "read",
        addDirs: grantDirs,
      });
    }
    const a = ["run", binding.harness, "--stream-json"];
    if (resumeSessionId) a.push("--continue", resumeSessionId);
    if (forwardModel) a.push("--model", forwardModel);
    // Enforce Read-only by mapping to the harness's native sandbox flag via
    // `coven run --permission read-only` (codex --sandbox read-only / claude
    // --permission-mode plan). Gated on the CLI advertising the flag.
    if (forwardPermission) a.push("--permission", forwardPermission);
    // Trust each granted root at the harness level; repeatable flag.
    for (const dir of forwardAddDirs) a.push("--add-dir", dir);
    // Inject identity preamble. coven-cli renders this through the best
    // available identity channel for the chosen harness. Without this, the
    // harness answers as its generic CLI identity instead of as the familiar.
    if (/^[a-z0-9_-]+$/i.test(body.familiarId)) {
      a.push("--familiar", body.familiarId);
    }
    a.push("--", prompt);
    return a;
  };
  // Resume the harness's latest session id, not the stable conversation id —
  // after the first resume those diverge permanently.
  const resumeTarget = body.startNewConversation && !existingConversation
    ? null
    : body.sessionId
      ? openCodeDirect
        // If the Cave transcript was removed, the submitted token may still be
        // a valid native OpenCode session. Preserve it for a help-confirmed
        // resume rather than silently creating a context-free chat.
        ? existingConversation?.harnessSessionId ?? body.sessionId
        : existingConversation?.harnessSessionId ?? body.sessionId
      : null;
  // Runtime grant changes are process-boundary changes, not prompt changes.
  // Rebuilding the boundary preamble and passing new --add-dir flags cannot
  // reliably widen a native session whose sandbox was created on an earlier
  // turn. Replace it atomically and replay the bounded active transcript.
  // Legacy conversations have no fingerprint, so their first resumed turn
  // after this upgrade also refreshes once instead of guessing that stale
  // process authority matches the live grant store.
  const runtimeAccessRefreshNeeded = Boolean(
    !sshRuntime &&
    existingConversation &&
    resumeTarget &&
    existingConversation.runtimeAccessFingerprint !== runtimeAccessFingerprint,
  );
  const runtimeAccessRetry = runtimeAccessRefreshNeeded
    ? buildResumeRetryPrompt(harnessPrompt, existingConversation)
    : null;
  // Grok deliberately refuses to change a resumed session's sandbox. Persist
  // the profile used for the previous native session and transparently start a
  // fresh one (with recent context replayed) when the access chip changed. An
  // older conversation without this metadata also starts fresh, rather than
  // risking a read-only request inheriting an unrestricted old session.
  const grokFreshSessionForSandbox = grokDirect && grokResumeNeedsNewSandboxSession({
    resumeSessionId: resumeTarget,
    savedProfile: existingConversation?.grokSandboxProfile,
    requestedProfile: grokSandboxProfile,
  });
  const grokSandboxRetry = grokFreshSessionForSandbox
    ? buildResumeRetryPrompt(harnessPrompt, existingConversation)
    : null;
  const openCodeNativeResumeSupported = openCodeCompatibility?.mode === "structured"
    ? Boolean(openCodeCompatibility.schema?.launch.sessionOption)
    : Boolean(
      openCodeCompatibility?.capabilities.valueOptions?.includes("--session")
      || openCodeCompatibility?.capabilities.valueOptions?.includes("--resume"),
    );
  const openCodeUnrecordedResume = Boolean(
    openCodeDirect && body.sessionId && !existingConversation && !openCodeNativeResumeSupported,
  );
  // A client which no longer advertises a native resume option, or a prior
  // turn which never received a native OpenCode id, must start fresh with
  // bounded Cave transcript replay. Plain output can still safely resume when
  // its exact option was confirmed by the capability probe.
  const openCodeFreshSessionForCompatibility = Boolean(
    openCodeDirect && body.sessionId && (
      openCodeUnrecordedResume
      || Boolean(existingConversation && (
        !openCodeNativeResumeSupported
        || !existingConversation.harnessSessionId
      ))
    ),
  );
  const openCodeSessionUnavailable = !openCodeNativeResumeSupported;
  const openCodeCompatibilityRetry = openCodeFreshSessionForCompatibility
    ? buildResumeRetryPrompt(harnessPrompt, existingConversation)
    : null;
  const args = buildArgs(
    runtimeAccessRefreshNeeded || grokFreshSessionForSandbox || openCodeFreshSessionForCompatibility
      ? null
      : resumeTarget,
    runtimeAccessRetry?.prompt ?? grokSandboxRetry?.prompt ?? openCodeCompatibilityRetry?.prompt,
  );

  // Resume failures from common harnesses. Codex emits
  // "thread/resume failed: no rollout found ... (code -32600)" when the
  // rollout DB no longer has the thread. Claude Code emits
  // "Session ID <uuid> is already in use" when --resume hits a session
  // that is locked by another live process, and
  // "No conversation found with session ID: <uuid>" when the requested
  // conversation vanished from Claude's local store. Coven itself emits
  // "session <uuid> not found in local store" when the requested --continue
  // id exists only in Cave's local transcript store. Copilot emits "No
  // session, task, or name matched '<id>'" on `--resume` misses — including
  // every conversation recorded before the direct-stream path existed, whose
  // harnessSessionId lives only in coven's store. Hermes and OpenCode emit
  // "Session not found" when their local session is gone. In these cases we
  // retry once without the resume flag so the chat starts fresh instead of
  // erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600|Session ID \S+ is already in use|No conversation found with session ID|session\s+\S+\s+not found in local store|No session, task, or name matched|Session not found\b/i;

  // A first structured OpenCode frame can establish Cave's stable chat id
  // before the child-run registry is installed. Keep this binding available
  // to `announceSession` without putting it in the temporal dead zone.
  let runHandle!: ChatRunHandle;
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false;
      const push = (e: StreamEvent) => {
        // Tee EVERY event through the per-run ring first (cave-h40l): the
        // buffer is what makes a dropped client resumable, so it must see
        // events even after the original transport closed. The returned seq
        // rides the SSE `id:` so live clients always hold a resume cursor.
        const seq = runBuffer?.record(e);
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(chatSse(e, seq));
        } catch (error) {
          closed = true;
          if (!req.signal.aborted) console.warn("Failed to enqueue chat stream event", error);
        }
      };
      let runBuffer: RunBufferHandle | null = null;
      // Compatibility notices are deliberately value-free and must survive
      // transcript reloads; the live SSE buffer alone expires after two
      // minutes. Keep only this narrowly-scoped subset of progress rows.
      const persistedCompatibilityDiagnostics: NonNullable<ChatTurn["progress"]> = [];
      const pushProgress = (
        id: string,
        label: string,
        status: "running" | "done" | "notice" | "error",
        detail?: string,
        durationMs?: number,
      ) => {
        if (
          (id === "opencode-compatibility" || id === "grok-compatibility") ||
          id === "codex-compatibility" ||
          // Identity loading must survive a transcript reload for the same
          // reason the compatibility rows do: the question it answers ("what
          // context did this familiar actually have?") is usually asked later,
          // from a reloaded or exported transcript, long after the live SSE
          // buffer has expired. It carries file names only, never contents.
          id === "familiar-contract" ||
          id === "runtime-process" ||
          id === "runtime-launch-diagnostics"
        ) {
          persistedCompatibilityDiagnostics.push({
            id,
            label,
            status,
            createdAt: new Date().toISOString(),
            ...(detail ? { detail } : {}),
            ...(durationMs != null ? { durationMs } : {}),
          });
        }
        push({
          kind: "progress",
          id,
          label,
          status,
          ...(detail ? { detail } : {}),
          ...(durationMs != null ? { durationMs } : {}),
        });
      };
      const heartbeat = startChatSseHeartbeat(controller, () => closed || req.signal.aborted);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already */
        }
      };

      push({ kind: "user", text: promptText });
      // Report what identity context this turn actually loaded. A familiar
      // asked "what is in your SOUL.md" should be answerable from the run's own
      // record rather than from the familiar's introspection, which is exactly
      // what was missing when this injection was specified.
      if (!body.sessionId && body.origin !== "enhance" && body.familiarId) {
        const notice = familiarContractNotice(familiarContract);
        pushProgress("familiar-contract", notice.label, "notice", notice.detail);
      }
      if (hermesDirect && !hermesApi) {
        // Do not fabricate tool bubbles from the CLI's presentation layer.
        // This gives the operator an actionable, privacy-safe degradation
        // notice while preserving normal CLI chat output.
        //
        // `notice`, not `error`: nothing failed here. The turn runs normally
        // and only its tool bubbles are missing, which is exactly what every
        // peer runtime's "continuing without tool activity" row reports
        // (claude-runtime-compatibility, opencode-compatibility,
        // grok-compatibility, codex-compatibility, copilot-protocol-*). Hermes
        // was the lone one styled as a failure, so every CLI-mode Hermes turn
        // opened with a red row and a "1 issue" count against a healthy run.
        pushProgress(
          "hermes-tool-activity",
          "Hermes tool activity unavailable; chat text will continue without tool bubbles",
          "notice",
          "Configure valid HERMES_API_URL and HERMES_API_KEY values for the versioned structured event transport.",
        );
      }
      if (grokFreshSessionForSandbox) {
        pushProgress(
          "grok-sandbox-restart",
          "Access mode changed; starting a fresh Grok session with recent context",
          "done",
        );
      }
      if (runtimeAccessRefreshNeeded) {
        pushProgress(
          "runtime-access-refresh",
          "Filesystem access refreshed",
          "done",
          runtimeAccessRetry?.replayedHistory
            ? "Started a fresh harness session with the current grants and recent context."
            : "Started a fresh harness session with the current grants.",
        );
      }

      let sessionId: string | null = body.sessionId ?? null;
      // Cave keeps `sessionId` as the stable conversation id for resumed
      // chats. Grok's end frame still carries the native session id, which
      // may change when an access-mode switch starts a fresh native session.
      // Keep it separately so the next Grok turn resumes the actual CLI
      // session rather than Cave's conversation id.
      let grokSessionId: string | null = null;
      // OpenCode's native session is distinct from Cave's stable conversation
      // ID on resumed turns. Always retain the latest event-provided native ID
      // for the next CLI resume, while only announcing the stable Cave ID.
      let openCodeSessionId: string | null = null;
      // Codex's native thread id (from `thread.started`) is likewise retained
      // separately from Cave's stable conversation id on the direct path.
      let codexSessionId: string | null = null;
      // Unknown direct-protocol events are counted during the stream and
      // surfaced once per turn as a shape-only diagnostic — never payloads.
      let codexUnknownEventCount = 0;
      const codexUnknownEventFingerprints = new Set<string>();
      // Responses API ids rotate per turn like other harness session ids, but
      // Cave's `sessionId` remains the stable conversation identity. Preserve
      // the latest response id separately so follow-ups send
      // `previous_response_id` instead of accidentally resuming from Cave's
      // UUID.
      let hermesResponseId: string | null = null;
      // A conversation created by Hermes CLI has a CLI-native session id here,
      // not a Responses id. If the API rejects it, the shared resume fallback
      // replays saved context into one fresh Responses turn instead.
      let hermesPreviousResponseId = existingConversation?.harnessSessionId ?? null;
      // Legacy/failed conversations may not have a usable Responses id. A
      // fresh API request must receive saved context rather than silently
      // answering only the newest prompt.
      const hermesNeedsContextReplay = Boolean(
        hermesApi && body.sessionId && !hermesPreviousResponseId,
      );
      // First-turn visibility (cave-0g2x): the id of the in-flight user turn,
      // minted up front so the announce-time stub conversation and the
      // end-of-stream authoritative save agree on the turn's identity.
      const pendingUserTurnId = crypto.randomUUID();
      // The pending stub write; the end-of-stream save awaits it so a
      // late-settling stub can never clobber the authoritative transcript.
      let stubWrite: Promise<unknown> | null = null;
      // The AssistantFilter's suppressions all key on codex/claude output
      // shapes (marker lines, startup banners, exec echoes). External manifest
      // adapters (copilot, opencode, hermes, …) pipe the CLI's raw stdout with
      // none of those shapes — the phase gate ate whole replies ("completed
      // but produced no output") and the banner heuristic ate bare-number
      // answers — so their text passes through verbatim.
      const rawStdoutHarness =
        binding.harness !== "codex" && binding.harness !== "claude";
      let assistantFilter = new AssistantFilter({ passthrough: rawStdoutHarness });
      let assistantText = "";
      let jsonBuf = "";
      let stdoutDecoder = new StringDecoder("utf8");
      // A protocol frame is control-plane data, not assistant text. Bound an
      // unterminated/malformed OpenCode JSONL frame so a client regression or
      // a tool dumping one huge value cannot retain unbounded route memory.
      const MAX_OPENCODE_JSONL_FRAME_BYTES = 256 * 1024;
      let result: {
        duration_ms?: number;
        is_error?: boolean;
        usage?: TurnUsage;
        costUsd?: number;
      } = {};
      // Launch-integrity flag (#3856): set when the pre-spawn availability
      // gate or the post-spawn error handler proves the harness never
      // actually ran. Downstream it suppresses the empty-output diagnostic
      // (a never-launched CLI must not be diagnosed as "installed but not
      // authenticated") and skips persisting a fabricated assistant turn.
      let launchFailure: { code: string; message: string } | null = null;
      // A Coven-backed child can exit non-zero before it writes even one
      // stream frame. Defer classifying that condition until all buffered
      // stdout has passed through the more-specific adapter failure parser.
      let covenBackedProcessFailed = false;
      let covenBackedExitCode: number | null = null;
      // Coven is the outer launch vehicle. Its cleanup can fail after the
      // adapter has already supplied a successful structured result; that
      // completed assistant response remains authoritative for this attempt.
      let covenCompletedSuccessfulResult = false;
      // Grok Build is launched directly. Its initial interactive sign-in
      // failure can exit non-zero without emitting stdout or stderr, so retain
      // the child outcome until buffered stream text has been fully decoded.
      let grokProcessFailed = false;
      // Coven can send adapter startup failures through stdout, where Codex's
      // transcript filter intentionally suppresses pre-assistant noise. Keep
      // only the classified, fixed remediation so those failures cannot fall
      // through to the generic empty-output/authentication diagnostic.
      let codexAdapterFailure: ReturnType<typeof codexAdapterFailureAvailability> = null;
      const captureCodexAdapterFailure = (text: string) => {
        if (binding.harness !== "codex" || codexAdapterFailure) return;
        codexAdapterFailure = codexAdapterFailureAvailability(text);
      };
      // Tracks open tool calls from both hook lines and stream-json
      // envelopes: per-name FIFO queues give concurrent same-name calls
      // distinct ids, and hook/envelope events describing the same call are
      // deduped onto one id (hook events win — they carry real durations).
      let toolAttempt = 0;
      let toolTracker = new ToolCallTracker(Date.now, "");
      // A recovery retry is a separate harness execution, but its early tool
      // activity has already reached the client and remains part of the turn's
      // audit trail. Keep it for persistence and namespace retry ids so a
      // same-name hook cannot upsert over the first attempt's tool bubble.
      const priorAttemptTools: ReturnType<ToolCallTracker["snapshot"]> = [];
      // JSONL frames can be replayed or reordered. Hold a completion until
      // its request/start arrives so the shared tracker emits one settled
      // tool bubble instead of later synthesizing a failure for the call.
      let pendingCopilotToolCompletions = new Map<
        string,
        { output: string | undefined; isError: boolean }
      >();
      const MAX_PENDING_COPILOT_TOOL_COMPLETIONS = 64;
      let claudeToolsEnabled =
        binding.harness !== "claude" ||
        (claudeCompatibility?.kind === "compatible" && !claudeCompatibility.stale);
      const claudeDiagnostic = claudeCompatibility
        ? claudeCompatibilityDiagnostic(claudeCompatibility)
        : binding.harness === "claude" && sshRuntime
          ? "Claude Code tool activity cannot be verified on an SSH host; chat text will continue without tool bubbles."
          : null;
      if (claudeDiagnostic) {
        // Emit the fallback state before the child produces output: an absent
        // or immediately-failing CLI must not hide the only useful diagnostic.
        pushProgress("claude-runtime-compatibility", claudeDiagnostic, "notice");
      }
      // A fallback reason is already a user-visible compatibility diagnostic.
      // Later malformed frames still get a redacted log fingerprint, but must
      // not overwrite that truthful state with a second, conflicting error.
      let claudeCompatibilityDiagnosticSent = Boolean(claudeDiagnostic);
      let claudeFallbackFingerprintLogged = false;
      let claudeUnsupportedFrameDiagnosticSent = false;
      const reportMalformedClaudeStreamFrame = (frame: unknown) => {
        // One malformed frame means the selected envelope profile no longer
        // describes this stream. Continue showing assistant text, but do not
        // resume profile-selected tool decoding on later frames.
        claudeToolsEnabled = false;
        if (claudeUnsupportedFrameDiagnosticSent) return;
        claudeUnsupportedFrameDiagnosticSent = true;
        console.warn("[chat] Claude stream frame could not be decoded", {
          fingerprint: redactedEventFingerprint(frame),
        });
        if (claudeCompatibilityDiagnosticSent) return;
        claudeCompatibilityDiagnosticSent = true;
        pushProgress(
          "claude-runtime-compatibility",
          "A Claude Code stream frame could not be decoded; chat text will continue without unverified tool bubbles.",
          "notice",
        );
      };
      const reportUnsupportedClaudeToolFrame = (frame: unknown) => {
        // An unrecognised tool block can change the meaning or ordering of
        // later frames, so fail closed for the rest of this stream rather than
        // treating subsequent familiar labels as independently trustworthy.
        claudeToolsEnabled = false;
        if (claudeUnsupportedFrameDiagnosticSent) return;
        claudeUnsupportedFrameDiagnosticSent = true;
        console.warn("[chat] Claude tool frame ignored by compatibility profile", {
          fingerprint: redactedEventFingerprint(frame),
        });
        if (claudeCompatibilityDiagnosticSent) return;
        claudeCompatibilityDiagnosticSent = true;
        pushProgress(
          "claude-runtime-compatibility",
          "A Claude Code tool frame is not supported by the selected compatibility profile; chat text will continue without unverified tool bubbles.",
          "notice",
        );
      };
      const settleUnfinishedTools = () => {
        for (const toolEv of toolTracker.settleUnfinished()) {
          push({ kind: "tool_use", ...toolEv });
        }
      };
      const resetToolTrackerForRetry = () => {
        settleUnfinishedTools();
        // The prior attempt's assistant text is intentionally discarded before
        // retrying, so place retained tool records at the start of the final
        // response instead of preserving offsets into text that no longer
        // exists.
        priorAttemptTools.push(...toolTracker.snapshot().map((event) => ({ ...event, textOffset: 0 })));
        toolAttempt += 1;
        toolTracker = new ToolCallTracker(Date.now, `retry-${toolAttempt}:`);
        pendingCopilotToolCompletions = new Map();
      };
      // Keep stderr off the assistant stream — surface it only on failure
      // or empty-success so users don't see raw 401 traces mid-bubble.
      const stderrTail: string[] = [];
      const STDERR_KEEP = 15;
      // Some harnesses (notably codex) route their error output through
      // stdout, where the AssistantFilter discards it. Capture any stdout
      // lines that look like errors as a fallback for the diagnostic.
      const stdoutErrTail: string[] = [];
      const STDOUT_ERR_KEEP = 10;
      const ERR_LINE_RE =
        /\b(error|failed|denied|unauthori[sz]ed|invalid|refused|missing|not found|401|403|500)\b/i;
      const recordStdoutErrorTail = (text: string, force = false) => {
        for (const part of text.split(/\r?\n/)) {
          const trimmed = part.trim();
          if (!trimmed || (!force && !ERR_LINE_RE.test(trimmed))) continue;
          stdoutErrTail.push(trimmed);
          if (stdoutErrTail.length > STDOUT_ERR_KEEP) stdoutErrTail.shift();
        }
      };

      // Set to true when the harness reports its resume failed (rollout DB
      // miss). Triggers a single transparent retry without --continue.
      let resumeFailed = false;

      // Fatal registry conflict from a stale scaffolded manifest whose id a
      // CLI upgrade promoted to built-in (copilot, coven-code). Kills every
      // `coven run` at startup, so the turn ends with no assistant text.
      // Detected from stderr; healed (manifest quarantined) and retried below.
      let adapterConflict: BuiltinAdapterConflict | null = null;
      let openCodeCompatibilityHealthNoticeSent = false;
      let openCodeProtocolQuarantineNoticeSent = false;
      let openCodeStructuredProtocolQuarantined = false;
      let openCodeModelRejected = false;
      let grokCompatibilityHealthNoticeSent = false;
      let grokStructuredProtocolQuarantined = false;
      let grokProtocolQuarantineNoticeSent = false;
      const quarantineGrokProtocol = (
        detail: "malformed-jsonl-event" | "unframed-jsonl-event" | `unknown-event:${string}`,
      ) => {
        grokStructuredProtocolQuarantined = true;
        quarantineGrokSchema(grokCompatibility?.schema);
        recordStdoutErrorTail("Grok Build emitted a malformed structured event", true);
        if (grokProtocolQuarantineNoticeSent) return;
        grokProtocolQuarantineNoticeSent = true;
        pushProgress(
          "grok-compatibility",
          "Grok Build sent an unrecognized event; future turns will use safe plain chat until a compatible schema is available",
          "notice",
          detail,
        );
      };
      const quarantineOpenCodeProtocol = (
        label: string,
        detail: "malformed-json-event" | "oversized-jsonl-event",
      ) => {
        // Structured-mode stdout can contain arbitrary tool payloads. Keep the
        // error tail and persisted diagnostic value-free.
        recordStdoutErrorTail("OpenCode emitted a malformed JSON event", true);
        openCodeStructuredProtocolQuarantined = true;
        quarantineOpenCodeSchema(openCodeCompatibility?.schema);
        if (openCodeProtocolQuarantineNoticeSent) return;
        openCodeProtocolQuarantineNoticeSent = true;
        pushProgress("opencode-compatibility", label, "notice", detail);
      };

      // Model parity: the harness echoes its resolved model on the init/system
      // stream event. Capturing it lets the application state render honestly as
      // `applied` instead of staying `pending`. Null until the init event with a
      // model field arrives (older CLIs omit it → honest `pending`).
      let confirmedModel: string | null = null;

      // Dedups copilot's streamed text deltas against the full-content
      // assistant.message frame that follows them.
      const copilotText = new CopilotTextAssembler();
      const copilotTranscript = new CopilotMessageTranscript();
      // A changed Copilot tool event must be visible, but diagnostics must
      // remain bounded and never include the event payload (which can contain
      // prompts, paths, or tool output). One status row per safe code avoids
      // flooding the transcript when a newer CLI repeats the frame.
      const copilotProtocolDiagnosticCodes = new Set<string>();

      const reportCopilotProtocolDiagnostic = (code: string, detail: string) => {
        if (copilotProtocolDiagnosticCodes.has(code)) return;
        copilotProtocolDiagnosticCodes.add(code);
        push({
          kind: "progress",
          id: `copilot-protocol-${code}`,
          label: "Copilot tool activity needs an update",
          detail,
          status: "notice",
        });
      };

      const rememberPendingCopilotToolCompletion = (
        toolCallId: string,
        completion: { output: string | undefined; isError: boolean },
      ) => {
        // Preserve the first terminal result for an out-of-order call. A
        // replay must not replace an already buffered completion.
        if (pendingCopilotToolCompletions.has(toolCallId)) return;
        if (!pendingCopilotToolCompletions.has(toolCallId) &&
            pendingCopilotToolCompletions.size >= MAX_PENDING_COPILOT_TOOL_COMPLETIONS) {
          const oldest = pendingCopilotToolCompletions.keys().next().value;
          if (oldest) pendingCopilotToolCompletions.delete(oldest);
          reportCopilotProtocolDiagnostic(
            "orphan-tool-completion-limit",
            "Copilot emitted too many unmatched tool completions; some tool details were discarded.",
          );
        }
        pendingCopilotToolCompletions.set(toolCallId, completion);
      };

      const settlePendingCopilotToolCompletion = (toolCallId: string) => {
        const completion = pendingCopilotToolCompletions.get(toolCallId);
        if (!completion) return;
        const toolEv = toolTracker.envelopeToolResult(
          toolCallId,
          completion.output,
          completion.isError,
        );
        if (!toolEv) return;
        pendingCopilotToolCompletions.delete(toolCallId);
        push({ kind: "tool_use", ...toolEv });
      };

      const announceSession = (id: string) => {
        sessionId = id;
        // The client tracks the STABLE conversation id — on resumed
        // turns the harness mints a fresh internal id, which must not
        // leak out as a "new session" (it fragmented every continued
        // chat into one sidebar entry per turn).
        // An unrecorded resume token is not a Cave conversation identity. Its
        // unsupported fallback gets a new stable Cave id before spawning.
        const announcedId = body.sessionId && !openCodeUnrecordedResume
          ? body.sessionId
          : sessionId;
        // A new chat registered with only the client runId (body.sessionId is
        // null until the harness mints the id) — late-key the run so
        // /api/chat/stop and the sessions-list liveness probe reach it by
        // conversation id. runHandle is declared later in this scope but is
        // always initialized before the stream handlers that call announce.
        if (runHandle) addChatRunKeys(runHandle, [announcedId]);
        // First-turn visibility (cave-0g2x): persist a stub conversation with
        // the pending user turn as soon as the id exists, so the sessions
        // list can surface this chat during its entire first turn (and after
        // a mid-turn crash). Best-effort and a no-op for resumed chats; the
        // end-of-stream save strips the stub turn and re-appends the
        // authoritative one under the same id.
        stubWrite = createConversationStub({
          sessionId: announcedId,
          familiarId: body.familiarId,
          harness: binding.harness,
          ...(responseMetadata.model ? { model: responseMetadata.model } : {}),
          ...(responseMetadata.runtime ? { runtime: responseMetadata.runtime } : {}),
          title: ownsFirstExchangeTitle
            ? chatSummaryTitle({ userText: promptText }) ?? defaultChatTitleForSession(announcedId)
            : defaultChatTitleForSession(announcedId),
          ...(body.origin ? { origin: body.origin } : {}),
          modelIntent: modelIntentForSend(body, modelState),
          userTurn: {
            id: pendingUserTurnId,
            text: promptText,
            ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
            ...attentionClearOperationForTurn(body.runId),
            ...persistedTurnControls(body, responseMetadata.retryModel),
          },
        }).then(async (created) => {
          if (created && ownsFirstExchangeTitle) {
            await setDefaultStubTitleAuto(
              announcedId,
              chatSummaryTitle({ userText: promptText }) ?? defaultChatTitleForSession(announcedId),
            );
          }
          return created;
        }).catch(() => undefined);
        push({ kind: "session", sessionId: announcedId });
      };

      // Formatted OpenCode output carries no native session id. Cave still
      // needs a stable conversation identity so a plain-mode first response
      // is persisted and visible after reload; native resume remains disabled
      // below and falls back to recent-context replay.
      if (openCodeUnrecordedResume) {
        announceSession(crypto.randomUUID());
      } else if (openCodeDirect && !sessionId) {
        // Cave owns the conversation identity in both structured and plain
        // modes. Structured frames may announce a different native OpenCode
        // token; retain that separately rather than exposing it as the chat id.
        announceSession(crypto.randomUUID());
      }

      // Hermes's `-Q` mode reserves stdout for the reply and writes the
      // resumable id to stderr as `session_id: <id>`. Do not announce it
      // until a zero exit confirms the reply: a failed CLI can print an id
      // before its authentication/configuration error.
      let hermesStderrBuffer = "";
      let pendingHermesSessionId: string | null = null;
      const captureHermesSessionFromStderr = (text: string, flush = false) => {
        if (!hermesDirect || sessionId) return;
        hermesStderrBuffer += text;
        const lines = hermesStderrBuffer.split(/\r?\n/);
        hermesStderrBuffer = flush ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          const hermesSession = line.trim().match(/^session_id:\s*(\S+)\s*$/i);
          if (hermesSession) {
            pendingHermesSessionId = hermesSession[1];
            return;
          }
        }
      };

      // Copilot JSONL stream (cave-yesg): the CLI's own event schema, not
      // claude stream-json. Text arrives as message deltas + a full-content
      // message frame (deduped by CopilotTextAssembler); tool calls arrive as
      // toolRequests / execution_start / execution_complete keyed on a native
      // toolCallId, which maps onto the tracker's envelope lifecycle so live
      // chips, textOffset interleaving, and persistedTools all work exactly
      // as they do for claude. Non-JSON stdout is never assistant text on
      // this protocol — it only feeds the empty-response diagnostic tail.
      const handleCopilotLine = (line: string, isJson: boolean) => {
        if (isJson) {
          try {
            const raw = JSON.parse(line);
            const protocol = copilotStream?.protocol;
            if (!protocol) return;
            const ev = parseCopilotChatEvent(raw, protocol);
            if (!ev) {
              const diagnostic = copilotProtocolDiagnostic(raw, protocol);
              if (diagnostic) reportCopilotProtocolDiagnostic(diagnostic.code, diagnostic.message);
              return;
            }
            if (!confirmedModel && ev.kind !== "result") {
              const echoed = cleanModelId(ev.model);
              if (echoed) {
                confirmedModel = selectedModel
                  ? modelForCaveFromRuntimeEcho(
                      binding.harness,
                      selectedModel,
                      echoed,
                    )
                  : echoed;
              }
            }
            // Copilot only echoes the session id on the final result frame;
            // announce the id Cave launched with as soon as the stream is
            // live so the client can adopt the conversation immediately.
            if (!sessionId && copilotSessionHint) announceSession(copilotSessionHint);
            switch (ev.kind) {
              case "text_delta": {
                const text = copilotText.delta(ev.messageId, ev.text, ev.frameId);
                if (text) {
                  const previousAssistantText = assistantText;
                  assistantText = copilotTranscript.appendDelta(ev.messageId, text);
                  // Deltas for distinct message ids can interleave. Append
                  // only when the aggregate transcript really gained a tail;
                  // otherwise send the reconciled transcript to every client.
                  if (assistantText === `${previousAssistantText}${text}`) {
                    push({ kind: "assistant_chunk", text });
                  } else {
                    push({ kind: "assistant_replace", text: assistantText });
                  }
                }
                break;
              }
              case "message": {
                const text = copilotText.message(ev.messageId, ev.content);
                const replacement = copilotText.takeReplacement(ev.messageId);
                const correctionStart = copilotTranscript.offset(ev.messageId);
                const previousMessageLength = copilotTranscript.messageLength(ev.messageId);
                const previousAssistantText = assistantText;
                const correctedText = copilotTranscript.setMessage(ev.messageId, ev.content);
                // Tools can be announced after a delta but before this final
                // frame. Shift later tool positions for every length change,
                // including the normal "append suffix" confirmation path.
                toolTracker.rebaseTextOffsets(
                  correctionStart + previousMessageLength,
                  ev.content.length - previousMessageLength,
                );
                if (replacement) {
                  // A full frame corrects only its own message. Rebuild from
                  // per-message spans so an interleaved later message survives.
                  assistantText = correctedText;
                  push({ kind: "assistant_replace", text: assistantText });
                } else if (correctedText === previousAssistantText) {
                  assistantText = correctedText;
                } else if (correctedText === `${previousAssistantText}${text}`) {
                  assistantText = correctedText;
                  push({ kind: "assistant_chunk", text });
                } else {
                  // Even an empty message can add a transcript boundary. Send
                  // the authoritative text so clients retain that separator.
                  assistantText = correctedText;
                  push({ kind: "assistant_replace", text: assistantText });
                }
                if (ev.malformedToolRequests) {
                  reportCopilotProtocolDiagnostic(
                    "malformed-tool-event",
                    "Copilot CLI emitted a malformed tool-activity event; assistant chat continues but tool details may be incomplete. Update the Copilot runtime schema or CLI.",
                  );
                }
                // Tool requests announce calls before execution starts; the
                // tracker links the later execution_start onto the same id.
                for (const req of ev.toolRequests) {
                  boundarySentinel?.observe(req.name, req.input);
                  const toolEv = toolTracker.envelopeToolUse(
                    req.toolCallId,
                    req.name,
                    formatToolInputValue(req.input),
                    assistantText.length,
                  );
                  if (toolEv) push({ kind: "tool_use", ...toolEv });
                  settlePendingCopilotToolCompletion(req.toolCallId);
                }
                break;
              }
              case "tool_start": {
                boundarySentinel?.observe(ev.toolName, ev.input);
                const toolEv = toolTracker.envelopeToolUse(
                  ev.toolCallId,
                  ev.toolName,
                  formatToolInputValue(ev.input),
                  assistantText.length,
                );
                if (toolEv) push({ kind: "tool_use", ...toolEv });
                settlePendingCopilotToolCompletion(ev.toolCallId);
                break;
              }
              case "tool_end": {
                const toolEv = toolTracker.envelopeToolResult(
                  ev.toolCallId,
                  ev.output,
                  ev.isError,
                );
                if (toolEv) push({ kind: "tool_use", ...toolEv });
                else if (!toolTracker.hasSettledEnvelopeId(ev.toolCallId)) {
                  rememberPendingCopilotToolCompletion(ev.toolCallId, {
                    output: ev.output,
                    isError: ev.isError,
                  });
                }
                break;
              }
              case "result": {
                if (!sessionId && ev.sessionId) announceSession(ev.sessionId);
                result = {
                  duration_ms: ev.durationMs,
                  is_error: ev.isError,
                };
                break;
              }
            }
            return;
          } catch {
            // Never persist raw malformed JSONL: tool inputs and outputs can
            // contain prompts, paths, or secrets. Keep diagnostics fixed and
            // redacted just like other protocol-drift reporting.
            const code = "malformed-jsonl";
            reportCopilotProtocolDiagnostic(code, "Copilot emitted a malformed protocol frame.");
            recordStdoutErrorTail("Copilot emitted a malformed protocol frame.", true);
            return;
          }
        }
        // Direct Copilot stdout is protocol-only. Preserve no raw text here:
        // future CLIs may write prompts, paths, tool input, or output before
        // their JSONL frame, and the generic empty-response error is persisted.
        reportCopilotProtocolDiagnostic(
          "unframed-output",
          "Copilot emitted an unrecognized protocol frame.",
        );
        recordStdoutErrorTail("Copilot emitted an unrecognized protocol frame.", true);
      };

      const handleGrokLine = (line: string, isJson: boolean) => {
        if (!grokCompatibilityHealthNoticeSent && grokCompatibility?.diagnostic) {
          grokCompatibilityHealthNoticeSent = true;
          const label = grokCompatibility.diagnostic === "streaming-json-unavailable"
            ? "This Grok Build client does not advertise streaming JSON; continuing without tool activity"
            : grokCompatibility.diagnostic === "built-in-schema-expired"
              ? "Grok Build's built-in compatibility schema has expired; continuing without tool activity"
              : grokCompatibility.diagnostic === "no-compatible-schema"
                ? "This Grok Build client has no verified tool-event schema; continuing without tool activity"
                : "Grok Build's structured event protocol is unavailable; continuing without tool activity";
          pushProgress("grok-compatibility", label, "notice", grokCompatibility.diagnostic);
        }
        if (grokCompatibility?.mode === "plain") {
          // Plain output is safe only while it is prose. A changed client can
          // still emit an unverified JSON envelope even after capability
          // probing failed; never turn that possible tool payload into a
          // persisted assistant message or diagnostic.
          let unverifiedStructuredOutput = false;
          if (isJson) {
            try {
              const candidate = JSON.parse(line);
              unverifiedStructuredOutput = !!candidate && typeof candidate === "object";
            } catch {
              // Plain prose can begin with a brace or bracket. It has no
              // parseable structured boundary, so preserve it as text.
            }
          }
          if (unverifiedStructuredOutput) {
            recordStdoutErrorTail("Grok Build emitted an unverified structured event", true);
            if (!grokProtocolQuarantineNoticeSent) {
              grokProtocolQuarantineNoticeSent = true;
              pushProgress(
                "grok-compatibility",
                "Grok Build emitted unverified structured output; continuing without tool activity",
                "notice",
                "unverified-structured-output",
              );
            }
            return;
          }
          const text = `${resolveBackspaces(stripAnsi(line))}\n`;
           // Plain mode has no native session event. Once actual assistant
           // prose arrives, the launched UUID is safe to retain for persistence
           // and the next resume; do not manufacture it for raw envelopes.
          if (!grokSessionId && grokSessionHint) grokSessionId = grokSessionHint;
          if (!sessionId && grokSessionHint) announceSession(grokSessionHint);
          assistantText += text;
          push({ kind: "assistant_chunk", text });
          return;
        }
        if (!isJson) {
          quarantineGrokProtocol("unframed-jsonl-event");
          return;
        }
        try {
          const raw = JSON.parse(line);
          const event = grokStructuredProtocolQuarantined
            ? parseGrokStreamEvent(raw, grokCompatibility?.schema)
            : parseGrokCompatibilityEvent(raw, grokCompatibility?.schema);
          // A fresh native session's id is assigned by Cave because Grok only
          // returns it in its final frame. Once its first response frame
          // confirms the process is live, retain that id for a cancelled
          // partial turn too. Do not persist an id for a startup error: Grok
          // did not create a resumable session in that case.
          if (event.kind === "text" || event.kind === "end") {
            if (!grokSessionId && grokSessionHint) grokSessionId = grokSessionHint;
            if (!sessionId && grokSessionHint) announceSession(grokSessionHint);
          }
          switch (event.kind) {
            case "text":
              assistantText += event.text;
              push({ kind: "assistant_chunk", text: event.text });
              return;
            case "end":
              if (event.sessionId) grokSessionId = event.sessionId;
              if (!sessionId && event.sessionId) announceSession(event.sessionId);
              // Grok's end event does not echo model, but successful native
              // launch means its --model contract accepted the selected id.
              if (!confirmedModel && grokLaunchModel) confirmedModel = desiredModel;
              result = {
                is_error: false,
                usage: parseStreamJsonUsage(event.usage),
                costUsd: parseCostUsd(event.totalCostUsd),
              };
              return;
            case "error":
              result = {
                is_error: true,
                usage: parseStreamJsonUsage(event.usage),
                costUsd: parseCostUsd(event.totalCostUsd),
              };
              // Provider error frames are untrusted structured payloads; keep
              // their values out of transcript diagnostics.
              recordStdoutErrorTail("Grok Build returned a structured error", true);
              return;
            case "tool_start": {
              boundarySentinel?.observe(event.name, event.input);
              const started = toolTracker.envelopeToolUse(event.id, event.name, formatToolInputValue(event.input), assistantText.length);
              if (started) push({ kind: "tool_use", ...started });
              const progress = toolTracker.consumePendingEnvelopeProgress(event.id);
              if (progress) push({ kind: "tool_use", ...progress });
              const ended = toolTracker.consumePendingEnvelopeResult(event.id);
              if (ended) push({ kind: "tool_use", ...ended });
              return;
            }
            case "tool_progress": {
              const progress = toolTracker.envelopeToolProgress(event.id, typeof event.output === "string" ? event.output : formatToolInputValue(event.output));
              if (progress) push({ kind: "tool_use", ...progress });
              return;
            }
            case "tool_end": {
              const ended = toolTracker.envelopeToolResult(event.id, typeof event.output === "string" ? event.output : formatToolInputValue(event.output), event.isError);
              if (ended) push({ kind: "tool_use", ...ended });
              return;
            }
            case "tool_complete": {
              boundarySentinel?.observe(event.name, event.input);
              const started = toolTracker.envelopeToolUse(event.id, event.name, formatToolInputValue(event.input), assistantText.length);
              if (started) push({ kind: "tool_use", ...started });
              const progress = toolTracker.consumePendingEnvelopeProgress(event.id);
              if (progress) push({ kind: "tool_use", ...progress });
              // A terminal frame can be flushed before the combined snapshot.
              // Keep ToolCallTracker's first terminal outcome instead of
              // overwriting it with a later duplicate completion.
              const reorderedEnd = toolTracker.consumePendingEnvelopeResult(event.id);
              if (reorderedEnd) {
                push({ kind: "tool_use", ...reorderedEnd });
                return;
              }
              const ended = toolTracker.envelopeToolResult(event.id, typeof event.output === "string" ? event.output : formatToolInputValue(event.output), event.isError);
              if (ended) push({ kind: "tool_use", ...ended });
              return;
            }
            case "unknown":
              grokStructuredProtocolQuarantined = true;
              quarantineGrokSchema(grokCompatibility?.schema);
              recordStdoutErrorTail("Grok Build emitted a malformed structured event", true);
              if (!grokProtocolQuarantineNoticeSent) {
                grokProtocolQuarantineNoticeSent = true;
                pushProgress(
                  "grok-compatibility",
                  "Grok Build sent an unrecognized event; future turns will use safe plain chat until a compatible schema is available",
                  "notice",
                  `unknown-event:${redactedGrokEventFingerprint(raw)}`,
                );
              }
              return;
            case "ignore":
              return;
          }
        } catch {
          /* not valid JSON after all — fall through to the error tail */
        }
        quarantineGrokProtocol("malformed-jsonl-event");
      };

      const handleOpenCodeLine = (line: string) => {
        // Current OpenCode can write a human-oriented permission control
        // notice to stdout. Only structured mode has framing sufficient to
        // recognize it without risking a valid assistant-text loss.
        const plainText = resolveBackspaces(stripAnsi(line));
        if (openCodeCompatibility?.mode === "plain") {
          // Plain stdout has no framing that can distinguish OpenCode's control
          // notice from an assistant reply that happens to contain the same
          // words. Preserve every line rather than silently dropping valid text.
          const text = `${plainText}\n`;
          assistantText += text;
          push({ kind: "assistant_chunk", text });
          return;
        }
        // Structured JSON supplies a protocol boundary, so this known CLI
        // control line cannot be mistaken for assistant content.
        if (/^permission requested\b[\s\S]*\bauto-rejecting\b/i.test(plainText.trim())) return;
        // Current OpenCode writes this human-oriented permission control
        // notice to stdout even in `--format json` mode before it rejects the
        // request. It is neither an event nor assistant output; parsing it as
        // JSON would incorrectly quarantine an otherwise compatible stream.
        if (openCodeStructuredProtocolQuarantined) {
          // The schema has already proven incompatible in this stream. Keep
          // only text that still satisfies its explicit envelope/kind contract;
          // never allow later frames to create tools, results, or sessions.
          handleOpenCodeJsonLine(line, openCodeCompatibility?.schema, {
            onText: (ev) => {
              const text = ev.text.endsWith("\n") ? ev.text : `${ev.text}\n`;
              assistantText += text;
              push({ kind: "assistant_chunk", text });
            },
          });
          return;
        }
        handleOpenCodeJsonLine(line, openCodeCompatibility?.schema, {
          onSession: (nativeSessionId) => {
            openCodeSessionId = nativeSessionId;
            if (!sessionId) announceSession(nativeSessionId);
          },
          onText: (ev) => {
            const text = ev.text.endsWith("\n") ? ev.text : `${ev.text}\n`;
            assistantText += text;
            push({ kind: "assistant_chunk", text });
          },
          onTool: (ev) => {
            boundarySentinel?.observe(ev.name, ev.input);
            const started = toolTracker.envelopeToolUse(
              ev.id,
              ev.name,
              formatToolInputValue(ev.input),
              assistantText.length,
            );
            if (started) push({ kind: "tool_use", ...started });
            // A split terminal result can arrive before this combined
            // terminal snapshot. Preserve the first terminal outcome.
            const reorderedEnd = toolTracker.consumePendingEnvelopeResult(ev.id);
            if (reorderedEnd) {
              push({ kind: "tool_use", ...reorderedEnd });
              return;
            }
            const ended = toolTracker.envelopeToolResult(
              ev.id,
              typeof ev.output === "string" ? ev.output : formatToolInputValue(ev.output),
              ev.isError,
            );
            if (ended) push({ kind: "tool_use", ...ended });
          },
          onToolStart: (ev) => {
            boundarySentinel?.observe(ev.name, ev.input);
            const started = toolTracker.envelopeToolUse(
              ev.id,
              ev.name,
              formatToolInputValue(ev.input),
              assistantText.length,
            );
            if (started) push({ kind: "tool_use", ...started });
            const reorderedProgress = toolTracker.consumePendingEnvelopeProgress(ev.id);
            if (reorderedProgress) push({ kind: "tool_use", ...reorderedProgress });
            const reorderedEnd = toolTracker.consumePendingEnvelopeResult(ev.id);
            if (reorderedEnd) push({ kind: "tool_use", ...reorderedEnd });
          },
          onToolProgress: (ev) => {
            const progress = toolTracker.envelopeToolProgress(
              ev.id,
              typeof ev.output === "string" ? ev.output : formatToolInputValue(ev.output),
            );
            if (progress) push({ kind: "tool_use", ...progress });
          },
          onToolEnd: (ev) => {
            const ended = toolTracker.envelopeToolResult(
              ev.id,
              typeof ev.output === "string" ? ev.output : formatToolInputValue(ev.output),
              ev.isError,
            );
            if (ended) push({ kind: "tool_use", ...ended });
          },
          onError: (ev) => {
            // This is an explicit error envelope, so retain its error state
            // even if its message does not match the generic stderr filter.
            // Error envelopes are provider-controlled and can repeat prompts,
            // paths, command output, or credentials. Retain only the model
            // rejection classification needed for response metadata; never
            // copy their message into a persisted/user-visible diagnostic.
            openCodeModelRejected ||= modelRejectionInError(ev.message);
            resumeFailed ||= RESUME_ERR_RE.test(ev.message);
            recordStdoutErrorTail("OpenCode reported an error event", true);
            result = { ...result, is_error: true };
          },
          onOther: (ev, rawEvent) => {
            // Do not treat arbitrary `text`/`content` on an unknown envelope
            // as assistant output: tool progress and provider errors often
            // carry those fields and may contain secrets or file contents.
            openCodeStructuredProtocolQuarantined = true;
            quarantineOpenCodeSchema(openCodeCompatibility?.schema);
            if (!openCodeProtocolQuarantineNoticeSent) {
              openCodeProtocolQuarantineNoticeSent = true;
              pushProgress(
                "opencode-compatibility",
                "OpenCode sent an unrecognized event; future turns will use safe plain chat until a compatible schema is available",
                "notice",
                `${ev.diagnostic ?? "unknown-event"}:${redactedOpenCodeEventFingerprint(rawEvent)}`,
              );
            }
          },
          onMalformedJson: () => {
            quarantineOpenCodeProtocol(
              "OpenCode sent a malformed event; future turns will use safe plain chat until a compatible schema is available",
              "malformed-json-event",
            );
          },
        });
      };

      // Codex direct JSONL (cave-53iko.1): `codex exec --json` stdout is
      // protocol-only. Every line feeds the versioned, capability-gated
      // parser; prose, malformed frames, and unknown shapes become bounded
      // shape-only diagnostics — never assistant text or persisted payloads.
      const MAX_CODEX_JSONL_FRAME_CHARS = 256 * 1024;
      const recordCodexUnknownEvent = (fingerprint: string) => {
        codexUnknownEventCount += 1;
        if (codexUnknownEventFingerprints.size < 3) {
          codexUnknownEventFingerprints.add(fingerprint);
        }
      };
      const handleCodexDirectLine = (line: string) => {
        if (!codexSchema) return;
        if (line.length > MAX_CODEX_JSONL_FRAME_CHARS) {
          recordCodexUnknownEvent("oversized-jsonl");
          recordStdoutErrorTail("Codex emitted an oversized protocol frame", true);
          return;
        }
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
          // Fixed, payload-free diagnostic, exactly like the Copilot JSONL
          // path: future CLIs may write prompts or tool data before a frame.
          recordCodexUnknownEvent("unframed-output");
          recordStdoutErrorTail("Codex emitted an unrecognized protocol line", true);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          recordCodexUnknownEvent("malformed-jsonl");
          recordStdoutErrorTail("Codex emitted a malformed protocol frame", true);
          return;
        }
        const event = parseCodexStreamEvent(parsed, codexSchema);
        if (!event || event.kind === "ignored") return;
        switch (event.kind) {
          case "session": {
            codexSessionId = event.sessionId;
            if (!sessionId) announceSession(event.sessionId);
            return;
          }
          case "text": {
            const text = event.text.endsWith("\n") ? event.text : `${event.text}\n`;
            assistantText += text;
            push({ kind: "assistant_chunk", text });
            return;
          }
          case "tool_start": {
            boundarySentinel?.observe(event.name, event.input);
            const input = formatToolInputValue(event.input);
            const started = toolTracker.envelopeToolUse(
              event.id,
              event.name,
              input,
              assistantText.length,
            );
            if (started) push({ kind: "tool_use", ...started });
            else {
              // item.updated refreshes an already-announced call's input.
              const updated = toolTracker.envelopeToolInput(event.id, input);
              if (updated) push({ kind: "tool_use", ...updated });
            }
            const reorderedEnd = toolTracker.consumePendingEnvelopeResult(event.id);
            if (reorderedEnd) push({ kind: "tool_use", ...reorderedEnd });
            return;
          }
          case "tool_end": {
            boundarySentinel?.observe(event.name, event.input);
            // A terminal item carries its full description, so a completion
            // whose start frame was never seen still settles as one bubble.
            const started = toolTracker.envelopeToolUse(
              event.id,
              event.name,
              formatToolInputValue(event.input),
              assistantText.length,
            );
            if (started) push({ kind: "tool_use", ...started });
            const ended = toolTracker.envelopeToolResult(event.id, event.output, event.isError);
            if (ended) push({ kind: "tool_use", ...ended });
            return;
          }
          case "failure": {
            // Terminal Codex failure: error state only — the engine already
            // stripped every payload from this event.
            result = { ...result, is_error: true };
            recordStdoutErrorTail("Codex reported a failure event", true);
            return;
          }
          case "unknown": {
            recordCodexUnknownEvent(event.fingerprint);
            return;
          }
        }
      };

      const handleLine = (rawLine: string) => {
        // stdout is split on bare \n; external adapters (copilot) emit CRLF,
        // and a trailing \r would both fail the endsWith("}") JSON sniff and
        // leak into bubble text.
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        // Plain fallback is ordinary assistant text, so preserve empty lines;
        // structured JSONL control frames can still ignore blank transport rows.
        if (!line && !(openCodeDirect && openCodeCompatibility?.mode === "plain")) return;
        if (openCodeDirect && !openCodeCompatibilityHealthNoticeSent && openCodeCompatibility?.diagnostic) {
          openCodeCompatibilityHealthNoticeSent = true;
          const diagnostic = openCodeCompatibility.diagnostic === "capability-probe-unavailable"
            ? "Couldn't verify OpenCode JSON events; continuing in plain chat without tool activity"
            : openCodeCompatibility.diagnostic === "capability-probe-fallback"
              ? "OpenCode capability probe was unavailable; using recently verified JSON event support"
            : openCodeCompatibility.diagnostic === "json-format-unavailable"
            ? "This OpenCode client does not advertise JSON events; continuing without tool activity"
            : openCodeCompatibility.diagnostic === "no-compatible-schema"
              ? "This OpenCode client has no verified tool-event schema; continuing without tool activity"
              : openCodeCompatibility.diagnostic === "schema-quarantined"
                ? "OpenCode's structured event protocol was quarantined; continuing without tool activity"
              : openCodeCompatibility.diagnostic === "cached-schema-unavailable"
                ? "OpenCode's compatibility registry is unavailable; continuing in plain chat without tool activity"
              : openCodeCompatibility.bundleSource === "built-in"
                ? "OpenCode schema refresh was not trusted; using the shipped compatible parser"
                : "OpenCode schema refresh was not trusted; using the last known compatible parser";
          pushProgress(
            "opencode-compatibility",
            diagnostic,
            "notice",
            openCodeCompatibility.diagnostic,
          );
        }
        const openCodePlainFallback = openCodeDirect && openCodeCompatibility?.mode === "plain";
        // Plain OpenCode has no structured error envelope, so stdout cannot
        // distinguish a real resume failure from an assistant reply quoting it.
        // Preserve every line rather than converting ordinary reply text into
        // a dropped retry signal.
        if (!openCodePlainFallback && RESUME_ERR_RE.test(line)) resumeFailed = true;
        const isJson = !hermesDirect && line.startsWith("{") && line.endsWith("}");
        // JSON.parse accepts primitive roots too. Claude needs those values to
        // reach the redacted compatibility boundary instead of plain stdout.
        const isClaudeStreamFrame = binding.harness === "claude" && isClaudeStreamJsonFrame(line);
        if (copilotStream) {
          // Direct Copilot output is JSONL. A truncated frame still starts
          // with `{`, so route it through the fixed redacted diagnostic path
          // instead of ever adding raw tool data to stdout error tails.
          handleCopilotLine(line, isJson || line.trimStart().startsWith("{"));
          return;
        }
        if (grokDirect) {
          // Plain Grok fallback must not make a structured envelope with
          // leading whitespace look like harmless assistant prose.
          handleGrokLine(line, isJson || /^[{\[]/.test(line.trimStart()));
          return;
        }
        if (openCodeDirect) {
          handleOpenCodeLine(line);
          return;
        }
        if (codexDirect) {
          handleCodexDirectLine(line);
          return;
        }
        if (isJson || isClaudeStreamFrame) {
          try {
            const ev = JSON.parse(line) as {
              type: string;
              subtype?: string;
              session_id?: string;
              model?: string;
              duration_ms?: number;
              is_error?: boolean;
              total_cost_usd?: number;
              usage?: unknown;
              text?: string;
              message?: {
                content?: Array<{
                  type?: string;
                  text?: string;
                  // tool_use blocks
                  id?: string;
                  name?: string;
                  input?: unknown;
                  // tool_result blocks
                  tool_use_id?: string;
                  content?: unknown;
                  is_error?: boolean;
                }>;
              };
            };
            // The init/system event echoes the harness's resolved model. Record
            // the first one seen so the turn can report `applied` honestly.
            if (!confirmedModel && (ev.type === "system" || ev.subtype === "init")) {
              const echoed = cleanModelId(ev.model);
              if (echoed) {
                confirmedModel = selectedModel
                  ? modelForCaveFromRuntimeEcho(
                      binding.harness,
                      selectedModel,
                      echoed,
                    )
                  : echoed;
              }
            }
            if (ev.session_id && !sessionId) {
              // Same contract as announceSession (stable-id announce, default
              // title, first-turn stub) for the stream-json protocol path.
              announceSession(ev.session_id);
            }
            if (ev.type === "result") {
              // The result event also carries token usage and total cost
              // (CHAT-D12-02). Both are optional and defensively validated —
              // harnesses without billing metadata simply omit them.
              result = {
                duration_ms: ev.duration_ms,
                is_error: ev.is_error,
                usage: parseStreamJsonUsage(ev.usage),
                costUsd: parseCostUsd(ev.total_cost_usd),
              };
              if (ev.is_error === false) covenCompletedSuccessfulResult = true;
            } else if (
              // `output` belongs to Coven's Windows Codex bridge, not the
              // profile-selected Claude protocol. Let an unexpected Claude
              // output frame reach the compatibility boundary below so its
              // value cannot be rendered or retained in diagnostics.
              binding.harness !== "claude" &&
              ev.type === "output" &&
              typeof ev.text === "string"
            ) {
              // Coven's Windows captured-piped Codex path wraps transcript
              // bytes as stream-json `output` events so stdout remains a
              // valid JSONL protocol. Preserve the original chunk boundaries:
              // AssistantFilter buffers partial lines and exposes only the
              // assistant phase after stripping Codex's startup transcript.
              const cleaned = resolveBackspaces(stripAnsi(ev.text));
              captureCodexAdapterFailure(cleaned);
              recordStdoutErrorTail(cleaned);
              const filtered = assistantFilter.push(cleaned);
              if (filtered) {
                assistantText += filtered;
                push({ kind: "assistant_chunk", text: filtered });
              }
            } else if (
              // Coven's native stream-json transport represents completed
              // Codex replies as an `assistant` envelope, just like the
              // adapter's direct CLI output.  This is structured assistant
              // content, not raw Codex transcript text, so it must bypass
              // AssistantFilter's marker-phase gate.  Previously only the
              // Claude compatibility branch decoded this shape; a successful
              // Coven Codex reply was therefore discarded and misreported as
              // an empty/authentication failure.
              binding.harness !== "claude" &&
              ev.type === "assistant" &&
              Array.isArray(ev.message?.content)
            ) {
              for (const block of ev.message.content) {
                if (block?.type !== "text" || typeof block.text !== "string" || !block.text) continue;
                assistantText += block.text;
                push({ kind: "assistant_chunk", text: block.text });
              }
            } else if (
              binding.harness === "claude" &&
              claudeCompatibility?.kind === "compatible" &&
              !claudeCompatibility.stale &&
              claudeToolsEnabled
            ) {
              // Profile-selected decoding keeps version-specific envelope names
              // outside this route. The shared tracker continues to provide
              // stable ids, hook/envelope deduplication, and persisted state.
              if (hasUnsupportedClaudeToolFrame(ev, claudeCompatibility.profile)) {
                reportUnsupportedClaudeToolFrame(ev);
                // A partially known envelope is not a verified tool protocol:
                // keep only ordinary assistant text rather than pairing its
                // sibling tool blocks with untrusted frames.
                for (const text of parseClaudeTextOnlyEnvelope(ev)) {
                  assistantText += text;
                  push({ kind: "assistant_chunk", text });
                }
                return;
              }
              for (const claudeEvent of parseClaudeMessageEnvelope(ev, claudeCompatibility.profile)) {
                if (claudeEvent.kind === "text") {
                  assistantText += claudeEvent.text;
                  push({ kind: "assistant_chunk", text: claudeEvent.text });
                } else if (claudeEvent.kind === "tool-use") {
                  boundarySentinel?.observe(claudeEvent.name, claudeEvent.input);
                  const toolEv = toolTracker.envelopeToolUse(
                    claudeEvent.id,
                    claudeEvent.name,
                    formatToolInputValue(claudeEvent.input),
                    assistantText.length,
                  );
                  if (toolEv) push({ kind: "tool_use", ...toolEv });
                  const reorderedEnd = toolTracker.consumePendingEnvelopeResult(claudeEvent.id);
                  if (reorderedEnd) push({ kind: "tool_use", ...reorderedEnd });
                } else {
                  const toolEv = toolTracker.envelopeToolResult(
                    claudeEvent.toolUseId,
                    flattenToolResultContent(claudeEvent.content),
                    claudeEvent.isError,
                  );
                  if (toolEv) push({ kind: "tool_use", ...toolEv });
                }
              }
            } else if (
              binding.harness === "claude" &&
              ev.type === "assistant" &&
              Array.isArray(ev.message?.content)
            ) {
              // An unrecognised Claude version must remain useful for ordinary
              // chat. Preserve text-only content, while deliberately refusing
              // to manufacture tool bubbles from an unverified envelope.
              if (!claudeFallbackFingerprintLogged) {
                claudeFallbackFingerprintLogged = true;
                console.warn("[chat] Claude tool envelope ignored under compatibility fallback", {
                  fingerprint: redactedEventFingerprint(ev),
                });
              }
              for (const text of parseClaudeTextOnlyEnvelope(ev)) {
                assistantText += text;
                push({ kind: "assistant_chunk", text });
              }
            }
            return;
          } catch {
            // Claude's stream-json frames can contain tool inputs and outputs.
            // A malformed JSONL line must never fall through into the generic
            // stdout/error diagnostics, which would expose that payload when a
            // turn otherwise has no assistant text.
            if (binding.harness === "claude") {
              reportMalformedClaudeStreamFrame(line);
              return;
            }
            /* fall through to filter */
          }
        }
        const cleaned = resolveBackspaces(stripAnsi(line));
        const trimmed = cleaned.trim();
        // `isJson` requires an object with a closing brace, so malformed
        // object and array JSONL frames reach this path. Treat them like any
        // other malformed stream frame instead of rendering or retaining raw
        // tool payload values in an empty-response diagnostic.
        if (binding.harness === "claude" && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
          reportMalformedClaudeStreamFrame(line);
          return;
        }
        // Older Hermes versions can print the durable session id to stdout.
        // The current quiet path writes it to stderr (captured separately).
        if (hermesDirect) {
          const hermesSession = trimmed.match(/^Session ID:\s*(\S+)\s*$/i);
          if (hermesSession && !sessionId) {
            announceSession(hermesSession[1]);
            return;
          }
        }
        // Snapshot error-looking stdout lines for the empty-response diagnostic.
        captureCodexAdapterFailure(cleaned);
        recordStdoutErrorTail(cleaned);
        // Surface tool-use hook lines as structured events so the chat can
        // render a tool block. Hooks are still discarded by AssistantFilter
        // below, so this is purely additive.
        const toolMatch = trimmed.match(TOOL_HOOK_RE);
        // Claude stdout can contain complete tool inputs or outputs, including
        // on unrecognised non-hook lines. Do not retain any Claude stdout in
        // the generic empty-response diagnostic, even when the profile is
        // unavailable and no bubble is emitted.
        if (binding.harness !== "claude") {
          recordStdoutErrorTail(cleaned);
        }
        if (toolMatch && claudeToolsEnabled) {
          const isPost = trimmed.startsWith("hook: post_tool_use");
          const name = toolMatch[1];
          const rest = (toolMatch[2] ?? "").trim();
          if (!isPost) boundarySentinel?.observe(name, rest);
          const toolEv = isPost
            ? toolTracker.hookEnd(
                name,
                formatToolPayload(rest),
                /error|fail|denied|exit\s*[1-9]/i.test(rest),
              )
            : toolTracker.hookStart(name, formatToolPayload(rest), assistantText.length);
          push({ kind: "tool_use", ...toolEv });
        }
        const filtered = assistantFilter.push(cleaned + "\n");
        if (filtered) {
          assistantText += filtered;
          push({ kind: "assistant_chunk", text: filtered });
        }
      };

      // One registration covers both attempts (resume retry replaces the
      // child): /api/chat/stop kills whichever child is current and flags the
      // run as user-cancelled. A bare transport abort no longer kills — the
      // turn finishes and persists, bounded by the detach cap.
      let currentChild: ReturnType<typeof spawn> | null = null;
      let currentHermesAbort: AbortController | null = null;
      const killCurrentChild = () => {
        try {
          currentChild?.kill("SIGTERM");
          currentHermesAbort?.abort();
        } catch {
          /* ignore */
        }
      };
      runHandle = registerChatRun(
        [body.runId, body.sessionId, sessionId],
        killCurrentChild,
      );
      let detachKillTimer: ReturnType<typeof setTimeout> | null = null;
      const armDetachKill = () => {
        if (runHandle.stopRequested || detachKillTimer != null) return;
        detachKillTimer = setTimeout(killCurrentChild, CHAT_DETACH_MAX_MS);
      };
      // Re-attach (GET /api/chat/stream) cancels the pending kill; the last
      // tail dropping re-arms it — but only once the ORIGINAL request is
      // gone, so a resume tail closing can't kill a still-attached turn.
      runBuffer = openRunBuffer([body.runId, body.sessionId], {
        attach: () => {
          if (detachKillTimer != null) {
            clearTimeout(detachKillTimer);
            detachKillTimer = null;
          }
        },
        detach: () => {
          if (req.signal.aborted) armDetachKill();
        },
      });

      const runHermesApiAttempt = async (apiPrompt: string): Promise<void> => {
        // This is an opt-in local/API-server transport. Hermes quiet CLI output
        // is intentionally not treated as a versioned tool-event protocol.
        if (!hermesApi) return;
        const attemptStartedAt = Date.now();
        const abort = new AbortController();
        currentHermesAbort = abort;
        let hermesToolsSettled = false;
        const settleOpenHermesTools = (reason: string) => {
          if (hermesToolsSettled) return;
          hermesToolsSettled = true;
          for (const toolEv of toolTracker.failOpenCalls(reason)) {
            push({ kind: "tool_use", ...toolEv });
          }
        };
        // Endpoint paths can carry reverse-proxy credentials; never put a
        // configured URL in browser-visible progress or run-replay events.
        pushProgress("harness-start", "Starting Hermes API", "running");
        const onAbort = () => {
          // Transport loss is resumable, not a user Stop: keep consuming until
          // the shared detach deadline, exactly like a child-process attempt.
          armDetachKill();
        };
        req.signal.addEventListener("abort", onAbort, { once: true });
        // AbortSignal does not replay an already-fired event. Route setup can
        // outlive a client disconnect, so arm the shared deadline before the
        // remote request starts in that race as well.
        if (req.signal.aborted) onAbort();
        try {
          const previousResponseId = hermesPreviousResponseId;
          const response = await fetch(hermesResponsesUrl(hermesApi), {
            method: "POST",
            signal: abort.signal,
            // Do not let a configured server redirect prompts or bearer
            // credentials past the validated endpoint boundary.
            redirect: "error",
            headers: {
              "content-type": "application/json",
              accept: "text/event-stream",
              authorization: `Bearer ${hermesApi.apiKey}`,
            },
            body: JSON.stringify({
              ...(hermesLaunchModel ? { model: hermesLaunchModel } : {}),
              input: apiPrompt,
              stream: true,
              ...(hermesReasoningEffort ? { reasoning: { effort: hermesReasoningEffort } } : {}),
              ...(hermesVerbosity ? { text: { verbosity: hermesVerbosity } } : {}),
              ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
            }),
          });
          const contentType = response.headers.get("content-type") ?? "";
          if (!response.ok || !response.body || !/^text\/event-stream(?:\s*;|$)/i.test(contentType)) {
            const apiError = !response.ok && /^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)
              ? await response.json().catch(() => undefined)
              : undefined;
            if (
              previousResponseId &&
              (isHermesInvalidPreviousResponseIdError(apiError) ||
                (response.status === 404 && isHermesMissingPreviousResponseError(apiError)))
            ) {
              resumeFailed = true;
            }
            result = { ...result, is_error: true };
            recordStdoutErrorTail(
              !response.ok
                ? `Hermes API request failed (${response.status})`
                : `Hermes API protocol error: expected text/event-stream, received ${contentType || "no content type"}`,
              true,
            );
            await response.body?.cancel().catch(() => undefined);
            return;
          }
          const reader = response.body.getReader();
          const utf8 = new TextDecoder();
          const decoder = new HermesSseDecoder();
          const hermesCallIdsByItemId = new Map<string, string>();
          const hermesCallNamesById = new Map<string, string>();
          const hermesArgumentBuffers = new Map<string, string>();
          const consume = (frame: { event: string; data: string }): boolean => {
            if (!frame.data.trim()) return false;
            if (frame.data === "[DONE]") return true;
            // Extensions commonly emit textual pings/progress. Unknown named
            // events are deliberately forward-compatible; only supported
            // protocol events must parse as JSON.
            if (frame.event && frame.event !== "message" && !isHermesResponsesEventName(frame.event)) {
              return false;
            }
            let payload: unknown;
            try {
              payload = JSON.parse(frame.data);
            } catch {
              // A malformed event can hide text or a tool transition. Do not
              // present a later terminal frame as a completed response after
              // silently discarding it.
              result = { ...result, is_error: true };
              recordStdoutErrorTail("Hermes API protocol error: malformed SSE payload", true);
              return true;
            }
            const event = parseHermesResponsesEvent(frame.event, payload);
            switch (event.kind) {
              case "session":
                hermesResponseId = event.id;
                if (!sessionId) announceSession(event.id);
                return false;
              case "text":
                assistantText += event.text;
                push({ kind: "assistant_chunk", text: event.text });
                return false;
              case "tool_start": {
                const input = formatToolInputValue(redactSecretsDeep(event.input));
                if (event.itemId) hermesCallIdsByItemId.set(event.itemId, event.id);
                hermesCallNamesById.set(event.id, event.name);
                if (input !== undefined) hermesArgumentBuffers.set(event.id, input);
                boundarySentinel?.observe(event.name, input ?? "");
                const toolEv = toolTracker.envelopeToolUse(event.id, event.name, input, assistantText.length);
                if (toolEv) push({ kind: "tool_use", ...toolEv });
                else if (input !== undefined) {
                  // Hermes progress can announce a call before the canonical
                  // Responses item. Keep the same bubble id but replace its
                  // preliminary input when the canonical item is complete.
                  const updated = toolTracker.envelopeToolInput(event.id, input);
                  if (updated) push({ kind: "tool_use", ...updated });
                }
                return false;
              }
              case "tool_input": {
                const id = event.id ?? (event.itemId ? hermesCallIdsByItemId.get(event.itemId) : undefined);
                if (!id) return false;
                const next = event.isFinal
                  ? event.input
                  : `${hermesArgumentBuffers.get(id) ?? ""}${event.input}`;
                hermesArgumentBuffers.set(id, next);
                // Standard Responses calls often arrive with empty arguments
                // and stream their actual path-bearing input afterward. Check
                // the assembled final value at the same runtime boundary as
                // the initial tool announcement.
                if (event.isFinal) {
                  const name = hermesCallNamesById.get(id);
                  if (name) boundarySentinel?.observe(name, next);
                }
                const toolEv = toolTracker.envelopeToolInput(id, formatToolInputValue(redactSecretText(next)));
                if (toolEv) push({ kind: "tool_use", ...toolEv });
                return false;
              }
              case "tool_end": {
                const safeOutput = redactSecretsDeep(event.output);
                const rawOutput = flattenToolResultContent(safeOutput) ?? formatToolInputValue(safeOutput);
                const output = rawOutput === undefined ? undefined : redactSecretText(rawOutput);
                const toolEv = toolTracker.envelopeToolResult(event.id, output, event.isError);
                if (toolEv) push({ kind: "tool_use", ...toolEv });
                return false;
              }
              case "done":
                if (event.id) {
                  hermesResponseId = event.id;
                  if (!sessionId) announceSession(event.id);
                }
                result = { ...result, is_error: event.isError };
                if (event.isError) recordStdoutErrorTail("Hermes API stream failed", true);
                if (event.isError && previousResponseId && event.invalidPreviousResponseId) resumeFailed = true;
                return true;
              case "error":
                result = { ...result, is_error: true };
                if (previousResponseId && event.invalidPreviousResponseId) resumeFailed = true;
                recordStdoutErrorTail("Hermes API stream failed", true);
                return true;
              case "ignore":
                return false;
            }
          };
          try {
            let terminal = false;
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              for (const frame of decoder.push(utf8.decode(value, { stream: true }))) {
                terminal = consume(frame) || terminal;
                if (terminal) break;
              }
              if (terminal) {
                await reader.cancel();
                break;
              }
            }
            if (!terminal) {
              for (const frame of decoder.push(utf8.decode())) {
                terminal = consume(frame) || terminal;
                if (terminal) break;
              }
            }
            if (!terminal) {
              for (const frame of decoder.finish()) {
                terminal = consume(frame) || terminal;
                if (terminal) break;
              }
            }
            if (!terminal && !abort.signal.aborted) {
              // EOF without an explicit protocol terminal means a proxy or
              // server cut the response short. Preserve any partial text for
              // diagnostics, but never present or persist it as a completed
              // model turn.
              result = { ...result, is_error: true };
              recordStdoutErrorTail("Hermes API stream ended before a terminal event", true);
            }
          } finally {
            reader.releaseLock();
          }
        } catch (error) {
          if (abort.signal.aborted) {
            // A detach deadline aborts the fetch just like a child kill. It
            // never received a protocol terminal, so do not persist partial
            // output as a resumable completed turn. Explicit Stop follows the
            // cancellation path below and remains intentionally non-error.
            if (!runHandle.stopRequested) {
              result = { ...result, is_error: true };
              recordStdoutErrorTail("Hermes API stream aborted after client disconnect", true);
            }
          } else {
            result = { ...result, is_error: true };
            recordStdoutErrorTail("Hermes API request failed", true);
          }
        } finally {
          settleOpenHermesTools(
            abort.signal.aborted
              ? "[tool interrupted because the Hermes stream was cancelled]"
              : "[tool did not settle before the Hermes stream ended]",
          );
          req.signal.removeEventListener("abort", onAbort);
          if (currentHermesAbort === abort) currentHermesAbort = null;
          result.duration_ms = Date.now() - attemptStartedAt;
          pushProgress(
            "harness-start",
            result.is_error ? "Hermes API stream failed" : "Hermes API stream finished",
            result.is_error ? "error" : "done",
            undefined,
            result.duration_ms,
          );
        }
      };

      const runAttempt = (spawnArgs: string[], apiPrompt = harnessPrompt): Promise<void> => {
        if (hermesApi) return runHermesApiAttempt(apiPrompt);
        return new Promise((resolve) => {
          const attemptStartedAt = Date.now();
          let discardingOpenCodeFrame = false;
          let claudeInnerLaunchMissing = false;
          pushProgress(
            "harness-start",
            `Starting ${binding.harness}`,
            "running",
            sshRuntime
              ? `${sshRuntime.host}:${sshRuntime.cwd}`
              // OpenCode compatibility diagnostics must not expose a local
              // workspace path. Other harnesses retain their existing launch
              // location detail.
              : openCodeDirect ? undefined : cwd,
          );
          const reportLaunchFailure = (err: NodeJS.ErrnoException) => {
            let localLaunchError: { code: string; message: string } = localRuntimeLaunchError(
              localRuntimePlan?.runner ?? "coven",
              err.code,
            );
            if (hermesDirect) localLaunchError = hermesLaunchFailure(localRuntimePlan ?? undefined);
            const openCodeWindowsOuterLaunchFailure =
              openCodeDirect && process.platform === "win32" && err.code === "ENOENT";
            const openCodeCommandMissing =
              openCodeDirect && !openCodeWindowsOuterLaunchFailure && err.code === "ENOENT";
            const launchError = sshRuntime
              ? err.code === "ENOENT"
                ? "ssh CLI not found on PATH. Install OpenSSH or run this familiar locally."
                : err.message
              : openCodeWindowsOuterLaunchFailure
                ? "OpenCode failed to start. Check its installation and try again."
                : openCodeCommandMissing
                  ? missingRunnerMessage("opencode")
                  : localLaunchError.message;
            const launchCode =
              !sshRuntime && err.code === "ENOENT" && binding.harness === "claude"
                ? RUNTIME_AVAILABILITY_ERROR_CODES.coven_missing
                : openCodeCommandMissing
                  ? "runtime_missing"
                  : openCodeWindowsOuterLaunchFailure
                    ? "runtime_launch_failed"
                    : localLaunchError.code;
            result.is_error = true;
            launchFailure ??= {
              code: sshRuntime ? err.code ?? "runtime_launch_failed" : launchCode,
              message: launchError,
            };
            pushProgress(
              "harness-start",
              `${binding.harness} failed to start`,
              "error",
              launchError,
              Date.now() - attemptStartedAt,
            );
            push({
              kind: "error",
              ...(sshRuntime ? (err.code ? { code: err.code } : {}) : { code: launchFailure.code }),
              message: launchError,
            });
          };
          let child:
            | ChildProcessWithoutNullStreams
            | ChildProcessByStdio<null, Readable, Readable>
            | null = null;
          try {
            child = sshRuntime
            ? (() => {
                const sshArgs = spawnArgs;
                return spawn("ssh", sshArgs, {
                  windowsHide: true,
                  stdio: ["ignore", "pipe", "pipe"],
                  env: harnessSpawnEnv(body.familiarId),
                });
              })()
            : (() => {
                const localPlan = localRuntimePlan;
                if (!localPlan) {
                  const message =
                    "Could not prepare the local runtime launch before starting it, so this turn was not run. Try again.";
                  launchFailure = { code: "runtime_probe_failed", message };
                  result.is_error = true;
                  pushProgress(
                    "harness-start",
                    `${binding.harness} failed to start`,
                    "error",
                    message,
                    Date.now() - attemptStartedAt,
                  );
                  push({ kind: "error", code: "runtime_probe_failed", message });
                  return null;
                }
                // Regenerate OpenCode's canonical direct command and fixed
                // target args with the per-attempt argv; the early plan's
                // environment is reused.
                const openCodeLaunchCommand = openCodeDirect
                  ? openCodeLaunch(spawnArgs, process.platform, localPlan.env)
                  : null;
                // Preserve the early no-spawn decision. Ready plans receive a
                // second passive check immediately before spawn so a removed
                // binary cannot drift into the empty-output/auth diagnostic.
                const availability =
                  localPlan.availability.state === "ready"
                    ? binding.harness === "claude"
                      ? evaluateCovenBackedRuntimeAvailability({
                          runner: "claude",
                          covenCommand: localPlan.command,
                          env: localPlan.env,
                          unresolvedCovenWindowsShim:
                            localPlan.unresolvedWindowsShim === true,
                          requiredCovenFiles: localPlan.requiredFiles,
                        })
                      : evaluateRuntimeAvailability(
                          openCodeLaunchCommand
                            ? openCodeAvailabilityProbe(
                                openCodeLaunchCommand,
                                localPlan.env,
                              )
                            : {
                                runner: localPlan.runner,
                                command: localPlan.command,
                                env: localPlan.env,
                                requiredFiles: localPlan.requiredFiles,
                                unresolvedWindowsShim:
                                  localPlan.unresolvedWindowsShim === true,
                                cwd: localPlan.cwd,
                              },
                        )
                    : localPlan.availability;
                if (availability.state !== "ready") {
                  launchFailure = { code: availability.code, message: availability.message };
                  result.is_error = true;
                  pushProgress(
                    "harness-start",
                    `${binding.harness} failed to start`,
                    "error",
                    availability.message,
                    Date.now() - attemptStartedAt,
                  );
                  push({ kind: "error", code: availability.code, message: availability.message });
                  return null;
                }
                const command = openCodeLaunchCommand
                  ?? {
                    command: localPlan.command,
                    args: [...localPlan.fixedArgs, ...spawnArgs],
                  };
                try {
                  const spawnOptions = {
                    // Spawn IN the familiar's workspace when no project root was
                    // supplied, so coven's project-root resolver picks that dir as
                    // root and Codex/Claude pick up AGENTS.md / SOUL.md / IDENTITY.md
                    // from the familiar's home. When a project root IS supplied,
                    // honor that instead.
                    cwd: localPlan.cwd ?? cwd,
                    env: localPlan.env,
                    shell: false,
                    // The sidecar runs without a console (CREATE_NO_WINDOW), so
                    // a console-subsystem child would be given a fresh, visible
                    // one. Every research familiar step spawns through here.
                    windowsHide: true,
                  } as const;
                  if (openCodeDirect) {
                    const child = spawn(/* turbopackIgnore: true */ command.command, command.args, {
                      ...spawnOptions,
                      stdio: ["pipe", "pipe", "pipe"],
                    });
                    // Always observe stdin errors: a fast child exit can close
                    // the pipe while a large prompt is still being written.
                    // Keep diagnostics fixed and value-free so prompt contents
                    // and local paths never leak into the transcript.
                    child.stdin.on("error", () => {
                      result = { ...result, is_error: true };
                      recordStdoutErrorTail("OpenCode prompt input failed", true);
                    });
                    child.stdin.end(apiPrompt, "utf8");
                    return child;
                  }
                  return spawn(/* turbopackIgnore: true */ command.command, command.args, {
                    ...spawnOptions,
                    stdio: ["ignore", "pipe", "pipe"],
                  });
                } catch (error) {
                  reportLaunchFailure(error as NodeJS.ErrnoException);
                  return null;
                }
              })();
          } catch (error) {
            // A plan can pass passive preflight yet still throw synchronously
            // during spawn (notably invalid Windows executables).
            reportLaunchFailure(error as NodeJS.ErrnoException);
            resolve();
            return;
          }

          if (!child) {
            resolve();
            return;
          }

          currentChild = child;
          let childLaunchFailed = false;
          const onAbort = () => {
            // Transport drop, not Stop — arm the detach cap and let the turn
            // finish. Deliberate stops kill through the registry instead.
            armDetachKill();
          };
          req.signal.addEventListener("abort", onAbort, { once: true });

          // Child-process chunks are arbitrary bytes, not UTF-8 character
          // boundaries. Preserve a split code point until its remaining bytes
          // arrive so JSONL text/tool payloads cannot silently gain U+FFFD.
          const openCodeStdoutDecoder = openCodeDirect ? new StringDecoder("utf8") : null;
          const hermesStdout = hermesDirect ? [] as Buffer[] : null;
          const handleStdoutChunk = (decodedChunk: string) => {
            let chunk = decodedChunk;
            // Once an unterminated frame crosses the cap, discard through its
            // newline before looking for another frame. Parsing its tail could
            // turn provider data into a misleading compatibility event.
            if (discardingOpenCodeFrame) {
              const newline = chunk.indexOf("\n");
              if (newline < 0) return;
              discardingOpenCodeFrame = false;
              chunk = chunk.slice(newline + 1);
            }
            jsonBuf += chunk;
            let idx;
            while ((idx = jsonBuf.indexOf("\n")) >= 0) {
              const line = jsonBuf.slice(0, idx);
              jsonBuf = jsonBuf.slice(idx + 1);
              if (
                openCodeDirect
                && openCodeCompatibility?.mode === "structured"
                && Buffer.byteLength(line, "utf8") > MAX_OPENCODE_JSONL_FRAME_BYTES
              ) {
                quarantineOpenCodeProtocol(
                  "OpenCode sent an oversized event; future turns will use safe plain chat until a compatible schema is available",
                  "oversized-jsonl-event",
                );
                continue;
              }
              handleLine(line);
            }
            // Plain compatibility mode is ordinary assistant text, not a
            // JSONL control frame. Flush a long partial line in bounded
            // chunks so a hostile/no-newline client cannot retain it forever.
            if (
              openCodeDirect
              && openCodeCompatibility?.mode === "plain"
              && Buffer.byteLength(jsonBuf, "utf8") > MAX_OPENCODE_JSONL_FRAME_BYTES
            ) {
              const plainChunk = jsonBuf;
              jsonBuf = "";
              handleLine(plainChunk);
            }
            if (
              openCodeDirect
              && openCodeCompatibility?.mode === "structured"
              && Buffer.byteLength(jsonBuf, "utf8") > MAX_OPENCODE_JSONL_FRAME_BYTES
            ) {
              jsonBuf = "";
              discardingOpenCodeFrame = true;
              quarantineOpenCodeProtocol(
                "OpenCode sent an oversized event; future turns will use safe plain chat until a compatible schema is available",
                "oversized-jsonl-event",
              );
            }
          };

          child.stdout.on("data", (data: Buffer) => {
            if (hermesStdout) {
              hermesStdout.push(data);
              return;
            }
            const chunk = openCodeStdoutDecoder ? openCodeStdoutDecoder.write(data) : stdoutDecoder.write(data);
            if (chunk) handleStdoutChunk(chunk);
          });

          child.stderr.on("data", (data: Buffer) => {
            const text = stripAnsi(data.toString("utf8"));
            captureHermesSessionFromStderr(text);
            if (RESUME_ERR_RE.test(text)) resumeFailed = true;
            if (!adapterConflict) {
              adapterConflict = detectBuiltinAdapterConflict(text);
            }
            for (const line of text.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              // Claude stderr can include tool payloads. It must not be copied
              // into the generic empty-response diagnostic, which is rendered
              // to the chat transcript.
              if (binding.harness !== "claude") {
                stderrTail.push(trimmed);
                if (stderrTail.length > STDERR_KEEP) stderrTail.shift();
              } else if (/(?:spawn\s+claude\s+ENOENT|claude:\s*command not found|command not found:\s*claude)/i.test(trimmed)) {
                claudeInnerLaunchMissing = true;
              }
            }
          });

          child.on("error", (err: NodeJS.ErrnoException) => {
            childLaunchFailed = true;
            reportLaunchFailure(err);
            req.signal.removeEventListener("abort", onAbort);
            resolve();
          });

          child.on("close", (code) => {
            if (childLaunchFailed) {
              req.signal.removeEventListener("abort", onAbort);
              resolve();
              return;
            }
            if (!hermesDirect) {
              const trailingOpenCodeText = openCodeStdoutDecoder?.end();
              if (trailingOpenCodeText) handleStdoutChunk(trailingOpenCodeText);
              const trailingStdoutText = openCodeStdoutDecoder ? "" : stdoutDecoder.end();
              if (trailingStdoutText) handleStdoutChunk(trailingStdoutText);
            }
            captureHermesSessionFromStderr("", true);
            const hermesAttemptFailed = hermesDirect && code !== 0 && !runHandle.stopRequested;
            // A stale native session is retried below without `--resume`. It is
            // still a failed attempt, so never release its buffered stdout or
            // session id, but it is not a terminal runtime-process failure.
            const hermesProcessFailed = hermesAttemptFailed && !resumeFailed;
            if (!hermesAttemptFailed && hermesDirect && !sessionId && pendingHermesSessionId) {
              announceSession(pendingHermesSessionId);
            }
            if (hermesProcessFailed) {
              const failure = runtimeProcessFailure("hermes");
              result.is_error = true;
              launchFailure ??= failure;
              pushProgress("harness-start", "Hermes exited with an error", "error", failure.message, Date.now() - attemptStartedAt);
              push({ kind: "error", code: failure.code, message: failure.message });
            } else if (hermesStdout && !hermesAttemptFailed) {
              for (const chunk of hermesStdout) {
                const decoded = stdoutDecoder.write(chunk);
                if (decoded) handleStdoutChunk(decoded);
              }
              const trailingHermesText = stdoutDecoder.end();
              if (trailingHermesText) handleStdoutChunk(trailingHermesText);
            }
            // OpenCode normally emits a JSON error envelope, but older CLI
            // builds can exit non-zero with only stderr. Do not mistake that
            // failed invocation for a successful model application below.
            if ((openCodeDirect || copilotStream || grokDirect) && code !== 0) {
              result = { ...result, is_error: true };
            }
            // Direct Codex can exit non-zero before (or without) a terminal
            // protocol frame; that failed invocation must not read as a
            // successful empty turn.
            if (codexDirect && code !== 0) {
              result = { ...result, is_error: true };
            }
            if (grokDirect && code !== 0 && !runHandle.stopRequested) {
              grokProcessFailed = true;
            }
            if (binding.harness === "claude" && claudeInnerLaunchMissing) {
              const message = missingRunnerMessage("claude");
              result = { ...result, is_error: true };
              launchFailure ??= {
                code: RUNTIME_AVAILABILITY_ERROR_CODES.claude_missing,
                message,
              };
              push({
                kind: "error",
                code: RUNTIME_AVAILABILITY_ERROR_CODES.claude_missing,
                message,
              });
            }
            // Copilot JSONL stderr can contain raw prompt or tool payloads on
            // a successful malformed stream too. Its only user-facing
            // diagnostics are fixed/redacted protocol messages.
            if (copilotStream) {
              stderrTail.length = 0;
              if (code !== 0) {
                stdoutErrTail.length = 0;
                stdoutErrTail.push("Copilot exited before completing its response.");
              }
            }
            // Grok's stderr can include provider request details or local
            // paths. Its structured errors already yield a fixed diagnostic;
            // an unframed non-zero exit must receive the same redaction.
            if (grokDirect) {
              stderrTail.length = 0;
              stdoutErrTail.length = 0;
              if (code !== 0) stdoutErrTail.push("Grok Build exited before completing its response.");
            }
            pushProgress(
              "harness-start",
              `${binding.harness} exited`,
              hermesAttemptFailed ? "error" : "done",
              hermesProcessFailed ? launchFailure?.message : undefined,
              Date.now() - attemptStartedAt,
            );
            if (jsonBuf) handleLine(jsonBuf);
            const tail = assistantFilter.flush();
            if (tail) {
              assistantText += tail;
              push({ kind: "assistant_chunk", text: tail });
            }
            // `coven run` is the outer launch vehicle for Codex, Claude, and
            // compatible Coven-backed adapters. Process every final stdout
            // fragment first: an adapter failure can arrive without a
            // trailing newline and has more specific remediation. If the
            // child was truly silent, a non-zero exit is a real runtime
            // failure, not a successful-but-empty assistant response.
            covenBackedProcessFailed ||=
              !sshRuntime &&
              localRuntimePlan?.runner === "coven" &&
              !runHandle.stopRequested &&
              !covenCompletedSuccessfulResult &&
              typeof code === "number" &&
              code !== 0;
            if (covenBackedProcessFailed && typeof code === "number" && code !== 0) {
              covenBackedExitCode = code;
            }
            if (covenBackedProcessFailed) {
              result = { ...result, is_error: true };
            }
            req.signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });

      // First attempt — uses --continue if body.sessionId was set.
      };
      const turnSpawnStartMs = Date.now();
      // Codex's native-chat route is a two-layer launch: Cave starts Coven,
      // then Coven starts Codex. Preflight with the exact command, fixed args,
      // and familiar-scoped environment that the local plan will spawn.
      const codexLaunchPlan =
        !sshRuntime && binding.harness === "codex" && localRuntimePlan?.runner === "coven"
          ? {
              command: localRuntimePlan.command,
              fixedArgs: localRuntimePlan.fixedArgs,
              ...(localRuntimePlan.unresolvedWindowsShim ? { unresolvedWindowsShim: true as const } : {}),
            }
          : null;
      if (codexLaunchPlan && localRuntimePlan) {
        const availability = await probeCodexRuntimeAvailability({
          launch: codexLaunchPlan,
          env: localRuntimePlan.env,
        });
        codexFallbackAdapterAvailability = availability;
        if (availability.state !== "ready") {
          launchFailure = { code: availability.code, message: availability.message };
          result.is_error = true;
          pushProgress(
            "harness-start",
            "codex failed to start",
            "error",
            availability.message,
            Date.now() - turnSpawnStartMs,
          );
          push({ kind: "error", code: availability.code, message: availability.message });
        }
      }
      if (!launchFailure) {
      // Codex compatibility fallback notice (cave-53iko.1): when a local
      // Codex chat stays on the generic Coven transport for a noteworthy
      // reason (probe unavailable, unsupported version, capability mismatch),
      // say so once — exactly parallel to the OpenCode health notice below.
      // The turn then continues down the existing `coven run codex` path.
      if (
        binding.harness === "codex" &&
        !sshRuntime &&
        codexRouting.mode === "fallback" &&
        codexRouting.compatibilityDiagnostic
      ) {
        pushProgress(
          "codex-compatibility",
          codexRouting.compatibilityDiagnostic,
          "notice",
          codexRouting.diagnosticCode ?? undefined,
        );
      }
      // A compatibility decision is meaningful even when the CLI exits before
      // stdout. Announce it before spawning instead of relying on handleLine.
      if (openCodeDirect && !openCodeCompatibilityHealthNoticeSent && openCodeCompatibility?.diagnostic) {
        openCodeCompatibilityHealthNoticeSent = true;
        const diagnostic = openCodeCompatibility.diagnostic === "capability-probe-unavailable"
          ? "Couldn't verify OpenCode JSON events; continuing in plain chat without tool activity"
          : openCodeCompatibility.diagnostic === "capability-probe-fallback"
            ? "OpenCode capability probe was unavailable; using recently verified JSON event support"
          : openCodeCompatibility.diagnostic === "json-format-unavailable"
          ? "This OpenCode client does not advertise JSON events; continuing without tool activity"
          : openCodeCompatibility.diagnostic === "no-compatible-schema"
            ? "This OpenCode client has no verified tool-event schema; continuing without tool activity"
            : openCodeCompatibility.diagnostic === "schema-quarantined"
              ? "OpenCode's structured event protocol was quarantined; continuing without tool activity"
            : openCodeCompatibility.diagnostic === "cached-schema-unavailable"
              ? "OpenCode's compatibility registry is unavailable; continuing in plain chat without tool activity"
            : openCodeCompatibility.bundleSource === "built-in"
              ? "OpenCode schema refresh was not trusted; using the shipped compatible parser"
              : "OpenCode schema refresh was not trusted; using the last known compatible parser";
        pushProgress(
          "opencode-compatibility",
          diagnostic,
          "notice",
          openCodeCompatibility.diagnostic,
        );
      }
      if (openCodeFreshSessionForCompatibility) {
        pushProgress(
          "opencode-compatibility",
          openCodeUnrecordedResume
            ? "This OpenCode session is not recorded locally and this client cannot resume it; starting a fresh chat"
            : openCodeCompatibilityRetry?.replayedHistory
            ? openCodeSessionUnavailable
              ? "This OpenCode client cannot resume sessions; replaying recent context in a fresh chat"
              : "This conversation has no resumable OpenCode session; replaying recent context in a fresh chat"
            : openCodeSessionUnavailable
              ? "This OpenCode client cannot resume sessions; starting a fresh chat"
              : "This conversation has no resumable OpenCode session; starting a fresh chat",
          "notice",
          "session-unavailable",
        );
      }
      if (hermesNeedsContextReplay) {
        const replay = buildResumeRetryPrompt(harnessPrompt, existingConversation);
        pushProgress(
          "resume-retry",
          replay.replayedHistory
            ? "No Responses session found; replaying recent context into a fresh chat"
            : "No Responses session found; starting a fresh chat",
          "done",
        );
        await runAttempt(buildArgs(null, replay.prompt), replay.prompt);
      } else {
        await runAttempt(args);
      }

      // Self-heal (cave-1c05): a stale scaffolded manifest whose id the
      // installed CLI now ships as a built-in harness makes the registry load
      // fatal, killing the run before any assistant output. Quarantine the
      // manifest the CLI named (rename off the scanned `.json` extension) and
      // retry the same turn. Bounded: several stale manifests can conflict,
      // but each pass must have healed a new one to continue. Local runs
      // only — an SSH runtime's error names a remote path.
      for (
        let heals = 0;
        heals < 3 && adapterConflict && !sshRuntime && !runHandle.stopRequested;
        heals++
      ) {
        const conflict: BuiltinAdapterConflict = adapterConflict;
        const healed = await healBuiltinShadowedManifest(conflict);
        if (!healed) break;
        pushProgress(
          "adapter-heal",
          `Quarantined stale ${conflict.id} adapter manifest; retrying`,
          "running",
          conflict.manifestPath,
        );
        assistantFilter = new AssistantFilter({ passthrough: rawStdoutHarness });
        assistantText = "";
        jsonBuf = "";
        stdoutDecoder = new StringDecoder("utf8");
        result = {};
        resetToolTrackerForRetry();
        openCodeModelRejected = false;
        copilotText.reset();
        copilotTranscript.reset();
        stderrTail.length = 0;
        stdoutErrTail.length = 0;
        codexAdapterFailure = null;
        covenBackedProcessFailed = false;
        covenBackedExitCode = null;
        covenCompletedSuccessfulResult = false;
        resumeFailed = false;
        adapterConflict = null;
        // Settle the heal step BEFORE the retry attempt runs (same shape as
        // the resume-retry step below): the quarantine itself is finished at
        // relaunch, and a step left "running" until the attempt ended would
        // headline the activity strip for the whole reply.
        pushProgress(
          "adapter-heal",
          `Stale ${conflict.id} adapter manifest quarantined; retried`,
          "done",
          conflict.manifestPath,
        );
        await runAttempt(args);
      }

      // Transparent retry: if codex reported its rollout-resume failed and
      // we had been resuming, start a fresh thread (no --continue) so the
      // user's prompt still gets answered. A fresh harness session has no
      // history of its own, so replay the recent conversation into the prompt —
      // otherwise the familiar answers as if the thread just started and the
      // user has to remind it of everything said so far.
      if (resumeFailed && body.sessionId) {
        const retry = buildResumeRetryPrompt(harnessPrompt, existingConversation);
        pushProgress(
          "resume-retry",
          retry.replayedHistory
            ? "Resume failed; replaying recent context into a fresh chat"
            : "Resume failed; starting a fresh chat",
          "running",
        );
        sessionId = null;
        // A failed Hermes resume may have printed a stale session id before
        // exiting. The fresh retry must not announce or persist that token.
        pendingHermesSessionId = null;
        hermesStderrBuffer = "";
        // The failed resumed stream can echo the stale native token before its
        // error frame. This retry deliberately omits --session, so retaining
        // that token would persist it again if the fresh process exits before
        // announcing a replacement session.
        openCodeSessionId = null;
        // Same for a failed direct Codex resume: the fresh attempt's
        // thread.started supplies the replacement thread id.
        codexSessionId = null;
        hermesResponseId = null;
        hermesPreviousResponseId = null;
        assistantFilter = new AssistantFilter({ passthrough: rawStdoutHarness });
        assistantText = "";
        jsonBuf = "";
        stdoutDecoder = new StringDecoder("utf8");
        result = {};
        resetToolTrackerForRetry();
        openCodeModelRejected = false;
        copilotText.reset();
        copilotTranscript.reset();
        stderrTail.length = 0;
        stdoutErrTail.length = 0;
        codexAdapterFailure = null;
        covenBackedProcessFailed = false;
        covenBackedExitCode = null;
        covenCompletedSuccessfulResult = false;
        resumeFailed = false;
        // Settle the retry step BEFORE the fresh attempt runs, not after it
        // finishes: the step's own work (rebuild context, relaunch) is done
        // the moment the fresh run launches. Left "running" until the attempt
        // ended, "Resume failed…" stayed the live headline in the activity
        // strip for the entire reply — minutes of what read like an
        // unresolved failure while the fresh chat streamed fine underneath.
        pushProgress(
          "resume-retry",
          retry.replayedHistory
            ? "Recent context replayed into a fresh chat"
            : "Fresh chat started",
          "done",
        );
        await runAttempt(buildArgs(null, retry.prompt), retry.prompt);
      }
      }

      markChatRunTransportSettled(runHandle);
      // Unknown direct-Codex protocol events surface as ONE safe diagnostic
      // per turn: a count plus up to three shape fingerprints. The payloads
      // themselves were never rendered, persisted, or logged.
      if (codexDirect && codexUnknownEventCount > 0) {
        pushProgress(
          "codex-compatibility",
          codexUnknownEventCount === 1
            ? "Codex sent an unrecognized protocol event; its content was not shown"
            : `Codex sent ${codexUnknownEventCount} unrecognized protocol events; their content was not shown`,
          "notice",
          [...codexUnknownEventFingerprints].join(", "),
        );
      }

      // A Codex adapter can disappear or become misconfigured after the
      // bounded preflight passed. Coven has started in this branch, so map
      // only its adapter-level evidence back to the same actionable Codex
      // state; provider/auth errors intentionally remain untouched.
      // The adapter-evidence mapping below is about Coven's adapter layer;
      // the direct spawn has no Coven in front of it and keeps the shared
      // direct-runner failure diagnostics instead.
      if (!launchFailure && !runHandle.stopRequested && binding.harness === "codex" && !codexDirect && !assistantText.trim()) {
        const adapterFailure = codexAdapterFailure
          ?? codexAdapterFailureAvailability([...stderrTail, ...stdoutErrTail].join("\n"));
        if (adapterFailure) {
          launchFailure = { code: adapterFailure.code, message: adapterFailure.message };
          result.is_error = true;
          pushProgress("harness-start", "codex failed to start", "error", adapterFailure.message);
          push({ kind: "error", code: adapterFailure.code, message: adapterFailure.message });
      }
      }

      if (!launchFailure && covenBackedProcessFailed && !assistantText.trim()) {
        const failedRunner = binding.harness === "codex"
          ? "codex"
          : binding.harness === "claude"
            ? "claude"
            : "coven";
        const emittedDiagnostic = stderrTail.length > 0 || stdoutErrTail.length > 0;
        const detail = covenBackedExitCode == null
          ? emittedDiagnostic
            ? "Runtime diagnostic output was withheld to protect local data."
            : "The runtime did not emit an error message."
          : emittedDiagnostic
            ? `Exit code ${covenBackedExitCode}; runtime diagnostic output was withheld to protect local data.`
            : `Exit code ${covenBackedExitCode}; the runtime did not emit an error message.`;
        const failure = runtimeProcessFailure(failedRunner, {
          exitCode: covenBackedExitCode,
          emittedDiagnostic,
        });
        launchFailure = failure;
        result.is_error = true;
        pushProgress("harness-start", `${binding.harness} exited with an error`, "error", failure.message);
        pushProgress("runtime-process", `${binding.harness} process failure`, "error", detail);
        const diagnostics = runtimeLaunchDiagnostics({
          runner: failedRunner,
          exitCode: covenBackedExitCode,
          emittedDiagnostic,
          ...(localRuntimePlan
            ? {
                launcher: {
                  identity: "coven",
                  command: localRuntimePlan.command,
                  availability: localRuntimePlan.availability,
                  env: localRuntimePlan.env,
                },
              }
            : {}),
          ...(binding.harness === "codex" && codexFallbackAdapterAvailability && localRuntimePlan
            ? {
                adapter: {
                  identity: "codex",
                  command: localRuntimePlan.command,
                  availability: codexFallbackAdapterAvailability,
                  env: localRuntimePlan.env,
                  source: "coven-adapter" as const,
                },
              }
            : {}),
        });
        pushProgress(
          "runtime-launch-diagnostics",
          "Runtime launch diagnostics captured",
          "error",
          JSON.stringify(diagnostics),
        );
        push({ kind: "error", code: failure.code, message: failure.message });
      }

      if (!launchFailure && grokProcessFailed && !assistantText.trim()) {
        const failure = runtimeProcessFailure("grok");
        launchFailure = failure;
        result.is_error = true;
        pushProgress("harness-start", "Grok Build needs interactive sign-in", "error", failure.message);
        push({ kind: "error", code: failure.code, message: failure.message });
      }

      // User cancel (CHAT-D5-02): when the client stops the response
      // (Esc/Stop → POST /api/chat/stop), the harness child gets SIGTERM —
      // usually before any "result" event. Without this guard the
      // empty-response diagnostic below fabricates an auth-hint error and
      // saves it, so reloading the chat rewrote the user's cancel into a
      // harness error. Persist the honest record instead: the partial text
      // streamed so far (or a minimal "(cancelled)" marker), never an error,
      // and skip the diagnostic SSE chunk — the client already rendered its
      // own cancelled state and is gone. A bare transport abort (signal loss,
      // closed tab) is NOT a cancel: the turn ran to completion and persists
      // as a normal reply the client recovers on resync.
      const cancelledByUser = runHandle.stopRequested;
      if (cancelledByUser) {
        if (!assistantText.trim()) assistantText = "(cancelled)";
        result.is_error = false;
      } else if (!assistantText.trim() && !launchFailure) {
        // Empty-response diagnostic: when the harness reports done but never
        // produced assistant text, the user otherwise sees a silent empty
        // bubble. Synthesize a short explanation so they know what to do.
        const harness = binding.harness;
        const durMs = result.duration_ms;
        const durSuffix = durMs != null ? ` in ${durMs}ms` : "";
        const tailSource = stderrTail.length ? stderrTail : stdoutErrTail;
        // OpenCode stderr can include request bodies, provider diagnostics, or
        // local paths. It is useful for other harnesses' existing recovery
        // guidance, but must never become assistant-visible/persisted text.
        const tailBlock = !openCodeDirect && !grokDirect && tailSource.length
          ? `\n\n\`\`\`\n${tailSource.slice(-5).join("\n")}\n\`\`\``
          : "";
        const diagnostic = result.is_error
          ? `_The "${harness}" harness errored${durSuffix} and returned no text._${tailBlock || "\n\nNo error output captured. Try `/doctor` for diagnostics."}`
          : `_The "${harness}" harness completed${durSuffix} but produced no output._\n\nUsually this means the CLI is installed but not authenticated to a provider. Try \`/doctor\`, re-run \`coven\`'s sign-in (\`codex login\` / Claude API key), or check the harness logs.${tailBlock}`;
        pushProgress("assistant-output", "No assistant text returned", "error", harness, durMs);
        assistantText = diagnostic;
        result.is_error = true;
        push({ kind: "assistant_chunk", text: diagnostic });
      }

      // Created-row leak sweep (bd cave-p08l): `coven run` registers the
      // daemon session row before launching the harness, and the row's id
      // only reaches this route via the stream handshake. A spawn that dies
      // pre-handshake (fork exhaustion, missing adapter) strands the row in
      // "created" forever — the daemon has no reaper. When a NEW chat's turn
      // ends without ever learning a session id, reap the rows this turn
      // provably registered: same spawn cwd, created inside the turn window,
      // title == this turn's prompt head. Best-effort; never fails the turn.
      if (!cancelledByUser && !body.sessionId && !sessionId && !sshRuntime) {
        const swept = await sweepStuckCreatedSessions({
          cwd,
          prompt: harnessPrompt,
          sinceMs: turnSpawnStartMs - 5000,
        });
        if (swept.length > 0) {
          pushProgress(
            "created-sweep",
            `Cleaned up ${swept.length} orphaned session ${swept.length === 1 ? "row" : "rows"}`,
            "done",
            swept.join(", "),
          );
        }
      }

      // Boundary sentinel readout: one non-blocking notice per turn listing
      // the out-of-boundary paths the harness touched, plus a recorded
      // reminder that steers the conversation's next turn. Nothing here
      // interrupts or fails the turn — enforcement is observe → surface →
      // steer, not kill.
      const boundaryViolations = boundarySentinel?.violations() ?? [];
      if (boundaryViolations.length > 0) {
        const boundarySessionId = body.sessionId ?? sessionId;
        if (boundarySessionId) {
          recordBoundaryViolations(boundarySessionId, boundaryViolations);
        }
        pushProgress(
          "boundary-sentinel",
          `Touched ${boundaryViolations.length === 1 ? "a path" : `${boundaryViolations.length} paths`} outside the granted roots`,
          "error",
          formatBoundaryNotice(boundaryViolations),
        );
      }

      // Agent-produced inline attachments: pull `coven:attachment` marker
      // blocks out of the reply, resolve+read the referenced files (allowlist
      // -guarded, size-capped), and strip the markers from the text. Stream the
      // attachments so the live turn renders file chips, and reuse them on the
      // persisted assistant turn so they survive reload. `cleanedAssistantText`
      // is the marker-free text that gets persisted (the client also strips
      // markers from the live-streamed text for parity — see chat-view).
      // Plain compatibility fallback has no structured boundary that permits
      // us to normalize provider text. Preserve its leading indentation and
      // trailing blank lines in the durable transcript as well as the live
      // stream; other harnesses retain their established trim behavior.
      const assistantTextForPersistence = (openCodeDirect && openCodeCompatibility?.mode === "plain") || (grokDirect && grokCompatibility?.mode === "plain")
        ? assistantText
        : assistantText.trim();
      const { text: cleanedAssistantText, attachments: agentAttachments } =
        (openCodeDirect && openCodeCompatibility?.mode === "plain") || (grokDirect && grokCompatibility?.mode === "plain")
          ? { text: assistantTextForPersistence, attachments: [] }
          : parseAgentAttachments(assistantTextForPersistence, {
              allowedRoots: sshRuntime
                ? []
                : [
                    cwd,
                    ...grantedProjectRoots,
                    ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
                  ],
            });
      for (const attachment of agentAttachments) {
        push({ kind: "attachment", attachment });
      }

      // Persist under the STABLE conversation id. The harness's per-turn id
      // is tracked on the file for the next resume but never becomes the
      // conversation's identity — keying off it created a new conversation
      // file (and sidebar entry) for every resumed turn.
      // A Grok resume can fail before producing a native event. In that case
      // `sessionId` is Cave's stable conversation id, not a CLI resume id;
      // do not overwrite the previous native id (or record a changed sandbox
      // profile) and accidentally let a later read turn resume the old full
      // access session.
      const harnessSessionId = grokDirect
        ? grokSessionId
 : openCodeDirect
          // Plain output has no new native id to announce, but a token is
          // reusable only when this attempt actually forwarded it. A fresh
          // compatibility fallback must invalidate an older native session.
          ? openCodeSessionId ?? (openCodeNativeResumeUsed
            ? existingConversation?.harnessSessionId ?? (!existingConversation ? body.sessionId : undefined)
            : undefined)
          : codexDirect
            // Direct Codex resumes keep the same thread id; a turn that never
            // reached thread.started retains the prior native id untouched.
            ? codexSessionId ?? existingConversation?.harnessSessionId ?? null
          : hermesDirect && hermesApi
            ? !result.is_error && hermesResponseId
              ? hermesResponseId
              : existingConversation?.harnessSessionId ?? null
          : sessionId;
      // OpenCode's JSON event protocol does not echo the selected model. Its
      // direct argv proves the selection was forwarded, while a successful
      // exit is the only confirmation it was applied. Preserve an explicit
      // model rejection as failed rather than incorrectly reporting applied.
      if (openCodeDirect && openCodeLaunchModel && forwardModel) {
        const application = modelApplicationForHarness(
          modelApplicationFromRun({
            confirmedModel: forwardModel,
            isError: result.is_error === true,
            errorText: openCodeModelRejected ? "model unavailable" : [...stderrTail, ...stdoutErrTail].join("\n"),
          }),
        );
        if (!result.is_error) responseMetadata.confirmedModel = forwardModel;
        responseMetadata.modelApplicationState = application.state;
        responseMetadata.modelApplicationReason = application.reason;
        modelState.applicationState = application.state;
        modelState.reason = application.reason;
      }
      // `coven run` can echo the forwarded model in system.init before it has
      // started the downstream harness. That establishes argv forwarding, not
      // downstream acceptance, so keep the model pending unless the error
      // itself safely identifies a rejected model. When the downstream harness
      // DID echo back a model (confirmedModel is set from the init/system
      // event, not from coven run's own argv), treat a successful run as
      // confirmed — that IS downstream acceptance.
      else if (localRuntimePlan?.runner === "coven" && forwardModel) {
        const rejected = result.is_error === true && modelRejectionInError(
          [...stderrTail, ...stdoutErrTail].join("\n"),
        );
        const confirmed = !result.is_error && confirmedModel != null;
        const application = modelApplicationForHarness(
          rejected
            ? { failed: true }
            : confirmed
              ? { supported: true, confirmed: true }
              : { supported: true },
        );
        if (confirmed) responseMetadata.confirmedModel = confirmedModel ?? undefined;
        responseMetadata.modelApplicationState = application.state;
        responseMetadata.modelApplicationReason = rejected
          ? application.reason
          : confirmed
            ? application.reason
            : "Coven forwarded the selected model; downstream acceptance was not confirmed.";
        modelState.applicationState = application.state;
        modelState.reason = responseMetadata.modelApplicationReason;
      }
      // Direct/native runtime echoes can identify the resolved model. A
      // successful run confirms it; a model rejection becomes failed rather
      // than incorrectly reporting the selected model as applied.
      else if (confirmedModel) {
        const application = modelApplicationForHarness(
          modelApplicationFromRun({
            confirmedModel,
            isError: result.is_error === true,
            errorText: [...stderrTail, ...stdoutErrTail].join("\n"),
          }),
        );
        if (!result.is_error) responseMetadata.confirmedModel = confirmedModel;
        responseMetadata.modelApplicationState = application.state;
        responseMetadata.modelApplicationReason = application.reason;
        modelState.applicationState = application.state;
        modelState.reason = application.reason;
      }
      if (!result.is_error && Object.keys(appliedModelControlValues).length > 0) {
        responseMetadata.appliedControls = appliedModelControlValues;
      }
      const routedTurnModel = copilotStream
        ? cleanModelId(desiredModel)
        : grokDirect
          ? grokLaunchModel
            ? grokForwardModel
            : null
          : openCodeDirect
            ? openCodeLaunchModel
              ? forwardModel
              : null
            : hermesDirect
              ? hermesLaunchModel
                ? forwardModel
                : null
              : forwardModel && forwardModel !== desiredModel
                ? desiredModel
                : forwardModel;
      responseMetadata.retryModel = turnRetryModel({
        requestedModel: body.modelOverride,
        confirmedModel: responseMetadata.confirmedModel,
        routedModel: routedTurnModel,
      });
      const finalSessionId = body.sessionId && !openCodeUnrecordedResume
        ? body.sessionId
        : sessionId;
      // Always settle the live chip before `done`, even if a malformed or
      // early-exiting harness never supplied a session id and therefore has
      // no conversation file to persist.
      settleUnfinishedTools();
      // Preflight/spawn failures never produced a real assistant response, so
      // preserve the established no-transcript behavior for them. A Coven
      // child that did start and then exited non-zero is different: persist a
      // clearly marked failure when the conversation already has an id, so a
      // reload retains the safe exit diagnostics instead of looking complete.
      const persistCovenProcessFailure = Boolean(
        finalSessionId && launchFailure && covenBackedProcessFailed,
      );
      if (finalSessionId && (!launchFailure || persistCovenProcessFailure)) {
        try {
          pushProgress("save-transcript", "Saving transcript", "running");
          await recordSessionFamiliar(finalSessionId, body.familiarId);
          // Settle any in-flight stub write first so it can never race (and
          // clobber) the authoritative transcript saved below.
          if (stubWrite) await stubWrite;

          const isFirstExchange = await withConversationLock(finalSessionId, async () => {
            const existing = await loadConversation(finalSessionId);
            // First-turn visibility (cave-0g2x): drop the announce-time stub turn
            // so the authoritative user turn below re-lands under the same id.
            // True only when this run's stub created the conversation, which keeps
            // first-exchange behaviors (auto-naming) firing for new chats.
            const hadFirstTurnStub = existing
              ? stripConversationStubTurn(existing, pendingUserTurnId)
              : false;
            const firstExchange =
              ownsFirstExchangeTitle && (!existing || hadFirstTurnStub);
            const now = new Date().toISOString();
            const userTurnId = pendingUserTurnId;
            const assistantTurnId = crypto.randomUUID();
            const chatTitle = existing?.title ?? defaultChatTitleForSession(finalSessionId);
            if (!existing && ownsFirstExchangeTitle) {
              await setDefaultStubTitleAuto(finalSessionId, chatTitle);
            }
          // Branching: when the client passes parentTurnId, the new user turn is
          // parented there (its prior sibling stays in the tree). For a normal
          // (non-branch) send, fall back to the prior activeLeafId so the
          // conversation stays a linear chain identical to the pre-branching
          // behaviour. First turn of a new chat gets null (no parent).
          const branchParentId =
            body.parentTurnId !== undefined ? body.parentTurnId : existing?.activeLeafId ?? null;
          const userTurn: ChatTurn = {
            id: userTurnId,
            role: "user",
            text: promptText,
            ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
            ...attentionClearOperationForTurn(body.runId),
            ...persistedTurnControls(body, responseMetadata.retryModel),
            createdAt: now,
            ...(branchParentId != null ? { parentId: branchParentId } : {}),
          };
          // Persist the turn's tool rows: the live chips exist only in client
          // state fed by SSE; without this, refresh/chat-switch loses them.
          // Offsets were stamped against the untrimmed stream — shift by the
          // leading trim so interleaving matches the saved text.
          const persistedTools = toPersistedTools([...priorAttemptTools, ...toolTracker.snapshot()],
            assistantText.length - assistantText.trimStart().length,
          );
          const persistedAssistantText = persistCovenProcessFailure && !cleanedAssistantText
            ? launchFailure!.message
            : cleanedAssistantText;
          const assistantCreatedAt = new Date().toISOString();
          const covenAttention = prepareAttentionRequest({
            text: persistedAssistantText,
            sessionId: finalSessionId,
            turnId: assistantTurnId,
            requestedAt: assistantCreatedAt,
            incomplete: cancelledByUser || result.is_error,
          });
          const assistantTurn: ChatTurn = {
            id: assistantTurnId,
            role: "assistant",
            text: covenAttention.text,
            ...(covenAttention.reasoning ? { reasoning: covenAttention.reasoning } : {}),
            ...(agentAttachments.length ? { attachments: agentAttachments } : {}),
            createdAt: assistantCreatedAt,
            durationMs: result.duration_ms,
            isError: result.is_error,
            ...(cancelledByUser ? { cancelled: true } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
            ...(persistedTools ? { tools: persistedTools } : {}),
            ...(persistedCompatibilityDiagnostics.length
              ? { progress: persistedCompatibilityDiagnostics }
              : {}),
            parentId: userTurnId,
            responseMetadata: covenAttention.request
              ? { ...responseMetadata, attentionRequest: covenAttention.request }
              : responseMetadata,
          };
          const conv = existing ?? {
            sessionId: finalSessionId,
            familiarId: body.familiarId,
            harness: binding.harness,
            model: responseMetadata.model,
            runtime: responseMetadata.runtime,
            title: chatTitle,
            ...(body.origin ? { origin: body.origin } : {}),
            createdAt: now,
            updatedAt: now,
            turns: [],
          };
          conv.model = responseMetadata.model;
          conv.runtime = responseMetadata.runtime;
          persistSendModelIntent(
            conv,
            body,
            modelState,
            existingConversation?.modelIntent?.model ?? null,
          );
          // Work-branch snapshot from the chat's own cwd — per-session PR
          // attribution (badges + merged-PR auto-archive). Best-effort; a
          // failed capture keeps the previous snapshot.
          const workBranch = await captureWorkBranch(cwdFromConversationRuntime(conv.runtime));
          if (workBranch) conv.branch = workBranch;
          // Transcript PR snapshot: the reply's last reported PR URL (fallback
          // attribution for chats whose work happens in agent worktrees).
          const reportedPrUrl = latestPrUrlFromText(persistedAssistantText);
          if (reportedPrUrl) conv.prUrl = reportedPrUrl;
          if (harnessSessionId) conv.harnessSessionId = harnessSessionId;
          else if (openCodeDirect && existingConversation && !openCodeNativeResumeUsed) {
            // A fresh compatibility fallback intentionally did not use the
            // prior native session. Persist that invalidation so a later client
            // upgrade cannot silently resume context that excludes this turn.
            delete conv.harnessSessionId;
          }
          if (grokDirect && grokSessionId) conv.grokSandboxProfile = grokSandboxProfile;
          if (!result.is_error && !cancelledByUser) {
            conv.runtimeAccessFingerprint = runtimeAccessFingerprint;
          }
          conv.turns.push(userTurn, assistantTurn);
          conv.activeLeafId = assistantTurnId;
          await saveConversation(conv);
            return firstExchange;
          });
          if (isFirstExchange && !result.is_error && !cancelledByUser) {
            await autoNameSessionFromFirstExchange(finalSessionId, promptText);
          }
          // Periodic context-aware rename on every completed turn (cadence gated inside).
          if (!result.is_error && !cancelledByUser) {
            await maybeAutoRenameFromContext(finalSessionId, promptText);
          }
          pushProgress("save-transcript", "Transcript saved", "done");
        } catch {
          result.is_error = true;
          pushProgress("save-transcript", "Transcript save failed", "error");
          push({ kind: "error", code: "transcript_save_failed", message: "Cave could not save the transcript." });
        }
      }

      markChatRunProjectionSettled(runHandle);
      push({
        kind: "done",
        durationMs: result.duration_ms,
        isError: result.is_error,
        sessionId: finalSessionId ?? undefined,
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        responseMetadata,
      });
      // Best-effort temp cleanup: the harness child process has already
      // exited (including any resume retry), so nothing can still be reading
      // the saved images. Failures just leave files in tmpdir.
      cleanupStagedImageFiles(imageFilePaths);
      if (detachKillTimer != null) clearTimeout(detachKillTimer);
      unregisterChatRun(runHandle);
      runBuffer?.finish();
      await sleep(20);
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
