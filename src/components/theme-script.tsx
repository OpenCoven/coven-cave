import type { CavePreferences } from "@/lib/preferences-schema";

/** JSON safe to place inside a non-executable application/json script element. */
export function serializePreferencesBootstrap(preferences: CavePreferences): string {
  return JSON.stringify(preferences)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Server-provided preferences followed by a synchronous, parser-blocking boot
 * script. The external script applies appearance before the first paint and
 * exposes the same snapshot to the post-hydration client store.
 *
 * ## Do not "fix" the React dev warning by reaching for next/script
 *
 * React logs this in development against the `theme-init` tag below:
 *
 *   Encountered a script tag while rendering React component. Scripts inside
 *   React components are never executed when rendering on the client.
 *
 * It is dev-only noise over a working path. The string lives exclusively in
 * react-dom's `*.development.js` bundles, so production never emits it, and the
 * tag does exactly what it claims: the browser parses it in <head> on the SSR
 * response and runs it parser-blocking, before first paint.
 *
 * `next/script` with `strategy="beforeInteractive"` looks like the obvious
 * remedy and is actively harmful here. Measured on Next 16.3.3, it emits no
 * parser-blocking tag at all - only a preload hint plus a queue push:
 *
 *   <link rel="preload" href="/scripts/theme-init.js" as="script"/>
 *   <script>(self.__next_s=self.__next_s||[]).push(["/scripts/theme-init.js",...])</script>
 *
 * The file is then fetched and run when Next's client runtime drains that
 * queue, which is after hydration begins and therefore after first paint. The
 * result is a guaranteed flash of the wrong appearance, in production, to
 * silence a message that only ever appeared in development.
 *
 * Two further constraints any future change has to satisfy:
 *
 * 1. Order is load-bearing. `theme-init.js` reads `#cave-preferences-bootstrap`
 *    synchronously at the top of its IIFE, inside a `try/catch` that swallows
 *    failure. If the initializer runs before that element exists, it silently
 *    falls back and the first paint is wrong with nothing logged.
 * 2. React accepts the inert `type="application/json"` element above precisely
 *    because it carries `dangerouslySetInnerHTML`; only the `src` form warns.
 *    Inlining the initializer the same way would work and would even save a
 *    parser-blocking round trip, but it costs ~5.7 KB gzipped on every HTML
 *    response and gives up HTTP caching of a file that is otherwise immutable.
 *    That is a deliberate trade, not a drive-by.
 *
 * See issue #5441 for the full measurements.
 */
export function ThemeScript({
  preferences,
  authoritative = true,
}: {
  preferences: CavePreferences;
  authoritative?: boolean;
}) {
  return (
    <>
      <script
        id="cave-preferences-bootstrap"
        type="application/json"
        data-authoritative={authoritative ? "true" : "false"}
        dangerouslySetInnerHTML={{ __html: serializePreferencesBootstrap(preferences) }}
      />
      <script id="theme-init" src="/scripts/theme-init.js" />
    </>
  );
}
