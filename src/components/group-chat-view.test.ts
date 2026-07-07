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
  assert.match(view, /className="cave-next-paths/, "renders the next-paths chip row");
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
    /\{\s*id:\s*"coven",\s*label:\s*"Group"/,
    "ChatSurface exposes a Group tab",
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
  // Smart autoscroll: never yank a reader who scrolled up; offer a jump pill.
  assert.match(view, /stickToBottomRef/, "tracks whether the transcript is pinned to the bottom");
  assert.match(view, /onTranscriptScroll/, "recomputes stickiness on scroll");
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
});
