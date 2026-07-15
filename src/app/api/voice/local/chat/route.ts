import { NextResponse } from "next/server.js";
import { buildLocalBrainMessages, DEFAULT_LOCAL_MODEL, localLlmBaseUrl, MAX_BRAIN_CONTENT_CHARS } from "../../../../../lib/voice/local-loop.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loopback brain proxy for the local voice provider. The WebView never talks
// to Ollama / LM Studio directly — proxying keeps CORS moot and the base-url
// config (COVEN_LOCAL_LLM_URL) server-owned. Nothing here leaves the machine.

type BrainTurn = { role?: string; content?: string };

const MAX_MESSAGES = 64;
// One shared per-message cap with buildLocalBrainMessages (the in-app client
// truncates to it before posting), so the client can never assemble a payload
// this proxy rejects; direct callers exceeding it still get a hard 400.
const MAX_CONTENT_CHARS = MAX_BRAIN_CONTENT_CHARS;

export async function POST(req: Request) {
  let body: { model?: string; messages?: BrainTurn[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_messages" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ ok: false, error: "too_many_messages" }, { status: 400 });
  }
  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? String(messages[0].content ?? "") : "";
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages.slice(hasSystem ? 1 : 0)) {
    if (m.role !== "user" && m.role !== "assistant") {
      return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
    }
    const content = typeof m.content === "string" ? m.content : "";
    if (!content || content.length > MAX_CONTENT_CHARS) {
      return NextResponse.json({ ok: false, error: "invalid_content" }, { status: 400 });
    }
    turns.push({ role: m.role, content });
  }

  const base = localLlmBaseUrl(process.env.COVEN_LOCAL_LLM_URL);
  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : DEFAULT_LOCAL_MODEL;

  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: buildLocalBrainMessages(system, turns),
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "local_llm_unreachable",
      hint: `No OpenAI-compatible server on ${base} (${e instanceof Error ? e.message : "fetch failed"}). Start Ollama (\`ollama serve\`) or LM Studio, or set COVEN_LOCAL_LLM_URL.`,
    }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string } | string;
  } | null;
  if (!res.ok) {
    const detail = typeof json?.error === "string" ? json.error : json?.error?.message;
    return NextResponse.json({
      ok: false,
      error: "local_llm_error",
      hint: detail ?? `local model server returned http ${res.status}`,
    }, { status: 502 });
  }

  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return NextResponse.json({
      ok: false,
      error: "local_llm_empty",
      hint: `The local model (${model}) returned no text — is it pulled? Try \`ollama pull ${model}\`.`,
    }, { status: 502 });
  }

  return NextResponse.json({ ok: true, text });
}
