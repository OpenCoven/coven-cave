// Browser-side markdown renderer for the native iOS app's WKWebView.
// Uses the SAME packages the desktop chat uses (@create-markdown/* + mermaid)
// so rendered responses match the desktop pixel-for-pixel, including Mermaid
// diagrams. Bundled to a single self-contained HTML by scripts/build-ios-markdown.mjs.

import { parse } from "@create-markdown/core";
import { renderAsync } from "@create-markdown/preview";
import { mermaidPlugin } from "@create-markdown/preview-mermaid";

const mermaid = mermaidPlugin({ theme: "dark", config: { securityLevel: "strict" } });

// Render a markdown string to sanitized HTML (Mermaid diagrams resolved to SVG).
async function renderMarkdown(md) {
  const blocks = parse(md || "");
  return await renderAsync(blocks, {
    plugins: [mermaid],
    linkTarget: "_blank",
    sanitize: true,
  });
}

function reportHeight() {
  // Two frames so Mermaid SVGs / fonts have laid out before we measure.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const h = Math.ceil(document.body.getBoundingClientRect().height);
      window.webkit?.messageHandlers?.cave?.postMessage({ type: "height", height: h });
    });
  });
}

// Native entry point: render markdown into #root and report the content height.
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

// Intercept link taps → hand off to native (open in Safari).
document.addEventListener("click", (e) => {
  const a = e.target?.closest?.("a[href]");
  if (!a) return;
  e.preventDefault();
  window.webkit?.messageHandlers?.cave?.postMessage({ type: "link", href: a.getAttribute("href") });
});

window.webkit?.messageHandlers?.cave?.postMessage({ type: "ready" });
