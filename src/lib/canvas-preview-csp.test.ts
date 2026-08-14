// @ts-nocheck
import assert from "node:assert/strict";

import {
  PREVIEW_CSP_MARKER,
  buildPreviewCsp,
  injectPreviewCsp,
  previewCspMetaTag,
  resolveSandboxAssetOrigin,
} from "./canvas-preview-csp.ts";
import { buildPreviewSrcDoc } from "./canvas-artifacts.ts";
import { buildReactSrcDoc, SANDBOX_RUNTIME_SRC } from "./canvas-react-harness.ts";

const ORIGIN = "http://127.0.0.1:3000";

// ── The policy itself ───────────────────────────────────────────────────────

const policy = buildPreviewCsp(ORIGIN);
assert.match(policy, /(^|; )default-src 'none'(;|$)/, "unnamed fetch directives fail closed");
assert.ok(
  policy.includes(`script-src ${ORIGIN} 'unsafe-inline' 'unsafe-eval'`),
  "the sandbox runtime's origin, inline artifact scripts, and the JSX transpiler's eval are allowed",
);
assert.ok(policy.includes(`style-src ${ORIGIN} 'unsafe-inline'`), "Tailwind's injected <style> elements are allowed");
// Every practical egress channel a sketch could reach for.
assert.ok(policy.includes("connect-src 'none'"), "no fetch/XHR/WebSocket/beacon");
assert.ok(policy.includes("img-src data: blob:"), "no remote image URL as a GET beacon");
assert.ok(policy.includes("font-src data:"), "no remote font fetch");
assert.ok(policy.includes("form-action 'none'"), "a form POST navigates, so connect-src alone wouldn't stop it");
assert.ok(policy.includes("frame-src 'none'"), "no nested browsing context with its own policy scope");
assert.ok(policy.includes("worker-src 'none'"), "no worker with its own policy scope");
assert.ok(policy.includes("object-src 'none'"), "no plugin content");
assert.ok(policy.includes("base-uri 'none'"), "a <base href> could re-point the runtime path at another host");

// `'self'` is meaningless from the preview's opaque origin — naming it would
// block the very runtime the React path loads. The origin must appear literally.
assert.doesNotMatch(policy, /'self'/, "'self' never appears: the preview origin is opaque");

// ── Origin handling ─────────────────────────────────────────────────────────

assert.equal(buildPreviewCsp(""), "", "no origin ⇒ no policy (never a policy that blanks the preview)");
assert.equal(buildPreviewCsp("   "), "", "whitespace is not an origin");
assert.equal(buildPreviewCsp("null"), "", "a sandboxed document's own \"null\" origin is unusable");
assert.equal(buildPreviewCsp("not an origin"), "", "a non-origin string is rejected rather than inlined");
assert.equal(
  buildPreviewCsp("http://evil.example\" onload=\"alert(1)"),
  "",
  "an origin carrying a quote can't break out of the meta attribute",
);
assert.equal(buildPreviewCsp("http://a.example; script-src *"), "", "an origin can't smuggle a second directive");
assert.ok(buildPreviewCsp("tauri://localhost").includes("script-src tauri://localhost"), "the desktop shell's origin works");
assert.ok(buildPreviewCsp("https://cave.example").includes("script-src https://cave.example"), "https origins work");

// In Node there is no location, so the default resolves to "" — which is what
// keeps the pure builders' existing unit tests policy-free.
assert.equal(resolveSandboxAssetOrigin(), "", "no browser location ⇒ no origin");
assert.equal(previewCspMetaTag(), "", "and therefore no meta tag");

// ── Injection placement ─────────────────────────────────────────────────────

const meta = previewCspMetaTag(ORIGIN);
assert.match(meta, /^<meta http-equiv="Content-Security-Policy" content="/, "stamped as an http-equiv meta");
assert.ok(meta.includes(`data-${PREVIEW_CSP_MARKER}="1"`), "carries the identifying marker");

const withDoctype = injectPreviewCsp('<!doctype html>\n<html><head><script>x()</script></head></html>', ORIGIN);
assert.ok(
  withDoctype.indexOf("Content-Security-Policy") < withDoctype.indexOf("x()"),
  "the policy precedes the document's own scripts — http-equiv only governs what follows it",
);
assert.match(withDoctype, /^<!doctype html>/i, "the doctype stays first, so the document is not quirks-mode");

const commented = injectPreviewCsp("<!-- lead -->\n<!doctype html><html></html>", ORIGIN);
assert.ok(
  commented.indexOf("Content-Security-Policy") > commented.indexOf("<!doctype html>"),
  "a comment before the doctype doesn't push the meta ahead of it",
);

const noDoctype = injectPreviewCsp("<html><body>hi</body></html>", ORIGIN);
assert.match(noDoctype, /^<meta http-equiv="Content-Security-Policy"/, "a doctype-less document gets the meta first");
assert.equal(injectPreviewCsp("<html></html>", ""), "<html></html>", "no origin ⇒ document is untouched");

// ── Both preview builders carry it ──────────────────────────────────────────

const reactDoc = buildReactSrcDoc("export default function App(){return <b>hi</b>}", "gen-1", ORIGIN);
assert.ok(reactDoc.includes("Content-Security-Policy"), "React previews are stamped");
assert.ok(
  reactDoc.indexOf("Content-Security-Policy") < reactDoc.indexOf("cave-canvas-inspector"),
  "the policy precedes the inspector, which is itself an inline script",
);
assert.ok(
  reactDoc.indexOf("Content-Security-Policy") < reactDoc.indexOf(SANDBOX_RUNTIME_SRC),
  "the policy precedes the runtime it explicitly permits",
);

const htmlDoc = buildPreviewSrcDoc("<!doctype html><html><body>hi</body></html>", "gen-2", ORIGIN);
assert.ok(htmlDoc.includes("Content-Security-Policy"), "full-document HTML previews are stamped");
const fragmentDoc = buildPreviewSrcDoc("<p>fragment</p>", "gen-3", ORIGIN);
assert.ok(fragmentDoc.includes("Content-Security-Policy"), "wrapped fragments are stamped");
assert.ok(fragmentDoc.includes("<p>fragment</p>"), "and still carry the artifact");

// Omitting the origin keeps the previous output verbatim, so no caller that
// hasn't been updated silently loses its preview.
assert.doesNotMatch(
  buildReactSrcDoc("export default function App(){return null}"),
  /Content-Security-Policy/,
  "no origin ⇒ the React document is unchanged",
);
assert.doesNotMatch(
  buildPreviewSrcDoc("<!doctype html><html></html>"),
  /Content-Security-Policy/,
  "no origin ⇒ the HTML document is unchanged",
);

console.log("canvas-preview-csp.test.ts ✓");
