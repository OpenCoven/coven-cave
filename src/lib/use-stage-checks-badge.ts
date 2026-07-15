"use client";

/**
 * Failing-checks badge signal for the code rail (cave-fpqx.12, design
 * docs/chat-github-integration.md §6). The chat stage header owns the stage
 * snapshot and broadcasts STAGE_CHECKS_EVENT whenever the failing signal
 * changes; this hook is the listener side, filtered to one project root, so
 * the rail never re-fetches the PR bridge itself.
 */

import { useEffect, useState } from "react";
import { STAGE_CHECKS_EVENT } from "@/lib/stage-model";

export function useStageChecksBadge(projectRoot: string | null | undefined): boolean {
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    setFailing(false);
    if (!projectRoot) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { projectRoot?: string; failing?: boolean } | undefined;
      if (d?.projectRoot === projectRoot) setFailing(Boolean(d.failing));
    };
    window.addEventListener(STAGE_CHECKS_EVENT, handler);
    return () => window.removeEventListener(STAGE_CHECKS_EVENT, handler);
  }, [projectRoot]);
  return failing;
}
