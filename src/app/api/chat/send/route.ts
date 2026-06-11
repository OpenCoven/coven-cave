import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
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
  ToolCallTracker,
} from "@/lib/chat-tool-events";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { buildPromptWithCovenIdentityCanon } from "@/lib/coven-identity-canon";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { covenHome, familiarWorkspace } from "@/lib/coven-paths";
import { isTrustedChatHarness } from "@/lib/harness-adapters";
import {
  type ChatTurn,
  loadConversation,
  saveConversation,
} from "@/lib/cave-conversations";
import {
  buildTaskAwarePrompt,
  taskContextForSession,
} from "@/lib/task-chat-context";
import { extractLinks } from "@/lib/link-extractor";
import { routeLinkHandler } from "@/app/api/library/route-link/route";
import {
  buildSshSpawnArgs,
  isSshRuntime,
} from "@/lib/familiar-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendBody = {
  familiarId: string;
  prompt?: string;
  sessionId?: string;
  projectRoot?: string;
  attachments?: ChatAttachment[];
  /** Repo-relative paths the user @-mentioned in the composer (CHAT-D1-04). */
  mentionedFiles?: string[];
  /** Project root the mentions are relative to — resumed sessions don't carry
   * projectRoot in the body, so the composer sends the root it knows. */
  mentionedFilesRoot?: string;
};

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
  | { kind: "done"; durationMs?: number; isError?: boolean; sessionId?: string }
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

/** Normalize a path so Node's fs functions don't EISDIR on bare Windows
 * drive letters. "C:" → "C:\\" on Windows; no-op elsewhere. */
function normalizePath(p: string): string {
  if (process.platform === "win32") {
    // Bare drive letter with no trailing separator
    if (/^[a-zA-Z]:$/.test(p)) return p + "\\";
    // Forward slashes → backslashes
    return p.replace(/\//g, "\\\\");
  }
  return p;
}

async function resolveCwd(requested?: string): Promise<string> {
  if (requested) {
    try {
      const normalized = normalizePath(requested);
      const s = await stat(normalized);
      if (s.isDirectory()) return normalized;
    } catch {
      /* fall through to homedir */
    }
  }
  return homedir();
}

/** Resolve the familiar's Coven workspace dir.
 *  Uses ~/.coven/familiars.toml workspace when present, otherwise
 *  ~/.coven/familiars/<id>. Falls back to undefined if the dir doesn't exist
 *  so callers can skip --cwd.
 */
async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  // Guard against path traversal: familiar IDs should be simple slugs.
  if (!/^[a-z0-9_-]+$/i.test(familiarId)) return undefined;
  const candidate = await familiarWorkspace(familiarId);
  try {
    const s = await stat(candidate);
    if (s.isDirectory()) return candidate;
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
    const child = spawn("openclaw", ["agents", "list", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
      env: covenSpawnEnv(),
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

function openClawAgentArgs(
  body: SendBody,
  harnessPrompt: string,
  agentId: string,
): string[] {
  const args = [
    "agent",
    "--agent",
    agentId,
    "--message",
    harnessPrompt,
    "--json",
  ];
  if (body.sessionId) args.push("--session-id", body.sessionId);
  return args;
}

function openClawChatResponse(args: {
  req: Request;
  body: SendBody;
  promptText: string;
  harnessPrompt: string;
  attachments: ChatAttachment[];
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
      pushProgress("openclaw-resolve", "Resolving OpenClaw agent", "running");
      const agentId = await resolveOpenClawAgentId(args.body.familiarId);
      pushProgress("openclaw-resolve", "OpenClaw agent resolved", "done", agentId);
      const argv = openClawAgentArgs(args.body, args.harnessPrompt, agentId);
      const cwd = await resolveCwd(args.body.projectRoot);
      pushProgress("openclaw-start", "Starting OpenClaw bridge", "running", cwd);
      const child = spawn("openclaw", argv, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: covenSpawnEnv(),
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
        });
        args.req.signal.removeEventListener("abort", onAbort);
        close();
      });
      child.on("close", async (code) => {
        args.req.signal.removeEventListener("abort", onAbort);
        const durationMs = Date.now() - startedAt;
        let sessionId: string | null = args.body.sessionId ?? null;
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
            sessionId = extractOpenClawSessionId(parsed, args.body.sessionId);
            assistantText = extractOpenClawText(parsed);
            isError = isError || parsed.status === "error";
          } catch {
            if (!cancelledByUser) assistantText = stdout.trim();
          }
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
            title: chatTitle,
            createdAt: now,
            updatedAt: now,
            turns: [],
          };
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
        body.mentionedFilesRoot ?? body.projectRoot,
      )
    : [];

  const taskContext = await taskContextForSession(body.sessionId);
  const harnessPrompt = buildPromptWithCovenIdentityCanon(
    buildTaskAwarePrompt(
      appendMentionedFilesBlock(
        buildPromptWithAttachments(promptText, attachments, {
          imagesSupported,
          imageFilePaths,
        }),
        mentionedFiles,
      ),
      taskContext,
    ),
    body.familiarId,
  );

  if (binding.harness === "openclaw" && !sshRuntime) {
    return openClawChatResponse({
      req,
      body,
      promptText,
      harnessPrompt,
      attachments: persistedAttachments,
    });
  }

  const cwd = sshRuntime ? homedir() : await resolveCwd(body.projectRoot);
  // Resolve familiar workspace for identity context. When a project root is
  // explicitly set, the harness boots there (and should have the familiar's
  // AGENTS.md injected separately). When there's no project root, boot in the
  // familiar's own workspace so the selected harness picks up AGENTS.md /
  // SOUL.md / IDENTITY.md and responds as the familiar instead of as the
  // generic CLI identity. SSH runtimes own their remote cwd, so never stat the
  // local filesystem for a remote familiar.
  const familiarWorkspace = !sshRuntime && !body.projectRoot
    ? await resolveFamiliarWorkspace(body.familiarId)
    : undefined;

  // Build coven run argv.
  // Important: pass every flag BEFORE the prompt and add a `--` separator,
  // because `<PROMPT>...` is a variadic positional in coven's clap definition
  // and otherwise swallows trailing flags like `--stream-json` as raw text.
  const buildArgs = (resumeSessionId: string | null): string[] => {
    if (sshRuntime) {
      return buildSshSpawnArgs({
        runtime: sshRuntime,
        harness: binding.harness,
        familiarId: body.familiarId,
        prompt: harnessPrompt,
        sessionId: resumeSessionId,
      });
    }
    const a = ["run", binding.harness, "--stream-json"];
    if (resumeSessionId) a.push("--continue", resumeSessionId);
    // Inject identity preamble. coven-cli renders this through the best
    // available identity channel for the chosen harness. Without this, the
    // harness answers as its generic CLI identity instead of as the familiar.
    if (/^[a-z0-9_-]+$/i.test(body.familiarId)) {
      a.push("--familiar", body.familiarId);
    }
    a.push("--", harnessPrompt);
    return a;
  };
  const args = buildArgs(body.sessionId ?? null);

  // Resume failures from common harnesses. Codex emits
  // "thread/resume failed: no rollout found ... (code -32600)" when the
  // rollout DB no longer has the thread. Claude Code emits
  // "Session ID <uuid> is already in use" when --resume hits a session
  // that is locked by another live process. Coven itself emits
  // "session <uuid> not found in local store" when the requested --continue
  // id exists only in Cave's local transcript store. In these cases we retry
  // once without the resume flag so the chat starts fresh instead of erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600|Session ID \S+ is already in use|session\s+\S+\s+not found in local store/i;

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
      let result: { duration_ms?: number; is_error?: boolean } = {};
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
              duration_ms?: number;
              is_error?: boolean;
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
            if (ev.session_id && !sessionId) {
              sessionId = ev.session_id;
              push({ kind: "session", sessionId });
              // Title the session from the user's prompt as soon as the id
              // exists. The daemon's own title derives from the harness
              // prompt — i.e. the identity-canon preamble — and is what the
              // UI would otherwise show until the transcript save runs.
              void setDefaultSessionTitleIfMissing(
                sessionId,
                chatTitleFromPrompt(promptText) ?? defaultChatTitleForSession(sessionId),
              ).catch(() => undefined);
            }
            if (ev.type === "result") {
              result = { duration_ms: ev.duration_ms, is_error: ev.is_error };
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
            : toolTracker.hookStart(name, formatToolPayload(rest));
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
              : familiarWorkspace ?? cwd,
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
                cwd: familiarWorkspace ?? cwd,
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

      const finalSessionId = sessionId;
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
        const assistantTurn: ChatTurn = {
          id: assistantTurnId,
          role: "assistant",
          text: assistantText.trim(),
          createdAt: new Date().toISOString(),
          durationMs: result.duration_ms,
          isError: result.is_error,
          ...(cancelledByUser ? { cancelled: true } : {}),
        };
        const conv = existing ?? {
          sessionId: finalSessionId,
          familiarId: body.familiarId,
          harness: binding.harness,
          title: chatTitle,
          createdAt: now,
          updatedAt: now,
          turns: [],
        };
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
