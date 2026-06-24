/**
 * src/app/api/library/chat/route.ts
 *
 * POST handler for "chat with a research paper" in the CovenCave library.
 *
 * Receives a document path + conversation history + user message, loads the
 * document, builds a context-aware system prompt, and streams the response via
 * the OpenClaw CLI (same spawn pattern as /api/chat/send).
 *
 * Security:
 *   - docPath must resolve within ~/.openclaw/workspace/sage/research/ (realpath)
 *   - No shell interpolation: all args via array
 *   - Max document size: 200KB (truncated at paragraph boundary with note)
 *   - Max conversation history: 12 messages (6 turns)
 *
 * Response format: SSE stream, each line:
 *   data: {"kind":"chunk","text":"..."}
 *   data: {"kind":"done","durationMs":1234}
 *   data: {"kind":"error","error":"..."}
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { stripAnsi } from "@/lib/ansi";
import {
  openClawBin,
  openClawNeedsShell,
  openClawSpawnArgs,
  openClawSpawnEnv,
} from "@/lib/openclaw-bin";
import {
  extractOpenClawText,
  openClawSessionKey,
  resolveOpenClawAgentId,
  type OpenClawAgentJson,
} from "@/lib/openclaw-bridge";
import { readLibraryChatDocument } from "./chat-doc-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DOC_BYTES = 200 * 1024; // 200KB — mirrors resolveLibraryChatDocPath
const MAX_HISTORY_MESSAGES = 12; // 6 turns

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type LibraryChatBody = {
  docPath: string;
  messages: ChatMessage[];
  familiarId?: string;
  sessionId?: string;
};

type SseEvent =
  | { kind: "chunk"; text: string }
  | { kind: "done"; durationMs: number }
  | { kind: "error"; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function sse(event: SseEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** SSE stream with a single error event followed by done — used for early exits. */
function errorStream(error: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sse({ kind: "error", error }));
      controller.enqueue(sse({ kind: "done", durationMs: 0 }));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200, // SSE clients expect 200; error detail is in the event
    headers: sseHeaders(),
  });
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
}

/**
 * Extract a document title from the first `# Heading` in the body, or fall
 * back to the filename stem.
 */
function extractTitle(body: string, filePath: string): string {
  const match = body.match(/^#\s+(.+)/m);
  if (match) return match[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Truncate document content to MAX_DOC_BYTES at a sensible paragraph boundary.
 * Returns the (possibly truncated) content and a flag indicating truncation.
 */
function truncateAtParagraph(content: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) {
    return { text: content, truncated: false };
  }

  // Slice to the byte limit first, then step back to the last double-newline
  // (paragraph boundary) to avoid cutting mid-sentence.
  const slice = Buffer.from(content, "utf8").slice(0, maxBytes).toString("utf8");
  const lastParagraph = slice.lastIndexOf("\n\n");
  const truncated = lastParagraph > 0 ? slice.slice(0, lastParagraph) : slice;
  return { text: truncated, truncated: true };
}

/**
 * Build the system prompt injected as the first "user" context turn.
 *
 * OpenClaw's `agent --message` API does not expose a separate system prompt
 * slot, so we prepend the context as a structured block at the top of the
 * assembled message, then append the actual user question below.
 */
function buildSystemContext(
  title: string,
  docContent: string,
  truncated: boolean,
): string {
  const truncationNote = truncated
    ? "\n\n[Note: The document was truncated to fit the context window. The above represents the first ~200KB of the original.]\n"
    : "";

  return `You are Sage, a research familiar. You are answering questions about a specific document from your research library.

## Document: ${title}

${docContent}${truncationNote}

---

**Instructions for this conversation:**
- You are grounded in the document above. When answering, cite specific sections or quote relevant passages.
- If a question is not answered by this document, say so explicitly rather than guessing.
- Distinguish clearly between what the document claims and your own synthesis or interpretation.
- Be concise but precise. Prefer direct answers over lengthy preamble.
- If asked for a summary, cover the document's main thesis, key arguments, and conclusions.`;
}

/**
 * Assemble the full message to send to OpenClaw:
 * system context + conversation history + current user question.
 */
function buildFullPrompt(
  systemContext: string,
  history: ChatMessage[],
  userMessage: string,
): string {
  const parts: string[] = [systemContext];

  if (history.length > 0) {
    parts.push("\n---\n## Prior conversation\n");
    for (const msg of history) {
      const label = msg.role === "user" ? "User" : "Sage";
      parts.push(`**${label}:** ${msg.text.trim()}`);
    }
  }

  parts.push(`\n---\n\n${userMessage.trim()}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // 1. Parse request body
  let body: LibraryChatBody;
  try {
    body = (await req.json()) as LibraryChatBody;
  } catch {
    return errorStream("Invalid JSON body.");
  }

  const familiarId = body.familiarId?.trim() || "sage";
  const sessionId = body.sessionId?.trim() || crypto.randomUUID();
  const rawMessages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

  // The last message in the array is the current user question.
  // History is everything before it (capped at MAX_HISTORY_MESSAGES).
  if (rawMessages.length === 0) {
    return errorStream("No messages provided.");
  }

  const currentMessage = rawMessages[rawMessages.length - 1];
  if (!currentMessage || currentMessage.role !== "user" || !currentMessage.text?.trim()) {
    return errorStream("Last message must be a non-empty user message.");
  }

  const historyMessages = rawMessages
    .slice(0, -1)
    .slice(-MAX_HISTORY_MESSAGES);

  // 2. Validate docPath
  if (!body.docPath) {
    return errorStream("docPath is required.");
  }

  const documentRead = readLibraryChatDocument(body.docPath);

  if (!documentRead.ok) {
    switch (documentRead.reason) {
      case "forbidden":
        return new Response(
          JSON.stringify({ ok: false, error: "Document path is not allowed." }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      case "not_found":
        return new Response(
          JSON.stringify({ ok: false, error: "Document not found." }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      case "not_file":
        return new Response(
          JSON.stringify({ ok: false, error: "Path does not point to a file." }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      case "too_large":
        // too_large from readLibraryChatDocument means the file exceeds our
        // 200KB limit even before truncation. We handle truncation ourselves
        // in this route, so this branch is a belt-and-suspenders guard — the
        // resolver uses the same MAX_DOC_BYTES constant. Surface as an error.
        return errorStream(
          `Document is too large (max ${MAX_DOC_BYTES / 1024}KB). Contact Sage to pre-process it.`,
        );
    }
  }

  const resolvedDocPath = documentRead.path;
  const rawContent = documentRead.content;

  // 4. Truncate if needed
  const { text: docContent, truncated } = truncateAtParagraph(rawContent, MAX_DOC_BYTES);

  // 5. Build context
  const title = extractTitle(docContent, resolvedDocPath);
  const systemContext = buildSystemContext(title, docContent, truncated);
  const fullPrompt = buildFullPrompt(
    systemContext,
    historyMessages,
    currentMessage.text,
  );

  // 6. Stream via OpenClaw
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const push = (event: SseEvent) => controller.enqueue(sse(event));
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const startedAt = Date.now();

      // Resolve the OpenClaw agent id for the familiar (may do an `agents list` probe).
      let agentId: string;
      try {
        agentId = await resolveOpenClawAgentId(familiarId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({ kind: "error", error: `Failed to resolve agent: ${msg}` });
        push({ kind: "done", durationMs: Date.now() - startedAt });
        close();
        return;
      }

      // Build argv. We use --no-persist so this ephemeral library chat does
      // not pollute the agent's main session history.
      const argv = openClawSpawnArgs([
        "agent",
        "--agent",
        agentId,
        "--message",
        fullPrompt,
        "--json",
        "--no-persist",
        "--session-key",
        openClawSessionKey(sessionId),
      ]);

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(openClawBin(), argv, {
          stdio: ["ignore", "pipe", "pipe"],
          env: openClawSpawnEnv(),
          shell: openClawNeedsShell(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({ kind: "error", error: `Failed to spawn OpenClaw: ${msg}` });
        push({ kind: "done", durationMs: Date.now() - startedAt });
        close();
        return;
      }

      // Abort handler — propagate client disconnect as SIGTERM.
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += stripAnsi(data.toString("utf8"));
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        req.signal.removeEventListener("abort", onAbort);
        const message =
          err.code === "ENOENT"
            ? "openclaw CLI not found on PATH. Open Setup to install it, then try again."
            : (err.message ?? String(err));
        push({ kind: "error", error: message });
        push({ kind: "done", durationMs: Date.now() - startedAt });
        close();
      });

      child.on("close", (code) => {
        req.signal.removeEventListener("abort", onAbort);
        const durationMs = Date.now() - startedAt;

        if (req.signal.aborted) {
          // Client cancelled — emit a clean done without error.
          push({ kind: "done", durationMs });
          close();
          return;
        }

        // Parse JSON output from OpenClaw.
        let assistantText = "";
        try {
          const trimmed = stdout.trim();
          if (trimmed) {
            const parsed: OpenClawAgentJson = JSON.parse(trimmed);
            assistantText = extractOpenClawText(parsed);
          }
        } catch {
          // Non-JSON or empty — may happen on error exits.
        }

        if (code !== 0 && !assistantText) {
          // Propagate meaningful stderr if available.
          const errDetail = stderr.trim() || `OpenClaw exited with code ${code ?? "unknown"}.`;
          push({ kind: "error", error: errDetail });
        } else if (assistantText) {
          push({ kind: "chunk", text: assistantText });
        }

        push({ kind: "done", durationMs });
        close();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders(),
  });
}
