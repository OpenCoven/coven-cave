// Sandbox runtime for the Canvas "Sketch" layer's React artifacts.
//
// This file is NOT part of the app bundle. `scripts/build-sandbox-runtime.mjs`
// esbuilds it into `public/sandbox/react-runtime.js`, a self-contained browser
// IIFE that the preview <iframe> loads. It bundles the app's own React 19
// (which ships no UMD build) plus the sucrase transpiler, so JSX/TSX artifacts
// render live and fully offline — no CDN.
//
// It runs inside `<iframe sandbox="allow-scripts">` WITHOUT allow-same-origin:
// the iframe is an opaque origin that can load this script from our server but
// cannot touch Cave's DOM, cookies, or storage. Errors are reported to the
// parent via postMessage (the only channel across the sandbox boundary).

import * as React from "react";
import { createRoot } from "react-dom/client";
import { transform } from "sucrase";

// Local view of the globals we set on the sandbox window. We deliberately do
// NOT augment the global `Window` interface — the app already declares
// `window.ReactDOM` as the full react-dom namespace, and this isolated runtime
// only needs `createRoot`.
const sandboxWindow = window as unknown as {
  React: typeof React;
  ReactDOM: { createRoot: typeof createRoot };
  __transpile: (src: string) => string;
  __mount: (src: string, root: HTMLElement) => void;
};

// Expose React so transpiled JSX (classic runtime → React.createElement) and
// hand-written code can reference it as a global.
sandboxWindow.React = React;
sandboxWindow.ReactDOM = { createRoot };

/** JSX + TypeScript → plain JS. Module syntax is stripped before this runs. */
function transpile(src: string): string {
  return transform(src, {
    transforms: ["jsx", "typescript"],
    jsxRuntime: "classic",
    production: true,
  }).code;
}
sandboxWindow.__transpile = transpile;

/**
 * Strip ESM module syntax so the source can run inside `new Function`. React is
 * already a global, so imports are dropped; the default export is rewritten to
 * a known binding (`__default`) and named exports lose their keyword.
 */
function stripModuleSyntax(src: string): string {
  return src
    .replace(/^[ \t]*import[^\n;]*;?[ \t]*$/gm, "")
    .replace(/^[ \t]*export[ \t]+default[ \t]+function[ \t]+/m, "function ")
    .replace(/^[ \t]*export[ \t]+default[ \t]+class[ \t]+/m, "class ")
    .replace(/^[ \t]*export[ \t]+default[ \t]+/m, "const __default = ")
    .replace(/^[ \t]*export[ \t]+/gm, "");
}

function reportError(message: string, stack?: string) {
  try {
    window.parent?.postMessage({ type: "sandbox-error", message, stack }, "*");
  } catch {
    /* parent may be gone */
  }
}

/** Transpile, evaluate, and render the component into `root`. */
function mount(src: string, root: HTMLElement) {
  let component: unknown;
  try {
    const code = transpile(stripModuleSyntax(src));
    // The component is resolved by convention: a default export becomes
    // `__default`; otherwise a top-level `App` is used.
    const factory = new Function(
      "React",
      "ReactDOM",
      `${code}\n;return typeof __default !== "undefined" ? __default : (typeof App !== "undefined" ? App : undefined);`,
    );
    component = factory(React, { createRoot });
  } catch (err) {
    reportError(`Compile error: ${(err as Error)?.message ?? String(err)}`, (err as Error)?.stack);
    return;
  }
  if (typeof component !== "function") {
    reportError("No component found. Export a default React component (e.g. `export default function App() { … }`).");
    return;
  }
  try {
    createRoot(root).render(React.createElement(component as React.ComponentType));
  } catch (err) {
    reportError(`Render error: ${(err as Error)?.message ?? String(err)}`, (err as Error)?.stack);
  }
}
sandboxWindow.__mount = mount;

// Surface uncaught errors from the rendered component (event handlers, effects).
window.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) =>
  reportError(`Unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`),
);

// Auto-mount: render the first `<script type="text/jsx">` into `#root`. The
// phase-2 srcDoc builder emits exactly this shape.
function boot() {
  const root = document.getElementById("root");
  const source = document.querySelector<HTMLScriptElement>('script[type="text/jsx"]');
  if (root && source) mount(source.textContent ?? "", root);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
