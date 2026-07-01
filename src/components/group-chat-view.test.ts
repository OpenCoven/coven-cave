// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
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
    /className="cave-group-chat-turn cave-group-chat-turn--user"[\s\S]*cave-group-chat-avatar cave-group-chat-avatar--human[\s\S]*cave-group-chat-name[\s\S]*You[\s\S]*cave-group-chat-badge cave-group-chat-badge--op[\s\S]*formatChatRecency\(user\.createdAt, dtPrefs\)/,
    "group user turns render a Discord-like avatar/name/OP/recency header",
  );
  assert.match(
    view,
    /className="cave-group-chat-turn cave-group-chat-turn--assistant"[\s\S]*<FamiliarAvatar familiar=\{f\} size="xl"[\s\S]*cave-group-chat-name[\s\S]*f\?\.display_name[\s\S]*formatChatRecency\(r\.createdAt, dtPrefs\)/,
    "group assistant replies render large avatars, author names, and recency",
  );
});

test("Group Chat is wired into navigation", () => {
  assert.match(mode, /\| "groupchat"/, "groupchat is a valid WorkspaceMode");
  assert.match(sidebar, /id: "groupchat", label: "Group"/, "sidebar exposes the Group surface");
  assert.match(workspace, /groupchat: "Group Chat"/, "groupchat mode has a title");
  assert.match(
    workspace,
    /mode === "groupchat" \?\s*\(\s*<GroupChatView/,
    "workspace renders GroupChatView for the groupchat mode",
  );
  assert.match(
    workspace,
    /import \{ GroupChatView \} from "@\/components\/group-chat-view"/,
    "workspace imports GroupChatView",
  );
});
