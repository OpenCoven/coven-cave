"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders `children` only after mount.
 *
 * The vendored Beautiful UI set is not server-renderable, and that is upstream's
 * design rather than something the port introduced: `InsightCards` computes
 * `Date.now()` at module scope, and several components drive themselves with
 * self-running demo loops. Both produce markup that legitimately differs between
 * the server pass and the client pass, so React reports a hydration mismatch and
 * the dev overlay shows an error on a page where nothing is actually wrong.
 *
 * SSR buys these components nothing — every one is a `"use client"` showcase
 * whose content is animation — so the fix is to not server-render them at all
 * rather than to patch 19 files away from upstream.
 *
 * A real adoption has to confront this properly: a component parameterized for a
 * live surface should take its time-derived values as props (or compute them in
 * an effect) so the surface stays server-renderable. See docs/beautiful-ui.md.
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}
