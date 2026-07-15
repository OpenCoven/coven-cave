// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const mode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

test("GroupChatView broadcasts via /api/chat/send and reuses pure helpers", () => {
  assert.match(view, /export function GroupChatView/, "exports GroupChatView");
  // Fan-out: one /api/chat/send per participant carrying the per-familiar id.
  assert.match(view, /fetch\("\/api\/chat\/send"/, "sends through the chat bridge");
  assert.match(view, /familiarId: reply\.familiarId/, "each stream targets one familiar");
  assert.match(view, /Promise\.all\(\s*replies\.map/, "fans out to every participant in parallel");
  // Reuses the tested pure reducers rather than re-parsing inline.
  assert.match(view, /applyGroupEvent|parseSseBuffer/, "uses the pure stream reducers");
  // Per-familiar session pinning so each thread resumes.
  assert.match(view, /recordSession\(group\.id, reply\.familiarId/, "pins each familiar's session id");
  // A Stop control aborts the in-flight broadcast.
  assert.match(view, /abortRef\.current\?\.abort\(\)/, "Stop aborts the broadcast");
  // Injects the coven roster into each send so a familiar knows who else is present.
  assert.match(view, /renderCovenRoundtablePrompt\(\{/, "builds the per-familiar roundtable prompt");
  assert.match(view, /receivingFamiliarId: r\.familiarId/, "marks the receiving familiar in prompt context");
  assert.match(view, /targeted: mentioned\.length > 0/, "tells the prompt whether the user targeted this reply");
  assert.doesNotMatch(view, /renderCovenContext\(contextTurns, r\.familiarId/, "default group chat does not relay peer replies");
  assert.doesNotMatch(view, /const shouldRelay = mentioned\.length === 0 && replies\.length > 1/, "full-coven broadcasts no longer switch to sequential relay");
  // Strips the piggybacked next-paths block (visible) and surfaces the parsed
  // lines (suggestions) so control markup never leaks and chips can render.
  assert.match(
    view,
    /const \{ visible: visibleText, suggestions \} = extractNextPaths\(r\.text\)/,
    "strips the next-paths block and parses suggestions from coven replies",
  );
  // Parsed suggestions render as click-to-send chips that broadcast the line.
  assert.match(
    view,
    /className="cave-next-paths mt-1\.5" data-count=\{suggestions\.length\}/,
    "renders the next-paths chip row, stamping its count for the uniform-rows layout",
  );
  assert.match(view, /onClick=\{\(\) => void broadcast\(s\)\}/, "clicking a chip broadcasts the suggestion");
});

test("@mentions target a subset of the coven", () => {
  // Send routes to mentioned familiars only, falling back to the full roster.
  assert.match(view, /const mentioned = parseMentions\(text, mentionable\)/, "parses @mentions on send");
  assert.match(
    view,
    /mentioned\.length > 0 \? group\.familiarIds\.filter/,
    "targets only mentioned familiars, else broadcasts to all",
  );
  assert.match(view, /targetFamiliarIds: mentioned\.length > 0/, "records the targeted ids on the user turn");
  assert.match(view, /replies: GroupReply\[\] = targetIds\.map/, "only the targets reply");
  // Composer autocomplete reuses the tested pure helpers.
  assert.match(view, /findActiveMention\(el\.value/, "detects the active mention token");
  assert.match(view, /matchMentions\(mention\.query, mentionable\)/, "filters the roster by the query");
  assert.match(view, /applyMention\(draft, mention\.start, mention\.query/, "inserts the chosen familiar");
});

test("Group chat transcript uses avatar author rows with recency", () => {
  assert.match(
    view,
    /import \{ formatChatRecency, useDateTimePrefs \} from "@\/lib\/datetime-format"/,
    "group chat imports the shared chat recency formatter",
  );
  assert.match(
    view,
    /const dtPrefs = useDateTimePrefs\(\)/,
    "group chat reads date/time preferences for message recency",
  );
  assert.match(
    view,
    /className="cave-group-chat-turn cave-group-chat-turn--user"[\s\S]*cave-group-chat-avatar cave-group-chat-avatar--human[\s\S]*cave-group-chat-name[\s\S]*operatorDisplayName[\s\S]*cave-group-chat-badge cave-group-chat-badge--op[\s\S]*formatChatRecency\(user\.createdAt, dtPrefs\)/,
    "group user turns render a Discord-like avatar/profile-name/OP/recency header",
  );
  assert.match(
    view,
    /className="cave-group-chat-turn cave-group-chat-turn--assistant"[\s\S]*<FamiliarAvatar familiar=\{f\} size="xl"[\s\S]*cave-group-chat-name[\s\S]*f\?\.display_name[\s\S]*formatChatRecency\(r\.createdAt, dtPrefs\)/,
    "group assistant replies render large avatars, author names, and recency",
  );
});

test("Group Chat is a tab inside the Chat surface, not a standalone page", () => {
  // The mode still exists purely as a redirect target for legacy deep links.
  assert.match(mode, /\| "groupchat"/, "groupchat stays a valid WorkspaceMode for redirects");
  assert.match(workspace, /groupchat: "Group Chat"/, "groupchat keeps a title entry");

  // The standalone page is retired: the Workspace no longer imports or renders
  // GroupChatView, and redirects the legacy mode into the Chat surface's tab.
  assert.doesNotMatch(
    workspace,
    /import \{ GroupChatView \} from "@\/components\/group-chat-view"/,
    "workspace no longer imports GroupChatView (it moved into ChatSurface)",
  );
  assert.doesNotMatch(
    workspace,
    /mode === "groupchat" \?\s*\(\s*<GroupChatView/,
    "workspace no longer renders a standalone GroupChatView surface",
  );
  assert.match(
    workspace,
    /if \(next === "groupchat"\)[\s\S]*setModeRaw\("chat"\)[\s\S]*CHAT_OPEN_COVEN_EVENT/,
    "workspace redirects the groupchat mode into chat + opens the coven tab",
  );

  // The standalone left-nav destination is gone.
  assert.doesNotMatch(
    sidebar,
    /id: "groupchat", label: "Group"/,
    "sidebar no longer exposes a standalone Group destination",
  );

  // ChatSurface owns Group Chat now: it imports GroupChatView, offers a Group
  // scope tab, listens for the open-coven event, and renders it for that scope.
  assert.match(
    chatSurface,
    /import \{ GroupChatView \} from "@\/components\/group-chat-view"/,
    "ChatSurface imports GroupChatView",
  );
  assert.match(
    chatSurface,
    /chat-scope-group-btn[\s\S]*onClick=\{\(\) => setScope\("coven"\)\}/,
    "ChatSurface exposes Group as a demoted icon-button (not a co-equal tab) that opens the coven scope (cave-xsq.5)",
  );
  assert.match(
    chatSurface,
    /scope === "coven" \?[\s\S]*<GroupChatView/,
    "ChatSurface renders GroupChatView for the coven scope",
  );
  assert.match(
    chatSurface,
    /addEventListener\(CHAT_OPEN_COVEN_EVENT/,
    "ChatSurface opens the Group tab when the workspace redirects the legacy mode",
  );
});

test("Group chat is a world-class chat surface (a11y + resilience)", () => {
  // Smart autoscroll (cave-o8si): intent-based release via the shared hook —
  // scrolling up detaches, only the true bottom re-attaches. No position
  // threshold (the old `< 48` re-stick yanked readers hovering near bottom).
  assert.match(view, /useStickToBottom\(scrollRef, \{/, "follow behavior comes from the shared intent-release hook");
  assert.match(view, /stuckRef: stickToBottomRef/, "tracks whether the transcript is pinned to the bottom");
  assert.doesNotMatch(view, /clientHeight < 48/, "the position-threshold re-stick stays gone");
  assert.match(view, /jumpToLatest/, "offers a jump-to-latest affordance");
  // Transcript is an accessible log region.
  assert.match(view, /role="log"/, "transcript is exposed as a log region");
  // Destructive delete is confirmed and outcomes are announced to AT.
  assert.match(view, /const confirm = useConfirm\(\)/, "coven delete is guarded by a confirm dialog");
  assert.match(view, /requestDeleteGroup/, "delete routes through the confirm wrapper");
  assert.match(view, /const \{ announce \} = useAnnouncer\(\)/, "broadcast outcomes are announced");
  // Coven rows are real buttons (keyboard-accessible), with aria-current.
  assert.match(view, /aria-current=\{isActive \? "true" : undefined\}/, "the active coven row is marked aria-current");
  // A failed familiar reply can be retried in place.
  assert.match(view, /const retryReply = useCallback/, "failed replies can be retried");
  assert.match(view, /onClick=\{\(\) => void retryReply\(r\)\}/, "the Retry control re-runs a single familiar");

  // cave-z4s (1): a broadcast streams every familiar concurrently, so recordSession
  // must compose on the LATEST groups via a functional setGroups (persisting
  // inside the updater) rather than reading the render-synced groupsRef — else
  // concurrent session events dropped each other's session ids (last write wins).
  assert.match(
    view,
    /const recordSession = useCallback\([\s\S]*?setGroups\(\(prev\) => \{[\s\S]*?const next = upsertGroup\(prev, setGroupSession\([\s\S]*?saveGroups\(next\);[\s\S]*?return next;[\s\S]*?\}\);[\s\S]*?onSessionStarted\?\.\(sessionId\);\s*\n\s*\},\s*\n?\s*\[onSessionStarted\]/,
    "recordSession updates groups functionally + persists inside the updater and no longer reads the stale groupsRef (race-safe)",
  );

  // cave-z4s (2): switching covens aborts the in-flight broadcast (no leaked
  // stream / stuck bubbles), and both stream-cleanup paths only clear the shared
  // abort/busy wiring when they still own the active controller.
  assert.match(
    view,
    /swap transcript when the active group changes[\s\S]*?abortRef\.current\?\.abort\(\);\s*\n\s*abortRef\.current = null;\s*\n\s*setBusy\(false\);/,
    "changing the active coven aborts any in-flight broadcast before loading the new transcript",
  );
  {
    const guarded = view.match(
      /if \(abortRef\.current === controller\) \{\s*\n\s*abortRef\.current = null;\s*\n\s*setBusy\(false\);\s*\n\s*\}/g,
    );
    assert.ok(
      guarded && guarded.length === 2,
      "both broadcast and retryReply guard their abort/busy cleanup on still owning the controller",
    );
  }

  // cave-lh78: persistence is throttled (one localStorage write per interval,
  // not one per streaming token), owner-guarded (the stale commit right after
  // a coven switch must not write the old transcript under the new key), and
  // flushed on switch/unmount so no settled tail is lost.
  assert.match(
    view,
    /if \(!activeId \|\| transcriptOwnerRef\.current !== activeId\) return;/,
    "the persist effect skips saves until the swap effect has loaded the active coven's transcript",
  );
  assert.match(
    view,
    /pendingSaveRef\.current = \{ groupId: activeId, turns: transcript \};[\s\S]{0,240}?window\.setTimeout\(/,
    "persistence coalesces streaming updates behind a timer instead of writing per token",
  );
  assert.match(
    view,
    /flushPendingSave\(\);\s*\n\s*transcriptOwnerRef\.current = activeId;/,
    "switching covens flushes the outgoing coven's pending save, then adopts ownership",
  );
  assert.match(
    view,
    /useEffect\(\(\) => \(\) => flushPendingSave\(\), \[flushPendingSave\]\);/,
    "unmount flushes the pending transcript save",
  );
  assert.match(
    view,
    /if \(pendingSaveRef\.current\?\.groupId === id\) \{/,
    "deleting a coven drops its queued save so a later flush cannot resurrect the transcript",
  );
  // Thread grouping is a single pass (a Map keyed by replyTo), not a nested
  // filter per user turn — it recomputes on every streaming token.
  assert.match(
    view,
    /const repliesByUser = new Map<string, GroupReply\[\]>\(\);/,
    "threads are grouped in one pass over the transcript",
  );
  assert.doesNotMatch(
    view,
    /replies: transcript\.filter\(/,
    "the O(userTurns × transcript) per-token grouping shape must not return",
  );

  // cave-hkls: the Enter that confirms an IME candidate (CJK input) must never
  // broadcast the draft, pick a mention, or commit a rename — ChatView has the
  // same guard on its composer.
  assert.match(
    view,
    /if \(e\.nativeEvent\.isComposing\) return;[\s\S]{0,220}?if \(mentionOpen\) \{/,
    "the composer ignores keydowns while an IME composition is in progress",
  );
  assert.match(
    view,
    /if \(e\.nativeEvent\.isComposing\) return;\s*\n\s*if \(e\.key === "Enter"\) \(e\.target as HTMLInputElement\)\.blur\(\);/,
    "the coven rename input ignores the IME-confirm Enter",
  );

  // cave-mpk4: labeling + keyboard-visible focus + per-coven drafts.
  assert.match(
    view,
    /aria-label="Coven name — Enter saves, Escape cancels"/,
    "the rename input is a labeled text field with discoverable save/cancel",
  );
  assert.match(
    view,
    /aria-label=\{`Rename coven: \$\{activeGroup\.name\}`\}/,
    "the rename affordance names its action for AT, not just via title=",
  );
  {
    // Every button inside the familiar picker and @mention popovers must carry
    // the shared focus-ring class so keyboard focus is visible.
    const options = view.match(/className="(?:focus-ring )?flex w-full items-center gap-2 rounded px-2 py-1\.5 text-left[^"]*"/g) ?? [];
    assert.ok(options.length >= 2, "found the picker and mention option buttons");
    assert.ok(
      options.every((c) => c.includes("focus-ring")),
      "picker and @mention options use the global focus-ring class",
    );
  }
  assert.match(
    view,
    /if \(draftOwnerRef\.current\) draftsByGroupRef\.current\.set\(draftOwnerRef\.current, draftRef\.current\);[\s\S]{0,220}?setDraft\(activeId \? draftsByGroupRef\.current\.get\(activeId\) \?\? "" : ""\);/,
    "switching covens stashes the outgoing draft and restores the incoming one (no cross-coven bleed)",
  );
  assert.match(
    view,
    /draftsByGroupRef\.current\.delete\(id\);/,
    "deleting a coven drops its stashed draft",
  );
});
