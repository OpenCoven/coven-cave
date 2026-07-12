// @ts-nocheck
// Source pins for the convo-thread PR-status signal and merged-chat
// auto-archive wiring: chat list rows swap the plain status dot for a GitHub
// PR-state icon when the thread's work reached a pull request; the sessions
// list enriches rows with branch PR context (never blocking the poll) and
// auto-archives chats whose PR merged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const listRoute = readFileSync(
  new URL("../app/api/sessions/list/route.ts", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const caveConfig = readFileSync(new URL("../lib/cave-config.ts", import.meta.url), "utf8");

// ── Chat list: PR badge replaces the status dot where applicable ─────────────
assert.match(
  chatList,
  /const prStatus = sessionPrStatus\(s\.pullRequest\);/,
  "each row derives its PR status from the session's pullRequest context",
);
assert.match(
  chatList,
  /\{prStatus \? \(/,
  "the PR badge renders only when PR context exists (dot otherwise)",
);
assert.match(
  chatList,
  /data-pr-state=\{prStatus\.key\}/,
  "the badge carries data-pr-state for state-colored styling",
);
assert.match(
  chatList,
  /e\.stopPropagation\(\);\s*\n\s*if \(onOpenUrl\) onOpenUrl\(prStatus\.url\);/,
  "clicking the badge opens the PR (in-app browser when wired) without opening the chat",
);
assert.match(
  chatList,
  /window\.open\(prStatus\.url, "_blank", "noopener,noreferrer"\)/,
  "without an in-app opener the badge falls back to a new tab",
);
assert.match(
  chatRouter,
  /onOpenUrl=\{onOpenUrl\}\n\s+onOpen=/s,
  "the chat router hands its in-app URL opener to the chat list",
);

// ── Badge styling: GitHub's state colors ─────────────────────────────────────
for (const state of ["merged", "closed", "draft"]) {
  assert.match(
    css,
    new RegExp(`\\.chat-list-pr-badge\\[data-pr-state="${state}"\\]`),
    `globals.css styles the ${state} PR state`,
  );
}

// ── Sessions list: branch PR enrichment never blocks the poll ────────────────
assert.match(
  listRoute,
  /branchPrCache\.get\(root, branch\)/,
  "the list route reads PR context from the stale-while-revalidate cache",
);
assert.match(
  listRoute,
  /applyMergedPrAutoArchive\(\s*enrichSessionsWithGitContext\(scoped\),/,
  "the merged-PR sweep runs over the enriched rows before the payload returns",
);
assert.match(
  listRoute,
  /process\.env\[MERGED_AUTO_ARCHIVE_DISABLE_ENV\] === "1"/,
  "the sweep honors the opt-out env",
);
assert.match(
  listRoute,
  /resolveArchiveNudges\(d\.sessionId\)/,
  "swept chats clear their pending archive nudges",
);

// ── One-shot state: summoning an auto-archived chat sticks ───────────────────
assert.match(
  caveConfig,
  /mergedPrAutoArchived: Record<string, string>;/,
  "cave state records which PR merge already archived each session",
);
assert.match(
  caveConfig,
  /export async function archiveSessionsForMergedPrs\(/,
  "the batch archive helper exists in cave-config",
);

// ── Workspace: server PR state wins over GitHub-task lifecycle words ─────────
assert.match(
  workspace,
  /pullRequest: session\.pullRequest \?\? \{/,
  "attachGitHubTaskContext never clobbers server-enriched PR state",
);
