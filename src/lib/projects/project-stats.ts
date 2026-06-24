// Pure glanceable counts for a project's header stat line (running · tasks ·
// sessions). Self-contained (no React) so it unit-tests in isolation.

import type { SessionRow } from "../types.ts";
import { isTaskSession } from "./session-glyph.ts";

export type ProjectStats = {
  total: number;
  running: number;
  tasks: number;
  failed: number;
};

export function projectStats(chats: SessionRow[]): ProjectStats {
  let running = 0;
  let tasks = 0;
  let failed = 0;
  for (const s of chats) {
    if (s.status === "running") running += 1;
    if (s.status === "failed" || s.status === "error") failed += 1;
    if (isTaskSession(s)) tasks += 1;
  }
  return { total: chats.length, running, tasks, failed };
}
