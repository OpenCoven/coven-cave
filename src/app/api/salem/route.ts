import { NextResponse } from "next/server";
import { SALEM_PRELOAD_CONTEXT, summarizePreload } from "@/components/salem/salem-context";
import { COVEN_IDENTITY_CANON } from "@/lib/coven-identity-canon";
import { stripMdxLeakage } from "./strip-mdx";

/**
 * Salem docs API — v1: live retrieval from llms-full.txt
 *
 * On first request the full docs corpus is fetched and split into chunks by
 * `Source:` headers. Subsequent requests are served from the module-level
 * cache (no TTL — process restart refreshes). Top-K chunks are matched by
 * token overlap and injected as context for Salem's reply.
 */

const DOCS_URL = "https://docs.opencoven.ai/llms-full.txt";
const DOCS_BASE = "https://docs.opencoven.ai";
const TOP_K = 5;
const MAX_CHUNK_CHARS = 1200;

// Hosted docs retrieval: the opencoven-chat-api owns the vector index and
// reranking. Cave uses it for context, then synthesizes locally through the
// selected familiar/model so user-connected providers own billing.
const CHAT_API_URL = (
  process.env.SALEM_CHAT_API_URL ?? "https://salem.opencoven.ai"
).replace(/\/+$/, "");
const CHAT_API_CONNECT_TIMEOUT_MS = 20_000;
const CHAT_API_TIMEOUT_MS = 45_000;

type SalemSearchContextItem = {
  type?: unknown;
  title?: unknown;
  detail?: unknown;
};

type SalemSearchContext = {
  source?: unknown;
  query?: unknown;
  matches?: unknown;
};

type ChatApiContextResponse = {
  mode?: unknown;
  systemPrompt?: unknown;
  context?: unknown;
  results?: unknown;
};

/**
 * Ask the upstream opencoven-chat-api for retrieved docs context only. Cave
 * owns the synthesis call so arbitrary connected user models stay local.
 */
async function askChatApiContext(message: string): Promise<ChatApiContextResponse | null> {
  try {
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), CHAT_API_CONNECT_TIMEOUT_MS);

    const res = await fetch(`${CHAT_API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode: "context" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(connectTimer));

    if (!res.ok) return null;
    const json = (await res.json()) as ChatApiContextResponse;
    return typeof json.systemPrompt === "string" ? json : null;
  } catch {
    return null;
  }
}

/**
 * No-regression fallback: ask the hosted chat-api for a fully-written answer
 * (its legacy streamed text/plain behavior). Used when `mode: "context"` is not
 * yet supported by the backend, so Salem keeps giving grounded hosted answers
 * instead of dropping to weak local token-overlap retrieval. Once the backend
 * serves context mode, the local-familiar synthesis path above takes over.
 */
async function askChatApiAnswer(message: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), CHAT_API_CONNECT_TIMEOUT_MS);

    const res = await fetch(`${CHAT_API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    }).finally(() => clearTimeout(connectTimer));

    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    const streamTimer = setTimeout(() => controller.abort(), CHAT_API_TIMEOUT_MS);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally {
      clearTimeout(streamTimer);
      reader.releaseLock();
    }

    const trimmed = parts.join("").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function buildLocalSalemPrompt(message: string, context: ChatApiContextResponse): string {
  const systemPrompt = typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  const docsContext = typeof context.context === "string" && context.context.trim()
    ? `\n\nRetrieved documentation context:\n${context.context.trim()}`
    : "";

  return [
    systemPrompt,
    docsContext,
    "",
    "Answer the user's question as Salem. Use the retrieved documentation when it is relevant, cite sources as markdown links, and say when the docs do not contain the answer.",
    "",
    `User question:\n${message}`,
  ].filter(Boolean).join("\n");
}

async function askLocalFamiliar(args: {
  req: Request;
  familiarId: string;
  message: string;
  model: string | null;
}): Promise<string | null> {
  try {
    const controller = new AbortController();
    const streamTimer = setTimeout(() => controller.abort(), CHAT_API_TIMEOUT_MS);
    const res = await fetch(new URL("/api/chat/send", args.req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familiarId: args.familiarId,
        prompt: args.message,
        ...(args.model ? { modelOverride: args.model, modelOverrideScope: "next-message" } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      clearTimeout(streamTimer);
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:"));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(5).trim()) as { kind?: string; text?: string };
            if (event.kind === "assistant_chunk" && event.text) parts.push(event.text);
          } catch {
            /* ignore malformed SSE frames */
          }
        }
      }
    } finally {
      clearTimeout(streamTimer);
      reader.releaseLock();
    }

    const trimmed = parts.join("").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function cleanContextText(value: unknown, max = 180): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function formatSearchContextForPrompt(context: SalemSearchContext | undefined): string | null {
  if (!context || typeof context !== "object") return null;
  const rawMatches = Array.isArray(context.matches) ? context.matches : [];
  const matches = rawMatches
    .slice(0, 8)
    .map((raw): string | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as SalemSearchContextItem;
      const type = cleanContextText(item.type, 40) || "result";
      const title = cleanContextText(item.title);
      const detail = cleanContextText(item.detail, 240);
      if (!title) return null;
      return `- [${type}] ${title}${detail ? ` — ${detail}` : ""}`;
    })
    .filter((line): line is string => Boolean(line));

  if (matches.length === 0) return null;
  const query = cleanContextText(context.query);
  return [
    "Use this local Cave search context when it helps answer the user. Do not invent details beyond the context.",
    query ? `Local search query: ${query}` : "",
    "Local matches:",
    ...matches,
  ].filter(Boolean).join("\n");
}

// ── Module-level cache ────────────────────────────────────────────────────────

type DocChunk = {
  source: string;
  heading: string;
  text: string;
  tokens: Set<string>;
};

let docsCache: DocChunk[] | null = null;
let docsFetchedAt: number | null = null;
let docsFetchError: string | null = null;

// Re-fetch at most once per hour so a long-lived process picks up new docs.
const CACHE_TTL_MS = 60 * 60 * 1000;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function parseChunks(raw: string): DocChunk[] {
  // Split on "Source:" lines — each new Source: starts a new chunk.
  const sections = raw.split(/\nSource:\s*/);
  const chunks: DocChunk[] = [];

  for (const section of sections) {
    if (!section.trim()) continue;
    const lines = section.split("\n");
    const source = lines[0]?.trim() ?? "";
    const rest = lines.slice(1).join("\n").trim();
    if (!rest) continue;

    // Strip MDX/JSX tags before extracting heading & truncating, so the chunk
    // text we hand to retrieval and the chat panel is plain markdown.
    const cleaned = stripMdxLeakage(rest);
    if (!cleaned) continue;

    const headingMatch = cleaned.match(/^#+\s+(.+)/m);
    const heading = headingMatch?.[1] ?? source;

    const text = cleaned.slice(0, MAX_CHUNK_CHARS);
    chunks.push({ source, heading, text, tokens: tokenize(heading + " " + text) });
  }

  return chunks;
}

async function getDocsChunks(): Promise<{ chunks: DocChunk[]; error: string | null }> {
  const now = Date.now();
  if (docsCache && docsFetchedAt && now - docsFetchedAt < CACHE_TTL_MS) {
    return { chunks: docsCache, error: null };
  }

  try {
    const res = await fetch(DOCS_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    docsCache = parseChunks(raw);
    docsFetchedAt = now;
    docsFetchError = null;
    return { chunks: docsCache, error: null };
  } catch (err) {
    docsFetchError = err instanceof Error ? err.message : String(err);
    // Return stale cache if available
    if (docsCache) return { chunks: docsCache, error: docsFetchError };
    return { chunks: [], error: docsFetchError };
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

function scoreChunk(chunk: DocChunk, queryTokens: Set<string>): number {
  let score = 0;
  for (const token of queryTokens) {
    if (chunk.tokens.has(token)) score++;
  }
  return score;
}

function retrieveTopK(chunks: DocChunk[], query: string, k: number): DocChunk[] {
  const qTokens = tokenize(query);
  return chunks
    .map((c) => ({ chunk: c, score: scoreChunk(c, qTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ chunk }) => chunk);
}

// ── Reply generation ──────────────────────────────────────────────────────────
// SALEM_PERSONA and buildPrompt reserved for future LLM-proxy integration.
// For now, retrieval returns formatted chunk text directly.

// ── Fallback static replies (keep for instant no-fetch responses) ─────────────

function quickReply(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.match(/\bqueen\b|\bcourt\b|\bsovereign\b/)) {
    return [
      "Court protocol, since apparently some familiars require remedial monarchy:",
      "",
      ...COVEN_IDENTITY_CANON.map((line) => `- ${line}`),
    ].join("\n");
  }
  if (lower.match(/\bwho are you\b|\bwhat are you\b|\bsalem\b/)) {
    return `I'm **Salem** — your docs familiar. Male black cat, preloaded with the full OpenCoven docs corpus, here to save you from reading 300KB of markdown yourself. Ask me anything about familiars, plugins, roles, skills, the daemon, Cave, or how any of this works.`;
  }
  return null;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET() {
  const { chunks, error } = await getDocsChunks();
  return NextResponse.json({
    preload: SALEM_PRELOAD_CONTEXT,
    summary: summarizePreload(),
    docsStatus: {
      loaded: chunks.length > 0,
      chunkCount: chunks.length,
      fetchedAt: docsFetchedAt ? new Date(docsFetchedAt).toISOString() : null,
      error: error ?? null,
      source: DOCS_URL,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message?: string; context?: SalemSearchContext; model?: string; familiarId?: string };
    const message = (body.message ?? "").trim();
    // The model of the local familiar this ask is scoped to (credit attribution).
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
    const familiarId = typeof body.familiarId === "string" && body.familiarId.trim()
      ? body.familiarId.trim()
      : null;

    if (!message) {
      return NextResponse.json({ error: "No message provided." }, { status: 400 });
    }

    // Quick self-identity reply — no fetch needed
    const quick = quickReply(message);
    if (quick) {
      return NextResponse.json({ reply: quick, preloadSummary: summarizePreload(), source: "static" });
    }

    const context = body.context;
    const searchContext = formatSearchContextForPrompt(context);
    const messageForApi = searchContext ? `${message}\n\n${searchContext}` : message;

    // Primary Cave path: use the hosted RAG index for context, then synthesize
    // through the local familiar so the user's connected model/provider pays.
    const apiContext = await askChatApiContext(messageForApi);
    if (apiContext && familiarId) {
      const apiReply = await askLocalFamiliar({
        req,
        familiarId,
        message: buildLocalSalemPrompt(messageForApi, apiContext),
        model,
      });
      if (apiReply) {
        return NextResponse.json({
          reply: apiReply,
          preloadSummary: summarizePreload(),
          source: "local-familiar",
          localContextUsed: Boolean(searchContext),
        });
      }
    }

    if (apiContext && typeof apiContext.context === "string" && apiContext.context.trim()) {
      return NextResponse.json({
        reply: apiContext.context.trim(),
        preloadSummary: summarizePreload(),
        source: "chat-api-context",
        localContextUsed: Boolean(searchContext),
      });
    }

    // No-regression fallback: the backend doesn't serve context mode yet, so use
    // its hosted streamed answer rather than dropping to weak local retrieval.
    const hostedReply = await askChatApiAnswer(messageForApi);
    if (hostedReply) {
      return NextResponse.json({
        reply: hostedReply,
        preloadSummary: summarizePreload(),
        source: "chat-api",
        localContextUsed: Boolean(searchContext),
      });
    }

    // Fallback: fetch + local retrieve
    const { chunks, error: fetchError } = await getDocsChunks();

    if (chunks.length === 0) {
      return NextResponse.json({
        reply: `I tried to consult the scrolls but the docs fetch failed (${fetchError ?? "unknown error"}). Try the full docs at **${DOCS_BASE}** directly — I'll be back once the connection clears.`,
        preloadSummary: summarizePreload(),
        source: "error",
      });
    }

    const topChunks = retrieveTopK(chunks, message, TOP_K);

    if (topChunks.length === 0) {
      return NextResponse.json({
        reply: `I checked the scrolls but couldn't find anything matching that. Try rephrasing or check the full docs at **${DOCS_BASE}**.`,
        preloadSummary: summarizePreload(),
        source: "retrieval-miss",
      });
    }

    // Format top chunks as a grounded answer (local fallback when the
    // upstream chat-api is unreachable — see askChatApi above).
    const primary = topChunks[0];
    const extras = topChunks.slice(1, 3);

    const extraLinks = extras
      .map((c) => `- [${c.heading}](${c.source || DOCS_BASE})`)
      .join("\n");

    const reply = [
      `**${primary.heading}**\n`,
      primary.text.slice(0, 800),
      primary.text.length > 800 ? "..." : "",
      primary.source ? `\n\n→ [Full docs](${primary.source})` : "",
      extras.length > 0 ? `\n\n**Related:**\n${extraLinks}` : "",
    ]
      .filter(Boolean)
      .join("");

    return NextResponse.json({
      reply,
      preloadSummary: summarizePreload(),
      source: "retrieval",
      localContextUsed: Boolean(searchContext),
      context: topChunks.map((c) => ({ heading: c.heading, source: c.source })),
      fetchError: fetchError ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Salem had a hairball moment." }, { status: 500 });
  }
}
