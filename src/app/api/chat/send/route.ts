import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { stripAnsi } from "@/lib/ansi";
import { bindingFor, loadConfig, recordSessionFamiliar } from "@/lib/cave-config";
import { covenBin, covenSpawnEnv } from "@/lib/coven-bin";
import {
  type ChatTurn,
  loadConversation,
  saveConversation,
} from "@/lib/cave-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendBody = {
  familiarId: string;
  prompt: string;
  sessionId?: string;
  projectRoot?: string;
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

const HOOK_LINE_RE = /^hook:\s+/;
// Hook-line shapes emitted by codex/claude harnesses while a tool runs.
// Examples:
//   hook: tool_use Bash {...}
//   hook: pre_tool_use Edit { ... }
//   hook: post_tool_use Bash {... exitCode: 0 ...}
const TOOL_HOOK_RE = /^hook:\s+(?:pre_tool_use|post_tool_use|tool_use)\s+(\S+)(?:\s+(.*))?$/;
const BANNER_LINE_RE = /^(?:--------|workdir:|model:|provider:|approval:|sandbox:|reasoning|session id:|tokens used|\d[\d,]*\s*$)/;
const CODEX_START_LINE = "codex";
const CLAUDE_ASSISTANT_RE = /^claude(?:\s+code)?$/i;

/**
 * Filter raw harness stdout (after JSON event lines have been stripped) into
 * what looks like assistant-authored text. Codex prints a banner + hook lines
 * + a `codex` marker before its reply + `tokens used` after. We keep only the
 * content between the start marker and the next hook/end-of-stream.
 */
class AssistantFilter {
  private phase: "pre" | "assistant" | "post" = "pre";
  private buf = "";

  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      out += this.processLine(line);
    }
    return out;
  }

  flush(): string {
    if (!this.buf) return "";
    const remainder = this.processLine(this.buf);
    this.buf = "";
    return remainder;
  }

  private processLine(rawLine: string): string {
    const line = rawLine.replace(/\r/g, "");
    const trimmed = line.trim();

    if (trimmed === CODEX_START_LINE || CLAUDE_ASSISTANT_RE.test(trimmed)) {
      this.phase = "assistant";
      return "";
    }
    if (HOOK_LINE_RE.test(trimmed)) {
      if (this.phase === "assistant" && /stop/i.test(trimmed)) {
        this.phase = "post";
      }
      return "";
    }
    if (trimmed === "user") {
      // Codex echoes the user prompt block; skip the leading marker
      return "";
    }
    if (BANNER_LINE_RE.test(trimmed)) {
      return "";
    }
    if (this.phase !== "assistant") return "";
    return line + "\n";
  }
}

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function resolveCwd(requested?: string): Promise<string> {
  if (requested) {
    try {
      const s = await stat(requested);
      if (s.isDirectory()) return requested;
    } catch {
      /* fall through to homedir */
    }
  }
  return homedir();
}

function sse(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!body.familiarId || !body.prompt?.trim()) {
    return new Response(
      JSON.stringify({ ok: false, error: "familiarId and prompt are required" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const config = await loadConfig();
  const binding = bindingFor(config, body.familiarId);
  const cwd = await resolveCwd(body.projectRoot);

  // coven run only knows codex|claude today. Other harnesses (openclaw,
  // copilot, opencode, gemini, hermes, …) are surfaced in /api/harnesses
  // and the rail configurator but can't be driven from native chat yet —
  // open them via Coven Code TUI through /api/launch.
  const COVEN_RUN_HARNESSES = new Set(["codex", "claude"]);
  if (!COVEN_RUN_HARNESSES.has(binding.harness)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Native chat isn't wired for the "${binding.harness}" harness yet — open this familiar in the Coven Code TUI instead.`,
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
    a.push("--", body.prompt);
    return a;
  };
  const args = buildArgs(body.sessionId ?? null);

  // Codex returns this when --continue points at a thread whose rollout
  // can no longer be found (common after auth switches, CODEX_HOME moves,
  // or rollout DB cleanup). On match we transparently retry once without
  // --continue so the chat starts a fresh thread instead of erroring.
  const RESUME_ERR_RE =
    /thread\/resume failed|no rollout found|code\s*-32600/i;

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

      push({ kind: "user", text: body.prompt });

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
      const ERR_LINE_RE = /\b(error|failed|denied|unauthori[sz]ed|invalid|refused|missing|not found|401|403|500)\b/i;

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
          if (isPost) {
            const meta = toolStartTimes.get(name);
            const durationMs = meta ? Date.now() - meta.startedAt : undefined;
            const isError = /error|fail|denied|exit\s*[1-9]/i.test(rest);
            push({
              kind: "tool_use",
              id,
              name,
              output: rest || undefined,
              status: isError ? "error" : "ok",
              durationMs,
            });
            toolStartTimes.delete(name);
          } else {
            push({
              kind: "tool_use",
              id,
              name,
              input: rest || undefined,
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
            cwd,
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
        const userTurn: ChatTurn = {
          id: crypto.randomUUID(),
          role: "user",
          text: body.prompt,
          createdAt: now,
        };
        const assistantTurn: ChatTurn = {
          id: crypto.randomUUID(),
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
          title: body.prompt.slice(0, 60),
          createdAt: now,
          updatedAt: now,
          turns: [],
        };
        conv.turns.push(userTurn, assistantTurn);
        await saveConversation(conv);
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
