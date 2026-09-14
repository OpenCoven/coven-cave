#!/usr/bin/env node
// Tombstone for stale hooks. Local classification is not deletion authority.

import { fileURLToPath } from "node:url";

export function main() {
  console.error(
    "worktree-session-exit-retirement: retired by issue #5399; no status probe or Git operation was attempted.\n" +
    "Use Branch Curator with current authorization and the complete deletion proof.",
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
