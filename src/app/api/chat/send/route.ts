import { spawn } from "node:child_process";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { resolveBackspaces, stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
  enqueueOfflineTravelItem,
  type CaveConfig,
  type FamiliarBinding,
  loadConfig,
  loadState,
  recordSessionFamiliar,
  setSessionTitle,
} from "@/lib/cave-config";
import {
  chatSummaryTitle,
  chatTitleFromPrompt,
  defaultChatTitleForSession,
} from "@/lib/cave-chat-titles";
import {
  buildPromptWithAttachments,
  MAX_ATTACHMENT_IMAGE_BYTES,
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import type { SessionOrigin } from "@/lib/types";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  toPersistedTools,
  ToolCallTracker,
} from "@/lib/chat-tool-events";
import { covenLaunchCommand } from "@/lib/coven-bin";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { sweepStuckCreatedSessions } from "@/lib/server/stuck-created-sweep";
import {
  buildCopilotStreamArgs,
  copilotIdentityPreamble,
  copilotStreamSpec,
  CopilotTextAssembler,
  parseCopilotChatEvent,
} from "@/lib/copilot-stream";
import { buildPromptWithCovenIdentityCanon } from "@/lib/coven-identity-canon";
import {
  buildPromptWithKnowledgeVault,
  listCollections,
  readKnowledgeVaultForPrompt,
} from "@/lib/server/knowledge-vault";
import { parseAgentAttachments } from "@/lib/server/agent-attachments";
import {
  registerChatRun,
  unregisterChatRun,
  type ChatRunHandle,
} from "@/lib/server/chat-stop-registry";
import { buildNextPathsDirective } from "@/lib/next-paths";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { loadProjects } from "@/lib/cave-projects";
import { chatProjectAccessId } from "@/lib/chat-project-access";
import { openClawBin, openClawNeedsShell, openClawSpawnArgs, openClawSpawnEnv } from "@/lib/openclaw-bin";
import {
  familiarWorkspacesRoot,
  readFamiliarWorkspaces,
} from "@/lib/coven-paths";
import {
  OpenClawAgentResolutionError,
  extractOpenClawSessionId,
  extractOpenClawText,
  openClawAgentArgs,
  openClawSessionKey,
  resolveOpenClawAgentBinding,
  type OpenClawAgentJson,
} from "@/lib/openclaw-bridge";
import { isTrustedChatHarness, covenRunSupportsModelFlag, covenRunSupportsPermissionFlag, covenRunSupportsAddDirFlag, canonicalHarnessId } from "@/lib/harness-adapters";
import {
  type ConversationFile,
  type ChatTurn,
  loadConversation,
  saveConversation,
} from "@/lib/cave-conversations";
import {
  captureWorkBranch,
  cwdFromConversationRuntime,
} from "@/lib/server/chat-work-branch";
import { buildResumeRetryPrompt } from "@/lib/chat-history-fallback";
import {
  cleanModelId,
  modelApplicationForHarness,
  resolveChatModelState,
  type ChatModelState,
} from "@/lib/chat-model-state";
import {
  RuntimeScopeError,
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
  filterProjectsForFamiliar,
} from "@/lib/project-permissions";
import {
  buildTaskAwarePrompt,
  taskContextForSession,
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
import type { StreamEvent } from "@/lib/stream-events";
import { deriveTravelClientStatus } from "@/lib/travel-client-state";

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

type SendBody = {
  familiarId: string;
  prompt?: string;
  /** Per-send client token for /api/chat/stop — lets Stop target this run
   *  before the server has assigned/echoed a conversation id. */
  runId?: string;
  sessionId?: string;
  projectRoot?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
  reasoningEffort?: string;
  responseSpeed?: string;
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

type ReasoningEffort = "low" | "medium" | "high";
type ResponseSpeed = "fast" | "balanced" | "careful";

type OfflineChatQueuePayload = Pick<
  SendBody,
  | "familiarId"
  | "projectRoot"
  | "modelOverride"
  | "modelOverrideScope"
  | "reasoningEffort"
  | "responseSpeed"
  | "mentionedFiles"
  | "mentionedFilesRoot"
  | "parentTurnId"
  | "origin"
> & {
  prompt: string;
  sessionId: string;
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

/**
 * Cwd recorded on the conversation's first turn (`runtime: "local:<cwd>"`).
 *
 * Continued turns don't carry `projectRoot` in the body, but harness session
 * stores are scoped per working directory — resuming `--continue <id>` from
 * homedir instead of the original project either fails resume or silently
 * continues an unrelated homedir session. Both presented as "a new session
 * spun up mid-chat" with the project context gone. Deriving the cwd from the
 * saved conversation keeps resume directory-stable for every turn.
 */
async function conversationCwd(sessionId?: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  try {
    const conv = await loadConversation(sessionId);
    const runtime = conv?.runtime;
    if (runtime?.startsWith("local:")) {
      const cwd = runtime.slice("local:".length).trim();
      return cwd || undefined;
    }
  } catch {
    /* fall back to the caller's default */
  }
  return undefined;
}

/** Resolve the familiar's Coven workspace dir.
 *  Uses ~/.coven/familiars.toml workspace when present, otherwise
 *  ~/.coven/workspaces/familiars/<id>. Falls back to undefined if the dir
 *  doesn't exist so callers can skip --cwd.
 */
async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  // Guard against path traversal: familiar IDs should be simple slugs.
  if (!/^[a-z0-9_-]+$/i.test(familiarId)) return undefined;
  const declared = await readFamiliarWorkspaces();
  const declaredWorkspace = declared.get(familiarId);
  if (declaredWorkspace) {
    try {
      const resolvedDeclared = await realpath(declaredWorkspace);
      const s = await stat(resolvedDeclared);
      if (s.isDirectory()) return resolvedDeclared;
    } catch {
      /* fall through to the derived workspace path */
    }
  }
  const familiarsRoot = familiarWorkspacesRoot();
  const candidate = path.resolve(familiarsRoot, familiarId);
  const relative = path.relative(familiarsRoot, candidate);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes("..")
  ) {
    return undefined;
  }
  try {
    const root = await realpath(familiarsRoot);
    const resolvedCandidate = await realpath(candidate);
    if (resolvedCandidate !== root && !resolvedCandidate.startsWith(root + path.sep)) {
      return undefined;
    }
    const s = await stat(resolvedCandidate);
    if (s.isDirectory()) return resolvedCandidate;
  } catch {
    /* not found */
  }
  return undefined;
}

// ── Image attachment delivery ────────────────────────────────────────────
// Local coven-run harnesses are agentic CLIs with a Read tool that can open
// image files, so image payloads are written to private temp files and the
// prompt points the harness at them. Bridges/remotes that cannot read this
// machine's filesystem get an explicit unsupported notice instead.

const ATTACHMENT_TMP_DIR = path.join(tmpdir(), "coven-cave-attachments");
const IMAGE_EXT_BY_SUBTYPE: Record<string, string> = {
  jpeg: "jpg",
  "svg+xml": "svg",
};

function imageExtension(mimeType?: string): string {
  const subtype = mimeType?.split("/")[1]?.toLowerCase() ?? "";
  const mapped = IMAGE_EXT_BY_SUBTYPE[subtype] ?? subtype;
  // Extension derives from the validated mime subtype only — never from a
  // user-controlled filename — and falls back to a fixed token.
  return /^[a-z0-9]{1,8}$/.test(mapped) ? mapped : "img";
}

async function writeImageAttachmentsToTemp(
  attachments: ChatAttachment[],
): Promise<Map<number, string>> {
  const filePaths = new Map<number, string>();
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.dataUrl || !attachment.mimeType?.startsWith("image/")) continue;
    const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
    const payload = Buffer.from(base64, "base64");
    // Defense in depth: normalizeChatAttachments already enforces the cap,
    // but never write more than the cap regardless.
    if (payload.byteLength === 0 || payload.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) continue;
    try {
      await mkdir(ATTACHMENT_TMP_DIR, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        ATTACHMENT_TMP_DIR,
        `${crypto.randomUUID()}.${imageExtension(attachment.mimeType)}`,
      );
      await writeFile(filePath, payload, { mode: 0o600 });
      filePaths.set(index, filePath);
    } catch {
      /* best effort — the prompt falls back to the not-delivered notice */
    }
  }
  return filePaths;
}

function cleanupImageTempFiles(filePaths: ReadonlyMap<number, string>) {
  for (const filePath of filePaths.values()) {
    void rm(filePath, { force: true }).catch(() => undefined);
  }
}

// ── @-mentioned file delivery (CHAT-D1-04) ───────────────────────────────
// The composer's `@` picker records repo-relative paths; the prompt gets a
// compact "Referenced files" block of absolute paths the harness can open
// with its Read tool. Validation mirrors /api/changes: repo-relative paths
// only, resolved against the realpathed root with a prefix containment
// check — absolute paths, NUL bytes, `..` segments, and symlinks that
// escape the root are silently skipped, never errors.

const MAX_MENTIONED_FILES = 10;

async function resolveMentionedFiles(
  relPaths: unknown,
  root: unknown,
): Promise<string[]> {
  if (!Array.isArray(relPaths) || relPaths.length === 0) return [];
  if (typeof root !== "string" || !path.isAbsolute(root)) return [];
  let realRoot: string;
  try {
    realRoot = await realpath(path.resolve(root));
    if (!(await stat(realRoot)).isDirectory()) return [];
  } catch {
    return [];
  }
  const resolved: string[] = [];
  for (const rel of relPaths.slice(0, MAX_MENTIONED_FILES)) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel)) continue;
    if (rel.split(/[\\/]+/).includes("..")) continue;
    const candidate = path.resolve(realRoot, rel);
    if (candidate === realRoot || !candidate.startsWith(realRoot + path.sep)) continue;
    try {
      // Containment must hold for the real file too, or a symlink inside the
      // root could point the prompt at an arbitrary path outside it.
      const real = await realpath(candidate);
      if (real !== candidate && !real.startsWith(realRoot + path.sep)) continue;
      if (!(await stat(real)).isFile()) continue;
      if (!resolved.includes(candidate)) resolved.push(candidate);
    } catch {
      /* missing or unreadable — skip */
    }
  }
  return resolved;
}

function appendMentionedFilesBlock(prompt: string, absPaths: string[]): string {
  if (absPaths.length === 0) return prompt;
  const block = [
    "Referenced files (open with the Read tool):",
    ...absPaths.map((p) => `- ${p}`),
  ].join("\n");
  return prompt ? `${prompt}\n\n${block}` : block;
}

async function setDefaultSessionTitleIfMissing(sessionId: string, title: string) {
  const state = await loadState();
  if (state.sessionTitles[sessionId]) return;
  await setSessionTitle(sessionId, title);
}

/** Auto-name a thread from its first user/assistant exchange with a short
 *  summary title. Only fires while the stored title is still one of the
 *  auto-derived defaults (prompt-derived or "New chat") — a manual rename,
 *  even one made mid-stream, always wins. Best effort: failures leave the
 *  default title in place. */
async function autoNameSessionFromFirstExchange(
  sessionId: string,
  promptText: string,
): Promise<void> {
  try {
    const summary = chatTitleFromPrompt(promptText);
    if (!summary) return;
    const autoDefaults = new Set(
      [chatTitleFromPrompt(promptText), defaultChatTitleForSession(sessionId)].filter(
        (t): t is string => Boolean(t),
      ),
    );
    const state = await loadState();
    const current = state.sessionTitles[sessionId];
    if (current && !autoDefaults.has(current)) return;
    if (current === summary) return;
    await setSessionTitle(sessionId, summary);
  } catch {
    /* best effort */
  }
}

function sse(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// SSE comment frame + cadence keeping quiet streams alive: NATs, proxies, and
// client idle timeouts can drop a connection that goes silent for the length
// of a long tool run. Comments are invisible to every consumer — the web
// readers and the iOS app all skip frames that don't start with `data:`.
const SSE_HEARTBEAT = new TextEncoder().encode(": hb\n\n");
const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

// Emit `: hb` comments until the stream closes/aborts; self-cleaning, but
// callers also clear it from close() so a finished turn stops immediately.
function startSseHeartbeat(
  controller: ReadableStreamDefaultController<Uint8Array>,
  isDone: () => boolean,
): NodeJS.Timeout {
  const heartbeat = setInterval(() => {
    if (isDone()) {
      clearInterval(heartbeat);
      return;
    }
    try {
      controller.enqueue(SSE_HEARTBEAT);
    } catch {
      clearInterval(heartbeat);
    }
  }, SSE_HEARTBEAT_INTERVAL_MS);
  return heartbeat;
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
  const payload: OfflineChatQueuePayload = {
    familiarId: args.body.familiarId,
    prompt: args.promptText,
    sessionId,
    projectRoot: args.body.projectRoot,
    modelOverride: args.body.modelOverride,
    modelOverrideScope: args.body.modelOverrideScope,
    reasoningEffort: args.body.reasoningEffort,
    responseSpeed: args.body.responseSpeed,
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

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const push = (event: StreamEvent) => controller.enqueue(sse(event));
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

// Model parity: probe once per process whether the installed `coven run`
// advertises `--model`. `coven run` rejects unknown flags, so forwarding must be
// a no-op until the companion CLI change ships. Cached; failures resolve false.
let covenRunModelFlagProbe: Promise<boolean> | null = null;
function covenRunSupportsModel(): Promise<boolean> {
  if (!covenRunModelFlagProbe) {
    covenRunModelFlagProbe = new Promise<boolean>((resolve) => {
      let out = "";
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const { command, fixedArgs } = covenLaunchCommand();
        const child = spawn(command, [...fixedArgs, "run", "--help"], {
          env: harnessSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => (out += d.toString()));
        const t = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          done(false);
        }, 2500);
        child.on("close", () => {
          clearTimeout(t);
          done(covenRunSupportsModelFlag(out));
        });
        child.on("error", () => {
          clearTimeout(t);
          done(false);
        });
      } catch {
        done(false);
      }
    });
  }
  return covenRunModelFlagProbe;
}

// Parallel capability probe for `coven run --permission` (the sandbox flag added
// in @opencoven/cli). Same shape/caching as the model probe; a CLI that predates
// the flag rejects unknown flags, so forwarding must stay gated to a no-op.
let covenRunPermissionFlagProbe: Promise<boolean> | null = null;
function covenRunSupportsPermission(): Promise<boolean> {
  if (!covenRunPermissionFlagProbe) {
    covenRunPermissionFlagProbe = new Promise<boolean>((resolve) => {
      let out = "";
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const { command, fixedArgs } = covenLaunchCommand();
        const child = spawn(command, [...fixedArgs, "run", "--help"], {
          env: harnessSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => (out += d.toString()));
        const t = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          done(false);
        }, 2500);
        child.on("close", () => {
          clearTimeout(t);
          done(covenRunSupportsPermissionFlag(out));
        });
        child.on("error", () => {
          clearTimeout(t);
          done(false);
        });
      } catch {
        done(false);
      }
    });
  }
  return covenRunPermissionFlagProbe;
}

// Same gated probe for `coven run --add-dir <DIR>` (repeatable). Granted
// project roots must be trusted by the spawned harness itself — the
// runtime-scope preamble only DESCRIBES the grants, and a harness that trusts
// nothing but its cwd denies every access to them (non-interactive sessions
// cannot re-request permission mid-turn). Cached; failures resolve false.
let covenRunAddDirFlagProbe: Promise<boolean> | null = null;
function covenRunSupportsAddDir(): Promise<boolean> {
  if (!covenRunAddDirFlagProbe) {
    covenRunAddDirFlagProbe = new Promise<boolean>((resolve) => {
      let out = "";
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const { command, fixedArgs } = covenLaunchCommand();
        const child = spawn(command, [...fixedArgs, "run", "--help"], {
          env: harnessSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => (out += d.toString()));
        const t = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          done(false);
        }, 2500);
        child.on("close", () => {
          clearTimeout(t);
          done(covenRunSupportsAddDirFlag(out));
        });
        child.on("error", () => {
          clearTimeout(t);
          done(false);
        });
      } catch {
        done(false);
      }
    });
  }
  return covenRunAddDirFlagProbe;
}

function resolveSendModelMetadata(args: {
  body: SendBody;
  config: CaveConfig;
  binding: FamiliarBinding;
  existingConversation: ConversationFile | null;
  /**
   * Whether `coven run --model` will actually be forwarded for this turn. When
   * true the application state reads `pending` (saved, awaiting confirmation)
   * instead of `unsupported`; the stream's init event later promotes it to
   * `applied`.
   */
  modelForwardingEnabled: boolean;
}): { desiredModel: string; modelState: ChatModelState } {
  const requestedModel = cleanModelId(args.body.modelOverride);
  const sessionModel =
    args.body.modelOverrideScope === "session"
      ? requestedModel
      : args.existingConversation?.modelIntent?.model ?? null;
  const modelState = resolveChatModelState({
    familiarId: args.body.familiarId,
    harness: args.binding.harness,
    runtime: null,
    globalDefaultModel: args.config.defaults.model,
    familiarModel: args.config.familiars[args.body.familiarId]?.model ?? null,
    sessionModel,
    nextMessageModel: args.body.modelOverrideScope === "next-message" ? requestedModel : null,
    application: { supported: args.modelForwardingEnabled },
  });
  const desiredModel = modelState.effectiveModel === "unknown" ? args.binding.model : modelState.effectiveModel;
  return { desiredModel, modelState };
}

function persistSendModelIntent(
  conversation: ConversationFile,
  body: SendBody,
  modelState: ChatModelState,
) {
  if (body.modelOverrideScope !== "session" || modelState.source !== "session") return;
  conversation.modelIntent = {
    model: modelState.effectiveModel,
    source: "session",
    applicationState: modelState.applicationState,
    reason: modelState.reason ?? "Saved for this chat.",
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" ? value : "high";
}

function normalizeResponseSpeed(value: unknown): ResponseSpeed {
  return value === "fast" || value === "balanced" || value === "careful" ? value : "fast";
}

function buildPromptWithResponseControls(prompt: string, body: SendBody): string {
  const effort = normalizeReasoningEffort(body.reasoningEffort);
  const speed = normalizeResponseSpeed(body.responseSpeed);
  const effortInstruction: Record<ReasoningEffort, string> = {
    low: "Use minimal internal planning and answer directly.",
    medium: "Balance planning with a concise answer.",
    high: "Spend extra internal planning on correctness before answering.",
  };
  const speedInstruction: Record<ResponseSpeed, string> = {
    fast: "Prioritize a fast, terse, action-first response.",
    balanced: "Balance speed, detail, and clarity.",
    careful: "Prioritize careful completeness over speed.",
  };
  return [
    "<response_controls>",
    `thinking: ${effort} — ${effortInstruction[effort]}`,
    `speed: ${speed} — ${speedInstruction[speed]}`,
    "Do not mention these controls unless the user asks about them.",
    "</response_controls>",
    "",
    buildNextPathsDirective(),
    "",
    prompt,
  ].join("\n");
}

function openClawChatResponse(args: {
  req: Request;
  body: SendBody;
  promptText: string;
  harnessPrompt: string;
  attachments: ChatAttachment[];
  desiredModel: string;
  modelState: ChatModelState;
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
        if (closed || args.req.signal.aborted) return;
        try {
          controller.enqueue(sse(event));
        } catch (error) {
          closed = true;
          if (!args.req.signal.aborted) console.warn("Failed to enqueue chat stream event", error);
        }
      };
      const pushProgress = (
        id: string,
        label: string,
        status: "running" | "done" | "error",
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
      const heartbeat = startSseHeartbeat(controller, () => closed || args.req.signal.aborted);
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
      const argv = openClawAgentArgs(args.harnessPrompt, agentId, conversationId);
      const spawnArgv = openClawSpawnArgs(argv);
      let cwd: string;
      try {
        cwd = await resolveLocalRuntimeCwd(
          args.body.projectRoot ?? (await conversationCwd(args.body.sessionId)),
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
        desiredModel: args.desiredModel,
        confirmedModel: undefined,
        modelSource: args.modelState.source,
        modelApplicationState: args.modelState.applicationState,
        modelApplicationReason: args.modelState.reason,
        openclawAgentId: agentBinding.openclawAgentId,
        openclawAgentSource: agentBinding.source,
        caveSessionId: conversationId,
        gatewaySessionId: undefined,
        sessionKey: openClawSessionKey(conversationId),
      };
      pushProgress("openclaw-start", "Starting OpenClaw bridge", "running", cwd);
      const child = spawn(openClawBin(), spawnArgv, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: openClawSpawnEnv(),
        shell: openClawNeedsShell(),
      });
      pushProgress("openclaw-start", "OpenClaw bridge started", "done");
      pushProgress("openclaw-response", "Waiting for OpenClaw response", "running");

      let stdout = "";
      let stderr = "";
      const killChild = () => {
        try {
          child.kill("SIGTERM");
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
      const onAbort = () => {
        if (runHandle.stopRequested || detachKillTimer != null) return;
        detachKillTimer = setTimeout(killChild, CHAT_DETACH_MAX_MS);
      };
      args.req.signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += stripAnsi(data.toString("utf8"));
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        const message =
          err.code === "ENOENT"
            ? "openclaw CLI not found on PATH. Open Setup to install it, then try again."
            : err.message;
        pushProgress("openclaw-response", "OpenClaw bridge failed", "error", message);
        push({ kind: "error", code: err.code, message });
        push({
          kind: "done",
          durationMs: Date.now() - startedAt,
          isError: true,
          responseMetadata,
        });
        args.req.signal.removeEventListener("abort", onAbort);
        if (detachKillTimer != null) clearTimeout(detachKillTimer);
        unregisterChatRun(runHandle);
        close();
      });
      child.on("close", async (code) => {
        args.req.signal.removeEventListener("abort", onAbort);
        if (detachKillTimer != null) clearTimeout(detachKillTimer);
        unregisterChatRun(runHandle);
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
        const cancelledByUser = runHandle.stopRequested;

        if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as OpenClawAgentJson;
            gatewaySessionId = extractOpenClawSessionId(parsed);
            if (gatewaySessionId) responseMetadata.gatewaySessionId = gatewaySessionId;
            assistantText = extractOpenClawText(parsed);
            isError = isError || parsed.status === "error";
          } catch {
            if (!cancelledByUser) assistantText = stdout.trim();
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

        if (cancelledByUser) {
          if (!assistantText.trim()) assistantText = "(cancelled)";
          isError = false;
        } else if (!assistantText.trim()) {
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
          pushProgress("save-transcript", "Saving transcript", "running");
          await recordSessionFamiliar(sessionId, args.body.familiarId);
          const existing = await loadConversation(sessionId);
          const now = new Date().toISOString();
          const userTurnId = crypto.randomUUID();
          const assistantTurnId = crypto.randomUUID();
          const chatTitle = existing?.title ?? defaultChatTitleForSession(sessionId);
          if (!existing) await setDefaultSessionTitleIfMissing(sessionId, chatTitle);
          // Branching: same logic as the coven-run path — client-supplied
          // parentTurnId takes precedence; falls back to prior activeLeafId for
          // normal (non-branch) sends so the linear chain is preserved.
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
          persistSendModelIntent(conv, args.body, args.modelState);
          // Work-branch snapshot from the chat's own cwd — per-session PR
          // attribution (badges + merged-PR auto-archive). Best-effort; a
          // failed capture keeps the previous snapshot.
          const workBranch = await captureWorkBranch(cwdFromConversationRuntime(conv.runtime));
          if (workBranch) conv.branch = workBranch;
          conv.turns.push(
            {
              id: userTurnId,
              role: "user",
              text: args.promptText,
              ...(args.attachments.length ? { attachments: args.attachments } : {}),
              createdAt: now,
              ...(branchParentId != null ? { parentId: branchParentId } : {}),
            },
            {
              id: assistantTurnId,
              role: "assistant",
              text: assistantText.trim(),
              createdAt: new Date().toISOString(),
              durationMs,
              isError,
              parentId: userTurnId,
              responseMetadata,
              ...(cancelledByUser ? { cancelled: true } : {}),
            },
          );
          conv.activeLeafId = assistantTurnId;
          await saveConversation(conv);
          if (!existing && !isError) {
            await autoNameSessionFromFirstExchange(sessionId, args.promptText);
          }
          pushProgress("save-transcript", "Transcript saved", "done");
        }

        push({
          kind: "done",
          durationMs,
          isError,
          sessionId: sessionId ?? undefined,
          responseMetadata,
        });
        await sleep(20);
        close();
      });
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
  // Persisted transcripts keep attachment metadata only — base64 image
  // payloads stay out of the conversation store.
  const persistedAttachments = stripPreviewOnlyAttachmentFields(attachments);

  const config = await loadConfig();
  const binding = bindingFor(config, body.familiarId);
  // Canonicalize the bound harness id up front so a familiar carrying a
  // package/alias id (e.g. "hermes-agent" for Hermes) is recognized as the
  // trusted "hermes" adapter — otherwise the trust gate below 403s and `coven
  // run` is invoked with an unknown harness name. Every downstream check and
  // the spawn use this canonical id.
  binding.harness = canonicalHarnessId(binding.harness);
  const existingConversation = body.sessionId
    ? await loadConversation(body.sessionId).catch(() => null)
    : null;
  if (existingConversation && existingConversation.familiarId !== body.familiarId) {
    return new Response(
      JSON.stringify({ ok: false, error: "not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
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
  // OpenClaw runs through its own agent bridge (no `coven run`), so it never
  // forwards `--model`; every other bundled harness gates on the capability
  // probe so this stays a no-op until the companion CLI ships the flag.
  const modelForwardingEnabled =
    binding.harness !== "openclaw" && (await covenRunSupportsModel());
  // Same gating for the sandbox/permission flag. Only "read" is forwarded
  // (→ `--permission read-only`); "full" stays implicit so the harness keeps
  // its own default sandbox instead of being widened to danger-full-access.
  const permissionForwardingEnabled =
    binding.harness !== "openclaw" && (await covenRunSupportsPermission());
  // Same gating for directory grants (`--add-dir`). Without forwarding, the
  // granted roots listed in the runtime-scope preamble are prompt-text-only
  // and the harness denies every access to them.
  const addDirForwardingEnabled =
    binding.harness !== "openclaw" && (await covenRunSupportsAddDir());
  const { desiredModel, modelState } = resolveSendModelMetadata({
    body,
    config,
    binding,
    existingConversation,
    modelForwardingEnabled,
  });

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
  const resumeCwd =
    !sshRuntime && !body.projectRoot && existingConversation?.runtime?.startsWith("local:")
      ? existingConversation.runtime.slice("local:".length).trim() || undefined
      : undefined;
  const projects = sshRuntime ? [] : await loadProjects();
  const resolvedFamiliarWorkspace = !sshRuntime
    ? await resolveFamiliarWorkspace(body.familiarId)
    : undefined;
  let cwd: string;
  try {
    cwd = sshRuntime
      ? homedir()
      : await resolveLocalRuntimeCwd(body.projectRoot ?? resumeCwd ?? resolvedFamiliarWorkspace);
  } catch (error) {
    if (error instanceof RuntimeScopeError) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message, code: error.code }),
        { status: error.status, headers: { "content-type": "application/json" } },
      );
    }
    throw error;
  }
  const chatProjectId = sshRuntime
    ? null
    : chatProjectAccessId({
        projects,
        requestedProjectRoot: body.projectRoot,
        resumeCwd,
        resolvedCwd: cwd,
        familiarWorkspace: resolvedFamiliarWorkspace,
      });
  if (chatProjectId) {
    try {
      await assertProjectAccess({ familiarId: body.familiarId }, chatProjectId, "chat");
    } catch (error) {
      if (error instanceof ProjectAccessDeniedError) {
        return new Response(
          JSON.stringify({ ok: false, error: error.message }),
          { status: error.status, headers: { "content-type": "application/json" } },
        );
      }
      throw error;
    }
  }
  const grantedProjectRoots = sshRuntime
    ? []
    : (await filterProjectsForFamiliar(projects, body.familiarId)).map((project) => project.root);
  // Resolve familiar workspace for identity context. When a project root is
  // explicitly set, the harness boots there (and should have the familiar's
  // AGENTS.md injected separately). When there's no project root, boot in the
  // familiar's own workspace so the selected harness picks up AGENTS.md /
  // SOUL.md / IDENTITY.md and responds as the familiar instead of as the
  // generic CLI identity. A resumed conversation keeps its recorded cwd over
  // the workspace for the same reason. SSH runtimes own their remote cwd, so
  // never stat the local filesystem for a remote familiar.
  const familiarCwd = !sshRuntime && !body.projectRoot && !resumeCwd
    ? resolvedFamiliarWorkspace
    : undefined;
  const runtimeScope: RuntimeScope = sshRuntime
    ? { kind: "ssh", host: sshRuntime.host, root: sshRuntime.cwd }
    : { kind: "local", root: familiarCwd ?? cwd, allowedProjectRoots: grantedProjectRoots };
  // Boundary sentinel: watches the harness's streamed tool calls for paths
  // outside the granted roots. Never blocks the stream — violations surface
  // as a progress notice at turn end and steer the NEXT turn via a prompt
  // reminder (see chat-boundary-sentinel.ts). SSH runtimes stream remote
  // paths that can't be classified against local roots, so they skip it.
  const boundarySentinel = sshRuntime
    ? null
    : createBoundarySentinel({
        allowedRoots: [
          familiarCwd ?? cwd,
          ...grantedProjectRoots,
          ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
        ],
      });
  const responseMetadata: ChatResponseMetadata = {
    familiarId: body.familiarId,
    harness: binding.harness,
    model: desiredModel,
    runtime: sshRuntime
      ? `ssh:${sshRuntime.host}:${sshRuntime.cwd}`
      : `local:${familiarCwd ?? cwd}`,
    desiredModel,
    confirmedModel: undefined,
    modelSource: modelState.source,
    modelApplicationState: modelState.applicationState,
    modelApplicationReason: modelState.reason,
  };
  const offlineChatResponse = await maybeQueueOfflineChat({
    body,
    config,
    promptText,
    persistedAttachments,
    responseMetadata,
  });
  if (offlineChatResponse) return offlineChatResponse;

  // Image delivery channel: only local coven-run harnesses can Read files on
  // this machine. The OpenClaw bridge and SSH runtimes cannot, so their
  // prompts carry an explicit unsupported notice instead of a dead path.
  const imagesSupported = !sshRuntime && binding.harness !== "openclaw";
  const imageFilePaths = imagesSupported
    ? await writeImageAttachmentsToTemp(attachments)
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
  const knowledgeVaultEntries = await readKnowledgeVaultForPrompt(body.familiarId);
  const knowledgeVaultCollections = await listCollections();

  const taskContext = await taskContextForSession(body.sessionId);
  const scopedPrompt = buildPromptWithRuntimeScope(
    buildPromptWithCovenIdentityCanon(
      buildTaskAwarePrompt(
        buildPromptWithKnowledgeVault(
          buildPromptWithFamiliarStartupContext(
            appendMentionedFilesBlock(
              buildPromptWithResponseControls(
                buildPromptWithAttachments(promptText, attachments, {
                  imagesSupported,
                  imageFilePaths,
                }),
                body,
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
      body.familiarId,
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
    });
  }

  // Build coven run argv.
  // Important: pass every flag BEFORE the prompt and add a `--` separator,
  // because `<PROMPT>...` is a variadic positional in coven's clap definition
  // and otherwise swallows trailing flags like `--stream-json` as raw text.
  // Model parity: forward the resolved model only when forwarding is enabled
  // (the installed `coven run` advertises `--model`) and the id is well-formed.
  // Emitted BEFORE the `--` separator for the same reason every other flag is.
  const forwardModel =
    modelForwardingEnabled && cleanModelId(desiredModel) ? desiredModel : null;
  const forwardPermission =
    permissionForwardingEnabled && body.permissionMode === "read" ? "read-only" : null;
  // Directory grants: forward every granted project root — plus the familiar's
  // own workspace when it isn't the spawn cwd — so the harness actually trusts
  // the roots the runtime-scope preamble grants. The spawn cwd is already
  // trusted implicitly, so it's excluded. Gated on the `--add-dir` probe and
  // local runtimes only (SSH runtimes own their remote filesystem).
  const spawnRoot = familiarCwd ?? cwd;
  const grantDirs = !sshRuntime
    ? Array.from(
        new Set(
          [
            ...grantedProjectRoots,
            ...(resolvedFamiliarWorkspace ? [resolvedFamiliarWorkspace] : []),
          ]
            .map((root) => root.trim())
            .filter((root) => root && root !== spawnRoot),
        ),
      )
    : [];
  const forwardAddDirs = addDirForwardingEnabled && !sshRuntime ? grantDirs : [];
  // Copilot tool visibility (cave-yesg): `coven run copilot --stream-json`
  // launches the CLI one-shot (`-s -p`) and pipes raw prose, so tool calls
  // never surface as structured events. When the registry manifest declares
  // copilot's JSONL stream mode, spawn the CLI directly with those args and
  // parse its event stream instead. Local runtimes only — SSH runtimes go
  // through `coven run` on the remote host. Null keeps the passthrough
  // fallback (and every other adapter keeps it unconditionally).
  const copilotStream =
    !sshRuntime && binding.harness === "copilot" ? copilotStreamSpec() : null;
  // The copilot session id Cave chose for the CURRENT attempt: the resume
  // target, or a pre-assigned fresh id (copilot events don't echo the id
  // until the final result frame, so the stream handler announces this one).
  let copilotSessionHint: string | null = null;
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
      copilotSessionHint = resumeSessionId ?? crypto.randomUUID();
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
        resumeSessionId,
        newSessionId: resumeSessionId ? null : copilotSessionHint,
        model: cleanModelId(desiredModel),
        permissionMode: body.permissionMode === "read" ? "read" : "full",
        // Ungated grant list (cave-n1yc): the direct spawn never goes through
        // `coven run`, so the coven CLI's --add-dir probe must not mask it.
        // Copilot's native repeatable --add-dir ships in every CLI version
        // this stream path supports, same trust basis as the manifest's
        // session/sandbox flags above.
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
  const resumeTarget = body.sessionId
    ? existingConversation?.harnessSessionId ?? body.sessionId
    : null;
  const args = buildArgs(resumeTarget);

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
  // harnessSessionId lives only in coven's store. In these cases we retry
  // once without the resume flag so the chat starts fresh instead of erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600|Session ID \S+ is already in use|No conversation found with session ID|session\s+\S+\s+not found in local store|No session, task, or name matched/i;

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false;
      const push = (e: StreamEvent) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(sse(e));
        } catch (error) {
          closed = true;
          if (!req.signal.aborted) console.warn("Failed to enqueue chat stream event", error);
        }
      };
      const pushProgress = (
        id: string,
        label: string,
        status: "running" | "done" | "error",
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
      const heartbeat = startSseHeartbeat(controller, () => closed || req.signal.aborted);
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

      let sessionId: string | null = body.sessionId ?? null;
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
      let result: {
        duration_ms?: number;
        is_error?: boolean;
        usage?: TurnUsage;
        costUsd?: number;
      } = {};
      // Tracks open tool calls from both hook lines and stream-json
      // envelopes: per-name FIFO queues give concurrent same-name calls
      // distinct ids, and hook/envelope events describing the same call are
      // deduped onto one id (hook events win — they carry real durations).
      let toolTracker = new ToolCallTracker();
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
      const recordStdoutErrorTail = (text: string) => {
        for (const part of text.split(/\r?\n/)) {
          const trimmed = part.trim();
          if (!trimmed || !ERR_LINE_RE.test(trimmed)) continue;
          stdoutErrTail.push(trimmed);
          if (stdoutErrTail.length > STDOUT_ERR_KEEP) stdoutErrTail.shift();
        }
      };

      // Set to true when the harness reports its resume failed (rollout DB
      // miss). Triggers a single transparent retry without --continue.
      let resumeFailed = false;

      // Model parity: the harness echoes its resolved model on the init/system
      // stream event. Capturing it lets the application state render honestly as
      // `applied` instead of staying `pending`. Null until the init event with a
      // model field arrives (older CLIs omit it → honest `pending`).
      let confirmedModel: string | null = null;

      // Dedups copilot's streamed text deltas against the full-content
      // assistant.message frame that follows them.
      const copilotText = new CopilotTextAssembler();

      const announceSession = (id: string) => {
        sessionId = id;
        // The client tracks the STABLE conversation id — on resumed
        // turns the harness mints a fresh internal id, which must not
        // leak out as a "new session" (it fragmented every continued
        // chat into one sidebar entry per turn).
        const announcedId = body.sessionId ?? id;
        push({ kind: "session", sessionId: announcedId });
        // Title the session from the user's prompt as soon as the id
        // exists. The daemon's own title derives from the harness
        // prompt — i.e. the identity-canon preamble — and is what the
        // UI would otherwise show until the transcript save runs.
        void setDefaultSessionTitleIfMissing(
          announcedId,
          chatTitleFromPrompt(promptText) ?? defaultChatTitleForSession(announcedId),
        ).catch(() => undefined);
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
            const ev = parseCopilotChatEvent(JSON.parse(line));
            if (!ev) return;
            if (!confirmedModel && ev.kind !== "result") {
              const echoed = cleanModelId(ev.model);
              if (echoed) confirmedModel = echoed;
            }
            // Copilot only echoes the session id on the final result frame;
            // announce the id Cave launched with as soon as the stream is
            // live so the client can adopt the conversation immediately.
            if (!sessionId && copilotSessionHint) announceSession(copilotSessionHint);
            switch (ev.kind) {
              case "text_delta": {
                const text = copilotText.delta(ev.messageId, ev.text);
                if (text) {
                  assistantText += text;
                  push({ kind: "assistant_chunk", text });
                }
                break;
              }
              case "message": {
                const text = copilotText.message(ev.messageId, ev.content);
                if (text) {
                  assistantText += text;
                  push({ kind: "assistant_chunk", text });
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
                break;
              }
              case "tool_end": {
                const toolEv = toolTracker.envelopeToolResult(
                  ev.toolCallId,
                  ev.output,
                  ev.isError,
                );
                if (toolEv) push({ kind: "tool_use", ...toolEv });
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
            /* not valid JSON after all — fall through to the error tail */
          }
        }
        recordStdoutErrorTail(resolveBackspaces(stripAnsi(line)));
      };

      const handleLine = (rawLine: string) => {
        // stdout is split on bare \n; external adapters (copilot) emit CRLF,
        // and a trailing \r would both fail the endsWith("}") JSON sniff and
        // leak into bubble text.
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line) return;
        if (RESUME_ERR_RE.test(line)) resumeFailed = true;
        const isJson = line.startsWith("{") && line.endsWith("}");
        if (copilotStream) {
          handleCopilotLine(line, isJson);
          return;
        }
        if (isJson) {
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
              if (echoed) confirmedModel = echoed;
            }
            if (ev.session_id && !sessionId) {
              sessionId = ev.session_id;
              // The client tracks the STABLE conversation id — on resumed
              // turns the harness mints a fresh internal id, which must not
              // leak out as a "new session" (it fragmented every continued
              // chat into one sidebar entry per turn).
              const announcedId = body.sessionId ?? sessionId;
              push({ kind: "session", sessionId: announcedId });
              // Title the session from the user's prompt as soon as the id
              // exists. The daemon's own title derives from the harness
              // prompt — i.e. the identity-canon preamble — and is what the
              // UI would otherwise show until the transcript save runs.
              void setDefaultSessionTitleIfMissing(
                announcedId,
                chatTitleFromPrompt(promptText) ?? defaultChatTitleForSession(announcedId),
              ).catch(() => undefined);
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
            } else if (ev.type === "output" && typeof ev.text === "string") {
              // Coven's Windows captured-piped Codex path wraps transcript
              // bytes as stream-json `output` events so stdout remains a
              // valid JSONL protocol. Preserve the original chunk boundaries:
              // AssistantFilter buffers partial lines and exposes only the
              // assistant phase after stripping Codex's startup transcript.
              const cleaned = resolveBackspaces(stripAnsi(ev.text));
              recordStdoutErrorTail(cleaned);
              const filtered = assistantFilter.push(cleaned);
              if (filtered) {
                assistantText += filtered;
                push({ kind: "assistant_chunk", text: filtered });
              }
            } else if (
              ev.type === "assistant" &&
              Array.isArray(ev.message?.content)
            ) {
              // Claude stream-json wraps assistant text inside a message envelope.
              // Extract every text chunk and surface it as an assistant_chunk so
              // the chat bubble renders. tool_use blocks become structured
              // tool events so harnesses WITHOUT pre/post_tool_use hooks still
              // show tool activity; the tracker dedups against hook-derived
              // events when both sources describe the same call.
              for (const block of ev.message.content) {
                if (block.type === "text" && block.text) {
                  assistantText += block.text;
                  push({ kind: "assistant_chunk", text: block.text });
                } else if (block.type === "tool_use" && block.id && block.name) {
                  boundarySentinel?.observe(block.name, block.input);
                  const toolEv = toolTracker.envelopeToolUse(
                    block.id,
                    block.name,
                    formatToolInputValue(block.input),
                    assistantText.length,
                  );
                  if (toolEv) push({ kind: "tool_use", ...toolEv });
                }
              }
            } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
              // Tool outputs come back as tool_result blocks on the follow-up
              // user envelope. Settle the matching tool event unless a post
              // hook already did (hook output + duration win).
              for (const block of ev.message.content) {
                if (block.type === "tool_result" && block.tool_use_id) {
                  const toolEv = toolTracker.envelopeToolResult(
                    block.tool_use_id,
                    flattenToolResultContent(block.content),
                    block.is_error === true,
                  );
                  if (toolEv) push({ kind: "tool_use", ...toolEv });
                }
              }
            }
            return;
          } catch {
            /* fall through to filter */
          }
        }
        const cleaned = resolveBackspaces(stripAnsi(line));
        const trimmed = cleaned.trim();
        // Snapshot error-looking stdout lines for the empty-response diagnostic.
        recordStdoutErrorTail(cleaned);
        // Surface tool-use hook lines as structured events so the chat can
        // render a tool block. Hooks are still discarded by AssistantFilter
        // below, so this is purely additive.
        const toolMatch = trimmed.match(TOOL_HOOK_RE);
        if (toolMatch) {
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
      const killCurrentChild = () => {
        try {
          currentChild?.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };
      const runHandle: ChatRunHandle = registerChatRun(
        [body.runId, body.sessionId],
        killCurrentChild,
      );
      let detachKillTimer: ReturnType<typeof setTimeout> | null = null;

      const runAttempt = (spawnArgs: string[]): Promise<void> =>
        new Promise((resolve) => {
          const attemptStartedAt = Date.now();
          pushProgress(
            "harness-start",
            `Starting ${binding.harness}`,
            "running",
            sshRuntime
              ? `${sshRuntime.host}:${sshRuntime.cwd}`
              : familiarCwd ?? cwd,
          );
          const child = sshRuntime
            ? (() => {
                const sshArgs = spawnArgs;
                return spawn("ssh", sshArgs, {
                  stdio: ["ignore", "pipe", "pipe"],
                  env: harnessSpawnEnv(body.familiarId),
                });
              })()
            : (() => {
                // Copilot stream turns spawn the adapter binary directly with
                // its manifest-declared JSONL args; everything else goes
                // through `coven run`.
                const { command, fixedArgs } = copilotStream
                  ? { command: copilotStream.executable, fixedArgs: [] as string[] }
                  : covenLaunchCommand();
                return spawn(command, [...fixedArgs, ...spawnArgs], {
                  // Spawn IN the familiar's workspace when no project root was
                  // supplied, so coven's project-root resolver picks that dir as
                  // root and Codex/Claude pick up AGENTS.md / SOUL.md / IDENTITY.md
                  // from the familiar's home. When a project root IS supplied,
                  // honor that instead.
                  cwd: familiarCwd ?? cwd,
                  stdio: ["ignore", "pipe", "pipe"],
                  // Scoped vault keys the familiar is not granted are
                  // subtracted here — the harness only sees shared secrets
                  // plus its own grants (cave-4nu6).
                  env: harnessSpawnEnv(body.familiarId),
                });
              })();

          currentChild = child;
          const onAbort = () => {
            // Transport drop, not Stop — arm the detach cap and let the turn
            // finish. Deliberate stops kill through the registry instead.
            if (runHandle.stopRequested || detachKillTimer != null) return;
            detachKillTimer = setTimeout(killCurrentChild, CHAT_DETACH_MAX_MS);
          };
          req.signal.addEventListener("abort", onAbort, { once: true });

          child.stdout.on("data", (data: Buffer) => {
            jsonBuf += data.toString("utf8");
            let idx;
            while ((idx = jsonBuf.indexOf("\n")) >= 0) {
              const line = jsonBuf.slice(0, idx);
              jsonBuf = jsonBuf.slice(idx + 1);
              handleLine(line);
            }
          });

          child.stderr.on("data", (data: Buffer) => {
            const text = stripAnsi(data.toString("utf8"));
            if (RESUME_ERR_RE.test(text)) resumeFailed = true;
            for (const line of text.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              stderrTail.push(trimmed);
              if (stderrTail.length > STDERR_KEEP) stderrTail.shift();
            }
          });

          child.on("error", (err: NodeJS.ErrnoException) => {
            pushProgress(
              "harness-start",
              `${binding.harness} failed to start`,
              "error",
              err.message,
              Date.now() - attemptStartedAt,
            );
            if (err.code === "ENOENT") {
              push({
                kind: "error",
                code: "ENOENT",
                message:
                  sshRuntime
                    ? "ssh CLI not found on PATH. Install OpenSSH or run this familiar locally."
                    : copilotStream
                      ? "copilot CLI not found on PATH. Install it with `npm install -g @github/copilot`, then try again."
                      : "Coven CLI not found on PATH. Open Setup to install it, then try again.",
              });
            } else {
              push({ kind: "error", message: err.message });
            }
            req.signal.removeEventListener("abort", onAbort);
            resolve();
            close();
          });

          child.on("close", () => {
            pushProgress(
              "harness-start",
              `${binding.harness} exited`,
              "done",
              undefined,
              Date.now() - attemptStartedAt,
            );
            if (jsonBuf) handleLine(jsonBuf);
            const tail = assistantFilter.flush();
            if (tail) {
              assistantText += tail;
              push({ kind: "assistant_chunk", text: tail });
            }
            req.signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });

      // First attempt — uses --continue if body.sessionId was set.
      const turnSpawnStartMs = Date.now();
      await runAttempt(args);

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
        assistantFilter = new AssistantFilter({ passthrough: rawStdoutHarness });
        assistantText = "";
        jsonBuf = "";
        result = {};
        toolTracker = new ToolCallTracker();
        copilotText.reset();
        stderrTail.length = 0;
        stdoutErrTail.length = 0;
        resumeFailed = false;
        await runAttempt(buildArgs(null, retry.prompt));
        pushProgress("resume-retry", "Fresh chat started", "done");
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
      } else if (!assistantText.trim()) {
        // Empty-response diagnostic: when the harness reports done but never
        // produced assistant text, the user otherwise sees a silent empty
        // bubble. Synthesize a short explanation so they know what to do.
        const harness = binding.harness;
        const durMs = result.duration_ms;
        const durSuffix = durMs != null ? ` in ${durMs}ms` : "";
        const tailSource = stderrTail.length ? stderrTail : stdoutErrTail;
        const tailBlock = tailSource.length
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
          cwd: familiarCwd ?? cwd,
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
      const { text: cleanedAssistantText, attachments: agentAttachments } =
        parseAgentAttachments(assistantText.trim(), {
          allowedRoots: sshRuntime ? [] : [familiarCwd ?? cwd, ...grantedProjectRoots],
        });
      for (const attachment of agentAttachments) {
        push({ kind: "attachment", attachment });
      }

      // Persist under the STABLE conversation id. The harness's per-turn id
      // is tracked on the file for the next resume but never becomes the
      // conversation's identity — keying off it created a new conversation
      // file (and sidebar entry) for every resumed turn.
      const harnessSessionId = sessionId;
      // Model parity: if the harness echoed its resolved model, promote the
      // application state from `pending` to `applied` and record what actually
      // ran. No echo ⇒ leave the honest `pending`/`unsupported` state untouched.
      if (confirmedModel) {
        const application = modelApplicationForHarness({ supported: true, confirmed: true });
        responseMetadata.confirmedModel = confirmedModel;
        responseMetadata.modelApplicationState = application.state;
        responseMetadata.modelApplicationReason = application.reason;
        modelState.applicationState = application.state;
        modelState.reason = application.reason;
      }
      const finalSessionId = body.sessionId ?? sessionId;
      if (finalSessionId) {
        pushProgress("save-transcript", "Saving transcript", "running");
        await recordSessionFamiliar(finalSessionId, body.familiarId);
        const existing = await loadConversation(finalSessionId);
        const now = new Date().toISOString();
        const userTurnId = crypto.randomUUID();
        const assistantTurnId = crypto.randomUUID();
        const chatTitle = existing?.title ?? defaultChatTitleForSession(finalSessionId);
        if (!existing) await setDefaultSessionTitleIfMissing(finalSessionId, chatTitle);
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
          createdAt: now,
          ...(branchParentId != null ? { parentId: branchParentId } : {}),
        };
        // Persist the turn's tool rows: the live chips exist only in client
        // state fed by SSE; without this, refresh/chat-switch loses them.
        // Offsets were stamped against the untrimmed stream — shift by the
        // leading trim so interleaving matches the saved text.
        const persistedTools = toPersistedTools(toolTracker.snapshot(),
          assistantText.length - assistantText.trimStart().length,
        );
        const assistantTurn: ChatTurn = {
          id: assistantTurnId,
          role: "assistant",
          text: cleanedAssistantText,
          ...(agentAttachments.length ? { attachments: agentAttachments } : {}),
          createdAt: new Date().toISOString(),
          durationMs: result.duration_ms,
          isError: result.is_error,
          ...(cancelledByUser ? { cancelled: true } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
          ...(persistedTools ? { tools: persistedTools } : {}),
          parentId: userTurnId,
          responseMetadata,
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
        persistSendModelIntent(conv, body, modelState);
        // Work-branch snapshot from the chat's own cwd — per-session PR
        // attribution (badges + merged-PR auto-archive). Best-effort; a
        // failed capture keeps the previous snapshot.
        const workBranch = await captureWorkBranch(cwdFromConversationRuntime(conv.runtime));
        if (workBranch) conv.branch = workBranch;
        if (harnessSessionId) conv.harnessSessionId = harnessSessionId;
        conv.turns.push(userTurn, assistantTurn);
        conv.activeLeafId = assistantTurnId;
        await saveConversation(conv);
        if (!existing && !result.is_error && !cancelledByUser) {
          await autoNameSessionFromFirstExchange(finalSessionId, promptText);
        }
        pushProgress("save-transcript", "Transcript saved", "done");
      }

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
      cleanupImageTempFiles(imageFilePaths);
      if (detachKillTimer != null) clearTimeout(detachKillTimer);
      unregisterChatRun(runHandle);
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
