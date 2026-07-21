// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachmentsLib,
  attachStagingHook,
  chatDebugStoreSource,
  emptyStateSource,
  globalsSrc,
  menusHookSource,
  sessionHeader,
  source,
  splitReasoning,
  styles,
  turnRow,
} from "./chat-view-polish-fixtures.ts";

assert.doesNotMatch(
  globalsSrc,
  /\.cave-code-page[\s\S]*?cave-composer|data-code-inline-toolbar|code-mode-toggle/,
  "Retired Code page and inline toolbar styling should stay removed",
);
assert.match(
  source,
  /<header className="cave-chat-linear-header reveal-scope"/,
  "Chat header uses the linear session header and is the reveal scope for its hover-quiet provenance (cave-xsq.3)",
);
// Slim header (cave-xsq.3): the settled provenance quiets to a reveal-on-hover
// cluster so a resting header reads as just the conversation title.
assert.match(
  source,
  /cave-chat-meta-line__provenance\$\{state === "complete" \? " reveal-on-hover" : ""\}/,
  "the static meta provenance reveals on hover once the turn has settled (visible inline while streaming)",
);

assert.match(
  turnRow,
  /cave-linear-turn[\s\S]*cave-linear-turn-content/,
  "Chat turns should use the dense linear transcript anatomy",
);

assert.match(
  source,
  /import \{ formatChatRecency, formatTimestamp, useDateTimePrefs \} from "@\/lib\/datetime-format"/,
  "Chat turn headers should use the shared chat recency formatter",
);

assert.match(
  turnRow,
  /formatChatRecency\(turn\.createdAt, dtPrefs\)[\s\S]*cave-linear-turn-content--with-avatar[\s\S]*<UserChatAvatar className="cave-linear-turn-avatar cave-linear-turn-avatar--human" \/>[\s\S]*cave-linear-turn-name[\s\S]*operatorDisplayName[\s\S]*cave-linear-turn-badge cave-linear-turn-badge--op[\s\S]*cave-linear-turn-recency/,
  "User turns should render a Discord-like avatar/name/badge/recency header",
);
assert.match(
  styles,
  /\.cave-linear-turn--user \.cave-linear-turn-meta \{[\s\S]*justify-content: flex-start;/,
  "User turn author rows should align beside the avatar, not at the old right-aligned bubble edge",
);

assert.match(
  turnRow,
  /formatChatRecency\(turn\.createdAt, dtPrefs\)[\s\S]*cave-linear-turn-avatar-btn[\s\S]*<FamiliarIcon familiar=\{familiar\} size=\{expanded \? "xl" : "md"\} \/>[\s\S]*cave-linear-turn-name[\s\S]*familiar\.display_name[\s\S]*cave-linear-turn-recency[\s\S]*cave-linear-turn-meta-extra[\s\S]*cave-linear-turn-crest/,
  "Assistant turns render a compact circular avatar (chat-revamp 1b; grows when the inline card opens) + name + recency, with the crest/role/usage extras in a trailing reveal-on-hover cluster (cave-xsq.2)",
);
// Lean meta (cave-xsq.2): the static extras collapse into a reveal-on-hover
// cluster so the default row is just name + time; the turn content is the
// reveal scope so hovering the message brings them back.
assert.match(
  turnRow,
  /cave-linear-turn-content[^"]*reveal-scope/,
  "the assistant turn content is the reveal scope for its meta extras",
);
assert.match(
  turnRow,
  /className="cave-linear-turn-meta-extra reveal-on-hover"/,
  "crest/role/usage/peek live in a trailing reveal-on-hover cluster (name + time stay visible)",
);

assert.match(
  source,
  /<div className="cave-composer-shell">/,
  "Composer should use the CSS-controlled shell so linear chat can run full width",
);

assert.doesNotMatch(
  source,
  /FamiliarSwitcher/,
  "Chat header should not duplicate the avatar rail's familiar switcher",
);

assert.doesNotMatch(
  source,
  /cave-linear-turn-index/,
  "Dead turn-index className should be deleted from TurnRow (CSS rule is already display:none)",
);

assert.match(
  turnRow,
  /\{turn\.role === "user" \? operatorDisplayName : "System"\}/,
  "User and system turns should identify the speaker in the avatar row header, using the operator profile name",
);

assert.doesNotMatch(
  source,
  /\{familiar\.model \?\? "—"\}/,
  "Composer dock model pill should be removed — header meta line carries the model",
);

// The steady-state hint survives behind the recommended-next-path ghost fill
// (cave-h62k): with a recommendation the placeholder mirrors it (`⇥ to fill`),
// without one the classic `Message <familiar>…  ↵ to send` remains.
assert.match(
  source,
  /: `Message \$\{familiar\.display_name\}…  ↵ to send`/,
  "Composer placeholder should include ↵ to send hint in steady state",
);
assert.match(
  source,
  /busy\s*\? "Streaming… \(esc to cancel\)"/,
  "Streaming keeps its own placeholder ahead of the recommendation branch",
);

assert.match(
  source,
  /Worked for/,
  "settled reasoning shows a 'Worked for Xs' summary",
);
assert.doesNotMatch(
  source,
  /Ask for follow-up changes/,
  "retired Code surface composer copy should be removed",
);

assert.match(
  source,
  /PERMISSION_MODES|permissionMode/,
  "composer exposes the permission-mode (Access) control",
);
// Context, linked work, prompt-improvement, and response controls collapse into
// one grouped Chat options surface while attachment and voice stay one click away.
assert.match(
  source,
  /<div className="cave-composer-utility-row">[\s\S]*aria-label="Attach images, videos, or files"[\s\S]*aria-label="Voice call"[\s\S]*<ComposerActionsMenu/,
  "composer keeps direct attachment and voice controls before the grouped Chat options trigger",
);
const composerActionsMenuMatch = source.match(/<ComposerActionsMenu\b[\s\S]*?(?:\/>|<\/ComposerActionsMenu>)/);
assert.ok(composerActionsMenuMatch, "expected the ComposerActionsMenu JSX block in ChatView");
const composerActionsMenuBlock = composerActionsMenuMatch[0];
assert.match(
  composerActionsMenuBlock,
  /context=\{\{[\s\S]*linkedWork=\{\{[\s\S]*improve=\{\{[\s\S]*response=\{\{/,
  "the grouped menu receives Context, Linked Work, Improve, and Response contracts in visual order",
);
assert.doesNotMatch(
  source,
  /aria-label="Prompt snippets"/,
  "the standalone Prompt-snippets utility button is gone (folded into Chat options)",
);
assert.match(
  composerActionsMenuBlock,
  /improve=\{\{[\s\S]*promptSnippets:\s*\{[\s\S]*onSelect:\s*\(\) => setPromptSnippetsOpen\(true\)[\s\S]*enhance:\s*\{[\s\S]*onEnhance:\s*promptEnhance\.enhance/,
  "Chat options keeps Prompt snippets and prompt enhancement reachable through Improve",
);
assert.match(
  source,
  /const composerResponseSections:[\s\S]*label:\s*"Access"[\s\S]*label:\s*"Model"[\s\S]*label:\s*"Thinking"[\s\S]*label:\s*"Speed"[\s\S]*<ComposerActionsMenu[\s\S]*response=\{\{[\s\S]*hostValue:\s*composerHostValue[\s\S]*sections:\s*composerResponseSections/,
  "the grouped Response section carries Host, Access, Model, Thinking, and Speed in order",
);
assert.doesNotMatch(source, /<ComposerPlusMenu/, "legacy plus-menu composition should be gone");
assert.doesNotMatch(source, /<ComposerContextPill/, "legacy context-pill composition should be gone");
assert.doesNotMatch(source, /<ComposerOptionsMenu/, "legacy options-menu composition should be gone");
assert.doesNotMatch(
  source,
  /cave-composer-settings-row/,
  "the inline settings-row of control pills is gone (collapsed into Chat options)",
);
assert.match(
  source,
  /<div className="cave-composer-submit-row">[\s\S]*aria-label="Send message"/,
  "the circular Send owns the submit row (enhance moved into Chat options)",
);
assert.match(
  composerActionsMenuBlock,
  /enhance:\s*\{[\s\S]*onEnhance:\s*promptEnhance\.enhance/,
  "enhance rides the grouped menu's Improve section",
);
assert.doesNotMatch(
  source,
  /<span className="hidden sm:inline">Enhance<\/span>/,
  "Enhance prompt action should not render visible text in the chat composer",
);
assert.match(
  styles,
  /\.cave-composer-control-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
  "composer footer lays out the utility cluster and submit actions in one minimal row",
);
// The extracted response section renders each control inline (no nested
// popover) and keeps the connect-host dialog available to the grouped surface.
const optionsMenu = readFileSync(new URL("./composer-options-menu.tsx", import.meta.url), "utf8");
assert.match(optionsMenu, /role="radiogroup"/, "each control is an inline radiogroup");
assert.match(optionsMenu, /ComposerHostChoices/, "host renders inline via the shared choices (no nested popover)");
assert.match(optionsMenu, /ConnectHostDialog/, "connect-host dialog is rendered as a popover sibling");
// The chip internals moved to the shared module — pin them there.
const hostChip = readFileSync(new URL("./composer-host-chip.tsx", import.meta.url), "utf8");
assert.match(
  hostChip,
  /cave-host-status--\$\{optionStatus\}/,
  "host rows carry live status dots (popover, not a native select)",
);
assert.match(
  hostChip,
  /Connect new host/,
  "the host chip offers the connect-new-host flow",
);
assert.match(
  source,
  /\(controlsOverride\?\.runtimeHost \?\? runtimeHost\)/,
  "an explicit host pick (or the home composer's initial pick) rides the send body; auto stays absent",
);
// Home composer: host pick is threaded into the opened chat via initialControls.
// The ComposerHostChip was removed from the home toolbar (run-rail removed); runtimeHost
// state persists so future sessions pick up the correct host via initialControls.
const homeComposer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
assert.match(
  homeComposer,
  /const \[runtimeHost, setRuntimeHost\] = useState<string \| null>\(null\)/,
  "the home composer still tracks runtimeHost for threading into initialControls",
);
assert.match(
  homeComposer,
  /initialControls: \{ thinkingEffort, responseSpeed, \.\.\.\(runtimeHost \? \{ runtimeHost \} : \{\}\) \}/,
  "the home composer threads the host pick into the opened chat's first send",
);
assert.match(
  source,
  /ph:phone/,
  "desktop composer has a voice-call button",
);
// Voice new-chat (spec: docs/superpowers/specs/2026-07-18-voice-new-chat-design.md):
// the call button now renders unconditionally, even pre-session — clicking
// it before a session exists mints the conversation first
// (startVoiceConversation) instead of the button being hidden until the
// first send creates one. Full wiring (openVoiceCall, the pre-session mint,
// the target-session-scoped nonce re-entry) is pinned in voice-new-chat.test.ts.
assert.doesNotMatch(
  source,
  /\{sessionId \? \([\s\S]{0,400}aria-label="Voice call"/,
  "the voice call button is no longer gated behind a sessionId check",
);
assert.doesNotMatch(
  source,
  /aria-label="Voice call"[\s\S]{0,200}disabled=\{!sessionId\}/,
  "the voice call button must not be a permanently disabled affordance on the zero-turn landing",
);

assert.match(
  source,
  /const activeSlashOptionRef = useRef<HTMLButtonElement \| null>\(null\)/,
  "Slash menu should keep a ref to the active option so keyboard navigation can keep it visible",
);
assert.match(
  source,
  /activeSlashOptionRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/,
  "Arrow-key slash navigation should scroll the active option into the visible menu viewport",
);
assert.match(
  source,
  /ref=\{active \? activeSlashOptionRef : null\}/,
  "Only the active slash command row should receive the scroll target ref",
);

const splitFn = source.match(/function splitReasoning\([\s\S]*?\n}\n/)?.[0] ?? "";
assert.match(
  splitFn,
  /DEBUG_PREFIX_RE/,
  "splitReasoning should reference the debug-prefix filter regex",
);

const DEBUG_PREFIX_RE = /^\[[a-z][\w-]*(?:\/[\w-]+)+\][^\n]*\n?/gim;
assert.equal(
  "[model-fallback/decision] model fallback decision: decision=candidate_succeeded\nreal content".replace(DEBUG_PREFIX_RE, ""),
  "real content",
  "Debug-prefix filter should strip [model-fallback/decision] lines but keep real content",
);
assert.equal(
  "see [link] for details".replace(DEBUG_PREFIX_RE, ""),
  "see [link] for details",
  "Debug-prefix filter should leave inline brackets alone (only line-anchored matches strip)",
);
assert.equal(
  "[docs](https://example.com) is the place".replace(DEBUG_PREFIX_RE, ""),
  "[docs](https://example.com) is the place",
  "Debug-prefix filter should not eat line-leading markdown links (requires a /segment)",
);

assert.doesNotMatch(
  source,
  /cave-chat-linear-header-identity/,
  "Daemon ready/offline chip should be removed — sidebar presence covers it; mobile keeps its own pill",
);
assert.doesNotMatch(
  source,
  /<ChatLifecycleStatus\b/,
  "ChatLifecycleStatus bar should be folded into the header meta line",
);

assert.doesNotMatch(
  source,
  /cave-chat-back-button/,
  "the in-chat back-to-chats control is removed",
);

assert.match(
  source,
  /<div className="cave-chat-session-actions">[\s\S]*<ChatFindBar[\s\S]*<SessionOverflowMenu/,
  "Open chat header actions collapse to a find bar plus a single overflow menu",
);
assert.match(
  sessionHeader,
  /function SessionOverflowMenu[\s\S]*Debug session[\s\S]*Delete chat/,
  "Secondary session actions (project, voice, debug, delete) live in the overflow menu",
);

assert.match(
  styles,
  /\.cave-chat-linear-header\s*\{[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*var\(--space-1\) var\(--space-4\);/,
  "Open chat header is the 52px identity band (chat-revamp 1b)",
);
// Chat-revamp 1b: the header closes with a fade-ended divider (transparent →
// hairline 48px from each end), not a full-width hard border.
assert.match(
  styles,
  /\.cave-chat-linear-header::after\s*\{[\s\S]*var\(--border-hairline\) 48px,[\s\S]*var\(--border-hairline\) calc\(100% - 48px\),[\s\S]*transparent\s*\)/,
  "Chat header bottom edge is the fade-ended divider",
);
assert.doesNotMatch(
  styles.match(/\.cave-chat-linear-header\s*\{[^}]*\}/)?.[0] ?? "",
  /border-bottom/,
  "Chat header no longer draws a full-width hard bottom border",
);

// The standalone header icon buttons (thinking/debug/reflect/delete) are gone —
// their chrome went with them; the kebab and find affordance are the only
// always-visible session actions.
assert.doesNotMatch(
  styles,
  /\.cave-chat-icon-button/,
  "Dead standalone icon-button chrome is removed with the buttons",
);

// Ultra-minimal header: at rest only the ⋮ kebab shows; the quick actions
// collapse and reveal on hover / keyboard focus (touch devices show them).
assert.match(
  sessionHeader,
  /className="focus-ring cave-chat-actions-kebab"/,
  "The overflow kebab is tagged so it stays visible while sibling actions collapse",
);
assert.match(
  styles,
  /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*\.cave-chat-session-actions > \.focus-ring:not\(\.cave-chat-actions-kebab\):not\(\.cave-chat-find\)[\s\S]*opacity:\s*0;/,
  "Quick header actions are hidden at rest on pointer devices",
);
assert.match(
  styles,
  /\.cave-chat-linear-header:hover \.cave-chat-session-actions > \.focus-ring[\s\S]*opacity:\s*1;/,
  "Quick header actions reveal on header hover",
);
// "No plan limits" is suppressed — the plan chip only shows a real limit.
assert.match(
  source,
  /availability === "unconfigured"\) return null;/,
  "UsagePlanChip suppresses the uninformative 'No plan limits' chip",
);
assert.match(
  source,
  /function shortModelLabel\(/,
  "Model id is shortened for the header (vendor/claude- prefix dropped)",
);
assert.match(
  source,
  /<MetaLine\b/,
  "ChatView header should render the new MetaLine component",
);
assert.match(
  source,
  /shouldKeepLiveNewChatState\(\{[\s\S]*sessionId[\s\S]*currentSessionId: currentSessionRef\.current[\s\S]*turnCount: turnsRef\.current\.length[\s\S]*\}\)/,
  "Promoting a live new chat to its daemon session id should not reload missing history over the fresh transcript",
);
assert.match(
  source,
  /const liveSessionIdRef = useRef<string \| null>\(null\)/,
  "ChatView should synchronously track the session id that owns the live in-flight transcript",
);
assert.match(
  source,
  /function shouldKeepLiveNewChatState\(\{[\s\S]*liveSessionId[\s\S]*turnCount[\s\S]*liveSessionId === sessionId/,
  "Live new-chat preservation should not depend only on committed turn state",
);
assert.match(
  source,
  /if \(!res\.ok\) \{[\s\S]*if \(keepLiveSession\(\)\) \{[\s\S]*setHistoryState\("loaded"\)[\s\S]*return/,
  "A stale missing-history response must not clear an in-flight transcript for the same promoted session",
);
assert.match(
  source,
  /case "session":[\s\S]*liveSessionIdRef\.current = ev\.sessionId[\s\S]*currentSessionRef\.current = ev\.sessionId/,
  "Session promotion events should bind the live transcript to the daemon session before parent rerender",
);
assert.match(
  source,
  /const hasLiveGeneration = \(\) => \{[\s\S]*readLiveChatGeneration\(sessionId\)[\s\S]*isLiveSnapshotActive[\s\S]*if \(hasLiveGeneration\(\)\) \{[\s\S]*setHistoryState\("loaded"\)[\s\S]*return/,
  "A stale successful history response must not overwrite an active live transcript",
);
assert.match(
  source,
  /consumeChatSse\(res\.body, applyStreamEvent\)[\s\S]*\/api\/chat\/stream\?runId=\$\{encodeURIComponent\(runId\)\}&cursor=\$\{cursor\}/,
  "A chat stream that ends without done reattaches through the buffered stream endpoint",
);

const initialStreamSection =
  source.match(/let initialStreamError = "Initial stream ended before completion";[\s\S]*?let recoveryError: string \| null = null;/)?.[0] ?? "";
assert.match(
  initialStreamSection,
  /if \(controller\.signal\.aborted\) throw error;/,
  "An aborted initial consumeChatSse read must rethrow the original error",
);
assert.match(
  initialStreamSection,
  /initialStreamError = conciseStreamError\(error, "Initial stream failed"\);/,
  "A non-aborted initial consumeChatSse failure should store the concise initialStreamError",
);

const recoverySection =
  source.match(/let recoveryError: string \| null = null;[\s\S]*?if \(sawDone\) \{/)?.[0] ?? "";
assert.equal(
  (recoverySection.match(/publishStreamHealth\(\{\s*type: "resume"/g) ?? []).length,
  1,
  "Resume health should publish exactly once",
);
const resumeDispatchIndex = recoverySection.indexOf('type: "resume"');
const recoveryFetchIndex = recoverySection.indexOf("/api/chat/stream?runId=");
assert.ok(
  resumeDispatchIndex !== -1 && recoveryFetchIndex !== -1 && resumeDispatchIndex < recoveryFetchIndex,
  "Resume dispatch must appear before the recovery fetch",
);
assert.match(
  recoverySection,
  /recoveryError = recovery\.ok\s*\?\s*"Recovery stream unavailable \(missing response body\)"\s*:\s*`Recovery stream unavailable \(HTTP \$\{recovery\.status\}\)`;/,
  "Recovery errors should preserve the exact concise wording for missing bodies and non-OK responses",
);

assert.match(
  source,
  /useReducer\(\s*chatStreamHealthReducer,\s*EMPTY_CHAT_STREAM_CLIENT_HEALTH,\s*\)/,
  "Each ChatView owns its stream-health state instead of reading a global last-writer snapshot",
);
assert.match(
  source,
  /const streamHealthRef = useRef\(EMPTY_CHAT_STREAM_CLIENT_HEALTH\);[\s\S]*?streamHealthRef\.current = next;[\s\S]*?dispatchStreamHealth\(action\)/,
  "A mutable stream-health ref should advance synchronously with every reducer action",
);
assert.match(
  source,
  /const runId = crypto\.randomUUID\(\);[\s\S]*?currentStreamHealthRunIdRef\.current = runId;[\s\S]*?applyStreamHealthAction\(\{\s*type: "connect",\s*runId,\s*at: new Date\(\)\.toISOString\(\),?\s*\}\)/,
  "A send claims stream-health ownership before starting its client-health record",
);

const streamHealthPublisher =
  source.match(/const publishStreamHealth = \([\s\S]*?\n    \};/)?.[0] ?? "";
assert.match(
  streamHealthPublisher,
  /currentStreamHealthRunIdRef\.current !== runId/,
  "Only the currently displayed run may publish stream health",
);
assert.match(
  streamHealthPublisher,
  /const displayedSessionId = currentSessionRef\.current;[\s\S]*?displayedSessionId === liveGeneration\.sessionId[\s\S]*?liveGeneration\.sessionId == null[\s\S]*?displayedSessionId === liveGeneration\.originSessionId/,
  "Health publishing verifies that the generation still owns the displayed thread",
);
assert.match(
  streamHealthPublisher,
  /applyStreamHealthAction\(\{\s*type: "hydrate",\s*health: generationStreamHealth/,
  "Owned stream-health actions reach the per-pane reducer",
);

const sendStreamHealthSection =
  source.match(/const runId = crypto\.randomUUID\(\);[\s\S]*?\n    \} finally \{/)?.[0] ?? "";
assert.equal(
  (sendStreamHealthSection.match(/applyStreamHealthAction\(\{\s*type: "connect"/g) ?? []).length,
  1,
  "Only connect dispatches directly; later run actions must pass ownership checks",
);

const pendingHealthSection =
  source.match(/let pendingStreamHealthEvent:[\s\S]*?const chunkCoalescer = createChunkCoalescer\(\{[\s\S]*?\n    \}\);/)?.[0] ?? "";
assert.match(
  pendingHealthSection,
  /const flushPendingStreamHealthEvent = \(\) => \{[\s\S]*?publishStreamHealth\(\{\s*type: "event",[\s\S]*?cursor: latest\.cursor,[\s\S]*?at: latest\.at/,
  "The latest valid event cursor is published by a coalesced flush helper",
);
assert.match(
  pendingHealthSection,
  /apply: \(text\) => \{\s*flushPendingStreamHealthEvent\(\);\s*applyAssistantChunk\(text, assistantId, liveGeneration\);\s*\}/,
  "Health cursor publication shares the assistant chunk coalescer cadence",
);

const applyStreamEventSection =
  source.match(/const applyStreamEvent = \(ev: StreamEvent, eventCursor: number \| null\) => \{[\s\S]*?\n      \};/)?.[0] ?? "";
assert.match(
  applyStreamEventSection,
  /if \(eventCursor != null\) \{[\s\S]*?cursor = Math\.max\(cursor, eventCursor\);[\s\S]*?pendingStreamHealthEvent = \{ cursor, at: new Date\(\)\.toISOString\(\) \};/,
  "Valid SSE cursors are recorded locally instead of dispatching React state per token",
);
assert.doesNotMatch(
  applyStreamEventSection,
  /dispatchStreamHealth|type: "event"/,
  "The per-event hot path must not dispatch stream-health React state",
);
assert.match(
  applyStreamEventSection,
  /if \(ev\.kind === "done"\) sawDone = true;[\s\S]*?if \(ev\.kind === "assistant_chunk"\)/,
  "A parsed done event is observed immediately before any later reader failure",
);
assert.match(
  applyStreamEventSection,
  /else \{[\s\S]{0,300}?chunkCoalescer\.flush\(\);\s*flushPendingStreamHealthEvent\(\);[\s\S]*?handleEvent\(ev, assistantId, request, liveGeneration\);/,
  "Non-chunk events publish the latest health cursor before lifecycle handling",
);
assert.match(
  source,
  /sawDone = sawDone \|\| initial\.sawDone;[\s\S]*?sawDone = sawDone \|\| resumed\.sawDone;/,
  "Reader results cannot downgrade a done event already observed by the callback",
);
assert.match(
  recoverySection,
  /flushStreamUpdates\(\);[\s\S]*?publishStreamHealth\(\{\s*type: "resume",[\s\S]{0,180}?error: initialStreamError/,
  "A recovery attempt records the initial transport error in stream health",
);
assert.match(
  source,
  /ev\.kind === "progress" && ev\.id === "resume-gap"\) \{[\s\S]{0,180}?needsTranscriptResync = true;[\s\S]{0,180}?publishStreamHealth\(\{\s*type: "gap"/,
  "An evicted replay gap must record health degradation and rehydrate the persisted transcript",
);
assert.match(
  source,
  /flushStreamUpdates\(\);\s*if \(sawDone\) \{[\s\S]{0,180}?publishStreamHealth\(\{\s*type: "settle"[\s\S]{0,240}?else if \(!controller\.signal\.aborted\) \{[\s\S]{0,700}?needsTranscriptResync = true;[\s\S]{0,240}?publishStreamHealth\(\{\s*type: "degrade"/,
  "A completed stream settles health while an incomplete non-aborted stream degrades and resyncs",
);
assert.match(
  source,
  /flushStreamUpdates\(\);\s*if \(\(err as Error\)\?\.name === "AbortError" && sawDone\) \{[\s\S]*?\} else if \(\(err as Error\)\?\.name === "AbortError"\) \{[\s\S]{0,180}?publishStreamHealth\(\{\s*type: "stop"/,
  "An intentional AbortError records a stopped stream",
);
assert.match(
  source,
  /let sawDone = false;[\s\S]*?\n    try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?if \(\(err as Error\)\?\.name === "AbortError" && sawDone\) \{[\s\S]*?type: "settle"[\s\S]*?\} else if \(\(err as Error\)\?\.name === "AbortError"\) \{[\s\S]*?type: "stop"[\s\S]*?lifecycle: "cancelled"/,
  "A parsed done event must settle instead of being overwritten by a later AbortError, while a pre-done abort remains cancelled",
);

const earlyHttpFailureSection =
  source.match(/const message = await chatBridgeFailureMessage\(res\);[\s\S]*?\n        return;\n      \}/)?.[0] ?? "";
assert.match(
  earlyHttpFailureSection,
  /error: conciseStreamError\(surfacedMessage, "Chat bridge request failed"\)/,
  "Dynamic HTTP response text is bounded before stream health stores it",
);
const outerSendCatch =
  source.match(/\} catch \(err\) \{\n      \/\/ Apply any buffered streamed text FIRST[\s\S]*?\n    \} finally \{/)?.[0] ?? "";
assert.match(
  outerSendCatch,
  /const message = conciseStreamError\(err, "send failed"\);[\s\S]*?error: message/,
  "The outer send failure is bounded before stream health stores it",
);

const navigationHealthSection =
  source.match(/const streamHealthSessionRef = useRef\(sessionId\);[\s\S]*?\}, \[sessionId\]\);/)?.[0] ?? "";
assert.match(
  navigationHealthSection,
  /previousSessionId == null[\s\S]*?sessionId != null[\s\S]*?liveSessionIdRef\.current === sessionId[\s\S]*?currentSessionRef\.current === sessionId/,
  "Null-to-assigned health preservation requires the exact promoted live session identity",
);
assert.doesNotMatch(
  navigationHealthSection,
  /streamHealth\.phase/,
  "Session promotion identity must not be inferred from a generic active phase",
);
assert.match(
  navigationHealthSection,
  /currentStreamHealthRunIdRef\.current = null;[\s\S]*?applyStreamHealthAction\(\{ type: "reset" \}\)/,
  "Actual navigation retires the current health run before resetting its state",
);
assert.match(
  source,
  /function adoptLiveGenerationMetadata\([\s\S]*?currentStreamHealthRunIdRef\.current = live\.runId \?\? live\.streamHealth\?\.runId \?\? null;[\s\S]*?applyStreamHealthAction\(\{ type: "hydrate", health: restoredHealth \}\);[\s\S]*?stopKeysRef\.current = \{[\s\S]*?runId: currentStreamHealthRunIdRef\.current,[\s\S]*?sessionId: targetSessionId/,
  "Adoption should restore run ownership, reducer health, and run-keyed stop/debug lookup state",
);
assert.match(
  source,
  /subscribeLiveChatGeneration\(sessionId, \(live\) => \{[\s\S]*?const latest = readLiveChatGeneration\(sessionId\);[\s\S]*?if \(!live && latest\) return;[\s\S]*?if \(live && latest && latest !== live\) return;[\s\S]*?currentStreamHealthRunIdRef\.current !== notificationRunId[\s\S]*?return;/,
  "Queued older snapshots and stale settle notifications must not steal ownership from a newer run",
);
assert.match(
  source,
  /recordLiveChatGeneration\(\{\s*sessionId: liveGeneration\.sessionId,[\s\S]*?runId,[\s\S]*?streamHealth: generationStreamHealth/,
  "Existing-session sends should persist run ID and current health in their initial live snapshot",
);
assert.match(
  source,
  /case "session":[\s\S]*?persistLiveTurns\([\s\S]*?runId: liveGeneration\.runId,[\s\S]*?streamHealth: liveGeneration\.streamHealth\(\)/,
  "Brand-new chats should persist run-keyed health when the session event creates the registry snapshot",
);
assert.match(
  source,
  /clearLiveChatGeneration\(liveGeneration\.sessionId, runId\)/,
  "A settling older run must not clear a newer run's registry snapshot",
);

assert.match(
  source,
  /import \{ DebugPane \} from "@\/components\/debug-pane"/,
  "ChatView imports the real DebugPane once its props accept stream health",
);
assert.doesNotMatch(
  source,
  /DebugPaneBase|function DebugPane\(/,
  "The temporary local forwarding wrapper must be removed",
);
assert.doesNotMatch(
  source,
  /type ChatDebugSnapshot/,
  "The wrapper-only debug snapshot prop type should leave ChatView after direct DebugPane integration",
);
assert.match(
  source,
  /<DebugPane[\s\S]{0,300}?streamHealth=\{streamHealth\}/,
  "The owning ChatView passes its own stream health directly to DebugPane",
);
const debugPublishCall = source.match(/publishChatDebugState\(debugToken, \{[\s\S]*?\}\);/)?.[0] ?? "";
assert.match(
  debugPublishCall,
  /publishChatDebugState\(debugToken, \{\s*sessionId,\s*session: session \?\? null,\s*familiar,\s*turns\s*\}\);/,
  "The shared debug snapshot should stay limited to session, familiar, and turns",
);
assert.doesNotMatch(
  debugPublishCall,
  /streamHealth/,
  "The shared debug snapshot must not carry streamHealth",
);
const chatDebugSnapshotType = chatDebugStoreSource.match(/export type ChatDebugSnapshot = \{[\s\S]*?\n\};/)?.[0] ?? "";
assert.doesNotMatch(
  chatDebugSnapshotType,
  /streamHealth/,
  "ChatDebugSnapshot should not define streamHealth",
);
assert.match(
  composerActionsMenuBlock,
  /linkedWork=\{\{[\s\S]*linkedContext,[\s\S]*onOpenTask,[\s\S]*sessionId,[\s\S]*onLinkedContextChange:\s*setLinkedContext/,
  "ChatView should route task and GitHub linked context through the grouped menu",
);
assert.match(
  composerActionsMenuBlock,
  /handoff:\s*\{ turns: activePath, familiarId: familiar\.id \?\? null, projectId: projectIdDraft \},[\s\S]*sessionSettled:/,
  "Linked Work keeps the active-path handoff and settled-session gate",
);
assert.doesNotMatch(source, /<LinkedContextRow\b/, "legacy direct LinkedContextRow composition should be gone");
assert.doesNotMatch(source, /linkedContextRow/, "legacy linked-context footer row state should be gone");
assert.doesNotMatch(source, /cave-composer-footer-band/, "the empty linked-context footer band should be removed");
assert.doesNotMatch(
  source,
  /hasLinkedChips/,
  "The header no longer hosts the linked-context row (no chip-count gating)",
);

assert.doesNotMatch(
  turnRow,
  /\{toolCount\} tool\{toolCount === 1 \? "" : "s"\}/,
  "Turn meta should drop the tool count — the Tool activity disclosure summary carries running/error/done counts",
);
assert.doesNotMatch(
  turnRow,
  /const duration = fmtDuration\(turn\.durationMs\)/,
  "Turn meta should drop per-turn duration — the header MetaLine carries the session duration",
);

// Per-turn provenance peek: model/cwd/duration aren't shown inline (above), but
// a quiet ⓘ in the meta row reveals them on hover so older turns are
// inspectable without opening the debug pane.
assert.match(
  source,
  /function turnMetaPeekTitle\(turn: Turn\): string \| null/,
  "A turnMetaPeekTitle helper assembles a turn's model · cwd · duration · usage line",
);
assert.match(
  turnRow,
  /const metaPeek = turn\.pending \? null : turnMetaPeekTitle\(turn\)/,
  "Settled assistant turns compute a meta peek (skipped while streaming)",
);
assert.match(
  turnRow,
  /className="cave-turn-peek focus-ring"[\s\S]{0,120}title=\{metaPeek\}/,
  "The peek renders as a focusable cave-turn-peek affordance with the meta as its title tooltip",
);
assert.match(
  styles,
  /\.cave-turn-peek\s*\{[\s\S]*?opacity:\s*0\.45/,
  "The peek is faint by default so the turn meta row stays clean",
);

assert.doesNotMatch(
  emptyStateSource,
  /\{modKey\}↵ to send/,
  "Empty-state hint must not advertise a modifier — plain Enter sends (onComposerKey)",
);
assert.match(
  emptyStateSource,
  /Ready for the next thread — \/ for commands, @ for files\./,
  "Empty-state hint uses the redesigned launch-screen ready copy",
);
// Discoverability, dosed: one terse fragment for the composer's hidden powers.
// ⌘K already lives in the hub footer and "↵ to send" in the placeholder —
// repeating either here would exceed the dose.
assert.match(
  emptyStateSource,
  /\/ for commands/,
  "Empty-state hint surfaces the slash-command entry point (skills, prompts, /model)",
);

assert.match(
  sessionHeader,
  /icon="ph:pencil-simple"[\s\S]{0,200}dispatchEvent\(new Event\("cave:chat-rename"\)\)[\s\S]{0,160}Rename chat/,
  "Rename lives in the session overflow menu (Codex/ChatGPT idiom), firing cave:chat-rename",
);
assert.match(
  sessionHeader,
  /addEventListener\("cave:chat-rename", onRename\)[\s\S]{0,80}setEditing\(true\)|onRename = \(\) => setEditing\(true\)/,
  "ChatTitleEditable enters edit mode when the overflow menu fires cave:chat-rename",
);
assert.match(
  sessionHeader,
  /aria-label="Rename chat"[\s\S]{0,200}setEditing\(true\)/,
  "Chat title carries an explicit, labeled rename button — click-to-rename and the overflow item alone are not discoverable",
);
assert.match(
  sessionHeader,
  /aria-label="Rename chat"[\s\S]{0,400}ph:pencil-simple/,
  "The title's rename button uses the same pencil icon as the overflow menu item",
);

// — CHAT-D2-01: slash menu keyboard contract ("↵ run · Tab complete · esc cancel") —
// The menu branches live in the shared use-inline-slash-menus hook; chat's
// onComposerKey delegates to its dispatcher. Semantics pin the hook, ordering
// pins chat's handler.
const composerKey = source.match(/const onComposerKey = [\s\S]*?\n  \};/)?.[0] ?? "";
const slashBranch = menusHookSource.match(/if \(slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0\) \{[\s\S]*?\n      \}/)?.[0] ?? "";

assert.match(
  slashBranch,
  /if \(e\.key === "Enter" && !e\.shiftKey\) \{[\s\S]*slashSuggestions\[slashIdx\][\s\S]*onRunCommand\(cmd\)/,
  "Slash-menu Enter must run the highlighted suggestion, not send the partially typed text",
);
assert.match(
  source,
  /onRunCommand: \(cmd\) => \{\s*\n\s*intentFromSlash\(cmd\.name\);\s*\n\s*\}/,
  "chat routes a run command through intentFromSlash (home submits the typed text instead)",
);
assert.match(
  slashBranch,
  /cmd\.argPlaceholder && canonicalize\(text\.trim\(\)\) !== cmd\.name[\s\S]*setText\(cmd\.name \+ " "\)/,
  "Slash-menu Enter autocompletes argument-taking commands (like Tab) instead of running them bare",
);
assert.match(
  menusHookSource,
  /if \(e\.key === "Escape" && menuOpen\) \{[\s\S]{0,400}setSlashDismissed\(true\);[\s\S]{0,40}return true;/,
  "Esc with any inline menu open must dismiss the menu",
);
assert.ok(
  composerKey.includes("handleMenuKey(e)") &&
    composerKey.indexOf("handleMenuKey(e)") < composerKey.indexOf("cancelSend()"),
  "Esc precedence: the menu dispatcher (which consumes Esc while open) runs before the busy-cancel branch can kill the stream",
);
assert.match(
  menusHookSource,
  /setSlashIdx\(0\);\s*\n\s*setSlashDismissed\(false\);\s*\n\s*\}, \[text\]\);/,
  "Editing the input must re-arm dismissed slash suggestions",
);
assert.match(
  source,
  /\{keys\.up\}\{keys\.down\} navigate · \{keys\.enter\} run · Tab complete · esc cancel/,
  "Slash menu footer promises run/complete/cancel — keep it in sync with onComposerKey",
);

// — CHAT-D10-01 + CHAT-D13-03: instant scroll pin, intent-based release —
const pinEffect = source.match(/\/\/ Pin: while following[\s\S]*?\}, \[turns, schedulePin\]\);/)?.[0] ?? "";
assert.match(
  pinEffect,
  /requestAnimationFrame\(\(\) => \{[\s\S]*el\.scrollTop = el\.scrollHeight/,
  "Streaming pin must set scrollTop instantly inside a rAF (coalesced per frame)",
);
assert.doesNotMatch(
  pinEffect,
  /scrollIntoView|behavior:/,
  "The turns-change pin path must never queue a smooth scrollIntoView per SSE chunk",
);
assert.match(
  pinEffect,
  /if \(pinFrameRef\.current !== null\) return/,
  "Pin must coalesce multiple turns updates into one frame, not stack rAF callbacks",
);
assert.doesNotMatch(
  source,
  /scrollIntoView\(\{ behavior: "smooth"/,
  "No explicit smooth scrollIntoView anywhere — the reduced-motion CSS kill switch cannot override explicit options",
);
assert.match(
  source,
  /addEventListener\("wheel", onWheel, \{ passive: true \}\)/,
  "Release must hook wheel input (passive) for intent detection",
);
assert.match(
  source,
  /if \(e\.deltaY < 0 && followingRef\.current && scrollable\(\)\) updateFollowing\(false\)/,
  "Wheel-up (negative deltaY) on a scrollable transcript is the user intent that detaches following",
);
assert.match(
  source,
  /addEventListener\("touchmove", onTouchMove, \{ passive: true \}\)/,
  "Release must hook touchmove (passive) for touch intent detection",
);
assert.match(
  source,
  /<div\b(?=[^>]*\bref=\{scrollRef\})(?=[^>]*\btabIndex=\{0\})(?=[^>]*\bclassName="cave-chat-transcript)[^>]*>/,
  "Transcript scroller must be focusable so PageUp/Home/ArrowUp keydown releases following",
);
assert.match(
  source,
  /y > lastTouchY && followingRef\.current && scrollable\(\)\) \{\s*updateFollowing\(false\)/,
  "Touch drag toward earlier content (finger moving down) detaches following",
);
assert.match(
  source,
  /if \(followingRef\.current\) return;[\s\S]{0,200}gap <= 4\) updateFollowing\(true\)/,
  "Re-pin only on user scrolls reaching the true bottom (small epsilon); pin's own scroll events are no-ops while following",
);
assert.match(
  source,
  /updateFollowing\(true\);[\s\S]{0,600}prefers-reduced-motion: reduce[\s\S]{0,200}behavior: reduceMotion \? "auto" : "smooth"[\s\S]{0,400}aria-label=/,
  "Scroll FAB must re-engage following and gate its smooth scroll on prefers-reduced-motion (CHAT-D10-03: aria-label now includes new message count)",
);
assert.match(
  source,
  /aria-label=\{`Scroll to bottom\$\{newTurnsCount \? ` \(\$\{newTurnsCount\} new message\$\{newTurnsCount !== 1 \? "s" : ""\}\)` : ""\}`\}/,
  "Scroll FAB aria-label must include the pluralized message noun for screen readers",
);
assert.match(
  source,
  /\{!following && \(/,
  "Scroll FAB visibility is driven by the following state",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*updateFollowing\(true\);[\s\S]*?\}, \[sessionId, updateFollowing\]\)/,
  "A freshly opened chat / session switch must re-engage following by default",
);

const workspaceSource = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const slashHelper = workspaceSource.match(/const handleSlashIntent = [\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(
  slashHelper,
  /\n    return false;\n  \};$/,
  "Workspace slash helper must return false for unknown commands so chat-view's Unknown-command feedback is reachable",
);
assert.equal(
  (workspaceSource.match(/onSlashFromChat=\{handleSlashIntent\}/g) ?? []).length,
  2,
  "General chat and task work must both report unhandled slash commands honestly (no unconditional return-true wrappers)",
);

// — CHAT-D1-02: paste-to-attach (clipboard files route through attachFiles) —
// Paste-to-attach moved into the shared use-attachment-staging hook; the
// composer pin holds the wiring, the hook pins hold the files-win semantics.
assert.match(
  source,
  /onPaste=\{handlePaste\}/,
  "Composer paste routes through the shared attachment-staging handler",
);
const pasteHandler = attachStagingHook.match(/const handlePaste = useCallback\([\s\S]*?\[addFiles\],\s*\);/)?.[0] ?? "";
assert.match(
  pasteHandler,
  /e\.clipboardData\.items[\s\S]*item\.kind === "file"[\s\S]*item\.getAsFile\(\)/,
  "Composer paste must inspect clipboardData.items for files (screenshots, copied images), not just text/plain",
);
assert.match(
  pasteHandler,
  /if \(pastedFiles\.length > 0\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*void addFiles\(pastedFiles\);/,
  "Pasted files win over any clipboard text and route through the existing attach pipeline; preventDefault only fires when files were consumed",
);
assert.doesNotMatch(
  source,
  /CsvImportModal|looksLikeCsv|setCsvRaw/,
  "ChatView stays decoupled from the feature/library CSV import flow",
);

// — CHAT-D1-03: drag-and-drop attach on the chat surface —
assert.match(
  attachmentsLib,
  /function hasDraggedFiles\(types: DataTransfer\["types"\]\): boolean \{[\s\S]*Array\.from\(types\)\.includes\("Files"\)/,
  "Drag file detection must normalize DataTransfer.types before calling includes for WebKit/WebView DOMStringList compatibility",
);
assert.doesNotMatch(
  source + attachStagingHook,
  /dataTransfer\.types\.includes\("Files"\)/,
  "Drag handlers must not call DataTransfer.types.includes directly; WebKit DOMStringList may not implement includes",
);
// The drag state machine lives in the shared use-attachment-staging hook; the
// chat section spreads its handler bundle (whole-surface drop target).
assert.match(
  source,
  /onKeyDown=\{onChatSectionKeyDown\}\s*\{\.\.\.dropHandlers\}/,
  "the whole chat section is the drop target (handlers spread from the shared hook)",
);
assert.match(
  attachStagingHook,
  /onDragEnter: \(e: DragEvent\) => \{\s*\n\s*if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?dragDepthRef\.current \+= 1;\s*\n\s*setDropActive\(true\);/,
  "dragenter must guard on a Files-type drag (text selections must not hijack) and use counter-based depth tracking",
);
assert.match(
  attachStagingHook,
  /onDragOver: \(e: DragEvent\) => \{\s*\n\s*if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;\s*\n\s*e\.preventDefault\(\);/,
  "dragover must preventDefault (only for file drags) so the browser allows the drop",
);
assert.match(
  attachStagingHook,
  /onDragLeave: \(e: DragEvent\) => \{[\s\S]*?dragDepthRef\.current = Math\.max\(0, dragDepthRef\.current - 1\);\s*\n\s*if \(dragDepthRef\.current === 0\) setDropActive\(false\);/,
  "dragleave must decrement the depth counter and only hide the overlay at depth 0 — child-element transitions must not flicker it",
);
assert.match(
  attachStagingHook,
  /onDrop: \(e: DragEvent\) => \{\s*\n\s*dragDepthRef\.current = 0;\s*\n\s*setDropActive\(false\);[\s\S]*?if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?void addFiles\(e\.dataTransfer\.files\);/,
  "drop must reset the overlay state and route dataTransfer.files through the existing attach pipeline",
);
assert.match(
  source,
  /\{dropActive \? \(\s*\n\s*<div className="cave-drop-overlay" aria-hidden="true">[\s\S]*?Drop files to attach/,
  "A visible drop overlay must render while a file drag is over the chat surface",
);
const caveChatCss = styles;
assert.match(
  caveChatCss,
  /\.cave-drop-overlay \{[\s\S]*?pointer-events: none;[\s\S]*?\n\}/,
  "The drop overlay must be pointer-events: none so it never intercepts clicks or the drop itself",
);
assert.match(
  caveChatCss,
  /\.cave-chat-linear \{\s*\n\s*position: relative;/,
  "The chat section must anchor the absolutely-positioned drop overlay",
);

// — CHAT-D1-04: @-mention repo files in the composer —
