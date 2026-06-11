import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
  loadConfig,
  loadState,
  recordSessionFamiliar,
  setSessionTitle,
} from "@/lib/cave-config";
import { defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendBody = {
  familiarId: string;
  prompt?: string;
  sessionId?: string;
  projectRoot?: string;
  attachments?: ChatAttachment[];
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

        if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as OpenClawAgentJson;
            sessionId = extractOpenClawSessionId(parsed, args.body.sessionId);
            assistantText = extractOpenClawText(parsed);
            isError = isError || parsed.status === "error";
          } catch {
            assistantText = stdout.trim();
          }
        }

        if (!assistantText.trim()) {
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
  const taskContext = await taskContextForSession(body.sessionId);
  const harnessPrompt = buildPromptWithCovenIdentityCanon(
    buildTaskAwarePrompt(
      buildPromptWithAttachments(promptText, attachments),
      taskContext,
    ),
    body.familiarId,
  );

  const config = await loadConfig();
  const binding = bindingFor(config, body.familiarId);
  const cwd = await resolveCwd(body.projectRoot);
  // Resolve familiar workspace for identity context. When a project root is
  // explicitly set, the harness boots there (and should have the familiar's
  // AGENTS.md injected separately). When there's no project root, boot in the
  // familiar's own workspace so the selected harness picks up AGENTS.md /
  // SOUL.md / IDENTITY.md and responds as the familiar instead of as the
  // generic CLI identity.
  const familiarWorkspace = !body.projectRoot
    ? await resolveFamiliarWorkspace(body.familiarId)
    : undefined;

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
  if (binding.harness === "openclaw") {
    return openClawChatResponse({
      req,
      body,
      promptText,
      harnessPrompt,
      attachments,
    });
  }

  // Build coven run argv.
  // Important: pass every flag BEFORE the prompt and add a `--` separator,
  // because `<PROMPT>...` is a variadic positional in coven's clap definition
  // and otherwise swallows trailing flags like `--stream-json` as raw text.
  const buildArgs = (resumeSessionId: string | null): string[] => {
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
  // that is locked by another live process. In both cases we retry once
  // without the resume flag so the chat starts fresh instead of erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600|Session ID \S+ is already in use/i;

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
      // Per-tool start times so post_tool_use can compute durationMs and
      // associate output with the matching pre_tool_use event.
      let toolStartTimes = new Map<string, { startedAt: number; id: string }>();
      let toolSeq = 0;
      const toolIdFor = (name: string): string => {
        const existing = toolStartTimes.get(name);
        if (existing) return existing.id;
        toolSeq += 1;
        const id = `tool-${toolSeq}-${name}`;
        toolStartTimes.set(name, { startedAt: Date.now(), id });
        return id;
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
                content?: Array<{ type?: string; text?: string }>;
              };
            };
            if (ev.session_id && !sessionId) {
              sessionId = ev.session_id;
              push({ kind: "session", sessionId });
            }
            if (ev.type === "result") {
              result = { duration_ms: ev.duration_ms, is_error: ev.is_error };
            } else if (ev.type === "assistant" && ev.message?.content) {
              // Claude stream-json wraps assistant text inside a message envelope.
              // Extract every text chunk and surface it as an assistant_chunk so
              // the chat bubble renders.
              for (const block of ev.message.content) {
                if (block.type === "text" && block.text) {
                  assistantText += block.text;
                  push({ kind: "assistant_chunk", text: block.text });
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
          const id = toolIdFor(name);
          // Try to pretty-print JSON payloads; fall back to raw string.
          const fmtPayload = (raw: string): string | undefined => {
            if (!raw) return undefined;
            try {
              return JSON.stringify(JSON.parse(raw), null, 2);
            } catch {
              return raw;
            }
          };
          if (isPost) {
            const meta = toolStartTimes.get(name);
            const durationMs = meta ? Date.now() - meta.startedAt : undefined;
            const isError = /error|fail|denied|exit\s*[1-9]/i.test(rest);
            push({
              kind: "tool_use",
              id,
              name,
              output: fmtPayload(rest),
              status: isError ? "error" : "ok",
              durationMs,
            });
            toolStartTimes.delete(name);
          } else {
            push({
              kind: "tool_use",
              id,
              name,
              input: fmtPayload(rest),
              status: "running",
            });
          }
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
          pushProgress("harness-start", `Starting ${binding.harness}`, "running", familiarWorkspace ?? cwd);
          const child = spawn(covenBin(), spawnArgs, {
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
                  "coven CLI not found on PATH. Open Setup to install it, then try again.",
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
        toolStartTimes = new Map();
        toolSeq = 0;
        resumeFailed = false;
        await runAttempt(buildArgs(null));
        pushProgress("resume-retry", "Fresh chat started", "done");
      }

      // Empty-response diagnostic: when the harness reports done but never
      // produced assistant text, the user otherwise sees a silent empty
      // bubble. Synthesize a short explanation so they know what to do.
      if (!assistantText.trim()) {
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
          ...(attachments.length ? { attachments } : {}),
          createdAt: now,
        };
        const assistantTurn: ChatTurn = {
          id: assistantTurnId,
          role: "assistant",
          text: assistantText.trim(),
          createdAt: new Date().toISOString(),
          durationMs: result.duration_ms,
          isError: result.is_error,
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
