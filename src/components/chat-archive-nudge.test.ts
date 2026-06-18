// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-text contract test for the in-chat archive nudge: the banner that
// surfaces inside a chat tied to a task once that task's execution lifecycle
// reaches `completed`. We assert the component's API, the chat-view's
// import/state/handler/render wiring, and the lifecycle->session->nudge chain
// the user actually sees — so a future refactor that quietly drops the inline
// surface fails CI instead of just disappearing the feature.

const componentSrc = readFileSync(
  new URL("./chat-archive-nudge.tsx", import.meta.url),
  "utf8",
);
const chatViewSrc = readFileSync(
  new URL("./chat-view.tsx", import.meta.url),
  "utf8",
);
const libSrc = readFileSync(
  new URL("../lib/chat-archive-nudge.ts", import.meta.url),
  "utf8",
);

// ── Component surface ─────────────────────────────────────────────────────
assert.match(
  componentSrc,
  /export function ChatArchiveNudge\(/,
  "ChatArchiveNudge is exported from chat-archive-nudge.tsx",
);
assert.match(
  componentSrc,
  /taskTitle: string;[\s\S]*onArchive: \(\) => void;[\s\S]*onDismiss: \(\) => void;[\s\S]*archiving\?: boolean;/,
  "ChatArchiveNudgeProps exposes taskTitle / onArchive / onDismiss / archiving",
);
assert.match(
  componentSrc,
  /role="status"/,
  "renders as a live-status region so screen readers announce it",
);
assert.match(
  componentSrc,
  /aria-label=\{`Ready to archive: \$\{title\}`\}/,
  "labels itself with the linked task title so the announcement is specific",
);
assert.match(
  componentSrc,
  /Archive chat/,
  "primary CTA reads 'Archive chat'",
);
// X-close + secondary Dismiss both wired to onDismiss so the user can quit
// from either affordance.
assert.match(
  componentSrc,
  /aria-label="Dismiss archive nudge"[\s\S]*onClick=\{onDismiss\}/,
  "header close button is wired to onDismiss",
);
// Disabled state during the archive request.
assert.match(
  componentSrc,
  /\{archiving \? "Archiving…" : "Archive chat"\}/,
  "primary CTA label flips while archiving",
);
// Icon must come from the icon whitelist — ph:archive-box is NOT registered.
assert.doesNotMatch(
  componentSrc,
  /ph:archive-box/,
  "does NOT use ph:archive-box (not in ICON_NAMES); use ph:archive instead",
);
assert.match(componentSrc, /ph:archive/, "uses the whitelisted ph:archive icon");

// ── Lib helper surface ────────────────────────────────────────────────────
for (const symbol of [
  "shouldShowChatArchiveNudge",
  "isChatArchiveNudgeDismissed",
  "markChatArchiveNudgeDismissed",
  "chatArchiveNudgeDismissKey",
]) {
  assert.match(
    libSrc,
    new RegExp(`export (function|const) ${symbol}\\b`),
    `chat-archive-nudge.ts exports ${symbol}`,
  );
}

// ── chat-view wiring ─────────────────────────────────────────────────────
assert.match(
  chatViewSrc,
  /import \{ ChatArchiveNudge \} from "@\/components\/chat-archive-nudge"/,
  "chat-view imports the ChatArchiveNudge component",
);
assert.match(
  chatViewSrc,
  /import \{[\s\S]*isChatArchiveNudgeDismissed,[\s\S]*markChatArchiveNudgeDismissed,[\s\S]*shouldShowChatArchiveNudge,[\s\S]*\} from "@\/lib\/chat-archive-nudge"/,
  "chat-view imports all three nudge helpers from the lib",
);
assert.match(
  chatViewSrc,
  /\[archiveNudgeDismissed, setArchiveNudgeDismissed\] = useState<boolean>/,
  "chat-view holds the per-session dismiss flag in state",
);
assert.match(
  chatViewSrc,
  /\[archivingChat, setArchivingChat\] = useState\(false\)/,
  "chat-view tracks an in-flight archive request",
);
// Re-sync the dismiss flag when the active sessionId changes.
assert.match(
  chatViewSrc,
  /setArchiveNudgeDismissed\(isChatArchiveNudgeDismissed\(sessionId \?\? "", window\.localStorage\)\)/,
  "chat-view re-reads the per-session dismiss flag whenever sessionId changes",
);
// archiveChat handler PATCHes /api/sessions/[id] with archived:true and
// triggers the existing onSessionsChanged + onBack flow.
assert.match(
  chatViewSrc,
  /const archiveChat = useCallback\(async \(\) => \{[\s\S]*\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}[\s\S]*archived: true[\s\S]*onSessionsChanged\?\.\(\)[\s\S]*onBack\?\.\(\)/,
  "archiveChat PATCHes the session as archived and tells the host to refresh + leave",
);
assert.match(
  chatViewSrc,
  /const dismissArchiveNudge = useCallback\([\s\S]*markChatArchiveNudgeDismissed\(sessionId, window\.localStorage\)/,
  "dismissArchiveNudge persists the per-session flag to localStorage",
);
// Banner is mounted inside the chat thread, just before tailRef so the new
// turn appears below it visually.
assert.match(
  chatViewSrc,
  /shouldShowChatArchiveNudge\(\{\s*taskLifecycle: linkedContext\?\.task\?\.lifecycle \?\? null,\s*sessionArchived: Boolean\(session\?\.archived_at\),\s*dismissed: archiveNudgeDismissed,\s*\}\) \? \(\s*<ChatArchiveNudge[\s\S]*taskTitle=\{linkedContext\?\.task\?\.title \?\? ""\}[\s\S]*onArchive=\{\(\) => void archiveChat\(\)\}[\s\S]*onDismiss=\{dismissArchiveNudge\}[\s\S]*archiving=\{archivingChat\}/,
  "chat-view renders ChatArchiveNudge gated on shouldShowChatArchiveNudge with the live task lifecycle, session.archived, and dismissed",
);

console.log("chat-archive-nudge.test.ts ok");
