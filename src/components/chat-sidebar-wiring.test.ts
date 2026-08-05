// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatAttentionEvents = await readFile(new URL("../lib/chat-attention-events.ts", import.meta.url), "utf8");
const chatAttentionProjection = await readFile(new URL("../lib/chat-attention-projection.ts", import.meta.url), "utf8");

// ── Chat-mode shell wiring: Chats replaces the global nav in the primary shell
//    nav slot, including the mobile nav drawer. ────────────────────────────────
assert.match(
  workspace,
  /const chatSidebar =\s*\(\s*<WorkspaceSidebar/,
  "workspace should define the chatSidebar element",
);
assert.match(
  workspace,
  /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/,
  "workspace should select Chats as the primary nav only in chat mode",
);
assert.doesNotMatch(workspace, /const list = mode === "chat" \? chatSidebar : undefined;/);
assert.match(
  workspace,
  /navPolicy=\{mode === "chat" \? "chat-contextual" : "remembered"\}/,
  "chat mode should activate the contextual nav policy",
);
assert.doesNotMatch(
  workspace,
  /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/,
  "chat mode should not reserve a persistent list pane",
);
assert.match(
  workspace,
  /nav=\{contextualNav\}\s*list=\{undefined\}/,
  "workspace should pass contextual navigation and no list content",
);
assert.match(workspace, /topBar=\{\(\{ navDrawerOpen \}\) =>/, "top bar should only receive nav drawer state");
assert.match(workspace, /onToggleList=\{undefined\}/, "top bar should expose no list drawer toggle");
assert.match(workspace, /listDrawerOpen=\{false\}/, "top bar should report no list drawer");
const chatSidebarBlock = workspace.match(/const chatSidebar =[\s\S]*?const contextualNav =/)?.[0] ?? "";
assert.ok(chatSidebarBlock, "workspace should keep a distinct chatSidebar block");
assert.doesNotMatch(chatSidebarBlock, /dismissListMobile/, "chat sidebar callbacks should not dismiss the list drawer");
assert.ok(
  (chatSidebarBlock.match(/dismissNavMobile/g) ?? []).length >= 6,
  "chat sidebar actions should dismiss the mobile nav drawer",
);
assert.match(
  workspaceSidebar,
  /aria-label="Go to Home"/,
  "the chat sidebar header control is explicitly a Go to Home button",
);

// ── Home-first boot: the app opens on Home; chat is one step away. ──
assert.match(
  workspace,
  /const \[mode, setModeRaw\] = useState<CaveMode>\("home"\)/,
  "workspace should boot into home mode",
);
assert.doesNotMatch(workspace, /const exitChatMode = useCallback/, "workspace should not keep the unused prior-surface exit helper");
assert.doesNotMatch(workspace, /lastNonChatMode/, "workspace should not track a stale prior-surface contract");

// ── Subpanel removal: the in-surface thread rail is dropped in chat mode,
//    because the contextual WorkspaceSidebar already owns the grouped threads. ─
assert.match(
  workspace,
  /hideThreadRail/,
  "the chat-mode ChatSurface should set hideThreadRail",
);
assert.match(chatSurface, /hideThreadRail = false/, "ChatSurface should accept a hideThreadRail prop");
assert.match(
  chatSurface,
  /const compactRail = hideThreadRail/,
  "ChatSurface should fold hideThreadRail into the compact rail flag",
);
assert.match(
  chatSurface,
  /hideRail=\{compactRail\}/,
  "ChatRouter should receive the rail-only flag — the outer sidebar owns chats, but the full-width toolbar must stay (hideRail, not compact)",
);

// ── Recreated sidepanel: project-grouped threads + register-as-project. ───────
assert.match(
  workspaceSidebar,
  /deriveChatProjectGroups\(applyProjectOverrides/,
  "ChatSidebar should group threads by project (with local overrides applied)",
);
assert.match(
  workspaceSidebar,
  /handleRegister/,
  "ChatSidebar should offer register-as-project for unregistered roots",
);
assert.match(
  workspaceSidebar,
  /Register \$\{label\} as a project/,
  "ChatSidebar register affordance should be labeled for assistive tech",
);

// ── Easy add-project on failure: a 403 project-access denial surfaces a
//    one-click register + grant + retry. ───────────────────────────────────────
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture the failing project root on a 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement the add-project recovery");
assert.match(
  chatView,
  /onAddProject=\{projectAccessRoot \? handleAddProject : undefined\}/,
  "chat-view should wire the add-project action into the error strip",
);

// ── Attention projection: a human reply clears stale sidebar attention
//    immediately, but ordinary read/open paths never fabricate that clear. ─────
assert.match(
  chatAttentionEvents,
  /export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";/,
  "the chat attention event module should expose the stable browser event name",
);
assert.match(
  chatAttentionEvents,
  /export const CHAT_ATTENTION_SETTLE_EVENT = "cave:chat-attention-settle";/,
  "the chat attention event module should expose the stable browser settlement event name",
);
assert.match(
  chatView,
  /import \{\s*emitChatAttentionClear,\s*emitChatAttentionSettlement,\s*\} from "@\/lib\/chat-attention-events";/,
  "chat-view should emit the shared attention clear/settlement events",
);
assert.match(
  chatAttentionEvents,
  /export function emitChatAttentionClear\([\s\S]*sessionId: string,[\s\S]*operationId: string,[\s\S]*options\?: \{[\s\S]*clearWatermark\?: string \| null;[\s\S]*scopeKey\?: string \| null;[\s\S]*baselineAttention\?: ChatAttention \| null;[\s\S]*\},[\s\S]*\): void \{/,
  "the clear event emitter should accept optional watermark, scope, and baseline evidence without breaking the session+operation API",
);
assert.match(
  chatAttentionEvents,
  /const hasClearWatermark = hasOwnDetailField\(detail, "clearWatermark"\);[\s\S]*const clearWatermark = hasClearWatermark && isCanonicalIsoInstant\(detail\?\.clearWatermark\)[\s\S]*\? detail\.clearWatermark[\s\S]*: null;[\s\S]*const scopeKey = normalizeString\(detail\?\.scopeKey\);[\s\S]*const hasBaselineAttention = hasOwnDetailField\(detail, "baselineAttention"\);[\s\S]*const baselineAttention = hasBaselineAttention[\s\S]*normalizeAttentionDetail\(detail\?\.baselineAttention\)[\s\S]*if \(hasClearWatermark && !clearWatermark\) return null;[\s\S]*if \(hasBaselineAttention && !baselineAttention\) return null;[\s\S]*return sessionId && operationId[\s\S]*sessionId,[\s\S]*operationId,[\s\S]*\.\.\.\(clearWatermark \? \{ clearWatermark \} : \{\}\),[\s\S]*\.\.\.\(scopeKey \? \{ scopeKey \} : \{\}\),[\s\S]*\.\.\.\(baselineAttention \? \{ baselineAttention \} : \{\}\),[\s\S]*: null;/,
  "clear-event parsing should preserve absent-field compatibility while rejecting explicitly malformed watermark and baseline evidence",
);
assert.match(
  chatView,
  /function emitAttentionClear\(\s*targetSessionId: string,\s*operationId: string,\s*clearWatermark\?: string \| null,\s*\) \{[\s\S]*emitChatAttentionClear\(targetSessionId, operationId, \{[\s\S]*clearWatermark,[\s\S]*scopeKey:[\s\S]*baselineAttention:[\s\S]*\}\);[\s\S]*\}/,
  "chat-view should emit attention clears with the stable watermark, actual scope, and any known baseline evidence",
);

// ── Projection scope provenance (defect #3): rows inherit the actual accepted
//    request scope, not a scope inferred from their familiar identity. List
//    absence is never canonical deletion evidence. ───────────────────────────
assert.match(
  chatView,
  /activeFamiliarId\?: string \| null;/,
  "ChatView should accept Workspace's current list scope as an explicit prop instead of inferring it from the session",
);
assert.match(
  chatView,
  /const scopeFamiliarId = activeFamiliarId !== undefined\s*\?\s*activeFamiliarId\s*:\s*knownSession\?\.familiarId \?\? familiar\.id;/,
  "emitAttentionClear should prefer Workspace's active list scope over the session's own owning familiar, falling back only when the caller never learned it",
);
assert.doesNotMatch(
  chatView,
  /scopeKey: chatAttentionProjectionScopeKey\(knownSession\?\.familiarId \?\? familiar\.id\)/,
  "emitAttentionClear must not compute scope solely from the session's/chat's owning familiar (wrong for split panes and off-list sessions)",
);
assert.match(
  chatRouter,
  /activeFamiliarId\?: string \| null;\s*\n\};/,
  "ChatRouter should accept and forward Workspace's active list scope",
);
assert.match(
  chatRouter,
  /<ChatView\s*\n\s*ref=\{viewHandle\}[\s\S]*?activeFamiliarId=\{activeFamiliarId\}/,
  "the primary ChatView mount should receive Workspace's active list scope",
);
assert.match(
  chatRouter,
  /<ChatView\s*\n\s*familiar=\{paneFamiliar\}[\s\S]*?activeFamiliarId=\{activeFamiliarId\}/,
  "split-pane ChatView mounts must receive the same active request scope as the primary pane rather than infer request provenance from their own familiar",
);
assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*?activeFamiliarId=\{activeFamiliarId\}/,
  "ChatSurface should forward its own activeFamiliarId prop down into ChatRouter",
);
assert.match(
  workspace,
  /baseSessionScopeKeyByIdRef\.current\.get\(detail\.sessionId\)\s*\?\?\s*CHAT_ATTENTION_UNPROVEN_SCOPE,\s*\n\s*baselineAttention,/,
  "workspace's onChatAttentionClear must record the accepted request scope (or the unproven sentinel), never infer scope from row identity",
);
assert.doesNotMatch(
  workspace,
  /detail\.scopeKey/,
  "workspace must not trust the event's scopeKey at all",
);
assert.match(
  workspace,
  /baseSessions\.map\(\(session\) => \[\s*session\.id,\s*capturedScopeKey,\s*\]\)/,
  "workspace must associate every accepted row with the actual captured request scope",
);
assert.match(
  chatView,
  /if \(liveGeneration\.sessionId\) \{\s*emitAttentionClear\(liveGeneration\.sessionId, runId, liveGeneration\.clearWatermark\);[\s\S]{0,240}const res = await fetch\("\/api\/chat\/send"/,
  "chat-view should clear attention immediately once the target session id is known, before /api/chat/send begins, using the generation's stable watermark",
);
assert.match(
  chatView,
  /case "session": \{[\s\S]*?emitAttentionClear\(ev\.sessionId, liveGeneration\.runId, liveGeneration\.clearWatermark\);/,
  "chat-view should clear attention when a live generation first gains a stable session id, using the original send watermark",
);
assert.match(
  chatView,
  /return subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?maybeEmitAdoptedPendingAttentionClear\(sessionId, live\);/,
  "chat-view should route registry-subscription adoption clears through the shared helper",
);
assert.match(
  chatView,
  /const live = readLiveChatGeneration\(sessionId\);\s*if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?maybeEmitAdoptedPendingAttentionClear\(sessionId, live\);/,
  "chat-view should route initial adoption clears through the shared helper",
);
const applyConversationPayloadBlock = chatView.match(/const applyConversationPayload = \(json: ConversationHistoryPayload\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";
assert.ok(applyConversationPayloadBlock, "chat-view should define the conversation payload apply helper");
assert.doesNotMatch(
  applyConversationPayloadBlock,
  /emitChatAttentionClear/,
  "chat-view should not clear attention while merely loading persisted conversation history",
);
assert.doesNotMatch(
  chatView,
  /from "@\/lib\/chat-attention-settlement"/,
  "the standalone attention-settlement module should be removed; its tracker is inlined in chat-view (cave-zs85n Task 5 spec-compliance)",
);
assert.match(
  chatView,
  /import \{[\s\S]*createAdoptedAttentionSettlementRegistry,[\s\S]*createChatAttentionAdoptionTracker,[\s\S]*createChatAttentionSettlementTracker,[\s\S]*createExternallySettledGenerationRegistry,[\s\S]*\} from "@\/lib\/chat-attention-lifecycle";/,
  "chat-view should import the shared chat-attention lifecycle helpers, including adopted-clear settlement ownership",
);
assert.match(
  chatView,
  /const externallySettledChatAttentionControllers = createExternallySettledGenerationRegistry\(\);/,
  "chat-view should share externally settled controller identities across remounts so a stale-eviction settle suppresses the original owner's duplicate cleanup without leaking orphaned run ids",
);
assert.match(
  chatView,
  /const adoptedPendingAttentionSettlementOwners = createAdoptedAttentionSettlementRegistry\(\);/,
  "chat-view should share adopted-clear settlement ownership by controller so remounts can attach their emitted clear to the original lifecycle",
);
assert.doesNotMatch(
  chatView,
  /const externallySettledChatAttentionRuns = new Set<string>\(\);/,
  "chat-view should not retain a module-level run-id string set after orphan stale-eviction suppression moved to controller identity",
);
assert.match(
  chatView,
  /const onSessionsChangedRef = useRef\(onSessionsChanged\);\s*\n\s*onSessionsChangedRef\.current = onSessionsChanged;/,
  "chat-view should keep the latest onSessionsChanged callback in a ref for background settlements",
);
assert.match(
  chatView,
  /const attentionSettlement = createChatAttentionSettlementTracker\(\{\s*operationId: runId,\s*operationController: controller,\s*externalSettlements: externallySettledChatAttentionControllers,\s*settleProjection: \(sessionId, operationId, outcome\) => \{\s*emitChatAttentionSettlement\(sessionId, operationId, outcome\);\s*\},\s*reconcileCanonicalSessions: \(\) => onSessionsChangedRef\.current\?\.\(\),\s*\}\);\s*adoptedPendingAttentionSettlementOwners\.register\(controller, attentionSettlement\);/s,
  "chat-view should settle against the latest callback, share external-settlement suppression, and register adopted-clear ownership for the live controller",
);
assert.match(
  chatView,
  /if \(liveGeneration\.sessionId\) \{\s*emitAttentionClear\(liveGeneration\.sessionId, runId, liveGeneration\.clearWatermark\);\s*attentionSettlement\.markAttentionCleared\(liveGeneration\.sessionId\);/,
  "chat-view should track pre-send attention clears on existing sessions",
);
assert.match(
  chatView,
  /case "session": \{[\s\S]*?emitAttentionClear\(ev\.sessionId, liveGeneration\.runId, liveGeneration\.clearWatermark\);\s*liveGeneration\.markAttentionCleared\(ev\.sessionId\);/,
  "session events should remain id acquisition plus attention-clear bookkeeping, not persistence confirmation",
);
assert.match(
  chatView,
  /case "done": \{[\s\S]*?if \(ev\.isError\) \{[\s\S]*?\} else \{[\s\S]*?liveGeneration\.markPersistenceConfirmed\(\);[\s\S]*?stampFirstReplyOnce\(\);/,
  "only a successful terminal done event should confirm persistence",
);
assert.match(
  chatView,
  /reconcileCanonicalSessions: \(\) => \{\s*attentionSettlement\.reconcileNow\(\);\s*\}/,
  "chat-view should expose the tracker-owned canonical-session refresh through the live generation helper",
);
assert.match(
  chatView,
  /if \(startNewConversation && ev\.sessionId\) liveGeneration\.reconcileCanonicalSessions\(\);/,
  "chat-view should route startNewConversation refreshes through the settlement tracker so failed terminals only reconcile once",
);
assert.match(
  chatView,
  /finally \{[\s\S]*?attentionSettlement\.reconcileIfNeeded\(\);[\s\S]*?clearLiveChatGeneration\(liveGeneration\.sessionId, runId\)/,
  "chat-view should reconcile canonical sessions exactly once at settlement before retiring the live snapshot",
);

// ── Adoption reads must not fabricate attention clears for a snapshot whose
//    generation already settled: only a still-pending active leaf represents
//    an unanswered human request (cave-zs85n Task 5 spec-compliance). ────────
assert.match(
  chatView,
  /function isLiveGenerationPending\([\s\S]*?\{\s*return Boolean\(live\.turns\.find\(\(t\) => t\.id === live\.activeLeafId\)\?\.pending\);\s*\}/,
  "chat-view should define a pending-generation helper reading the active leaf's turn",
);
assert.match(
  chatView,
  /const adoptedPendingAttentionClearRef = useRef\(createChatAttentionAdoptionTracker\(\)\);/,
  "chat-view should keep per-lifecycle adoption clear state so repeated live snapshot updates do not re-clear the same run",
);
assert.match(
  chatView,
  /function maybeEmitAdoptedPendingAttentionClear\([\s\S]*?targetSessionId: string,[\s\S]*?live: LiveChatGenerationSnapshot,[\s\S]*?\) \{[\s\S]*?if \(!isLiveGenerationPending\(live\) \|\| !live\.runId\) return;[\s\S]*?if \(!adoptedPendingAttentionClearRef\.current\.shouldEmit\(targetSessionId, live\.runId\)\) return;[\s\S]*?emitAttentionClear\(targetSessionId, live\.runId, attentionClearWatermarkForLiveGeneration\(live\)\);[\s\S]*?adoptedPendingAttentionSettlementOwners\.markAttentionCleared\(live\.controller, targetSessionId\);/,
  "chat-view should centralize adopted pending-generation clears behind a one-per-lifecycle helper that reuses the snapshot watermark and attaches the emitted clear to the owning settlement lifecycle",
);
assert.match(
  chatView,
  /return subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?maybeEmitAdoptedPendingAttentionClear\(sessionId, live\);/,
  "the registry-subscription adoption site should clear attention through the per-lifecycle adoption helper",
);
assert.match(
  chatView,
  /const live = readLiveChatGeneration\(sessionId\);\s*if \(live && isLiveSnapshotActive\(live, Date\.now\(\)\)\) \{[\s\S]*?maybeEmitAdoptedPendingAttentionClear\(sessionId, live\);/,
  "the initial-load adoption site should clear attention through the same per-lifecycle adoption helper",
);

// ── Stale/orphan live-snapshot eviction must settle (not strand) its
//    attention projection and reconcile canonical sessions, without
//    fabricating a "persisted" outcome it cannot prove (cave-zs85n Task 5
//    spec-compliance). A pending generation whose registry entry goes stale
//    (TTL expiry, or aborted) has no owning send left to ever call its
//    normal finally-block settlement — without this, the operation would sit
//    "pending" in the workspace's projection map forever. ────────────────────
const staleEvictionBlock = chatView.match(
  /if \(live\) \{\s*\/\/ Stale\/aborted snapshot whose cleanup never ran[\s\S]*?\n    \}\n/,
)?.[0] ?? "";
assert.ok(staleEvictionBlock, "chat-view should define the stale/orphan live-snapshot eviction branch");
assert.match(
  staleEvictionBlock,
  /skipSettleNotifyRef\.current \+= 1;\s*clearLiveChatGeneration\(sessionId\);[\s\S]*?if \(isLiveGenerationPending\(live\) && live\.runId\) \{\s*externallySettledChatAttentionControllers\.mark\(live\.controller,\s*sessionId,\s*live\.runId\);\s*emitChatAttentionSettlement\(sessionId, live\.runId, "failed"\);\s*onSessionsChangedRef\.current\?\.\(\);\s*\}/,
  "evicting a stale/orphan pending snapshot should settle its attention operation as \"failed\", reconcile canonical sessions once, and mark the controller so the original owner's later finally path cannot duplicate that cleanup",
);
assert.doesNotMatch(
  staleEvictionBlock,
  /emitChatAttentionSettlement\([^)]*"persisted"/,
  "stale eviction must never fabricate a \"persisted\" settlement outcome — it cannot prove the human's request was actually answered",
);
// Only reached when the evicted snapshot was actually pending — a
// recent-but-settled snapshot never recorded a clear operation, so nothing
// needs settling, and this must not unconditionally fire a refetch.
assert.doesNotMatch(
  staleEvictionBlock.replace(/if \(isLiveGenerationPending\(live\) && live\.runId\) \{[\s\S]*?\}\n/, ""),
  /emitChatAttentionSettlement|onSessionsChangedRef/,
  "the settle + reconcile must live strictly inside the isLiveGenerationPending(live) guard, not run unconditionally on every eviction",
);
assert.match(
  chatAttentionProjection,
  /export function applyChatAttentionProjections\(/,
  "workspace attention persistence should live in a focused projection helper",
);
assert.match(
  chatAttentionProjection,
  /export function clearSessionAttentionRows\(rows: readonly SessionRow\[\], sessionId: string\): SessionRow\[\]/,
  "the projection helper should expose a targeted, non-retiring clear for a single session",
);
assert.match(
  workspace,
  /import \{[\s\S]*applyChatAttentionProjections,[\s\S]*clearSessionAttentionRows,[\s\S]*\} from "@\/lib\/chat-attention-projection";/,
  "workspace should import the targeted clear alongside the retirement-capable apply",
);
assert.match(
  workspace,
  /import \{[\s\S]*CHAT_ATTENTION_CLEAR_EVENT,[\s\S]*CHAT_ATTENTION_SETTLE_EVENT,[\s\S]*attentionClearFromEvent,[\s\S]*attentionClearedSessionId,[\s\S]*attentionSettlementFromEvent,[\s\S]*\} from "@\/lib\/chat-attention-events";/,
  "workspace should subscribe to the shared attention clear/settlement events",
);
assert.match(
  chatAttentionProjection,
  /function clearSessionAttention\(row: SessionRow\): SessionRow \{[\s\S]*NO_CHAT_ATTENTION/,
  "the projection helper should reset attention with a NO_CHAT_ATTENTION-only patch that preserves every other field",
);
assert.match(
  workspace,
  /recordChatAttentionClear\([\s\S]*baseSessionScopeKeyByIdRef\.current\.get\(detail\.sessionId\)[\s\S]*CHAT_ATTENTION_UNPROVEN_SCOPE[\s\S]*baseSessionsRef\.current = clearSessionAttentionRows\(baseSessionsRef\.current, sessionId\);[\s\S]*setSessions\(\(currentSessions\) => clearSessionAttentionRows\(currentSessions, sessionId\)\);/,
  "workspace should record clears with the accepted request scope (or the unproven sentinel) and then patch both the canonical base rows and the rendered enriched rows for the matching session only",
);
assert.match(
  workspace,
  /window\.addEventListener\(CHAT_ATTENTION_CLEAR_EVENT, onChatAttentionClear\);[\s\S]*window\.addEventListener\(CHAT_ATTENTION_SETTLE_EVENT, onChatAttentionSettle\);[\s\S]*?return \(\) => \{\s*window\.removeEventListener\(CHAT_ATTENTION_CLEAR_EVENT, onChatAttentionClear\);[\s\S]*window\.removeEventListener\(CHAT_ATTENTION_SETTLE_EVENT, onChatAttentionSettle\);[\s\S]*?\};/,
  "workspace should subscribe once to chat attention clear/settlement events and clean up both listeners",
);
// A loadSessions() started before the clear (mount, the 4s poll, a scope
// change) can still be in flight when the clear fires and resolve *after* it
// with a stale, pre-clear attention snapshot — silently resurrecting the
// attention this handler just cleared. The handler must bump
// loadSessionsReqRef.current before patching state so any such in-flight
// response is superseded (loadSessions' own isCurrent() guard) and dropped.
const onChatAttentionClearBlock = workspace.match(
  /const onChatAttentionClear = \(event: Event\) => \{[\s\S]*?\n    \};/,
)?.[0] ?? "";
assert.ok(onChatAttentionClearBlock, "workspace should define the chat-attention clear handler");
assert.match(
  onChatAttentionClearBlock,
  /const sessionId = detail\?\.sessionId \?\? attentionClearedSessionId\(event\);\s*if \(!sessionId\) return;[\s\S]*?if \(detail\) \{[\s\S]*?const recordResult = recordChatAttentionClear\([\s\S]*?if \(!recordResult\.recorded\) return;[\s\S]*?\}[\s\S]*?loadSessionsReqRef\.current \+= 1;[\s\S]*?baseSessionsRef\.current = clearSessionAttentionRows/,
  "workspace should accept legacy session-only clear payloads, but only record/invalidate durable projection state for real operation-aware clears",
);
assert.match(
  onChatAttentionClearBlock,
  /const acceptedRow = baseSessionsRef\.current\.find\(\(session\) => session\.id === detail\.sessionId\);[\s\S]*?const acceptedCanonical = acceptedRow && acceptedRow\.attention\.state !== "none"[\s\S]*?\? acceptedRow\.attention[\s\S]*?: null;[\s\S]*?const baselineAttention = acceptedCanonical \?\?[\s\S]*?detail\.baselineAttention \?\?[\s\S]*?acceptedRow\?\.attention \?\?[\s\S]*?sessionsRef\.current\.find\(\(session\) => session\.id === detail\.sessionId\)\?\.attention;[\s\S]*?const recordResult = recordChatAttentionClear\([\s\S]*?baseSessionScopeKeyByIdRef\.current\.get\(detail\.sessionId\)\s*\?\?\s*CHAT_ATTENTION_UNPROVEN_SCOPE,[\s\S]*?baselineAttention[\s\S]*?baseSessionsRef\.current = clearSessionAttentionRows/,
  "workspace should prefer its own accepted canonical row over stale event fallback evidence and preserve the actual accepted request scope",
);
assert.match(
  onChatAttentionClearBlock,
  /if \(detail\) \{[\s\S]*?recordChatAttentionClear[\s\S]*?\}[\s\S]*?baseSessionsRef\.current = clearSessionAttentionRows\(baseSessionsRef\.current, sessionId\);[\s\S]*?setSessions\(\(currentSessions\) => clearSessionAttentionRows\(currentSessions, sessionId\)\);/,
  "workspace should use the shared targeted clear for both session-only compatibility payloads and operation-aware payloads, without changing unrelated rows",
);
// Task 5 spec-compliance: the clear handler patches cached arrays with a
// targeted, non-retiring clear. It must NEVER call the retirement-capable
// applyChatAttentionProjections against those cached arrays with a synthetic
// (merely-incremented) request id — that call is reserved for an actually
// accepted `/api/sessions/list` response, where retiring an operation means
// something real.
assert.doesNotMatch(
  onChatAttentionClearBlock,
  /applyChatAttentionProjections\(/,
  "the chat-attention clear handler must not call canonical-response retirement logic against cached arrays with a synthetic request id — only clearSessionAttentionRows",
);
assert.match(
  workspace,
  /const baseSessions = applyChatAttentionProjections\([\s\S]*filterDeletedSessions\([\s\S]*capturedScopeKey/,
  "loadSessions should reapply retained attention clears before assigning canonical and rendered rows",
);
// Task 5 spec-compliance: applyChatAttentionProjections (which can retire
// operations) may only run once a session-list response has been accepted —
// gated behind both the isCurrent() scope/reqId guard and a successful
// `json.ok` — never against a rejected/superseded/failed response.
const loadSessionsBlock = workspace.match(
  /const loadSessions = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/,
)?.[0] ?? "";
assert.ok(loadSessionsBlock, "workspace should define the loadSessions callback");
assert.match(
  loadSessionsBlock,
  /if \(!isCurrent\(\)\) return;[\s\S]*?if \(!json\.ok\) \{[\s\S]*?return;\s*\}[\s\S]*?const baseSessions = applyChatAttentionProjections\(/,
  "only an accepted (current + ok) /api/sessions/list response may apply and retire attention projections",
);
assert.match(
  workspace,
  /const capturedActiveId = activeIdRef\.current;\s*const capturedScopeKey = chatAttentionProjectionScopeKey\(capturedActiveId\);[\s\S]*const isCurrent = \(\) => isCurrentSessionListRequest\(\{[\s\S]*capturedScopeKey,[\s\S]*currentScopeKey: chatAttentionProjectionScopeKey\(activeIdRef\.current\)/,
  "each session-list response should be tagged with its captured scope and rejected after a scope switch",
);
assert.match(
  workspace,
  /const loadSessions = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/,
  "session refresh callbacks should be stable and read the current familiar scope from a ref",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*void loadSessions\(\);\s*\}, \[activeId, loadSessions\]\);/,
  "scope changes should explicitly launch a current-scope session-list request",
);

// ── Visible grouping tabs: recency view (default) + by-project. ───────────────
assert.match(
  workspaceSidebar,
  /deriveChatRecencyBuckets\(/,
  "ChatSidebar should derive time buckets for the Recent view",
);
assert.match(
  workspaceSidebar,
  /<Tabs<ChatSidebarView>/,
  "ChatSidebar should use the shared accessible tabs primitive",
);
assert.match(
  workspaceSidebar,
  /idPrefix="chat-sidebar-group"/,
  "Grouping tabs should emit stable ids and aria-controls",
);
assert.match(
  workspaceSidebar,
  /id="chat-sidebar-group-panel"[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby=\{`chat-sidebar-group-tab-\$\{view\}`\}[\s\S]*?<nav aria-label="Chat threads">/,
  "The active thread list should be associated with its selected grouping tab",
);
const chatSidebarPanelOpenTag = workspaceSidebar.match(
  /<div\s*\n\s*id="chat-sidebar-group-panel"[\s\S]*?>/,
)?.[0] ?? "";
assert.ok(chatSidebarPanelOpenTag, "ChatSidebar should render the active grouping panel");
assert.doesNotMatch(
  chatSidebarPanelOpenTag,
  /tabIndex=/,
  "the tabpanel should not add a redundant keyboard stop before its interactive rows",
);
assert.match(
  workspaceSidebar,
  /id: "recent",[\s\S]*?label: "Recent",[\s\S]*?icon: "ph:clock-counter-clockwise",[\s\S]*?controlsId: "chat-sidebar-group-panel"/,
  "ChatSidebar should expose the Recent grouping tab",
);
assert.match(
  workspaceSidebar,
  /id: "projects",[\s\S]*?label: "Projects",[\s\S]*?icon: "ph:folders-bold",[\s\S]*?controlsId: "chat-sidebar-group-panel"/,
  "ChatSidebar should expose the Projects grouping tab",
);
assert.match(
  workspaceSidebar,
  /<PopoverLabel>Chat visibility<\/PopoverLabel>/,
  "Sidebar overflow should retain archive visibility without duplicating grouping",
);
assert.match(
  workspaceSidebar,
  /readChatSidebarView\(\)/,
  "the organize mode should hydrate from the persisted preference",
);
assert.doesNotMatch(
  workspaceSidebar,
  /function bareTime\(/,
  "the sidebar should remove the dead bareTime compatibility helper",
);
assert.match(
  workspaceSidebar,
  /const minuteTick = useMinuteTick\(\);/,
  "the sidebar should subscribe to the shared minute tick",
);
// One memoized clock per minute tick (cave-zs85n Task 6 gap-fix) — a bare
// Date.now() here would advance on every unrelated re-render, splitting the
// instant recentBuckets derives from away from the one row times/attention
// descriptions render with.
assert.match(
  workspaceSidebar,
  /const now = useMemo\(\(\) => Date\.now\(\), \[minuteTick\]\);/,
  "now should be a single clock snapshot memoized off the shared minute tick, not a per-render Date.now()",
);
assert.match(
  workspaceSidebar,
  /const recentBuckets = useMemo\([\s\S]*?\[view, recentSessions, now\],/,
  "recent buckets should re-derive from the same memoized now, not a separately-tracked minuteTick",
);
assert.match(
  workspaceSidebar,
  /bareTimeAt\(session\.updated_at \|\| session\.created_at, now\)/,
  'sidebar row times should render through bareTimeAt on the current render clock',
);
assert.ok(
  (workspaceSidebar.match(/<ThreadRow/g) ?? []).length >= 2,
  "both view branches should render the shared ThreadRow",
);

// Recent rows carry their project's identity tile: the time buckets
// interleave chats from every project, and the mapping comes from the SAME
// override-aware grouping the folder view uses (a dragged chat shows its
// override folder's tile, not its recorded cwd's).
assert.match(
  workspaceSidebar,
  /const sessionProjectById = useMemo\(\(\) => \{[\s\S]*?for \(const group of groups\)/,
  "Recent-row project lookup derives from the override-aware groups",
);
assert.match(
  workspaceSidebar,
  /indent="flat"\s*\n\s*project=\{sessionProjectById\.get\(session\.id\) \?\? null\}/,
  "Recent rows pass the project identity into ThreadRow",
);
assert.match(
  workspaceSidebar,
  /cnav__thread-proj[\s\S]*?<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\} size="sm"/,
  "ThreadRow renders the shared ProjectAvatar tile with an accessible project name",
);
assert.match(
  workspaceSidebar,
  /<span className="sr-only">\{`Project \$\{project\.name\} `\}<\/span>/,
  "the project name is announced even after the visual project tile collapses",
);
assert.doesNotMatch(workspaceSidebar, /cnav__footer|cnav__user-plan/, "ChatSidebar should not render the user plan footer");

console.log("chat-sidebar-wiring.test.ts passed");
