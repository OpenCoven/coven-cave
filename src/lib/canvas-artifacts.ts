// Pure helpers for the Sketch layer of the Canvas — ad-hoc "spin up a UI"
// artifacts. A familiar is asked to emit one self-contained HTML document; we
// extract it from the chat response, frame it for a sandboxed <iframe srcdoc>
// preview, and persist it. Everything here is framework-/fs-free so it can be
// unit-tested without a DOM, a daemon, or React Flow.

import { injectCanvasInspector } from "./canvas-inspector.ts";

// An artifact is either a self-contained HTML document or a single React
// component (transpiled + rendered by the sandbox runtime). Older records
// (pre-React) have no `kind` and are treated as "html".
export type ArtifactKind = "html" | "react";

export type CanvasComponentTarget = {
  selector: string;
  label: string;
  excerpt: string;
};

export type CanvasAnnotation = {
  id: string;
  target: CanvasComponentTarget;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasArtifact = {
  id: string;
  /** Short human label, derived from the prompt (editable later). */
  title: string;
  /** The natural-language description the user asked for. */
  prompt: string;
  /** The HTML document, or React component source, rendered in the preview. */
  code: string;
  /** How `code` should be previewed. Absent ⇒ "html" (back-compat). */
  kind?: ArtifactKind;
  annotations?: CanvasAnnotation[];
  createdAt: string;
  updatedAt: string;
};

// Storage guard: a single artifact's code is capped so a runaway generation
// can't bloat the canvas store. Generous enough for a real standalone page.
export const MAX_ARTIFACT_CODE_CHARS = 200_000;
const MAX_TITLE_CHARS = 60;
// Prompts are short descriptions (the composer's ask or a refine request);
// clamping keeps a runaway/buggy caller from bloating every store read.
export const MAX_ARTIFACT_PROMPT_CHARS = 4_000;
// Ids are client-minted (`art-<uuid>`, ghreview slugs); anything this long is
// garbage and would pollute the positions map keyed by it.
const MAX_ARTIFACT_ID_CHARS = 200;
const MAX_ANNOTATIONS = 100;
const MAX_ANNOTATION_ID_CHARS = 200;
const MAX_ANNOTATION_SELECTOR_CHARS = 500;
const MAX_ANNOTATION_LABEL_CHARS = 200;
const MAX_ANNOTATION_EXCERPT_CHARS = 1_000;
const MAX_ANNOTATION_NOTE_CHARS = 4_000;

/**
 * Pull the HTML document out of a familiar's chat response.
 *
 * Models reliably wrap code in a fenced block; we prefer an html/markup-tagged
 * fence, fall back to the first fence of any language, and finally — if the
 * model ignored the format and emitted a bare document — slice from the first
 * `<!doctype` / `<html` tag. Returns null when there's nothing renderable.
 */
export function extractHtmlArtifact(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null;

  const fences = [...text.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)];
  if (fences.length > 0) {
    const htmlFence = fences.find((m) => /^(html?|markup|xml)$/i.test(m[1] ?? ""));
    const chosen = (htmlFence ?? fences[0])[2] ?? "";
    const trimmed = chosen.trim();
    if (trimmed) return trimmed;
  }

  // No usable fence — accept a bare document if one is present.
  const docMatch = text.match(/<!doctype html[\s\S]*<\/html>/i) ?? text.match(/<html[\s\S]*<\/html>/i);
  if (docMatch) return docMatch[0].trim();

  return null;
}

/** Heuristic: does this fenced code look like a React component vs HTML?
 *  Exported for the Canvas add tile's pasted-code kind detection. */
export function looksLikeReact(code: string): boolean {
  if (/<!doctype html/i.test(code) || /<html[\s>]/i.test(code)) return false;
  return /\bexport\s+default\b/.test(code) || /\bfunction\s+App\b/.test(code) || /\buse(State|Effect|Ref|Memo|Callback)\b/.test(code);
}

/**
 * Pull a renderable artifact out of a familiar's response and classify it. A
 * `tsx`/`jsx` fence ⇒ React; an `html` fence (or bare `<!doctype>`) ⇒ HTML; an
 * untagged fence is classified by content. Returns null when nothing renders.
 */
export function extractArtifact(text: string): { kind: ArtifactKind; code: string } | null {
  if (typeof text !== "string" || !text.trim()) return null;

  const fences = [...text.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)];
  if (fences.length > 0) {
    const react = fences.find((m) => /^(tsx|jsx|react|javascriptreact|typescriptreact)$/i.test(m[1] ?? ""));
    if (react && react[2]?.trim()) return { kind: "react", code: react[2].trim() };
    const html = fences.find((m) => /^(html?|markup|xml)$/i.test(m[1] ?? ""));
    if (html && html[2]?.trim()) return { kind: "html", code: html[2].trim() };
    const first = (fences[0][2] ?? "").trim();
    if (first) return { kind: looksLikeReact(first) ? "react" : "html", code: first };
  }

  const docMatch = text.match(/<!doctype html[\s\S]*<\/html>/i) ?? text.match(/<html[\s\S]*<\/html>/i);
  if (docMatch) return { kind: "html", code: docMatch[0].trim() };

  return null;
}

const RENDERABLE_REACT_LANGS = /^(tsx|jsx|react|javascriptreact|typescriptreact)$/i;
const RENDERABLE_HTML_LANGS = /^(html?|markup|xml)$/i;

/** A renderable fenced block with its span in the source text. */
export type RenderableBlock = { index: number; length: number; kind: ArtifactKind; code: string };

/**
 * Find every COMPLETE, renderable fenced code block in `text` and report its
 * span (`index`/`length` are offsets into `text`, fence delimiters included) so
 * a caller can slice the surrounding prose. Conservative on purpose: only a
 * `tsx/jsx/react` fence containing `export default` (React) or an `html`/
 * untagged fence whose body is a full document (HTML) qualifies — trivial
 * snippets stay as ordinary code. Unterminated fences never match.
 */
export function extractArtifactBlocks(text: string): RenderableBlock[] {
  if (typeof text !== "string" || !text) return [];
  const out: RenderableBlock[] = [];
  for (const m of text.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)) {
    const lang = (m[1] ?? "").trim();
    const code = (m[2] ?? "").trim();
    if (!code) continue;
    let kind: ArtifactKind | null = null;
    if (RENDERABLE_REACT_LANGS.test(lang) && /\bexport\s+default\b/.test(code)) {
      kind = "react";
    } else if ((RENDERABLE_HTML_LANGS.test(lang) || lang === "") && isFullDocument(code)) {
      kind = "html";
    }
    if (!kind) continue;
    out.push({ index: m.index ?? 0, length: m[0].length, kind, code });
  }
  return out;
}

/** True when `code` already looks like a full HTML document (vs a fragment). */
export function isFullDocument(code: string): boolean {
  return /<html[\s>]/i.test(code) || /<!doctype html/i.test(code);
}

/**
 * Frame artifact code for the preview iframe. Full documents pass through; a
 * bare fragment is wrapped in a minimal document with neutral base styling so
 * it renders sensibly on its own. The result is fed to `<iframe srcdoc>` and
 * runs under `sandbox="allow-scripts"` (no same-origin) — isolation comes from
 * the sandbox, so we intentionally do NOT strip scripts here.
 */
export function buildPreviewSrcDoc(code: string, inspectorGeneration = ""): string {
  const src = typeof code === "string" ? code : "";
  if (isFullDocument(src)) return injectCanvasInspector(src, inspectorGeneration);
  return injectCanvasInspector([
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>",
    "  :root { color-scheme: light dark; }",
    "  body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }",
    "</style>",
    "</head>",
    `<body>${src}</body>`,
    "</html>",
  ].join("\n"), inspectorGeneration);
}

/** A compact title from a prompt: first line, collapsed, clamped. */
export function titleFromPrompt(prompt: string): string {
  const firstLine = (prompt ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "Untitled";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed || "Untitled";
  return collapsed.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + "…";
}

/** Clamp code to the storage cap, preserving the head of the document. */
export function clampArtifactCode(code: string): string {
  const src = typeof code === "string" ? code : "";
  return src.length > MAX_ARTIFACT_CODE_CHARS ? src.slice(0, MAX_ARTIFACT_CODE_CHARS) : src;
}

/**
 * The instruction wrapped around the user's description before it goes to the
 * familiar. Constrains output to one self-contained document so extraction is
 * deterministic — no build step, no external files, no prose.
 */
export function buildSketchPrompt(userPrompt: string): string {
  const ask = (userPrompt ?? "").trim() || "a simple example UI";
  return [
    "You are generating a UI for a live preview sandbox inside a design canvas.",
    "",
    "Output EXACTLY ONE fenced code block and nothing else — no prose before or after.",
    "Choose ONE of these two forms:",
    "",
    "(A) A ```html block: a COMPLETE self-contained document starting with `<!doctype html>`,",
    "    with all CSS inlined in <style> and all JS inlined in <script>. No external files.",
    "",
    "(B) A ```tsx block: a single React component, DEFAULT-EXPORTED and named `App`",
    "    (e.g. `export default function App() { … }`). React 19 and its hooks are available",
    "    as globals — use `React.useState`, or destructure `const { useState } = React`.",
    "    Do NOT write `import React`/`import ReactDOM` and do NOT load anything from a CDN.",
    "    Tailwind utility classes ARE available — style with `className=\"…\"` (e.g. `flex gap-4 rounded-xl`)",
    "    and/or inline `style={{…}}`. Both work.",
    "",
    "Prefer (B) tsx for interactive components; (A) html for static pages or plain markup.",
    "It must render on its own with no network access. Make it polished and responsive.",
    "",
    `Build this: ${ask}`,
  ].join("\n");
}

/**
 * Prompt for iterating on an existing artifact: hand the familiar the current
 * document plus the change request, keeping the same one-document output
 * contract so the result drops straight back onto the canvas.
 */
export function buildRefinePrompt(
  currentCode: string,
  changeRequest: string,
  kind: ArtifactKind = "html",
): string {
  const ask = (changeRequest ?? "").trim() || "improve it";
  const lang = kind === "react" ? "tsx" : "html";
  const noun = kind === "react" ? "React component" : "document";
  return [
    buildSketchPrompt(`Apply this change: ${ask}`),
    "",
    `Modify the ${noun} below. Keep the same ${lang} form and return the FULL updated ${noun}, not a diff:`,
    "",
    "```" + lang,
    (currentCode ?? "").trim(),
    "```",
  ].join("\n");
}

/**
 * One-shot recovery prompt for a Canvas-origin response that streamed
 * successfully but could not be rendered. Keeping this separate from the
 * normal sketch prompt lets callers retry only the format failure, and pass
 * the first run's session id so the repair remains in the same hidden Canvas
 * conversation.
 */
export function buildArtifactRepairPrompt(
  originalIntent: string,
  kind?: ArtifactKind,
): string {
  const intent = (originalIntent ?? "").trim() || "the requested UI";
  const form = kind === "react"
    ? "one complete `tsx` fenced artifact"
    : kind === "html"
      ? "one complete `html` fenced artifact"
      : "one complete `html` or `tsx` fenced artifact";
  return [
    "Repair the previous response so the Canvas can preview it.",
    `Return only ${form}, with no prose before or after.`,
    "The artifact must be complete, self-contained, and require no network access.",
    "Original user intent:",
    intent,
  ].join("\n");
}

/** A minimal starter document for hand-written / pasted artifacts. */
export const STARTER_ARTIFACT_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  "<style>",
  "  body { margin: 0; display: grid; place-items: center; min-height: 100vh;",
  "    font-family: system-ui, sans-serif; background: #0f1115; color: #e7e9ee; }",
  "  .card { padding: 24px 28px; border-radius: 14px; background: #1a1d24;",
  "    box-shadow: 0 8px 30px rgba(0,0,0,.4); }",
  "</style>",
  "</head>",
  "<body>",
  '  <div class="card"><h1>Hello, canvas</h1><p>Edit this HTML to sketch a UI.</p></div>',
  "</body>",
  "</html>",
].join("\n");

/** A minimal interactive starter for the explicit Blank React path. */
export const STARTER_ARTIFACT_REACT = [
  "export default function App() {",
  "  const [count, setCount] = React.useState(0);",
  "  return (",
  '    <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">',
  '      <section className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">',
  '        <h1 className="text-2xl font-semibold">Hello, canvas</h1>',
  '        <p className="mt-2 text-slate-400">Edit this React component to sketch an interaction.</p>',
  '        <button className="mt-5 rounded-lg bg-violet-500 px-4 py-2 font-medium hover:bg-violet-400" onClick={() => setCount((value) => value + 1)}>',
  "          Clicked {count} times",
  "        </button>",
  "      </section>",
  "    </main>",
  "  );",
  "}",
].join("\n");

/** Validate and bound a component target received from the preview sandbox. */
export function sanitizeCanvasComponentTarget(value: unknown): CanvasComponentTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (
    typeof target.selector !== "string"
    || typeof target.label !== "string"
    || typeof target.excerpt !== "string"
  ) {
    return null;
  }

  const selector = target.selector.trim();
  if (!selector) return null;
  return {
    selector: selector.slice(0, MAX_ANNOTATION_SELECTOR_CHARS),
    label: target.label.trim().slice(0, MAX_ANNOTATION_LABEL_CHARS),
    excerpt: target.excerpt.trim().slice(0, MAX_ANNOTATION_EXCERPT_CHARS),
  };
}

/** Validate and bound one persisted component annotation. */
export function sanitizeAnnotation(value: unknown): CanvasAnnotation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const target = sanitizeCanvasComponentTarget(v.target);
  if (typeof v.id !== "string" || !target || typeof v.note !== "string") return null;

  const id = v.id.trim();
  if (!id || id.length > MAX_ANNOTATION_ID_CHARS) return null;

  const createdAt = typeof v.createdAt === "string" && Number.isFinite(Date.parse(v.createdAt))
    ? v.createdAt
    : "";
  const updatedAt = typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt))
    ? v.updatedAt
    : createdAt;
  return {
    id,
    target,
    note: v.note.trim().slice(0, MAX_ANNOTATION_NOTE_CHARS),
    createdAt,
    updatedAt,
  };
}

/** Sanitize an annotation list, preserving the first 100 usable records. */
export function sanitizeAnnotations(raw: unknown): CanvasAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasAnnotation[] = [];
  for (const entry of raw) {
    const annotation = sanitizeAnnotation(entry);
    if (annotation) out.push(annotation);
    if (out.length === MAX_ANNOTATIONS) break;
  }
  return out;
}

/** Validate/normalize a raw artifact record from disk or a request body. */
export function sanitizeArtifact(value: unknown): CanvasArtifact | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  if (!id || id.length > MAX_ARTIFACT_ID_CHARS) return null;
  const prompt = (typeof v.prompt === "string" ? v.prompt : "").slice(0, MAX_ARTIFACT_PROMPT_CHARS);
  const code = clampArtifactCode(typeof v.code === "string" ? v.code : "");
  const title = typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, MAX_TITLE_CHARS) : titleFromPrompt(prompt);
  const kind: ArtifactKind = v.kind === "react" ? "react" : "html";
  // Timestamps feed the gallery's lexicographic recency sort and the card's
  // date label — garbage strings sort a sketch as if newest forever. Coerce
  // unparseable values to "" (renders dateless, sorts last).
  const createdAt = typeof v.createdAt === "string" && Number.isFinite(Date.parse(v.createdAt)) ? v.createdAt : "";
  const updatedAt = typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt)) ? v.updatedAt : createdAt;
  const annotations = sanitizeAnnotations(v.annotations);
  return {
    id,
    title,
    prompt,
    code,
    kind,
    ...(annotations.length > 0 ? { annotations } : {}),
    createdAt,
    updatedAt,
  };
}

/** Sanitize an array of artifact records, dropping any that are unusable. */
export function sanitizeArtifacts(raw: unknown): CanvasArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasArtifact[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const art = sanitizeArtifact(entry);
    if (art && !seen.has(art.id)) {
      seen.add(art.id);
      out.push(art);
    }
  }
  return out;
}
