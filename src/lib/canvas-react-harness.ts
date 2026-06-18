// Builds the <iframe srcdoc> document that previews a React artifact. The doc
// embeds the component source in a <script type="text/jsx"> and loads the
// offline sandbox runtime (public/sandbox/react-runtime.js, built in prebuild),
// which transpiles + mounts it. Pure + DOM-free so it's unit-testable.
//
// Isolation is unchanged from the HTML path: the result runs in an
// <iframe sandbox="allow-scripts"> (no allow-same-origin). The runtime asset is
// same-origin to our server but the iframe stays an opaque origin — loading a
// script is allowed; reaching Cave's DOM/cookies is not.

/** Absolute path (resolved against the parent's base URL inside about:srcdoc). */
export const SANDBOX_RUNTIME_SRC = "/sandbox/react-runtime.js";

/**
 * Neutralize `</script>` so component source can't break out of the embedding
 * <script> tag. (`<\/script>` is equivalent JS inside the tag.)
 */
export function escapeForScriptTag(code: string): string {
  // Insert a backslash before the slash, preserving the original case so the
  // component's string contents aren't altered.
  return (typeof code === "string" ? code : "").replace(/<\/(script>)/gi, "<\\/$1");
}

/** Frame React component source into a full preview document. */
export function buildReactSrcDoc(code: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>",
    "  :root { color-scheme: light dark; }",
    "  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }",
    "</style>",
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script type="text/jsx">${escapeForScriptTag(code)}</script>`,
    `<script src="${SANDBOX_RUNTIME_SRC}"></script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
