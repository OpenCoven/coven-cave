// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
// The empty state (the familiar's starting page) was extracted when it became
// task-aware; its launch-screen pins now read the dedicated file.
const emptyStateSource = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
const globalsSrc = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// fileToAttachment moved to the shared lib (reused by the home composer).
const attachmentsLib = readFileSync(new URL("../lib/chat-attachments.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  globalsSrc,
  /\.cave-code-page[\s\S]*?cave-composer|data-code-inline-toolbar|code-mode-toggle/,
  "Retired Code page and inline toolbar styling should stay removed",
);
const turnRow = source.match(/function TurnRowImpl[\s\S]*?\n}\n\ntype TurnRowProps/)?.[0] ?? "";
const splitReasoning = source.match(/function splitReasoning[\s\S]*?\n}\n\n\/\/ ── ChatEmptyState/)?.[0] ?? "";

assert.match(
  source,
  /fetch\("\/api\/chat\/send"[\s\S]*body: JSON\.stringify\(\{[\s\S]*attachments: stripPreviewOnlyAttachmentFieldsKeepingImages\(outgoingAttachments\)/,
  "Chat send should strip preview-only attachment fields before POSTing, keeping image payloads so the harness can see them",
);

assert.match(
  attachmentsLib,
  /if \(file\.size > MAX_ATTACHMENT_IMAGE_BYTES\) \{[\s\S]*?attachment\.truncated = true;/,
  "Oversized image attachments should be capped at capture time and marked like truncated text",
);

assert.match(
  source,
  /const isImage = \(attachment\.mimeType \?\? attachment\.type\)\?\.startsWith\("image\/"\)/,
  "Attachment lightbox should fall back to legacy attachment.type for images",
);

assert.match(
  source,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Attachment lightbox should expose modal dialog semantics",
);

assert.match(
  splitReasoning,
  /tagRe\.exec\(text\)/,
  "Reasoning splitting should use a streaming-safe tag scanner",
);

assert.match(
  splitReasoning,
  /if \(activeTag\) \{[\s\S]*reasoningParts\.push\(text\.slice\(reasoningStart\)\.trim\(\)\)/,
  "Unclosed reasoning blocks should be captured instead of leaking raw tags into chat",
);

assert.match(
  splitReasoning,
  /if \(!activeTag && closing\) \{[\s\S]*cursor = tagRe\.lastIndex/,
  "Unmatched closing reasoning tags should be hidden instead of leaking raw markup into chat",
);

assert.match(
  turnRow,
  /<ToolGroup|<ReasoningBlock/,
  "Assistant turns should render tool-use and reasoning chrome in collapsed transcript blocks",
);

assert.match(
  turnRow,
  /const reasoningSplit = splitReasoning\(extractAgentAttachmentMarkers\(turn\.text\)\.text\)[\s\S]*const inlineReasoning = reasoningSplit\.reasoning[\s\S]*const \{ visible, suggestions: nextPaths \} = extractNextPaths\(reasoningSplit\.visible\)/,
  "Assistant turns should split visible content from collapsible reasoning before extracting next-path suggestions",
);

assert.match(
  source,
  /function ReasoningBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Thinking[\s\S]*<RichText text=\{reasoning\}/,
  "ReasoningBlock should render thinking in a collapsed disclosure with formatted text",
);

// Thinking is togglable: the global Show-thinking preference opens every
// reasoning block at once via a controlled `open` (default-collapsed in markup).
assert.match(
  source,
  /function ReasoningBlock[\s\S]*const \[showThinking\] = useShowThinking\(\)[\s\S]*open=\{showThinking \|\| undefined\}/,
  "ReasoningBlock open state is driven by the global Show-thinking preference",
);
assert.match(
  source,
  /function HeaderThinkingToggle[\s\S]*useShowThinking\(\)[\s\S]*aria-pressed=\{showThinking\}/,
  "A header toggle flips the global Show-thinking preference",
);

assert.match(
  source,
  /function ToolGroup[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Tool activity[\s\S]*tools\.map[\s\S]*<ToolBlock/,
  "ToolGroup should render tool calls in a collapsed disclosure",
);

assert.match(
  source,
  /function ToolBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*<summary[\s\S]*tool\.name[\s\S]*<ToolInputView input=\{tool\.input\}[\s\S]*<SyntaxBlock text=\{prettyToolOutput\(tool\.output\)\}/,
  "ToolBlock keeps payloads collapsed, renders readable input fields, and pretty-prints output",
);

// JSON tool input is converted to a human-readable labelled field list, with
// the raw JSON available behind a toggle.
assert.match(
  source,
  /function ToolInputView[\s\S]*toolReadableFields\(input\)[\s\S]*showRaw \? <SyntaxBlock text=\{input\}/,
  "ToolInputView renders readable fields by default and raw JSON on toggle",
);
assert.match(
  source,
  /function ToolFieldList[\s\S]*field\.label[\s\S]*field\.value/,
  "ToolFieldList renders each readable field's humanised label and value",
);

// Tool rows are color-coded by category for quick visual inspection.
assert.match(source, /import \{ toolVisual \} from "@\/lib\/tool-visual"/, "chat view imports the tool visual map");
assert.match(
  source,
  /function ToolBlock[\s\S]*const visual = toolVisual\(tool\.name\)[\s\S]*data-tool-category=\{visual\.category\}[\s\S]*<Icon name=\{visual\.icon\}/,
  "ToolBlock should color-code by tool category (data-tool-category + per-category icon)",
);

// Tool-use disclosures must never default open (the transcript stays clean).
// ReasoningBlock is the one exception — its `open` is a controlled binding to
// the global Show-thinking preference (asserted above), not a hardcoded default.
assert.doesNotMatch(
  [
    source.match(/function ToolGroup[\s\S]*?function ToolBlock/)?.[0] ?? "",
    source.match(/function ToolBlock[\s\S]*?function ToolInputView/)?.[0] ?? "",
  ].join("\n"),
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Tool-use disclosures must not default open",
);
// A hardcoded `open` (open with no binding) on the reasoning block would defeat
// the toggle — only the controlled `open={showThinking || undefined}` is allowed.
assert.doesNotMatch(
  source.match(/function ReasoningBlock[\s\S]*?function ProgressGroup/)?.[0] ?? "",
  /<details[^>]*\sopen(?:\s|>)/,
  "ReasoningBlock must not hardcode the disclosure open",
);

// --- Tool activity renders in a designated section on settled turns ---

// No per-turn show/hide toggle: the designated section is always present
// (collapsed) instead, so prose and tool usage are cleanly separated.
assert.doesNotMatch(
  turnRow,
  /showTools|showToolsOverride|cave-turn-tools-toggle/,
  "the settled-turn tool show/hide toggle is gone — tools live in a designated section",
);

assert.match(
  turnRow,
  /segments=\{renderSegments\}/,
  "MessageBubble renders the artifact-aware renderSegments",
);

assert.match(
  turnRow,
  /renderSegments = split\.some\(\(s\) => s\.kind === "block"\) \? split : undefined/,
  "settled turns render prose (+ artifacts) only — tool blocks are not woven into the text",
);

assert.match(
  turnRow,
  /!turn\.pending && turn\.tools\?\.length/,
  "settled turns that used tools render a designated tool section",
);
assert.match(
  turnRow,
  /cave-edit-cards[\s\S]*editCards\.map\(\(tool\) => <ToolBlock/,
  "edit-tool cards stay visible inline on settled turns (not buried in the collapsed rollup)",
);
assert.match(
  turnRow,
  /const isEditCard = \(t: ToolEvent\) =>\s*toolInputAsDiff\(t\.name, t\.input\) != null;/,
  "any structured file mutation diff stays visible inline, even when the tool input only has a relative path",
);
assert.match(
  turnRow,
  /otherTools\.length \? <ToolGroup tools=\{otherTools\}/,
  "non-edit tool activity still collapses into the designated ToolGroup",
);

assert.match(
  turnRow,
  /<MessageBubble[\s\S]*role="assistant"[\s\S]*content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}/,
  "Assistant turns should render only filtered visible content",
);

assert.match(
  source,
  /<header className="cave-chat-linear-header"/,
  "Chat header should use the dense linear session header",
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
  /formatChatRecency\(turn\.createdAt, dtPrefs\)[\s\S]*cave-linear-turn-avatar-btn[\s\S]*<FamiliarIcon familiar=\{familiar\} size="xl" \/>[\s\S]*cave-linear-turn-name[\s\S]*familiar\.display_name[\s\S]*cave-linear-turn-recency[\s\S]*cave-linear-turn-meta-extra[\s\S]*cave-linear-turn-crest/,
  "Assistant turns render a large circular avatar + name + recency, with the crest/role/usage extras in a trailing reveal-on-hover cluster (cave-xsq.2)",
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

assert.match(
  source,
  /placeholder=\{busy \? "Streaming… \(esc to cancel\)" : `Message \$\{familiar\.display_name\}…  ↵ to send`\}/,
  "Composer placeholder should include ↵ to send hint in steady state",
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
// The five response controls (Host · Access · Model · Thinking · Speed) collapse
// into ONE icon-only Options menu instead of a row of inline pills.
assert.match(
  source,
  /<ComposerOptionsMenu[\s\S]*hostValue=\{composerHostValue\}[\s\S]*onHostPick=\{setRuntimeHost\}/,
  "composer collapses host + response controls into the ComposerOptionsMenu",
);
assert.match(
  source,
  /<div className="cave-composer-utility-row">[\s\S]*aria-label="Attach images, videos, or files"[\s\S]*<Icon name="ph:paperclip"[\s\S]*aria-label="Voice"[\s\S]*<ComposerOptionsMenu/,
  "composer utility row keeps attach + voice, then the collapsed Options menu",
);
assert.match(
  source,
  /sections=\{\[[\s\S]*label: "Access"[\s\S]*label: "Model"[\s\S]*label: "Thinking"[\s\S]*label: "Speed"/,
  "the Options menu carries Access, Model, Thinking, Speed sections in order",
);
assert.doesNotMatch(
  source,
  /cave-composer-settings-row/,
  "the inline settings-row of control pills is gone (collapsed into the Options menu)",
);
assert.match(
  source,
  /<div className="cave-composer-submit-row">[\s\S]*aria-label="Enhance prompt"[\s\S]*<Icon name="ph:sparkle"[\s\S]*aria-label="Send message"/,
  "Enhance should be an icon-only sparkle action immediately next to Send",
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
// The Options menu renders each control inline (no nested popover) and keeps the
// connect-host dialog as a popover sibling so it survives the panel closing.
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
  /ph:microphone/,
  "desktop composer has a mic/voice button",
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
  source,
  /function SessionOverflowMenu[\s\S]*Debug session[\s\S]*Delete chat/,
  "Secondary session actions (project, voice, debug, delete) live in the overflow menu",
);

assert.match(
  styles,
  /\.cave-chat-linear-header\s*\{[\s\S]*padding:\s*4px 10px 5px;/,
  "Open chat header should be compressed for a streamlined session UI",
);

assert.match(
  styles,
  /\.cave-chat-icon-button\s*\{[\s\S]*border:\s*1px solid transparent;[\s\S]*background:\s*transparent;/,
  "Open chat header icon buttons should be chromeless until hover/focus",
);

// Ultra-minimal header: at rest only the ⋮ kebab shows; the quick actions
// collapse and reveal on hover / keyboard focus (touch devices show them).
assert.match(
  source,
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
  /<LinkedContextRow\b/,
  "ChatView header should render LinkedContextRow for task/GitHub chips",
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
  /Ready for the next thread\./,
  "Empty-state hint uses the redesigned launch-screen ready copy",
);

assert.match(
  source,
  /icon="ph:pencil-simple"[\s\S]{0,200}dispatchEvent\(new Event\("cave:chat-rename"\)\)[\s\S]{0,160}Rename chat/,
  "Rename lives in the session overflow menu (Codex/ChatGPT idiom), firing cave:chat-rename",
);
assert.match(
  source,
  /addEventListener\("cave:chat-rename", onRename\)[\s\S]{0,80}setEditing\(true\)|onRename = \(\) => setEditing\(true\)/,
  "ChatTitleEditable enters edit mode when the overflow menu fires cave:chat-rename",
);
assert.doesNotMatch(
  source,
  /aria-label="Rename chat"/,
  "The persistent pencil button is removed — the title is clean, rename is one click away in the menu",
);

// — CHAT-D2-01: slash menu keyboard contract ("↵ run · Tab complete · esc cancel") —
const composerKey = source.match(/const onComposerKey = [\s\S]*?\n  \};/)?.[0] ?? "";
const slashBranch = composerKey.match(/if \(slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0\) \{[\s\S]*?\n    \}/)?.[0] ?? "";

assert.match(
  slashBranch,
  /if \(e\.key === "Enter" && !e\.shiftKey\) \{[\s\S]*slashSuggestions\[slashIdx\][\s\S]*intentFromSlash\(cmd\.name\)/,
  "Slash-menu Enter must run the highlighted suggestion, not send the partially typed text",
);
assert.match(
  slashBranch,
  /cmd\.argPlaceholder && canonicalize\(input\.trim\(\)\) !== cmd\.name[\s\S]*setInput\(cmd\.name \+ " "\)/,
  "Slash-menu Enter autocompletes argument-taking commands (like Tab) instead of running them bare",
);
assert.match(
  slashBranch,
  /if \(e\.key === "Escape"\) \{[\s\S]*setSlashDismissed\(true\)/,
  "Esc with the slash menu open must dismiss the menu",
);
assert.ok(
  composerKey.includes("setSlashDismissed(true)") &&
    composerKey.indexOf("setSlashDismissed(true)") < composerKey.indexOf("cancelSend()"),
  "Esc precedence: dismiss the slash menu before the busy-cancel branch can kill the stream",
);
assert.match(
  source,
  /setSlashIdx\(0\);\s*\n\s*setSlashDismissed\(false\);/,
  "Editing the input must re-arm dismissed slash suggestions",
);
assert.match(
  source,
  /\{keys\.up\}\{keys\.down\} navigate · \{keys\.enter\} run · Tab complete · esc cancel/,
  "Slash menu footer promises run/complete/cancel — keep it in sync with onComposerKey",
);

// — CHAT-D10-01 + CHAT-D13-03: instant scroll pin, intent-based release —
const pinEffect = source.match(/\/\/ Pin: while following[\s\S]*?\}, \[turns\]\);/)?.[0] ?? "";
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
  /if \(e\.deltaY < 0 && followingRef\.current\) updateFollowing\(false\)/,
  "Wheel-up (negative deltaY) is the user intent that detaches following",
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
  /y > lastTouchY && followingRef\.current\) updateFollowing\(false\)/,
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
  1,
  "The chat-mode onSlashFromChat site must report unhandled slash commands honestly (no unconditional return-true wrappers)",
);

// — CHAT-D1-02: paste-to-attach (clipboard files route through attachFiles) —
const pasteHandler = source.match(/onPaste=\{\(e\) => \{[\s\S]*?\n              \}\}/)?.[0] ?? "";
assert.match(
  pasteHandler,
  /e\.clipboardData\.items[\s\S]*item\.kind === "file"[\s\S]*item\.getAsFile\(\)/,
  "Composer paste must inspect clipboardData.items for files (screenshots, copied images), not just text/plain",
);
assert.match(
  pasteHandler,
  /if \(pastedFiles\.length > 0\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*void attachFiles\(pastedFiles\);\s*\n\s*return;/,
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
  source,
  /dataTransfer\.types\.includes\("Files"\)/,
  "Drag handlers must not call DataTransfer.types.includes directly; WebKit DOMStringList may not implement includes",
);
assert.match(
  source,
  /onDragEnter=\{\(e\) => \{\s*\n\s*if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?dragDepthRef\.current \+= 1;\s*\n\s*setDropActive\(true\);/,
  "dragenter must guard on a Files-type drag (text selections must not hijack) and use counter-based depth tracking",
);
assert.match(
  source,
  /onDragOver=\{\(e\) => \{\s*\n\s*if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;\s*\n\s*e\.preventDefault\(\);/,
  "dragover must preventDefault (only for file drags) so the browser allows the drop",
);
assert.match(
  source,
  /onDragLeave=\{\(e\) => \{[\s\S]*?dragDepthRef\.current = Math\.max\(0, dragDepthRef\.current - 1\);\s*\n\s*if \(dragDepthRef\.current === 0\) setDropActive\(false\);/,
  "dragleave must decrement the depth counter and only hide the overlay at depth 0 — child-element transitions must not flicker it",
);
assert.match(
  source,
  /onDrop=\{\(e\) => \{\s*\n\s*dragDepthRef\.current = 0;\s*\n\s*setDropActive\(false\);[\s\S]*?if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?void attachFiles\(e\.dataTransfer\.files\);/,
  "drop must reset the overlay state and route dataTransfer.files through the existing attach pipeline",
);
assert.match(
  source,
  /\{dropActive \? \(\s*\n\s*<div className="cave-drop-overlay" aria-hidden="true">[\s\S]*?Drop files to attach/,
  "A visible drop overlay must render while a file drag is over the chat surface",
);
const caveChatCss = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
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

// Behavioral: mention token parsing + fuzzy ranking (src/lib/file-mention.ts)
const { fileMentionToken, filterFileMentions, MAX_FILE_MENTIONS, FILE_MENTION_RESULT_LIMIT } =
  await import("../lib/file-mention.ts");

assert.deepEqual(
  fileMentionToken("@", 1),
  { start: 0, query: "" },
  "A bare `@` at the start of the composer opens an empty-query mention token",
);
assert.deepEqual(
  fileMentionToken("look at @src/ch", 15),
  { start: 8, query: "src/ch" },
  "`@` after whitespace yields the text between the @ and the caret (slashes allowed)",
);
assert.equal(
  fileMentionToken("mail me a@b.com", 15),
  null,
  "Mid-word `@` (emails) must not open the picker — the @ must start the text or follow whitespace",
);
assert.equal(
  fileMentionToken("@src foo", 8),
  null,
  "Whitespace between the @ and the caret closes the token",
);
assert.equal(
  fileMentionToken("@a@b", 4),
  null,
  "A second `@` inside the query invalidates the token",
);
assert.deepEqual(
  fileMentionToken("@src/ch trailing", 7),
  { start: 0, query: "src/ch" },
  "Only text up to the caret counts as the query",
);
assert.equal(
  fileMentionToken("/help", 5),
  null,
  "A `/` first token is never a mention — slash menu and mention menu stay disjoint",
);

const mentionIndexFixture = [
  "src/components/chat-view.tsx",
  "src/lib/chat-attachments.ts",
  "src/lib/file-mention.ts",
  "docs/changelog.md",
  "chat.ts",
];
assert.deepEqual(
  filterFileMentions(mentionIndexFixture, "chat")[0],
  "chat.ts",
  "Basename-prefix matches rank above basename/path substring matches",
);
assert.ok(
  filterFileMentions(mentionIndexFixture, "chat").includes("src/components/chat-view.tsx"),
  "Basename substring matches are included after prefix matches",
);
assert.deepEqual(
  filterFileMentions(mentionIndexFixture, "scmvt"),
  ["src/components/chat-view.tsx"],
  "Subsequence matching catches scattered-character queries",
);
assert.deepEqual(
  filterFileMentions(mentionIndexFixture, "zzz"),
  [],
  "Non-matching queries return no rows",
);
assert.equal(
  filterFileMentions(mentionIndexFixture, "", 2).length,
  2,
  "The result limit caps the list (empty query returns the head of the index)",
);
assert.equal(MAX_FILE_MENTIONS, 10, "Mentions are capped at 10 per send");
assert.ok(FILE_MENTION_RESULT_LIMIT <= 15, "The picker shows a short list (~12), not the whole index");

// Pins: file-index route mirrors the /api/changes security posture
const filesRouteSource = readFileSync(
  new URL("../app/api/project/files/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  filesRouteSource,
  /execFileAsync\("git", args, \{/,
  "/api/project/files must run git through execFile with an argument array (no shell)",
);
assert.doesNotMatch(
  filesRouteSource,
  /\bexec\(|shell:\s*true|spawnSync\(/,
  "/api/project/files must never interpolate the root into a shell command",
);
assert.match(
  filesRouteSource,
  /if \(!path\.isAbsolute\(root\)\)/,
  "/api/project/files must reject relative roots",
);
assert.match(
  filesRouteSource,
  /import \{ resolveAllowedProjectPath \} from "@\/lib\/server\/project-paths"/,
  "/api/project/files must reuse the standard allowed-root guard",
);
assert.match(
  filesRouteSource,
  /const allowedRoot = resolveAllowedProjectPath\(root\);[\s\S]*?if \(!allowedRoot\)[\s\S]*?path not allowed[\s\S]*?status: 403/,
  "/api/project/files must reject roots outside allowed workspaces",
);
assert.match(
  filesRouteSource,
  /try \{[\s\S]*?fs\.realpathSync\(allowedRoot\);[\s\S]*?fs\.statSync\(real\);[\s\S]*?\} catch/,
  "/api/project/files must realpath and stat the allowed root inside a guarded block",
);
assert.match(
  filesRouteSource,
  /\{ ok: true, repo: false, error: resolved\.error \}/,
  "Not-a-repo must be a distinct non-error state, not a 4xx/5xx",
);
assert.match(
  filesRouteSource,
  /"ls-files",\s*\n\s*"-z",\s*\n\s*"--cached",\s*\n\s*"--others",\s*\n\s*"--exclude-standard",/,
  "The index must list tracked plus untracked-but-not-ignored files, NUL-separated",
);
assert.match(
  filesRouteSource,
  /const MAX_FILES = 5000;/,
  "The index must cap at ~5000 paths",
);
assert.match(
  filesRouteSource,
  /truncated = all\.length > MAX_FILES/,
  "An over-cap index must set the truncated flag",
);
assert.match(
  filesRouteSource,
  /const CACHE_TTL_MS = 10_000;[\s\S]*Date\.now\(\) - cached\.at < CACHE_TTL_MS/,
  "The route must keep a ~10s module-level cache keyed by root",
);

// Pins: composer mention picker (chat-view.tsx)
const mentionSource = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
assert.match(
  mentionSource,
  /const mentionRoot = activeProjectRoot\.trim\(\);/,
  "The mention root must use the selected project root",
);
assert.match(
  mentionSource,
  /projectRoot: requestProjectRoot/,
  "The send body must use the vetted project root (selected project, minus unregistered session-cwd echoes)",
);
assert.match(
  mentionSource,
  /new URLSearchParams\(\{ root: mentionRoot, familiarId: familiar\.id \}\)/,
  "The picker must fetch the file index for the chat's project root scoped to the active familiar",
);
assert.match(
  mentionSource,
  /id=\{mentionListboxId\} role="listbox" aria-label="Workspace files"/,
  "The mention popover must be a listbox (ARIA parity with the slash menu, #423)",
);
assert.match(
  mentionSource,
  /role="option"\s*\n\s*id=\{`\$\{mentionListboxId\}-opt-\$\{i\}`\}\s*\n\s*aria-selected=\{active\}/,
  "Mention rows must be aria-selected options with stable ids for aria-activedescendant",
);
assert.match(
  mentionSource,
  /const mentionActiveIdx = mentionOpen \? Math\.min\(mentionIdx, mentionMatches\.length - 1\) : 0;/,
  "Mention active index must clamp to the current match count",
);
assert.match(
  mentionSource,
  /setMentionIdx\(\(i\) => \(mentionMatches\.length === 0 \? 0 : Math\.min\(i, mentionMatches\.length - 1\)\)\);/,
  "Mention index should be brought back in range when the match list shrinks",
);
assert.match(
  mentionSource,
  /const mentionAriaOverrides: React\.AriaAttributes = mentionOpen\s*\n\s*\? \{\s*\n\s*"aria-expanded": true,\s*\n\s*"aria-controls": mentionListboxId,\s*\n\s*"aria-activedescendant": `\$\{mentionListboxId\}-opt-\$\{mentionActiveIdx\}`,/,
  "While the mention picker is open it must override the combobox ARIA with the clamped active option",
);
assert.match(
  mentionSource,
  /\{\.\.\.mentionAriaOverrides\}/,
  "The composer textarea must apply the mention ARIA overrides after the slash wiring (later JSX attributes win)",
);
assert.match(
  mentionSource,
  /const active = i === mentionActiveIdx;/,
  "Mention row highlight should use the same clamped active index as aria-activedescendant",
);

// Esc precedence (#402): mention dismiss → slash dismiss → busy cancel.
const mentionComposerKey = mentionSource.match(/const onComposerKey = [\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(
  mentionComposerKey,
  /if \(mentionOpen\) \{[\s\S]*?setMentionDismissed\(true\)/,
  "Esc with the mention picker open must dismiss the picker",
);
assert.ok(
  mentionComposerKey.indexOf("if (mentionOpen) {") <
    mentionComposerKey.indexOf("if (slashSuggestions.length > 0 || skillCommandRows.length > 0) {"),
  "The mention branch must run before the slash branch in onComposerKey",
);
assert.ok(
  mentionComposerKey.indexOf("setMentionDismissed(true)") <
    mentionComposerKey.indexOf("setSlashDismissed(true)") &&
    mentionComposerKey.indexOf("setSlashDismissed(true)") <
      mentionComposerKey.indexOf("cancelSend()"),
  "Esc precedence: mention dismiss before slash dismiss before busy-cancel",
);
assert.match(
  mentionComposerKey,
  /if \(e\.key === "Tab" \|\| \(e\.key === "Enter" && !e\.shiftKey\)\) \{[\s\S]*?selectMention\(file\)/,
  "Enter/Tab must insert the highlighted file, never send the draft, while the picker is open",
);
assert.match(
  mentionSource,
  /setMentionIdx\(0\);\s*\n\s*setMentionDismissed\(false\);/,
  "Editing the input must re-arm a dismissed mention picker",
);

// Selection semantics: inline `@path` token + mentionedFiles in the send body.
assert.match(
  mentionSource,
  /const insert = `@\$\{relPath\} `;[\s\S]*?input\.slice\(0, mentionToken\.start\) \+ insert \+ input\.slice\(composerCaret\)/,
  "Selecting a file must replace the `@query` token with the relative path inline (Claude Code convention)",
);
assert.match(
  mentionSource,
  /\.\.\.\(outgoingMentions\.length && mentionRoot\s*\n\s*\? \{\s*\n\s*mentionedFiles: outgoingMentions\.slice\(0, MAX_FILE_MENTIONS\),\s*\n\s*mentionedFilesRoot: mentionRoot,/,
  "The send body must carry mentionedFiles plus the root they are relative to",
);
assert.match(
  mentionSource,
  /mentionedFiles\s*\n?\s*\.filter\(\(p\) => text\.includes\(`@\$\{p\}`\)\)/,
  "Only mentions whose @path token survived editing may ride the send",
);
assert.match(
  mentionSource,
  /setInput\(""\);\s*\n\s*setAttachments\(\[\]\);\s*\n\s*setMentionedFiles\(\[\]\);/,
  "Sending must clear staged mentions with the composer",
);

// Pins: send route validates mentions and appends the prompt block.
const mentionSendSource = readFileSync(
  new URL("../app/api/chat/send/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  mentionSendSource,
  /async function resolveMentionedFiles\([\s\S]*?relPaths\.slice\(0, MAX_MENTIONED_FILES\)[\s\S]*?\.includes\("\.\."\)[\s\S]*?candidate\.startsWith\(realRoot \+ path\.sep\)/,
  "/chat/send must validate each mention: cap, repo-relative only, no `..`, prefix containment under the realpathed root",
);
assert.match(
  mentionSendSource,
  /async function resolveFamiliarWorkspace\([\s\S]*?readFamiliarWorkspaces\(\)[\s\S]*?path\.resolve\(familiarsRoot, familiarId\)[\s\S]*?path\.relative\(familiarsRoot, candidate\)[\s\S]*?relative\.startsWith\("\.\."\)/,
  "/chat/send must validate default familiar workspace paths under the familiar root while preserving configured workspaces",
);
assert.match(
  mentionSendSource,
  /const real = await realpath\(candidate\);[\s\S]*?real\.startsWith\(realRoot \+ path\.sep\)/,
  "/chat/send must re-check containment on the realpathed file so in-repo symlinks cannot smuggle outside paths",
);
assert.match(
  mentionSendSource,
  /"Referenced files \(open with the Read tool\):",\s*\n\s*\.\.\.absPaths\.map\(\(p\) => `- \$\{p\}`\)/,
  "Validated mentions must render as the compact Referenced-files prompt block of absolute paths",
);
assert.match(
  mentionSendSource,
  /appendMentionedFilesBlock\(\s*\n\s*buildPromptWithResponseControls\(\s*\n\s*buildPromptWithAttachments\(/,
  "The mention block must join the prompt after attachments and response controls are applied",
);
assert.match(
  mentionSendSource,
  /const resolvedFamiliarWorkspace = !sshRuntime\s*\n\s*\? await resolveFamiliarWorkspace\(body\.familiarId\)\s*\n\s*: undefined;/,
  "Mention roots must come from the validated familiar workspace, not a client-supplied path",
);
assert.match(
  mentionSendSource,
  /const mentionedFiles = imagesSupported\s*\n\s*\? await resolveMentionedFiles\(\s*\n\s*body\.mentionedFiles,\s*\n\s*resolvedFamiliarWorkspace,/,
  "Mentions are only delivered to harnesses that can Read this machine's filesystem, against the validated familiar workspace",
);

// The top suggested follow-up is flagged as the recommendation (green pulsing
// border + leading dot), so the most useful next step stands out.
assert.match(
  source,
  /cave-next-path--recommended/,
  "the first follow-up is marked as the recommended next step",
);

// File picker resets its value synchronously so re-selecting the same file (or
// re-attaching after the CSV / 10-cap early returns) still fires onChange.
assert.ok(
  source.includes("const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : null;"),
  "file input snapshots files before reset",
);
assert.ok(
  source.includes('e.currentTarget.value = "";') && !source.includes('fileInputRef.current.value = ""'),
  "file input resets value synchronously in onChange, not after the async attach",
);

// Codex inline file-edit card: Edit/Write/MultiEdit/NotebookEdit tool calls
// render as a visible details card in the transcript. The collapsed summary
// shows when/status + what file changed; expanding the same card shows the
// actual diff, matching the Bash/tool-use disclosure pattern.
assert.match(source, /cave-edit-card/, "mutation tools render as an inline Codex edit card");
assert.match(source, /diffStat/, "edit card derives a +/- stat");
assert.match(source, /Review/, "edit card has a Review action");
assert.match(globalsSrc, /\.cave-edit-card/, "edit card styling exists");

// Review adapts to where the edit can actually be reviewed: a file under the
// session's project root jumps to the code rail's Changes diff; anything else
// (familiar-workspace docs, repo-less sessions, relative paths) opens an
// in-chat modal with this edit's diff instead of dispatching an event nothing
// can service. The actions row renders on every edit card — not only when an
// absolute target path exists — so Review is always available.
assert.match(
  source,
  /if \(relPath && targetFile\) \{[\s\S]{0,200}cave:open-file-diff[\s\S]{0,200}setReviewOpen\(true\)/,
  "Review falls back to the in-chat diff modal when the Changes panel can't show the file",
);
assert.match(
  source,
  /<Modal[\s\S]{0,200}open=\{reviewOpen\}[\s\S]{0,600}<SyntaxBlock text=\{diff\} lang="diff" \/>/,
  "the review modal renders this edit's structured diff",
);
assert.match(
  source,
  /<EditCardActions targetFile=\{targetFile\} diff=\{inputDiff \?\? ""\} displayPath=\{displayPath\} \/>/,
  "edit-card actions render unconditionally (Review works without an absolute target path)",
);
assert.match(globalsSrc, /\.cave-review-modal/, "review modal styling exists");
assert.match(
  source,
  /if \(isEditTool\) \{[\s\S]*<details className="cave-tool-block cave-edit-card"[\s\S]*Edited \{base\}[\s\S]*<DurationText durationMs=\{tool\.durationMs\} \/>[\s\S]*Code changes[\s\S]*<SyntaxBlock text=\{inputDiff\} lang="diff" \/>[\s\S]*<\/details>/,
  "edit cards should use the same expandable tool details pattern and include the code diff in chat",
);

// Inline "Undo" reverts the edited file to its last committed state via the
// changes revert API, resolving the repo-relative path through a context, and
// pings the Changes panel to refresh.
assert.match(source, /cave-edit-card__undo/, "edit card has an Undo action");
assert.match(source, /ToolProjectRootContext/, "edit card resolves project root via context for revert");
assert.match(source, /"\/api\/changes"/, "Undo posts to the changes revert API");
assert.match(source, /cave:changes-refresh/, "Undo notifies the changes panel to refresh");
assert.match(globalsSrc, /\.cave-edit-card__undo/, "Undo button styling exists");
