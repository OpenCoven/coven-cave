/**
 * Open-in-tab carrier for untrusted chat artifacts (cave-e3ia).
 *
 * Two hard constraints shape this module:
 *
 * 1. Untrusted artifact HTML must never run in Cave's origin. A blob:/object
 *    URL minted by the app inherits the privileged app origin, so those are
 *    banned outright (regression-pinned in chat-artifact-viewer.test.ts).
 * 2. A top-level `data:text/html` navigation — the previous approach — is
 *    blocked by every engine we ship to (Chromium 60+, Firefox 59+, WebKit
 *    incl. Tauri's WKWebView), and blocked *silently*: window.open returns
 *    null without throwing, so the feature was a dead no-op (cave-e3ia).
 *
 * The working mechanism: open an app-controlled about:blank carrier document
 * and confine the artifact to a sandboxed `srcdoc` iframe WITHOUT
 * `allow-same-origin` — the exact opaque-origin boundary the inline preview
 * uses. Only trusted, app-authored markup is written to the carrier itself;
 * the untrusted payload travels solely inside an HTML-escaped attribute
 * value.
 */

/** Escape a string for safe embedding inside a double-quoted HTML attribute.
 *  `&` must be escaped first; `<`/`>` are escaped too so the value can never
 *  terminate the surrounding tag even if a parser mishandles quotes. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Sandbox grants for the carried artifact — kept identical to the inline
 *  preview iframe in chat-artifact-viewer.tsx. Never add allow-same-origin:
 *  the opaque origin IS the isolation boundary. */
export const ARTIFACT_CARRIER_SANDBOX = "allow-scripts allow-popups allow-modals";

/** Build the full carrier document. Everything outside the srcdoc attribute
 *  is static app-authored markup; the artifact HTML appears only as an
 *  escaped attribute value. */
export function buildArtifactCarrierHtml(artifactHtml: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    "<title>Cave artifact</title>",
    "<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%;display:block}</style>",
    "</head><body>",
    `<iframe sandbox="${ARTIFACT_CARRIER_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(artifactHtml)}"></iframe>`,
    "</body></html>",
  ].join("");
}

/** Open `artifactHtml` in a new tab inside the sandboxed carrier. Returns
 *  false when the popup was blocked (callers should surface that — the old
 *  data:-URL path failed silently, which is how cave-e3ia shipped dead).
 *  The opener handle is severed AFTER writing the carrier: the carrier is
 *  trusted app markup, and the sandboxed artifact inside it never receives
 *  an opener of its own. */
export function openArtifactInTab(
  artifactHtml: string,
  opener: (url: string, target: string) => Window | null = (url, target) => window.open(url, target),
): boolean {
  const w = opener("about:blank", "_blank");
  if (!w) return false;
  try {
    w.document.write(buildArtifactCarrierHtml(artifactHtml));
    w.document.close();
  } finally {
    w.opener = null;
  }
  return true;
}
