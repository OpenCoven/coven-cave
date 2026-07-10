/**
 * Stitches — the Grimoire's KB intake model.
 *
 * A **pin** is one captured source fragment (a fetched URL, pasted text, a
 * local file, a chat session transcript, GitHub content, or a memory-file
 * section). A **thread** is the working trail of pins being gathered toward
 * one entry. A **stitch** is the durable Knowledge Vault entry sewn from a
 * thread — stored in the existing vault schema with a `pins:` provenance
 * block in frontmatter, so prompt injection, scope, and deep links all keep
 * working unchanged.
 *
 * This module is pure and shared by client and server: types, validation,
 * excerpting, the sew (distill) prompt, and sew-output parsing.
 */

export const PIN_KINDS = ["url", "paste", "file", "chat", "github", "memory"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export function isPinKind(value: unknown): value is PinKind {
  return typeof value === "string" && (PIN_KINDS as readonly string[]).includes(value);
}

/** Hard cap on one pin's captured content (characters). */
export const PIN_CONTENT_MAX = 120_000;
/** Cap on the short preview shown in pin chips. */
export const PIN_EXCERPT_MAX = 240;
/** Cap on pins per thread — a stitch is a distillation, not an archive. */
export const THREAD_PIN_MAX = 24;

export type StitchPin = {
  id: string;
  kind: PinKind;
  /** Source reference: URL, file path, session id, memory path… */
  ref: string;
  title: string;
  excerpt: string;
  /** Captured content, capped at PIN_CONTENT_MAX. Server-side only for large pins. */
  content: string;
  addedAt: string;
};

export type StitchThread = {
  id: string;
  title: string;
  pins: StitchPin[];
  createdAt: string;
  updatedAt: string;
  /** Set once the thread has been sewn into a vault entry. */
  sewnEntryId?: string;
};

/** Compact provenance reference persisted in stitch frontmatter. */
export type StitchPinRef = {
  kind: PinKind;
  ref: string;
  title: string;
};

const THREAD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidThreadId(id: unknown): id is string {
  return typeof id === "string" && THREAD_ID_RE.test(id);
}

export function newThreadId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newPinId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** First non-empty line(s) of content, collapsed and capped for chip previews. */
export function makeExcerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PIN_EXCERPT_MAX) return collapsed;
  return `${collapsed.slice(0, PIN_EXCERPT_MAX - 1)}…`;
}

export function capPinContent(content: string): string {
  return content.length > PIN_CONTENT_MAX ? content.slice(0, PIN_CONTENT_MAX) : content;
}

/** Build a persisted pin from captured source material. */
export function makePin(input: {
  kind: PinKind;
  ref: string;
  title: string;
  content: string;
  now?: Date;
}): StitchPin {
  const content = capPinContent(input.content);
  return {
    id: newPinId(),
    kind: input.kind,
    ref: input.ref.trim(),
    title: input.title.trim() || input.ref.trim() || input.kind,
    excerpt: makeExcerpt(content),
    content,
    addedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Compact pins into the provenance refs stored in stitch frontmatter. */
export function pinRefs(pins: readonly StitchPin[]): StitchPinRef[] {
  return pins.map((pin) => ({ kind: pin.kind, ref: pin.ref, title: pin.title }));
}

/** Parse a frontmatter `pins` value back into provenance refs. Tolerant: bad
 *  items are dropped, never thrown. */
export function normalizePinRefs(value: unknown): StitchPinRef[] {
  if (!Array.isArray(value)) return [];
  const refs: StitchPinRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!isPinKind(record.kind)) continue;
    if (typeof record.ref !== "string" || !record.ref.trim()) continue;
    refs.push({
      kind: record.kind,
      ref: record.ref.trim(),
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : record.ref.trim(),
    });
  }
  return refs;
}

// ── Sewing (distillation) ────────────────────────────────────────────────────

const PIN_KIND_LABEL: Record<PinKind, string> = {
  url: "Web page",
  paste: "Pasted text",
  file: "Local file",
  chat: "Chat session",
  github: "GitHub",
  memory: "Memory file",
};

export function pinKindLabel(kind: PinKind): string {
  return PIN_KIND_LABEL[kind];
}

function pinBlocks(pins: readonly StitchPin[]): string {
  return pins
    .map(
      (pin, index) =>
        `### Pin ${index + 1} — ${PIN_KIND_LABEL[pin.kind]}: ${pin.title}\nSource: ${pin.ref}\n\n${pin.content.trim()}`,
    )
    .join("\n\n---\n\n");
}

/**
 * The headless sew prompt: pins in, one strictly-formatted stitch out. The
 * output contract is parsed by `parseSewOutput` — keep the two in lockstep.
 */
export function buildSewPrompt(thread: Pick<StitchThread, "title" | "pins">): string {
  return [
    "You are distilling captured source material into ONE durable knowledge-base entry (a \"stitch\").",
    "Write reference material: factual, self-contained, deduplicated across sources, no meta-commentary.",
    "Prefer the sources' own terminology. Cite nothing — provenance is stored separately.",
    "",
    `Working title / intent: ${thread.title.trim() || "(none given)"}`,
    "",
    "Respond in EXACTLY this format (no fences, no preamble):",
    "TITLE: <entry title, one line>",
    "TAGS: <2-6 comma-separated lowercase tags>",
    "---",
    "<entry body as markdown>",
    "",
    "SOURCE PINS:",
    "",
    pinBlocks(thread.pins),
  ].join("\n");
}

/** A short digest prompt for the "sew in chat" escape hatch. */
export function buildSewChatPrompt(thread: Pick<StitchThread, "title" | "pins">): string {
  const list = thread.pins
    .map((pin, index) => `${index + 1}. [${PIN_KIND_LABEL[pin.kind]}] ${pin.title} — ${pin.ref}\n   ${pin.excerpt}`)
    .join("\n");
  return [
    `Help me sew a Grimoire stitch (knowledge-base entry)${thread.title.trim() ? ` about: ${thread.title.trim()}` : ""}.`,
    "",
    "I've pinned these sources:",
    list,
    "",
    "Draft one durable, self-contained reference entry (title, a few tags, markdown body) that distills them. Ask me before assuming anything the pins don't cover.",
  ].join("\n");
}

export type SewOutput = {
  title: string;
  tags: string[];
  body: string;
};

/** Parse the strict sew-output contract. Returns null when the shape is off —
 *  callers surface that as a retryable failure instead of writing garbage. */
export function parseSewOutput(text: string): SewOutput | null {
  const trimmed = text.trim();
  // Tolerate the WHOLE response being fenced even though the prompt forbids
  // it. Anchored to the full string (no `m` flag) and greedy: a line-anchored
  // lazy match would pair a code fence INSIDE the body and strip it, silently
  // corrupting sewn entries that contain code blocks.
  const unfenced = trimmed.replace(/^```[a-z]*\r?\n([\s\S]*)\r?\n```$/, "$1").trim();
  const match = unfenced.match(/^TITLE:\s*(.+)\r?\nTAGS:\s*(.*)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const title = match[1].trim();
  const body = match[3].trim();
  if (!title || !body) return null;
  const tags = match[2]
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  return { title, tags, body };
}

/** Prefill body for the "sew manually" path: pins concatenated under headings. */
export function buildManualStitchBody(thread: Pick<StitchThread, "pins">): string {
  return thread.pins
    .map((pin) => `## ${pin.title}\n\n> ${PIN_KIND_LABEL[pin.kind]} — ${pin.ref}\n\n${pin.content.trim()}`)
    .join("\n\n");
}
