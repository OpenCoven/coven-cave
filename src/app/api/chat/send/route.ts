import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { stripAnsi } from "@/lib/ansi";
import {
  bindingFor,
  loadConfig,
  recordSessionFamiliar,
} from "@/lib/cave-config";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { AssistantFilter } from "@/lib/chat-assistant-filter";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import { familiarWorkspace } from "@/lib/coven-paths";
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

function sse(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
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
  const harnessPrompt = buildTaskAwarePrompt(
    buildPromptWithAttachments(promptText, attachments),
    taskContext,
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

  // Native Cave chat only drives bundled, reviewed Coven harnesses through
  // `coven run <harness> --stream-json`. OpenClaw and external adapter
  // manifests use their own bridges instead of this privileged local runner.
  if (!isTrustedChatHarness(binding.harness)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "This familiar's harness is not supported by native Cave chat. Pick Codex, Claude Code, or Hermes here, or open the familiar from its own runtime.",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
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
        sessionId = null;
        assistantFilter = new AssistantFilter();
        assistantText = "";
        jsonBuf = "";
        result = {};
        toolStartTimes = new Map();
        toolSeq = 0;
        resumeFailed = false;
        await runAttempt(buildArgs(null));
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
        assistantText = diagnostic;
        result.is_error = true;
        push({ kind: "assistant_chunk", text: diagnostic });
      }

      const finalSessionId = sessionId;
      if (finalSessionId) {
        await recordSessionFamiliar(finalSessionId, body.familiarId);
        const existing = await loadConversation(finalSessionId);
        const now = new Date().toISOString();
        const userTurnId = crypto.randomUUID();
        const assistantTurnId = crypto.randomUUID();
        const chatTitle = (
          promptText ||
          attachments[0]?.name ||
          "Attached files"
        ).slice(0, 60);
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
