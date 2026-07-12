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
 */
export function ThemeScript({ preferences }: { preferences: CavePreferences }) {
  return (
    <>
      <script
        id="cave-preferences-bootstrap"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: serializePreferencesBootstrap(preferences) }}
      />
      <script id="theme-init" src="/scripts/theme-init.js" />
    </>
  );
}
