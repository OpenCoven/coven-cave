// Pure helpers for the Sketch layer of the Canvas — ad-hoc "spin up a UI"
// artifacts. A familiar is asked to emit one self-contained HTML document; we
// extract it from the chat response, frame it for a sandboxed <iframe srcdoc>
// preview, and persist it. Everything here is framework-/fs-free so it can be
// unit-tested without a DOM, a daemon, or React Flow.

// An artifact is either a self-contained HTML document or a single React
// component (transpiled + rendered by the sandbox runtime). Older records
// (pre-React) have no `kind` and are treated as "html".
export type ArtifactKind = "html" | "react";

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

/** Heuristic: does this fenced code look like a React component vs HTML? */
function looksLikeReact(code: string): boolean {
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

/** A pre-built starter the canvas composer can drop in (alongside Blank). */
export type CanvasTemplate = {
  id: string;
  label: string;
  description: string;
  kind: ArtifactKind;
  code: string;
};

const TEMPLATE_DOC = (title: string, bodyStyle: string, body: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title}</title>`,
    "<style>",
    "  * { box-sizing: border-box; }",
    `  body { margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif;`,
    "    background: #0f1115; color: #e7e9ee; " + bodyStyle + " }",
    "  h1, h2, h3 { margin: 0 0 .4em; }",
    "  .btn { display: inline-block; padding: 10px 18px; border-radius: 10px; border: 0;",
    "    background: #6d5efc; color: #fff; font-weight: 600; cursor: pointer; text-decoration: none; }",
    "  .btn--ghost { background: transparent; border: 1px solid #2a2e38; color: #e7e9ee; }",
    "  .muted { color: #9aa0ad; }",
    "  .card { background: #1a1d24; border: 1px solid #242833; border-radius: 14px; padding: 22px; }",
    "</style>",
    "</head>",
    `<body>${body}</body>`,
    "</html>",
  ].join("\n");

/** Starter scaffolds offered in the composer's template dropdown. Self-styled
 *  HTML documents (the HTML preview has no Tailwind), matching the dark canvas
 *  aesthetic; users edit from there. */
export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "landing",
    label: "Landing page",
    description: "Hero with headline, subcopy, and call-to-action buttons",
    kind: "html",
    code: TEMPLATE_DOC(
      "Landing",
      "display: grid; place-items: center; padding: 48px;",
      [
        '<main style="max-width:640px;text-align:center">',
        '  <p class="muted" style="letter-spacing:.08em;text-transform:uppercase;font-size:13px">Your product</p>',
        "  <h1 style=\"font-size:44px;line-height:1.1\">Ship the thing, faster.</h1>",
        '  <p class="muted" style="font-size:18px;margin:0 auto 28px;max-width:48ch">A one-line promise that makes the value obvious. Replace this with your own pitch.</p>',
        '  <a href="#" class="btn">Get started</a>',
        '  <a href="#" class="btn btn--ghost" style="margin-left:10px">Learn more</a>',
        "</main>",
      ].join("\n"),
    ),
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Stat cards in a responsive grid",
    kind: "html",
    code: TEMPLATE_DOC(
      "Dashboard",
      "padding: 32px;",
      [
        '<h1 style="font-size:24px">Overview</h1>',
        '<p class="muted" style="margin-bottom:24px">Last 30 days</p>',
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px">',
        ...[
          ["Revenue", "$48,210", "+12.4%"],
          ["Active users", "3,902", "+4.1%"],
          ["Conversion", "2.8%", "-0.3%"],
          ["Churn", "1.2%", "+0.1%"],
        ].map(
          ([k, v, d]) =>
            `  <div class="card"><p class="muted" style="font-size:13px">${k}</p><p style="font-size:28px;font-weight:700;margin:.2em 0">${v}</p><p class="muted" style="font-size:12px">${d}</p></div>`,
        ),
        "</div>",
      ].join("\n"),
    ),
  },
  {
    id: "signin",
    label: "Sign-in form",
    description: "Centered card with email/password and submit",
    kind: "html",
    code: TEMPLATE_DOC(
      "Sign in",
      "display: grid; place-items: center; padding: 32px;",
      [
        '<form class="card" style="width:340px;display:grid;gap:14px" onsubmit="event.preventDefault()">',
        '  <h2 style="font-size:22px;text-align:center">Welcome back</h2>',
        '  <label style="display:grid;gap:6px;font-size:13px" class="muted">Email',
        '    <input type="email" style="padding:10px 12px;border-radius:10px;border:1px solid #2a2e38;background:#11141a;color:#e7e9ee" placeholder="you@example.com" /></label>',
        '  <label style="display:grid;gap:6px;font-size:13px" class="muted">Password',
        '    <input type="password" style="padding:10px 12px;border-radius:10px;border:1px solid #2a2e38;background:#11141a;color:#e7e9ee" placeholder="••••••••" /></label>',
        '  <button class="btn" type="submit" style="width:100%;margin-top:4px">Sign in</button>',
        "</form>",
      ].join("\n"),
    ),
  },
  {
    id: "pricing",
    label: "Pricing tiers",
    description: "Three side-by-side plans with a highlighted tier",
    kind: "html",
    code: TEMPLATE_DOC(
      "Pricing",
      "padding: 40px;",
      [
        '<h1 style="font-size:30px;text-align:center">Simple pricing</h1>',
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;max-width:780px;margin:28px auto 0">',
        ...[
          ["Starter", "$0", "For trying things out", false],
          ["Pro", "$19", "For growing teams", true],
          ["Scale", "$49", "For heavy usage", false],
        ].map(
          ([name, price, sub, hot]) =>
            `  <div class="card"${hot ? ' style="border-color:#6d5efc;box-shadow:0 0 0 1px #6d5efc"' : ""}><h3>${name}</h3><p style="font-size:34px;font-weight:700;margin:.1em 0">${price}<span class="muted" style="font-size:14px;font-weight:400">/mo</span></p><p class="muted" style="min-height:2.4em">${sub}</p><a href="#" class="btn${hot ? "" : " btn--ghost"}" style="width:100%;text-align:center;margin-top:8px">Choose</a></div>`,
        ),
        "</div>",
      ].join("\n"),
    ),
  },
];

/** Validate/normalize a raw artifact record from disk or a request body. */
export function sanitizeArtifact(value: unknown): CanvasArtifact | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  if (!id) return null;
  const prompt = typeof v.prompt === "string" ? v.prompt : "";
  const code = clampArtifactCode(typeof v.code === "string" ? v.code : "");
  const title = typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, MAX_TITLE_CHARS) : titleFromPrompt(prompt);
  const kind: ArtifactKind = v.kind === "react" ? "react" : "html";
  const createdAt = typeof v.createdAt === "string" ? v.createdAt : "";
  const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : createdAt;
  return { id, title, prompt, code, kind, createdAt, updatedAt };
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
