// Browser-side markdown renderer for the native iOS app's WKWebView.
// Same @create-markdown/* + mermaid pipeline as the desktop chat, with
// highlight.js for code syntax colours (shiki doesn't bundle into a browser
// IIFE via esbuild — @shikijs/vscode-textmate's Resolver breaks). Bundled to a
// self-contained HTML by scripts/build-ios-markdown.mjs.

import { parse } from "@create-markdown/core";
import { renderAsync } from "@create-markdown/preview";
import { mermaidPlugin } from "@create-markdown/preview-mermaid";
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
  if (lang && hljs.getLanguage(lang)) {
    try { inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch {}
  }
  // Wrap in a positioned container with a copy button; the button reads the
  // <code> textContent (raw, de-highlighted) and hands it to native on tap.
  return `<div class="code-block"><button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre class="hljs"><code class="hljs">${inner}</code></pre></div>`;
}

async function renderMarkdown(md) {
  const blocks = parse(md || "");
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
  const hasMermaid = codeBlocks.some(isMermaid);
  if (hasMermaid) await initMermaid();

  const replacements = new Array(codeBlocks.length);
  codeBlocks.forEach((block, i) => {
    if (hasMermaid && isMermaid(block)) {
      replacements[i] = mermaid.renderBlock?.(block, () => "") ?? "";
      return;
    }
    replacements[i] = highlightCode(codeText(block), block.props?.language ?? block.props?.info ?? "");
  });

  let idx = 0;
  let html = await renderAsync(blocks, {
    linkTarget: "_blank",
    sanitize: true,
    customRenderers: { codeBlock: () => replacements[idx++] ?? "" },
  });
  if (hasMermaid && mermaid.postProcess) html = await mermaid.postProcess(html);
  return html;
}

function reportHeight() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const h = Math.ceil(document.body.getBoundingClientRect().height);
      window.webkit?.messageHandlers?.cave?.postMessage({ type: "height", height: h });
    });
  });
}

window.caveRender = async (md) => {
  const root = document.getElementById("root");
  if (!root) return;
  try {
    root.innerHTML = await renderMarkdown(md);
  } catch (err) {
    root.textContent = String(md || "");
    window.webkit?.messageHandlers?.cave?.postMessage({ type: "error", message: String(err) });
  }
  reportHeight();
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
  const text = btn.parentElement?.querySelector("code")?.textContent ?? "";
  window.webkit?.messageHandlers?.cave?.postMessage({ type: "copy", text });
  btn.textContent = "Copied";
  btn.classList.add("is-copied");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("is-copied"); }, 1400);
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
  window.webkit?.messageHandlers?.cave?.postMessage({
    type: "enlarge",
    kind,
    html: target.outerHTML,
  });
});

window.webkit?.messageHandlers?.cave?.postMessage({ type: "ready" });
