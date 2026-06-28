/**
 * src/app/api/library/research/route.ts
 *
 * POST handler for the Library's `/research` flow. Takes a free-text topic,
 * runs a deep-research prompt through the active familiar's agent, and writes
 * the synthesized brief into that familiar's `research/research/` collection so
 * it appears in the Library alongside hand-written docs.
 *
 * Response format: SSE stream
 *   data: {"kind":"status","text":"Researching…"}
 *   data: {"kind":"doc","id":"research/research/2026-…md","collection":"research","title":"…","familiar":"sage"}
 *   data: {"kind":"done","durationMs":1234}
 *   data: {"kind":"error","error":"…"}
 *
 * Security: topic is normalized + length-bounded; the output path is derived
 * from a slug (no user-controlled path segments) under the familiar's research
 * root; all CLI args passed via array (no shell interpolation).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { stripAnsi } from "@/lib/ansi";
import { writeFileAtomic } from "@/lib/server/atomic-write.ts";
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
import {
  readFamiliarLibraryWorkspaces,
  researchRootFor,
  type FamiliarLibraryWorkspace,
} from "@/lib/familiar-library-workspaces";
import {
  buildResearchPrompt,
  buildResearchDoc,
  researchDocFilename,
  normalizeTopic,
  RESEARCH_COLLECTION_DIR,
} from "@/lib/research-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SseEvent =
  | { kind: "status"; text: string }
  | { kind: "doc"; id: string; collection: string; title: string; familiar: string }
  | { kind: "done"; durationMs: number }
  | { kind: "error"; error: string };

const encoder = new TextEncoder();

function sse(event: SseEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
}

function errorStream(error: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sse({ kind: "error", error }));
      controller.enqueue(sse({ kind: "done", durationMs: 0 }));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: sseHeaders() });
}

function resolveFamiliar(familiarId: string | undefined): FamiliarLibraryWorkspace | null {
  const workspaces = readFamiliarLibraryWorkspaces();
  if (workspaces.length === 0) return null;
  const wanted = familiarId?.trim();
  if (wanted) {
    const match = workspaces.find((w) => w.id === wanted);
    if (match) return match;
  }
  return workspaces[0];
}

/** Strip a leading YAML frontmatter block and/or duplicate H1 the agent may emit. */
function sanitizeAgentBody(raw: string): string {
  let body = raw.trim();
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  body = body.replace(/^#\s+.+\n+/, "");
  return body.trim();
}

export async function POST(req: Request): Promise<Response> {
  let body: { topic?: unknown; familiarId?: unknown };
  try {
    body = (await req.json()) as { topic?: unknown; familiarId?: unknown };
  } catch {
    return errorStream("Invalid JSON body.");
  }

  const topic = normalizeTopic(body.topic);
  if (!topic) {
    return errorStream("A research topic of 3–500 characters is required.");
  }

  const familiarId = typeof body.familiarId === "string" ? body.familiarId : undefined;
  const familiar = resolveFamiliar(familiarId);
  if (!familiar) {
    return errorStream("No familiar workspace is configured to hold research.");
  }

  const prompt = buildResearchPrompt(topic);
  const sessionId = openClawSessionKey(crypto.randomUUID());

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
      push({ kind: "status", text: `Researching “${topic}”…` });

      let agentId: string;
      try {
        agentId = await resolveOpenClawAgentId(familiar.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({ kind: "error", error: `Failed to resolve agent: ${msg}` });
        push({ kind: "done", durationMs: Date.now() - startedAt });
        close();
        return;
      }

      const argv = openClawSpawnArgs([
        "agent",
        "--agent",
        agentId,
        "--message",
        prompt,
        "--json",
        "--no-persist",
        "--session-id",
        sessionId,
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
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      child.stderr?.on("data", (d: Buffer) => { stderr += stripAnsi(d.toString("utf8")); });

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

      child.on("close", async (code) => {
        req.signal.removeEventListener("abort", onAbort);
        const durationMs = Date.now() - startedAt;

        if (req.signal.aborted) {
          push({ kind: "done", durationMs });
          close();
          return;
        }

        let assistantText = "";
        try {
          const trimmed = stdout.trim();
          if (trimmed) {
            const parsed: OpenClawAgentJson = JSON.parse(trimmed);
            assistantText = extractOpenClawText(parsed);
          }
        } catch {
          /* non-JSON output */
        }

        if (code !== 0 && !assistantText) {
          push({ kind: "error", error: stderr.trim() || `OpenClaw exited with code ${code ?? "unknown"}.` });
          push({ kind: "done", durationMs });
          close();
          return;
        }
        if (!assistantText.trim()) {
          push({ kind: "error", error: "The research run produced no output." });
          push({ kind: "done", durationMs });
          close();
          return;
        }

        // Persist the brief into the familiar's research/research collection.
        try {
          const dateIso = new Date().toISOString();
          const docMarkdown = buildResearchDoc({
            topic,
            body: sanitizeAgentBody(assistantText),
            familiar: familiar.id,
            dateIso,
          });
          const collectionDir = path.join(researchRootFor(familiar), RESEARCH_COLLECTION_DIR);
          await fs.mkdir(collectionDir, { recursive: true });
          const filename = researchDocFilename(topic, dateIso);
          const absPath = path.join(collectionDir, filename);
          await writeFileAtomic(absPath, docMarkdown);
          const id = path.relative(path.resolve(familiar.root), absPath);
          push({ kind: "doc", id, collection: RESEARCH_COLLECTION_DIR, title: topic, familiar: familiar.id });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          push({ kind: "error", error: `Research finished but saving failed: ${msg}` });
        }

        push({ kind: "done", durationMs });
        close();
      });
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}
