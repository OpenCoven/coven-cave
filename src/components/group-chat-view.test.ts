// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const mode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const transcript = readFileSync(new URL("../lib/group-chat-transcript.ts", import.meta.url), "utf8");
const covenStyles = readFileSync(new URL("../styles/coven-tab.css", import.meta.url), "utf8");

test("GroupChatView schedules Broadcast and Round robin replies through /api/chat/send", () => {
  assert.match(view, /export function GroupChatView/, "exports GroupChatView");
  // Both schedules use one /api/chat/send per participant carrying the
  // per-familiar id. The pure scheduler owns concurrent vs sequential timing.
  assert.match(view, /fetch\("\/api\/chat\/send"/, "sends through the chat bridge");
  assert.match(view, /familiarId: reply\.familiarId/, "each stream targets one familiar");
  assert.match(view, /runCovenReplySchedule\(\{/, "delegates reply timing to the tested scheduler");
  assert.match(view, /mode: group\.responseMode/, "uses the active Coven's configured response mode");
  // Reuses the tested pure reducers rather than re-parsing inline.
  assert.match(view, /applyGroupEvent|parseSseBuffer/, "uses the pure stream reducers");
  // Per-familiar session pinning so each thread resumes.
  assert.match(view, /recordSession\(group\.id, reply\.familiarId/, "pins each familiar's session id");
  // A Stop control aborts the in-flight broadcast.
  assert.match(view, /abortRef\.current\?\.abort\(\)/, "Stop aborts the broadcast");
  // Broadcast injects the roster but remains an independent first pass.
  assert.match(view, /renderCovenRoundtablePrompt\(\{/, "builds the per-familiar roundtable prompt");
  assert.match(view, /receivingFamiliarId: reply\.familiarId/, "marks the receiving familiar in prompt context");
  assert.match(view, /targeted,/, "tells the prompt whether the user targeted this reply");
  // Round robin passes settled replies into a relay-aware prompt. The default
  // remains Broadcast, so this branch is selected only by explicit config.
  assert.match(view, /group\.responseMode === "round-robin"[\s\S]*renderCovenRoundRobinPrompt\(\{/, "round robin uses the relay-aware prompt");
  assert.match(view, /transcript: \[\.\.\.priorTurns, userTurn, \.\.\.settledBefore\]/, "later speakers receive settled earlier replies");
  assert.match(view, /extractNextPaths\(turn\.text\)\.visible/, "relay strips internal next-path controls");
  // Group chat strips the typed trailer and keeps ONLY reply suggestions. A
  // compact coven bubble cannot execute or send task/action suggestions.
  assert.match(
    view,
    /typedSuggestions[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?\.map\(\(path\) => path\.prompt\)/,
    "filters non-reply intents before group-chat suggestions can render or send",
  );
  // Parsed suggestions render as click-to-send chips targeted to their author.
  assert.match(
    view,
    /className="cave-next-paths mt-1\.5" data-count=\{suggestions\.length\}/,
    "renders the next-paths chip row, stamping its count for the uniform-rows layout",
  );
  assert.match(
    view,
    /sendSuggestion\(s, r\.familiarId, f\?\.display_name \?\? r\.familiarId\)/,
    "clicking a chip targets the familiar who authored it",
  );
  assert.match(
    view,
    /broadcast\(mentionSuggestionAuthor\(suggestion, displayName\), \[familiarId\]\)/,
    "suggestion sends visibly mention the author while routing by familiar id",
  );
  assert.match(
    view,
    /sessionId: group\.sessions\[fid\] \?\? null/,
    "the targeted reply reuses its familiar's existing coven session",
  );
  assert.match(
    view,
    /if \(targetIds\.length === 0\) \{[\s\S]*?return;/,
    "suggestions from removed familiars cannot fall back to a coven broadcast",
  );
});

test("Group Chat requires one project every participant can access", () => {
  assert.match(
    view,
    /useGroupProjects\(activeGroup\?\.familiarIds \?\? EMPTY_FAMILIAR_IDS\)/,
    "project choices load from every current participant's familiar scope",
  );
  assert.match(
    view,
    /const selectedGroupProject =\s*groupProjects\.find\(\(project\) => project\.id === activeGroup\?\.projectId\) \?\? null/,
    "the persisted group project must still exist in the verified intersection",
  );
  assert.match(
    view,
    /groupProjectsLoadedSuccessfully[\s\S]{0,220}!groupProjectsLoading[\s\S]{0,220}!groupProjectsError[\s\S]{0,220}selectedGroupProject/,
    "launch readiness fails closed while intersection access is loading or failed",
  );
  assert.match(
    view,
    /projectRoot,\s*\n\s*\}\),/,
    "every participant chat request carries the shared authorized project root",
  );
  assert.match(
    view,
    /if \(!projectLaunchReady \|\| !selectedGroupProject\) \{[\s\S]{0,180}return;/,
    "a coven message returns before optimistic transcript mutation when no valid project is selected",
  );
  assert.match(view, /<ProjectPicker/, "the coven header exposes the shared access-labelled project picker");
  assert.match(
    view,
    /setGroupProject\(group, projectId, nowIso\(\)\)/,
    "changing project uses the model helper that clears cwd-scoped participant sessions",
  );
  assert.match(
    view,
    /disabled=\{participants\.length === 0 \|\| !draft\.trim\(\) \|\| !projectLaunchReady\}/,
    "the group send action remains disabled until its project intersection is verified",
  );
});

test("@mentions target a subset of the coven", () => {
  // Send routes to mentioned familiars only, falling back to the full roster.
  assert.match(view, /resolveGroupMessageTargets\(/, "resolves composer mentions and explicit targets through the pure routing helper");
  assert.match(
    view,
    /text,\s*\n\s*group\.familiarIds,\s*\n\s*mentionable,\s*\n\s*explicitTargetFamiliarIds/,
    "passes visible text, the current roster, and any authoritative target to routing",
  );
  assert.match(view, /targetFamiliarIds: targeted \? targetIds : undefined/, "records targeted ids on the user turn");
  assert.match(view, /replies: GroupReply\[\] = orderedTargetIds\.map/, "only the targets reply, in the selected mode's order");
  // Composer autocomplete reuses the tested pure helpers.
  assert.match(view, /findActiveMention\(\s*el\.value/, "detects the active mention token");
  assert.match(view, /matchMentions\(mention\.query, mentionable\)/, "filters the roster by the query");
  assert.match(
    view,
    /applyMention\(\s*draft,\s*mention\.start,\s*mention\.query/,
    "inserts the chosen familiar",
  );
});

test("completed @mentions close autocomplete and render as standout targets", () => {
  assert.match(
    view,
    /const completedMentionsRef = useRef<MentionCompletion\[]>\(\[\]\)/,
    "tracks every picker-confirmed token separately from routing state",
  );
  assert.match(
    view,
    /const completedMentionsByGroupRef = useRef\(\s*new Map<string, MentionCompletion\[]>\(\),?\s*\)/,
    "keeps picker-confirmed completion state with each coven draft",
  );
  assert.match(
    view,
    /completedMentionsByGroupRef\.current\.set\(outgoingGroupId, completions\)/,
    "stashes the outgoing coven's completion state",
  );
  assert.match(
    view,
    /completedMentionsRef\.current = activeId[\s\S]{0,180}completedMentionsByGroupRef\.current\.get\(activeId\)/,
    "restores the incoming coven's completion state",
  );
  assert.match(
    view,
    /findActiveMention\([\s\S]{0,180}completedMentionsRef\.current/,
    "suppresses autocomplete for every picker-confirmed token",
  );
  assert.match(
    view,
    /reconcileMentionCompletions\(\s*draftRef\.current,\s*nextDraft,\s*completedMentionsRef\.current,\s*\)/,
    "carries unaffected completions across textarea edits",
  );
  assert.match(
    view,
    /completedMentionsRef\.current = \[[\s\S]{0,260}\.\.\.reconcileMentionCompletions\([\s\S]{0,260}completion/,
    "adds each selected token without discarding prior completions",
  );
  assert.match(view, /announce\(`Tagged \$\{f\.name\}\.`\)/, "announces the selected familiar");

  assert.match(view, /function CovenMentionPills/, "owns one group-specific mention-pill primitive");
  assert.match(
    view,
    /function CovenMentionPills[\s\S]{0,700}<div[\s\S]{0,200}role="note"[\s\S]{0,200}aria-label=/,
    "exposes the pill summary through a valid named ARIA role",
  );
  assert.match(view, /Use @ to tag a familiar/, "keeps the @ instruction visible outside the placeholder");
  assert.match(view, /const mentionGuidanceId = useId\(\)/, "gives the persistent guidance a stable local id");
  assert.match(
    view,
    /aria-describedby=\{participants\.length > 0 \? mentionGuidanceId : undefined\}/,
    "connects the textarea only when persistent @ guidance is rendered",
  );
  assert.match(
    view,
    /<CovenMentionPills[\s\S]*familiars=\{composerTargets\}/,
    "shows parsed targets in the composer",
  );
  assert.match(
    view,
    /<CovenMentionPills familiars=\{targets \?\? \[\]\} align="end" \/>/,
    "shows target pills on sent user turns",
  );
  assert.match(
    view,
    /<CovenMentionPills familiars=\{replyTargets\} \/>/,
    "shows familiar tags on assistant turns",
  );
  assert.match(
    view,
    /`Message \$\{participants\.length\} familiar\$\{participants\.length === 1 \? "" : "s"\}…`/,
    "keeps the populated placeholder focused on composition",
  );
  assert.doesNotMatch(view, /\(@ to tag one\)/, "does not hide required mention guidance in the placeholder");

  assert.match(covenStyles, /\.coven-tab__composer-field/, "composer field makes room for persistent target guidance");
  assert.match(
    covenStyles,
    /\.coven-tab__mention-chip[\s\S]*var\(--accent-presence\)/,
    "mention pills derive their standout state from the presence accent",
  );
  assert.match(
    covenStyles,
    /\.coven-tab__mention-chip[\s\S]*color-mix\(in oklch,[\s\S]*14%/,
    "mention pills use the design-system tint recipe",
  );
});

test("completed familiar delegation trailers route bounded, attributable follow-up work", () => {
  assert.match(view, /extractCovenDelegations\(withoutNextPaths\)/, "parses only the tested structured trailer after removing next-path controls");
  assert.match(view, /source\.status !== "done"/, "never routes a partial or failed familiar reply");
  assert.match(view, /!group\.familiarIds\.includes\(targetId\)/, "rejects out-of-coven targets");
  assert.match(view, /!visibleTargets\.has\(targetId\)/, "requires the visible reply to name the routed target");
  assert.match(
    view,
    /!isCovenDelegationTaskVisible\(visible, delegation\)/,
    "requires the hidden structured task to match the visible task",
  );
  assert.match(view, /!parseMentions\(delegation\.task, mentionable\)\.includes\(targetId\)/, "requires the structured task to name the same target");
  assert.match(view, /targetId === source\.familiarId/, "rejects self-delegation");
  assert.match(view, /lineage\.has\(targetId\)/, "rejects delegation cycles");
  assert.match(view, /delivered\.has\(dedupeKey\)/, "deduplicates source-to-target deliveries");
  assert.match(view, /MAX_COVEN_DELEGATION_DEPTH/, "bounds delegation depth");
  assert.match(view, /MAX_COVEN_DELEGATIONS_PER_TURN/, "bounds total delegated sends per human turn");
  assert.match(view, /controller\.signal\.aborted/, "Stop prevents queued delegated sends from starting");
  assert.match(view, /delegatedByFamiliarId: source\.familiarId/, "records who delegated the task");
  assert.match(view, /delegationSourceReplyId: source\.id/, "records the stable source reply for persistence and idempotency");
  assert.match(view, /targetFamiliarIds: \[targetId\]/, "routes only to the explicitly delegated target");
  assert.match(view, /sessions\[targetId\] \?\? null/, "reuses the target familiar's latest pinned session");
  assert.match(view, /const retryText = delegator \? `Delegated by @\$\{delegator\}:\\n\$\{userTurn\.text\}` : userTurn\.text/, "preserves delegation attribution when a failed target is retried");
  assert.match(view, /delegator \? "HANDOFF" : "OP"/, "renders familiar-issued work as an attributed handoff");
});

test("response mode is configured per Coven and locked while a turn is running", () => {
  assert.match(view, /options=\{COVEN_RESPONSE_MODES\}/, "offers the two canonical response modes");
  assert.match(view, /ariaLabel="Coven response mode"/, "labels the mode selector for assistive technology");
  assert.match(view, /<fieldset disabled=\{busy\}/, "prevents mid-turn mode changes");
  assert.match(view, /setGroupResponseMode\(group, responseMode, nowIso\(\)\)/, "persists the setting on the active Coven");
  assert.match(view, /responseMode: group\.responseMode/, "snapshots mode on each user turn for stable retries");
  assert.match(view, /nextRoundRobinLeadId\(current\.familiarIds, leadId\)/, "rotates the next round-robin lead");
  assert.match(view, /leads next/, "shows who will lead the next round");
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
  assert.match(view, /<UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human"/, "human turns retain the user avatar");
  assert.match(view, /delegator\?\.display_name \?\? operatorDisplayName/, "human turns retain the operator display name while handoffs show the familiar");
  assert.match(view, /delegator \? "HANDOFF" : "OP"/, "human and familiar-authored turns have distinct badges");
  assert.match(view, /formatChatRecency\(user\.createdAt, dtPrefs\)/, "group prompt turns retain recency");
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
    /if \(next === "groupchat"\)[\s\S]*commitMode\("chat", "groupchat"\)[\s\S]*CHAT_OPEN_COVEN_EVENT/,
    "workspace redirects groupchat into Chat, preserves the tab destination, and opens the coven tab",
  );

  // The standalone left-nav destination is gone.
  assert.doesNotMatch(
    navigation,
    /id: "groupchat", label: "Group"/,
    "workspace navigation no longer exposes a standalone Group destination",
  );

  // ChatSurface owns Group Chat now: it imports GroupChatView, offers a Group
  // scope tab, listens for the open-coven event, and renders it for that scope.
  assert.match(
    chatSurface,
    /import \{[\s\S]*GroupChatView[\s\S]*\} from "@\/components\/lazy-surfaces"/,
    "ChatSurface lazy-loads GroupChatView",
  );
  assert.match(
    chatSurface,
    /chat-scope-group-btn[\s\S]*onClick=\{\(\) => window\.dispatchEvent\(new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "groupchat" \} \}\)\)\}/,
    "ChatSurface routes its demoted Group icon through workspace navigation so history preserves the coven scope",
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

test("Group surface follows the design handoff: SurfaceRail covens + details drawer", () => {
  // The coven list is the shared SurfaceRail primitive (persisted width /
  // collapse, search slot) instead of a bespoke fixed-width aside.
  assert.match(
    view,
    /import \{ SurfaceRail \} from "@\/components\/ui\/surface-rail"/,
    "rail comes from the shared SurfaceRail primitive",
  );
  assert.match(view, /storageKey="cave:coven:rail"/, "rail prefs persist under the coven rail key");
  assert.match(view, /placeholder="Search covens…"/, "rail search filters covens by name");
  assert.match(view, /aria-label="New coven"/, "the rail header keeps the create-coven action");
  assert.match(view, /requestDeleteGroup\(g\.id, g\.name\)/, "rows keep the confirmed delete affordance");

  // Details drawer: subject + running summary on the local group model,
  // committed on blur through the same saveGroups path as other mutations.
  assert.match(view, /setGroupDetails\(group, patch, nowIso\(\)\)/, "details commits go through the pure helper");
  assert.match(view, /if \(next === group\) return;/, "an untouched blur neither persists nor reorders the rail");
  assert.match(view, /placeholder="What is this coven about\?"/, "subject field uses the handoff placeholder");
  assert.match(
    view,
    /placeholder="Short running summary of the conversation…"/,
    "summary field uses the handoff placeholder",
  );
  assert.match(view, /aria-expanded=\{detailsOpen\}/, "the details strip is a disclosure button");

  // Header grammar: double-click rename (keyboard parity kept), member chips
  // + dashed "+ Add" pill anchoring the existing roster picker.
  assert.match(view, /onDoubleClick=\{\(\) => setRenaming\(true\)\}/, "pointer rename is double-click");
  assert.match(view, /coven-tab__member-chip/, "members render as header chips");
  assert.match(view, /coven-tab__add-member/, "the dashed add pill opens the roster picker");

  // Composer affordances from the mock: mention kicker + explicit empty state,
  // and a typing line while replies are in flight.
  assert.match(view, /coven-tab__mention-kicker">Tag a familiar</, "mention popover keeps its kicker");
  assert.match(view, /No matching familiar in this coven/, "mention popover has an explicit empty state");
  assert.match(view, /replyingNames\.join\(", "\)\} replying…/, "in-flight replies surface the typing line");
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
    transcript,
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
    /const outgoingGroupId = draftOwnerRef\.current;[\s\S]{0,180}?draftsByGroupRef\.current\.set\(outgoingGroupId, draftRef\.current\);[\s\S]{0,700}?const incomingDraft = activeId[\s\S]{0,160}?draftsByGroupRef\.current\.get\(activeId\)[\s\S]{0,160}?setDraft\(incomingDraft\);/,
    "switching covens stashes the outgoing draft and restores the incoming one (no cross-coven bleed)",
  );
  assert.match(
    view,
    /draftsByGroupRef\.current\.delete\(id\);/,
    "deleting a coven drops its stashed draft",
  );
});

test("coven Details drawer offers per-participant Debug (A5: no debug affordance in the coven tab)", () => {
  // Each participant's pinned session is a regular resumable daemon session;
  // the drawer lists them with a Debug action instead of hosting a DebugPane.
  assert.match(
    view,
    /onDebugSession\?: \(sessionId: string, familiarId: string\) => void/,
    "GroupChatView accepts an onDebugSession handler",
  );
  assert.match(
    view,
    /participants\.some\(\(f\) => activeGroup\.sessions\[f\.id\]\)/,
    "the Threads section only renders when a participant has a pinned session",
  );
  assert.match(
    view,
    /onClick=\{\(\) => onDebugSession\(sessionId, f\.id\)\}/,
    "Debug passes the pinned session AND its familiar so the host can scope the conversation",
  );
  assert.match(
    view,
    /className="coven-tab__thread-debug focus-ring"/,
    "the Debug action keeps the shared focus-ring class",
  );
  // Host wiring: chat-surface switches to the conversation scope, opens the
  // session through the router, and latches the debug modal (S1 latch) — the
  // same machinery the rail's Debug action relies on.
  assert.match(
    chatSurface,
    /const debugGroupSession = useCallback\(\s*\n\s*\(sessionId: string, familiarId: string\) => \{\s*\n\s*onSetActiveFamiliar\(familiarId\);\s*\n\s*setScope\("conversation"\);\s*\n\s*window\.setTimeout\(\(\) => \{\s*\n\s*routerRef\.current\?\.openSession\(sessionId\);\s*\n\s*requestDebugOpen\(\);/,
    "chat-surface opens the member session as a conversation and latches debug-open",
  );
  assert.match(
    chatSurface,
    /onDebugSession=\{debugGroupSession\}/,
    "chat-surface hands the handler to GroupChatView",
  );
});
