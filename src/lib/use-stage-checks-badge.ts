"use client";

/**
 * Failing-checks badge signal for the code rail (cave-fpqx.12; replay fix
 * cave-r0gt). The chat stage header owns the stage snapshot and PUBLISHES the
 * failing signal through publishStageChecks — which records it in a
 * module-level store and broadcasts STAGE_CHECKS_EVENT. Listeners initialize
 * FROM THE STORE at mount, so a rail that mounts after the broadcast (it was
 * collapsed when checks went red — the exact moment the user clicks the
 * reopen strip) still shows the current state; the event keeps already-
 * mounted listeners live. Roots are normalized on both sides so dispatcher
 * and listener derivations can't drift on a trailing slash.
 */

import { useEffect, useState } from "react";
import { STAGE_CHECKS_EVENT } from "@/lib/stage-model";

function normalizeRoot(root: string): string {
  let out = root;
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

// Current failing-signal per project root — the replay source for listeners
// that mount after the broadcast. Module-level, session-lifetime.
const stageChecksState = new Map<string, boolean>();

/** Publish the failing signal for a root: record for late-mounting listeners
 *  and broadcast for live ones. The stage header is the only producer. */
export function publishStageChecks(projectRoot: string, failing: boolean): void {
  const root = normalizeRoot(projectRoot);
  stageChecksState.set(root, failing);
  window.dispatchEvent(new CustomEvent(STAGE_CHECKS_EVENT, { detail: { projectRoot: root, failing } }));
}

export function useStageChecksBadge(projectRoot: string | null | undefined): boolean {
  const root = projectRoot ? normalizeRoot(projectRoot) : null;
  // Initialize from the store so a listener mounting after the broadcast
  // reads the current state instead of defaulting to false (cave-r0gt).
  const [failing, setFailing] = useState(() => (root ? (stageChecksState.get(root) ?? false) : false));
  useEffect(() => {
    if (!root) {
      setFailing(false);
      return;
    }
    setFailing(stageChecksState.get(root) ?? false);
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { projectRoot?: string; failing?: boolean } | undefined;
      if (d?.projectRoot === root) setFailing(Boolean(d.failing));
    };
    window.addEventListener(STAGE_CHECKS_EVENT, handler);
    return () => window.removeEventListener(STAGE_CHECKS_EVENT, handler);
  }, [root]);
  return failing;
}
