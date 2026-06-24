// Browser-side markdown renderer for the native iOS app's WKWebView.
// Same @create-markdown/* + mermaid pipeline as the desktop chat, with
// highlight.js for code syntax colours (shiki doesn't bundle into a browser
// IIFE via esbuild — @shikijs/vscode-textmate's Resolver breaks). Bundled to a
// self-contained HTML by scripts/build-ios-markdown.mjs.

import { parse } from "@create-markdown/core";
import { renderAsync } from "@create-markdown/preview";
import { mermaidPlugin } from "@create-markdown/preview-mermaid";
import { renderTableReplacements } from "../../../src/lib/markdown-table-cells.ts";
import hljs from "highlight.js/lib/core";

import langSwift from "highlight.js/lib/languages/swift";
import langPython from "highlight.js/lib/languages/python";
import langJavascript from "highlight.js/lib/languages/javascript";
import langTypescript from "highlight.js/lib/languages/typescript";
import langRust from "highlight.js/lib/languages/rust";
import langGo from "highlight.js/lib/languages/go";
import langRuby from "highlight.js/lib/languages/ruby";
import langBash from "highlight.js/lib/languages/bash";
import langJson from "highlight.js/lib/languages/json";
import langYaml from "highlight.js/lib/languages/yaml";
import langSql from "highlight.js/lib/languages/sql";
import langXml from "highlight.js/lib/languages/xml";
import langCss from "highlight.js/lib/languages/css";
import langScss from "highlight.js/lib/languages/scss";
import langMarkdown from "highlight.js/lib/languages/markdown";
import langDiff from "highlight.js/lib/languages/diff";
import langDockerfile from "highlight.js/lib/languages/dockerfile";
import langJava from "highlight.js/lib/languages/java";
import langKotlin from "highlight.js/lib/languages/kotlin";
import langC from "highlight.js/lib/languages/c";
import langCpp from "highlight.js/lib/languages/cpp";
import langPhp from "highlight.js/lib/languages/php";
import langLua from "highlight.js/lib/languages/lua";

const REGISTER = {
  swift: langSwift, python: langPython, javascript: langJavascript,
  typescript: langTypescript, rust: langRust, go: langGo, ruby: langRuby,
  bash: langBash, json: langJson, yaml: langYaml, sql: langSql, xml: langXml,
  css: langCss, scss: langScss, markdown: langMarkdown, diff: langDiff,
  dockerfile: langDockerfile, java: langJava, kotlin: langKotlin, c: langC,
  cpp: langCpp, php: langPhp, lua: langLua,
};
for (const [name, def] of Object.entries(REGISTER)) hljs.registerLanguage(name, def);
hljs.configure({ classPrefix: "hljs-" });

// highlight.js already knows common aliases (js, ts, py, sh, yml, html, c++, …);
// a few extras it doesn't infer from our registered set:
const ALIASES = { sh: "bash", shell: "bash", zsh: "bash", html: "xml", "objective-c": "c" };

const mermaid = mermaidPlugin({ theme: "dark", config: { securityLevel: "strict" } });
let mermaidReady = null;
function initMermaid() {
  if (!mermaidReady) mermaidReady = Promise.resolve(mermaid.init?.());
  return mermaidReady;
}

function isMermaid(block) {
  if (block.type !== "codeBlock") return false;
  return (block.props?.language ?? block.props?.info ?? "").trim().toLowerCase() === "mermaid";
}
function codeText(block) {
  return (block.content ?? []).map((s) => s.text).join("");
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlightCode(code, rawLang) {
  let lang = (rawLang ?? "").trim().toLowerCase().split(/\s+/)[0];
  lang = ALIASES[lang] ?? lang;
  let inner = escapeHtml(code);
  let resolved = "";
  if (lang && hljs.getLanguage(lang)) {
    resolved = lang;
    try { inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch {}
  }
  // A header bar (language label + Expand + Copy) sits above the code, like the
  // desktop chat. Expand lifts the highlighted <pre> to a full-screen viewer;
  // Copy reads the <code> textContent (raw, de-highlighted) and hands it to
  // native. Both are explicit buttons so reading/scrolling code never triggers
  // them by accident.
  const label = resolved ? `<span class="code-lang">${escapeHtml(resolved)}</span>` : `<span class="code-lang"></span>`;
  return `<div class="code-block">`
    + `<div class="code-toolbar">${label}<span class="code-actions">`
    + `<button class="code-btn code-expand" type="button" aria-label="Expand code">⤢ Expand</button>`
    + `<button class="code-btn code-copy" type="button" aria-label="Copy code">Copy</button>`
    + `</span></div>`
    + `<pre class="hljs"><code class="hljs">${inner}</code></pre></div>`;
}

// While a reply is still streaming we DON'T run Mermaid: the fence is usually
// incomplete (so it errors) and re-rendering a diagram on every token is heavy
// and flickers. Show a lightweight placeholder instead; the real diagram renders
// once on settle (streaming === false).
function mermaidPlaceholder(code) {
  const preview = escapeHtml(code).trim().slice(0, 400);
  return `<div class="cm-mermaid" style="opacity:.8">`
    + `<div style="font:600 10.5px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--txt-muted);text-align:left;margin-bottom:6px">◇ Diagram · rendering on completion</div>`
    + `<pre style="margin:0;background:transparent;border:0;padding:0;white-space:pre-wrap;text-align:left;font-size:12px;color:var(--txt-muted)">${preview}</pre></div>`;
}

async function renderMarkdown(md, { streaming = false } = {}) {
  const blocks = parse(md || "");
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
  const hasMermaid = !streaming && codeBlocks.some(isMermaid);
  if (hasMermaid) await initMermaid();

  const replacements = new Array(codeBlocks.length);
  codeBlocks.forEach((block, i) => {
    if (isMermaid(block)) {
      replacements[i] = streaming
        ? mermaidPlaceholder(codeText(block))
        : (mermaid.renderBlock?.(block, () => "") ?? "");
      return;
    }
    replacements[i] = highlightCode(codeText(block), block.props?.language ?? block.props?.info ?? "");
  });

  // Re-render table cells through the inline path so **bold**/`code`/[links]
  // inside a cell render as formatting, not literal markdown (preview emits
  // cells as escaped plain text). Supplied positionally via `table`.
  const tableReplacements = await renderTableReplacements(blocks, renderAsync);

  let idx = 0;
  let tableIdx = 0;
  let html = await renderAsync(blocks, {
    linkTarget: "_blank",
    sanitize: true,
    customRenderers: {
      codeBlock: () => replacements[idx++] ?? "",
      table: () => tableReplacements[tableIdx++] ?? "",
    },
  });
  if (hasMermaid && mermaid.postProcess) html = await mermaid.postProcess(html);
  return html;
}

// Reader theming: override the prose-level CSS variables (declared on :root in
// markdown.css) so the same bundle can render dark / light / sepia. Code blocks
// keep their dark card (we deliberately DON'T touch --code-bg / hljs colours) —
// a dark code card on a light page is intentional and dodges contrast problems.
const THEME_VARS = {
  dark: null,
  light: { "--txt": "#1c1c22", "--txt-muted": "#5b5b66", "--accent": "#5a51d6", "--hairline": "rgba(0,0,0,0.14)", "--code-inline-bg": "rgba(90,81,214,0.12)", "--code-inline-fg": "#4b43c4", "--th-bg": "rgba(0,0,0,0.04)", bg: "#ffffff" },
  sepia: { "--txt": "#43382a", "--txt-muted": "#7a6a55", "--accent": "#9a5a2a", "--hairline": "rgba(0,0,0,0.16)", "--code-inline-bg": "rgba(154,90,42,0.14)", "--code-inline-fg": "#8a4a1a", "--th-bg": "rgba(0,0,0,0.05)", bg: "#f4ecd8" },
};
const THEME_KEYS = ["--txt", "--txt-muted", "--accent", "--hairline", "--code-inline-bg", "--code-inline-fg", "--th-bg"];
function applyTheme(name) {
  const de = document.documentElement;
  const t = THEME_VARS[name] || null;
  THEME_KEYS.forEach((k) => de.style.removeProperty(k));
  if (t) for (const k of THEME_KEYS) if (t[k]) de.style.setProperty(k, t[k]);
  document.body.style.background = t && t.bg ? t.bg : "";
}

// fontScale zooms the whole document uniformly (px + em both scale); reader mode
// adds page padding so the full-screen scroll view isn't edge-to-edge.
function applyStyle(opts = {}) {
  const { fontScale = 1, theme = "dark", reader = false } = opts || {};
  applyTheme(theme);
  document.body.style.zoom = fontScale && fontScale !== 1 ? String(fontScale) : "";
  document.body.style.padding = reader ? "18px 18px 80px" : "";
}

// Heading elements from the last render, in document order, so the reader's TOC
// can scroll to one by index without round-tripping coordinates.
let lastHeadingEls = [];
function reportLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const h = Math.ceil(document.body.getBoundingClientRect().height);
      window.webkit?.messageHandlers?.cave?.postMessage({ type: "height", height: h });
      const root = document.getElementById("root");
      lastHeadingEls = root ? [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")] : [];
      const headings = lastHeadingEls
        .map((el, i) => ({ index: i, level: Number(el.tagName[1]), text: (el.textContent || "").trim() }))
        .filter((x) => x.text);
      window.webkit?.messageHandlers?.cave?.postMessage({ type: "headings", headings });
    });
  });
}

window.caveRender = async (md, opts = {}) => {
  const root = document.getElementById("root");
  if (!root) return;
  applyStyle(opts);
  try {
    root.innerHTML = await renderMarkdown(md, { streaming: !!opts.streaming });
  } catch (err) {
    root.textContent = String(md || "");
    window.webkit?.messageHandlers?.cave?.postMessage({ type: "error", message: String(err) });
  }
  reportLayout();
};

// Re-style without re-rendering markdown — used when the reader's font size or
// theme changes, so the scroll position survives (innerHTML is untouched).
window.caveStyle = (opts = {}) => {
  applyStyle(opts);
  reportLayout();
};

// Reader TOC: scroll the (internally-scrolling) reader WebView to a heading.
window.caveScrollToHeading = (i) => {
  lastHeadingEls[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
};

document.addEventListener("click", (e) => {
  const a = e.target?.closest?.("a[href]");
  if (!a) return;
  e.preventDefault();
  window.webkit?.messageHandlers?.cave?.postMessage({ type: "link", href: a.getAttribute("href") });
});

// Copy a code block: native owns the clipboard (UIPasteboard), so post the raw
// text and flip the button to a confirmation briefly.
document.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".code-copy");
  if (!btn) return;
  const text = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
  window.webkit?.messageHandlers?.cave?.postMessage({ type: "copy", text });
  btn.textContent = "Copied";
  btn.classList.add("is-copied");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("is-copied"); }, 1400);
});

// Expand a code block: lift the highlighted <pre> into a full-screen, scrollable
// code viewer (native owns the surface) and pass the raw text so the viewer's
// own Copy button works without round-tripping through the WebView again.
document.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".code-expand");
  if (!btn) return;
  const block = btn.closest(".code-block");
  const pre = block?.querySelector("pre");
  const text = block?.querySelector("code")?.textContent ?? "";
  window.webkit?.messageHandlers?.cave?.postMessage({
    type: "enlarge",
    kind: "code",
    html: pre?.outerHTML ?? "",
    text,
  });
});

// Tap a table, Mermaid diagram, or inline image to enlarge it full-screen —
// native owns the zoom surface. Links / copy buttons keep their own behavior,
// so skip taps that land on them.
const MERMAID_SEL = ".cm-mermaid, .mermaid, [class*='mermaid']";
document.addEventListener("click", (e) => {
  if (e.target?.closest?.("a[href], button, .code-copy")) return;
  const hit = e.target?.closest?.(`table, img, svg, ${MERMAID_SEL}`);
  if (!hit) return;
  // A Mermaid SVG: lift its styled wrapper so the enlarged view keeps the card.
  const target =
    hit.tagName?.toLowerCase() === "svg" ? (hit.closest(MERMAID_SEL) || hit) : hit;
  const tag = target.tagName?.toLowerCase();
  const kind = tag === "table" ? "table" : tag === "img" ? "image" : "diagram";
  // For an <img>, also pass its src so native can decode it into a UIImage and
  // present the smooth native zoom (pinch/pan/double-tap) instead of a WebView.
  const src = kind === "image" ? (target.getAttribute("src") || "") : "";
  window.webkit?.messageHandlers?.cave?.postMessage({
    type: "enlarge",
    kind,
    html: target.outerHTML,
    src,
  });
});

window.webkit?.messageHandlers?.cave?.postMessage({ type: "ready" });
