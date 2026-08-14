// The offline Content-Security-Policy stamped into every Canvas artifact
// preview (HTML and React alike).
//
// The `<iframe sandbox="allow-scripts">` around a preview is an ORIGIN
// boundary: the frame is opaque, so artifact code cannot touch Cave's DOM,
// cookies, or storage. It is not a NETWORK boundary — until this module, a
// sketch could still `fetch()` an arbitrary host, pull a remote script into its
// own sandbox, or beacon out through an `<img>` URL. Every generation prompt
// asks for a self-contained, network-free document; this makes the browser
// enforce it rather than trusting a model to have complied.
//
// Two properties are load-bearing:
//
// 1. `'self'` is USELESS here. The preview document's own origin is opaque, so
//    a `'self'` source expression matches nothing and would block the very
//    runtime the React path loads from `/sandbox/`. The app's real origin has
//    to be named explicitly, which is why the builders take one.
// 2. No origin ⇒ NO POLICY. When the origin can't be resolved (a unit test, a
//    non-browser caller), we emit nothing rather than a policy that would blank
//    every React preview. A half-applied lockdown that silently breaks the
//    surface is worse than the status quo it replaces; the app itself is fully
//    client-rendered (`lazy-surfaces.tsx` mounts these with `ssr: false`), so
//    the origin is always available where it matters.

/** Marker attribute so a stamped policy is identifiable in tests and DevTools. */
export const PREVIEW_CSP_MARKER = "cave-canvas-preview-csp";

/** True for a source expression we can safely inline into a policy: a real
 *  scheme://host origin with no quote, whitespace, or delimiter that could
 *  break out of the directive (or out of the meta tag's attribute). */
function isUsableOrigin(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^\s'";<>]+$/i.test(value);
}

/**
 * The origin the sandbox assets (`/sandbox/react-runtime.js`, `tailwind.js`)
 * are served from — the app's own origin, since a `srcdoc` document resolves
 * absolute paths against its parent's base URL. Returns "" when there's no
 * usable origin (Node, an opaque context), which callers read as "no policy".
 */
export function resolveSandboxAssetOrigin(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (typeof origin !== "string") return "";
  const trimmed = origin.trim();
  // A sandboxed document reports its own origin as the literal "null".
  if (!trimmed || trimmed === "null") return "";
  return isUsableOrigin(trimmed) ? trimmed : "";
}

/**
 * Build the policy for a preview served alongside `assetOrigin`. Returns "" for
 * an unusable origin (see the module comment — that means "stamp nothing").
 */
export function buildPreviewCsp(assetOrigin: string = resolveSandboxAssetOrigin()): string {
  const origin = typeof assetOrigin === "string" ? assetOrigin.trim() : "";
  if (!origin || !isUsableOrigin(origin)) return "";
  return [
    // Everything not named below is denied outright, so a fetch directive we
    // forget fails closed instead of staying wide open.
    "default-src 'none'",
    // The offline runtime + Tailwind engine load from our origin; the
    // artifact's own inline <script> needs 'unsafe-inline', and the JSX
    // transpiler evaluates the component through `new Function` ('unsafe-eval').
    // Both are inherent to running untrusted code in the sandbox — the opaque
    // origin, not the script policy, is what contains it.
    `script-src ${origin} 'unsafe-inline' 'unsafe-eval'`,
    // Tailwind's browser engine injects <style> elements as it scans the DOM.
    `style-src ${origin} 'unsafe-inline'`,
    // Inline art only. A remote image URL is a GET beacon in disguise, which is
    // the cheapest exfil channel a generated sketch has.
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    // No fetch/XHR/WebSocket/sendBeacon to anywhere, including our own origin:
    // a preview has nothing legitimate to ask Cave's API for.
    "connect-src 'none'",
    // A form POST navigates, so it escapes connect-src; deny it separately.
    "form-action 'none'",
    // Nested browsing contexts and workers would each get their own policy
    // scope, so they stay off the table entirely.
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    // Without this, a `<base href>` in the artifact could re-point every
    // relative URL — including the sandbox runtime path — at another host.
    "base-uri 'none'",
  ].join("; ");
}

/** The meta tag carrying `policy`, or "" when there's no policy to stamp. */
export function previewCspMetaTag(assetOrigin?: string): string {
  const policy = buildPreviewCsp(assetOrigin);
  if (!policy) return "";
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" data-${PREVIEW_CSP_MARKER}="1" />`;
}

/** Offset just past a leading `<!doctype …>` (comments allowed before it), or
 *  null when the document doesn't start with one. Mirrors the inspector's own
 *  placement rule so the two injections agree on where a document begins. */
function leadingDoctypeEnd(source: string): number | null {
  let offset = 0;
  while (offset < source.length) {
    while (offset < source.length && source[offset].trim() === "") offset += 1;
    if (!source.startsWith("<!--", offset)) break;
    const commentEnd = source.indexOf("-->", offset + 4);
    if (commentEnd === -1) return null;
    offset = commentEnd + 3;
  }
  if (source.slice(offset, offset + 9).toLowerCase() !== "<!doctype") return null;
  const doctypeEnd = source.indexOf(">", offset + 9);
  return doctypeEnd === -1 ? null : doctypeEnd + 1;
}

/**
 * Stamp the policy into `html`, immediately after any leading doctype.
 *
 * A `http-equiv` policy only governs what the parser meets AFTER it, so this
 * must run LAST — after the inspector injection — to stay ahead of every other
 * script in the document. Markup before `<html>` is hoisted into the implicit
 * `<head>` by the parser, which is exactly where the meta needs to land.
 */
export function injectPreviewCsp(html: string, assetOrigin?: string): string {
  const source = typeof html === "string" ? html : "";
  const meta = previewCspMetaTag(assetOrigin);
  if (!meta) return source;
  const splitAt = leadingDoctypeEnd(source);
  if (splitAt === null) return `${meta}${source}`;
  return `${source.slice(0, splitAt)}${meta}${source.slice(splitAt)}`;
}
