// Pure helpers for the Sketch layer of the Canvas — ad-hoc "spin up a UI"
// artifacts. A familiar is asked to emit one self-contained HTML document; we
// extract it from the chat response, frame it for a sandboxed <iframe srcdoc>
// preview, and persist it. Everything here is framework-/fs-free so it can be
// unit-tested without a DOM, a daemon, or React Flow.

export type CanvasArtifact = {
  id: string;
  /** Short human label, derived from the prompt (editable later). */
  title: string;
  /** The natural-language description the user asked for. */
  prompt: string;
  /** The self-contained HTML document rendered in the preview. */
  code: string;
  createdAt: string;
  updatedAt: string;
};

// Storage guard: a single artifact's code is capped so a runaway generation
// can't bloat the canvas store. Generous enough for a real standalone page.
export const MAX_ARTIFACT_CODE_CHARS = 200_000;
const MAX_TITLE_CHARS = 60;

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
export function buildPreviewSrcDoc(code: string): string {
  const src = typeof code === "string" ? code : "";
  if (isFullDocument(src)) return src;
  return [
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
  ].join("\n");
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
    "Rules:",
    "- Output EXACTLY ONE fenced ```html code block and nothing else — no prose, no explanation before or after.",
    "- The block must be a COMPLETE, self-contained document starting with `<!doctype html>`.",
    "- Inline all CSS in a <style> tag and all JS in a <script> tag. Do not reference local files or build tooling.",
    "- It must render on its own with no network access. If you need a library (e.g. React), load it from a CDN such as https://esm.sh, but prefer plain HTML/CSS/JS when it suffices.",
    "- Make it visually polished and responsive; fill the viewport sensibly.",
    "",
    `Build this: ${ask}`,
  ].join("\n");
}

/**
 * Prompt for iterating on an existing artifact: hand the familiar the current
 * document plus the change request, keeping the same one-document output
 * contract so the result drops straight back onto the canvas.
 */
export function buildRefinePrompt(currentCode: string, changeRequest: string): string {
  const ask = (changeRequest ?? "").trim() || "improve it";
  return [
    buildSketchPrompt(`Apply this change: ${ask}`),
    "",
    "Modify the document below. Return the FULL updated document, not a diff:",
    "",
    "```html",
    (currentCode ?? "").trim(),
    "```",
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

/** Validate/normalize a raw artifact record from disk or a request body. */
export function sanitizeArtifact(value: unknown): CanvasArtifact | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  if (!id) return null;
  const prompt = typeof v.prompt === "string" ? v.prompt : "";
  const code = clampArtifactCode(typeof v.code === "string" ? v.code : "");
  const title = typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, MAX_TITLE_CHARS) : titleFromPrompt(prompt);
  const createdAt = typeof v.createdAt === "string" ? v.createdAt : "";
  const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : createdAt;
  return { id, title, prompt, code, createdAt, updatedAt };
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
