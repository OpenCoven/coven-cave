import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
  type CaveConfig,
  type FamiliarBinding,
  loadConfig,
  loadState,
  recordSessionFamiliar,
  setSessionTitle,
} from "@/lib/cave-config";
import {
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
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  toPersistedTools,
  ToolCallTracker,
} from "@/lib/chat-tool-events";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { buildPromptWithCovenIdentityCanon } from "@/lib/coven-identity-canon";
import { buildNextPathsDirective } from "@/lib/next-paths";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import { openClawBin, openClawNeedsShell, openClawSpawnArgs, openClawSpawnEnv } from "@/lib/openclaw-bin";
import {
  covenHome,
  familiarWorkspacesRoot,
  readFamiliarWorkspaces,
} from "@/lib/coven-paths";
import { isTrustedChatHarness, covenRunSupportsModelFlag } from "@/lib/harness-adapters";
import {
  type ConversationFile,
  type ChatTurn,
  loadConversation,
  saveConversation,
} from "@/lib/cave-conversations";
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
  ProjectAccessDeniedError,
  assertProjectAccess,
} from "@/lib/project-permissions";
import {
  buildTaskAwarePrompt,
  taskContextForSession,
} from "@/lib/task-chat-context";
import {
  buildPromptWithFamiliarStartupContext,
  readFamiliarDailyMemoryStartupContext,
} from "@/lib/server/familiar-startup-context";
import { extractLinks } from "@/lib/link-extractor";
import { routeLinkHandler } from "@/app/api/library/route-link/route";
import {
  buildSshSpawnArgs,
  isSshRuntime,
} from "@/lib/familiar-runtime";
import {
  parseCostUsd,
  parseStreamJsonUsage,
  type TurnUsage,
} from "@/lib/usage-format";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendBody = {
  familiarId: string;
  prompt?: string;
  sessionId?: string;
  projectRoot?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
  reasoningEffort?: string;
  responseSpeed?: string;
  attachments?: ChatAttachment[];
  /** Repo-relative paths the user @-mentioned in the composer (CHAT-D1-04). */
  mentionedFiles?: string[];
  /** Project root the mentions are relative to — resumed sessions don't carry
   * projectRoot in the body, so the composer sends the root it knows. */
  mentionedFilesRoot?: string;
};

type ReasoningEffort = "low" | "medium" | "high";
type ResponseSpeed = "fast" | "balanced" | "careful";

type StreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; text: string }
  | { kind: "assistant_chunk"; text: string }
  | { kind: "progress"; id?: string; label: string; detail?: string; status?: "running" | "done" | "error"; durationMs?: number }
  | {
      kind: "tool_use";
      id?: string;
      name: string;
      input?: string;
      output?: string;
      status?: "running" | "ok" | "error";
      durationMs?: number;
    }
  | {
      kind: "done";
      durationMs?: number;
      isError?: boolean;
      sessionId?: string;
      usage?: TurnUsage;
      costUsd?: number;
      responseMetadata?: ChatResponseMetadata;
    }
  | { kind: "error"; message: string; code?: string };

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

async function chatProjectAccessId(args: {
  requestedProjectRoot?: string;
  resumeCwd?: string;
  resolvedCwd: string;
}): Promise<string | null> {
  const explicitRoot = args.requestedProjectRoot?.trim() || undefined;
  const resumedRoot = !explicitRoot ? args.resumeCwd?.trim() || undefined : undefined;
  const projectRoot = explicitRoot ?? resumedRoot;
  if (!projectRoot) return null;

  const projects = await loadProjects();
  const project =
    projectForRoot(projectRoot, projects) ??
    projectForRoot(args.resolvedCwd, projects);
  if (project) return project.id;

  // An explicit projectRoot that is not registered is still a project-scoped
  // chat request. Fail it closed through the shared permission chokepoint so
  // the decision is audited and only Supreme can proceed.
  return explicitRoot ? `unregistered:${projectRoot}` : null;
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
      /* fall through to default familiar workspace */
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

function scheduleLinkRoute(args: {
  prompt: string;
  sessionId: string | null;
  turnId: string | null;
  chatTitle: string;
  familiar: string;
}) {
  if (!args.sessionId || !args.turnId) return; // chat-source requires both
  const { prompt } = args;
  const urls = extractLinks(prompt);
  for (const url of urls) {
    void (async () => {
      try {
        await routeLinkHandler({
          url,
          source: {
            kind: "chat",
            sessionId: args.sessionId!,
            turnId: args.turnId!,
            chatTitle: args.chatTitle,
          },
          familiar: args.familiar,
        });
      } catch (err) {
        console.warn("[chat-send] routeLink failed:", (err as Error).message);
      }
    })();
  }
}

async function setDefaultSessionTitleIfMissing(sessionId: string, title: string) {
  const state = await loadState();
  if (state.sessionTitles[sessionId]) return;
  await setSessionTitle(sessionId, title);
}

function sse(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
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
        const child = spawn(covenBin(), ["run", "--help"], {
          env: covenSpawnEnv(),
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

type OpenClawAgentJson = {
  status?: string;
  summary?: string;
  sessionId?: string;
  result?: {
    payloads?: Array<{ text?: string; content?: unknown }>;
    sessionId?: string;
    meta?: { agentMeta?: { sessionId?: string } };
  };
  meta?: { agentMeta?: { sessionId?: string } };
};

type OpenClawAgentSummary = {
  id?: string;
  name?: string;
  identityName?: string;
  isDefault?: boolean;
};

function readTomlString(block: string, key: string): string | null {
  const quoted = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(['"])(.*?)\\1\\s*(?:#.*)?$`, "m"));
  if (quoted) return quoted[2];
  const bare = block.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\s#]+)\\s*(?:#.*)?$`, "m"));
  return bare?.[1] ?? null;
}

function slugifyAgentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readOpenClawAgentBinding(familiarId: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(covenHome(), "familiars.toml"), "utf8");
    const blocks = raw.split(/^\s*\[\[familiar\]\]\s*$/m).slice(1);
    for (const block of blocks) {
      if (readTomlString(block, "id") !== familiarId) continue;
      return readTomlString(block, "openclaw_agent");
    }
  } catch {
    /* no familiar binding file */
  }
  return null;
}

function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  return new Promise((resolve) => {
    const child = spawn(openClawBin(), openClawSpawnArgs(["agents", "list", "--json"]), {
      stdio: ["ignore", "pipe", "ignore"],
      env: openClawSpawnEnv(),
      shell: openClawNeedsShell(),
    });
    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim()) as OpenClawAgentSummary[];
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

async function resolveOpenClawAgentId(familiarId: string): Promise<string> {
  const explicit = await readOpenClawAgentBinding(familiarId);
  if (explicit) return explicit;

  const agents = await listOpenClawAgents();
  const exact = agents.find((agent) => agent.id === familiarId)?.id;
  if (exact) return exact;

  const named = agents.find(
    (agent) =>
      (agent.name && slugifyAgentName(agent.name) === familiarId) ||
      (agent.identityName && slugifyAgentName(agent.identityName) === familiarId),
  )?.id;
  if (named) return named;

  return familiarId;
}

function extractOpenClawText(json: OpenClawAgentJson): string {
  const payloads = json.result?.payloads ?? [];
  const text = payloads
    .map((payload) => {
      if (typeof payload.text === "string") return payload.text;
      if (Array.isArray(payload.content)) {
        return payload.content
          .map((part) =>
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
              ? part.text
              : "",
          )
          .join("");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || json.summary?.trim() || "";
}

function extractOpenClawSessionId(
  json: OpenClawAgentJson,
  fallback?: string,
): string | null {
  return (
    json.sessionId ??
    json.result?.sessionId ??
    json.result?.meta?.agentMeta?.sessionId ??
    json.meta?.agentMeta?.sessionId ??
    fallback ??
    null
  );
}

/**
 * Conversation identity for the OpenClaw bridge is CAVE-owned. OpenClaw
 * sessions are persisted per session *key* (`agent:<id>:<key>`); the
 * `sessionId` inside an entry rotates on daily resets, `/new`, and
 * compaction. Pinning each Cave chat to its own `--session-key` keeps one
 * durable gateway session per conversation. Without a key, every turn lands
 * in the shared `agent:<id>:main` session — id rotation then forked each
 * Cave chat into a brand-new conversation, and concurrent chats with the
 * same familiar interleaved context.
 */
function openClawSessionKey(conversationId: string): string {
  return `cave-${conversationId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

function openClawAgentArgs(
  harnessPrompt: string,
  agentId: string,
  conversationId: string,
): string[] {
  return [
    "agent",
    "--agent",
    agentId,
    "--message",
    harnessPrompt,
    "--json",
    "--session-key",
    openClawSessionKey(conversationId),
  ];
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
      const push = (event: StreamEvent) => controller.enqueue(sse(event));
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
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
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
      const agentId = await resolveOpenClawAgentId(args.body.familiarId);
      pushProgress("openclaw-resolve", "OpenClaw agent resolved", "done", agentId);
      const argv = openClawAgentArgs(args.harnessPrompt, agentId, conversationId);
      const spawnArgv = openClawSpawnArgs(argv);
      const cwd = await resolveLocalRuntimeCwd(
        args.body.projectRoot ?? (await conversationCwd(args.body.sessionId)),
      );
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
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
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
        close();
      });
      child.on("close", async (code) => {
        args.req.signal.removeEventListener("abort", onAbort);
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

        // User cancel (CHAT-D5-02): a stopped response SIGTERMs the bridge,
        // so stdout is usually empty or truncated JSON. Persist an honest
        // cancelled marker — never raw truncated output or the fabricated
        // "returned no text" error diagnostic.
        const cancelledByUser = args.req.signal.aborted;

        if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as OpenClawAgentJson;
            gatewaySessionId = extractOpenClawSessionId(parsed);
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
          const conv = existing ?? {
            sessionId,
            familiarId: args.body.familiarId,
            harness: "openclaw",
            model: responseMetadata.model,
            runtime: responseMetadata.runtime,
            title: chatTitle,
            createdAt: now,
            updatedAt: now,
            turns: [],
          };
          conv.model = responseMetadata.model;
          conv.runtime = responseMetadata.runtime;
          persistSendModelIntent(conv, args.body, args.modelState);
          conv.turns.push(
            {
              id: userTurnId,
              role: "user",
              text: args.promptText,
              ...(args.attachments.length ? { attachments: args.attachments } : {}),
              createdAt: now,
            },
            {
              id: assistantTurnId,
              role: "assistant",
              text: assistantText.trim(),
              createdAt: new Date().toISOString(),
              durationMs,
              isError,
              responseMetadata,
              ...(cancelledByUser ? { cancelled: true } : {}),
            },
          );
          await saveConversation(conv);
          pushProgress("save-transcript", "Transcript saved", "done");
          scheduleLinkRoute({
            prompt: args.promptText,
            sessionId,
            turnId: userTurnId,
            chatTitle,
            familiar: args.body.familiarId,
          });
          scheduleLinkRoute({
            prompt: assistantText.trim(),
            sessionId,
            turnId: assistantTurnId,
            chatTitle,
            familiar: args.body.familiarId,
          });
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
  const sshRuntime = isSshRuntime(binding.runtime) ? binding.runtime : null;
  const existingConversation = body.sessionId
    ? await loadConversation(body.sessionId).catch(() => null)
    : null;
  if (existingConversation && existingConversation.familiarId !== body.familiarId) {
    return new Response(
      JSON.stringify({ ok: false, error: "not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  // OpenClaw runs through its own agent bridge (no `coven run`), so it never
  // forwards `--model`; every other bundled harness gates on the capability
  // probe so this stays a no-op until the companion CLI ships the flag.
  const modelForwardingEnabled =
    binding.harness !== "openclaw" && (await covenRunSupportsModel());
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
  let cwd: string;
  try {
    cwd = sshRuntime ? homedir() : await resolveLocalRuntimeCwd(body.projectRoot ?? resumeCwd);
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
    : await chatProjectAccessId({
        requestedProjectRoot: body.projectRoot,
        resumeCwd,
        resolvedCwd: cwd,
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
  const resolvedFamiliarWorkspace = !sshRuntime
    ? await resolveFamiliarWorkspace(body.familiarId)
    : undefined;
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
    : { kind: "local", root: familiarCwd ?? cwd };
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

  const taskContext = await taskContextForSession(body.sessionId);
  const harnessPrompt = buildPromptWithRuntimeScope(
    buildPromptWithCovenIdentityCanon(
      buildTaskAwarePrompt(
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
          [dailyMemoryContext],
        ),
        taskContext,
      ),
      body.familiarId,
    ),
    runtimeScope,
  );

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
  const buildArgs = (resumeSessionId: string | null): string[] => {
    if (sshRuntime) {
      return buildSshSpawnArgs({
        runtime: sshRuntime,
        harness: binding.harness,
        familiarId: body.familiarId,
        prompt: harnessPrompt,
        sessionId: resumeSessionId,
        model: forwardModel,
      });
    }
    const a = ["run", binding.harness, "--stream-json"];
    if (resumeSessionId) a.push("--continue", resumeSessionId);
    if (forwardModel) a.push("--model", forwardModel);
    // Inject identity preamble. coven-cli renders this through the best
    // available identity channel for the chosen harness. Without this, the
    // harness answers as its generic CLI identity instead of as the familiar.
    if (/^[a-z0-9_-]+$/i.test(body.familiarId)) {
      a.push("--familiar", body.familiarId);
    }
    a.push("--", harnessPrompt);
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
  // id exists only in Cave's local transcript store. In these cases we retry
  // once without the resume flag so the chat starts fresh instead of erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600|Session ID \S+ is already in use|No conversation found with session ID|session\s+\S+\s+not found in local store/i;

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const push = (e: StreamEvent) => controller.enqueue(sse(e));
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
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already */
        }
      };

      push({ kind: "user", text: promptText });

      let sessionId: string | null = body.sessionId ?? null;
      let assistantFilter = new AssistantFilter();
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

      // Set to true when the harness reports its resume failed (rollout DB
      // miss). Triggers a single transparent retry without --continue.
      let resumeFailed = false;

      // Model parity: the harness echoes its resolved model on the init/system
      // stream event. Capturing it lets the application state render honestly as
      // `applied` instead of staying `pending`. Null until the init event with a
      // model field arrives (older CLIs omit it → honest `pending`).
      let confirmedModel: string | null = null;

      const handleLine = (line: string) => {
        if (!line) return;
        if (RESUME_ERR_RE.test(line)) resumeFailed = true;
        const isJson = line.startsWith("{") && line.endsWith("}");
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
        const cleaned = stripAnsi(line);
        // Snapshot error-looking stdout lines for the empty-response diagnostic.
        const trimmed = cleaned.trim();
        if (trimmed && ERR_LINE_RE.test(trimmed)) {
          stdoutErrTail.push(trimmed);
          if (stdoutErrTail.length > STDOUT_ERR_KEEP) stdoutErrTail.shift();
        }
        // Surface tool-use hook lines as structured events so the chat can
        // render a tool block. Hooks are still discarded by AssistantFilter
        // below, so this is purely additive.
        const toolMatch = trimmed.match(TOOL_HOOK_RE);
        if (toolMatch) {
          const isPost = trimmed.startsWith("hook: post_tool_use");
          const name = toolMatch[1];
          const rest = (toolMatch[2] ?? "").trim();
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
                  env: covenSpawnEnv(),
                });
              })()
            : spawn(covenBin(), spawnArgs, {
                // Spawn IN the familiar's workspace when no project root was
                // supplied, so coven's project-root resolver picks that dir as
                // root and Codex/Claude pick up AGENTS.md / SOUL.md / IDENTITY.md
                // from the familiar's home. When a project root IS supplied,
                // honor that instead.
                cwd: familiarCwd ?? cwd,
                stdio: ["ignore", "pipe", "pipe"],
                env: covenSpawnEnv(),
              });

          const onAbort = () => {
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
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
                    : "coven CLI not found on PATH. Open Setup to install it, then try again.",
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
      await runAttempt(args);

      // Transparent retry: if codex reported its rollout-resume failed and
      // we had been resuming, start a fresh thread (no --continue) so the
      // user's prompt still gets answered.
      if (resumeFailed && body.sessionId) {
        pushProgress("resume-retry", "Resume failed; starting a fresh chat", "running");
        sessionId = null;
        assistantFilter = new AssistantFilter();
        assistantText = "";
        jsonBuf = "";
        result = {};
        toolTracker = new ToolCallTracker();
        stderrTail.length = 0;
        stdoutErrTail.length = 0;
        resumeFailed = false;
        await runAttempt(buildArgs(null));
        pushProgress("resume-retry", "Fresh chat started", "done");
      }

      // User cancel (CHAT-D5-02): when the client stops the response
      // (Esc/Stop), req.signal aborts and the harness child gets SIGTERM —
      // usually before any "result" event. Without this guard the
      // empty-response diagnostic below fabricates an auth-hint error and
      // saves it, so reloading the chat rewrote the user's cancel into a
      // harness error. Persist the honest record instead: the partial text
      // streamed so far (or a minimal "(cancelled)" marker), never an error,
      // and skip the diagnostic SSE chunk — the client already rendered its
      // own cancelled state and is gone.
      const cancelledByUser = req.signal.aborted;
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
        const userTurn: ChatTurn = {
          id: userTurnId,
          role: "user",
          text: promptText,
          ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
          createdAt: now,
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
          text: assistantText.trim(),
          createdAt: new Date().toISOString(),
          durationMs: result.duration_ms,
          isError: result.is_error,
          ...(cancelledByUser ? { cancelled: true } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
          ...(persistedTools ? { tools: persistedTools } : {}),
          responseMetadata,
        };
        const conv = existing ?? {
          sessionId: finalSessionId,
          familiarId: body.familiarId,
          harness: binding.harness,
          model: responseMetadata.model,
          runtime: responseMetadata.runtime,
          title: chatTitle,
          createdAt: now,
          updatedAt: now,
          turns: [],
        };
        conv.model = responseMetadata.model;
        conv.runtime = responseMetadata.runtime;
        persistSendModelIntent(conv, body, modelState);
        if (harnessSessionId) conv.harnessSessionId = harnessSessionId;
        conv.turns.push(userTurn, assistantTurn);
        await saveConversation(conv);
        pushProgress("save-transcript", "Transcript saved", "done");

        // Fire-and-forget: extract URLs from user prompt and assistant text,
        // route them to the library. Failures must never affect the chat stream.
        const prompt = promptText;
        scheduleLinkRoute({
          prompt,
          sessionId: finalSessionId,
          turnId: userTurnId,
          chatTitle,
          familiar: body.familiarId,
        });
        scheduleLinkRoute({
          prompt: assistantText.trim(),
          sessionId: finalSessionId,
          turnId: assistantTurnId,
          chatTitle,
          familiar: body.familiarId,
        });
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
