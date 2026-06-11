// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const turnRow = source.match(/function TurnRow[\s\S]*?\n}\n\nfunction AttachmentLightbox/)?.[0] ?? "";
const splitReasoning = source.match(/function splitReasoning[\s\S]*?\n}\n\n\/\/ ── ChatEmptyState/)?.[0] ?? "";

assert.match(
  source,
  /fetch\("\/api\/chat\/send"[\s\S]*body: JSON\.stringify\(\{[\s\S]*attachments: stripPreviewOnlyAttachmentFieldsKeepingImages\(outgoingAttachments\)/,
  "Chat send should strip preview-only attachment fields before POSTing, keeping image payloads so the harness can see them",
);

assert.match(
  source,
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
  /const \{ visible, reasoning: inlineReasoning \} = splitReasoning\(turn\.text\)/,
  "Assistant turns should split visible content from collapsible reasoning",
);

assert.match(
  source,
  /function ReasoningBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Thinking[\s\S]*<RichText text=\{reasoning\}/,
  "ReasoningBlock should render thinking in a collapsed disclosure with formatted text",
);

assert.match(
  source,
  /function ToolGroup[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Tool activity[\s\S]*tools\.map[\s\S]*<ToolBlock/,
  "ToolGroup should render tool calls in a collapsed disclosure",
);

assert.match(
  source,
  /function ToolBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*<summary[\s\S]*tool\.name[\s\S]*<SyntaxBlock text=\{tool\.input\}[\s\S]*<SyntaxBlock text=\{tool\.output\}/,
  "ToolBlock should keep individual tool payloads collapsed and format input/output with SyntaxBlock",
);

assert.doesNotMatch(
  [
    source.match(/function ReasoningBlock[\s\S]*?function ProgressGroup/)?.[0] ?? "",
    source.match(/function ToolGroup[\s\S]*?function ToolBlock/)?.[0] ?? "",
    source.match(/function ToolBlock[\s\S]*?function ThinkingIndicator/)?.[0] ?? "",
  ].join("\n"),
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Thinking and tool-use disclosures must not default open",
);

assert.match(
  turnRow,
  /const \{ visible, reasoning: inlineReasoning \} = splitReasoning\(turn\.text\)/,
  "Assistant turns should render only reasoning-filtered visible content",
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

assert.doesNotMatch(
  source,
  /\{turn\.role === "user" \? "You" : "System"\}/,
  "User turns should drop the \"You\" label — bubble + right-alignment already convey role",
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

assert.doesNotMatch(
  source,
  /\{modKey\}↵ to send/,
  "Empty-state hint must not advertise a modifier — plain Enter sends (onComposerKey)",
);
assert.match(
  source,
  /↵ to send · shift↵ for newline/,
  "Empty-state hint matches actual composer key behavior",
);

assert.match(
  source,
  /aria-label="Rename chat"[\s\S]{0,200}setEditing\(true\)/,
  "Chat title has an explicit, labeled rename button — click-to-rename alone is not discoverable",
);
assert.match(
  source,
  /ph:pencil-simple/,
  "Rename affordance uses the pencil icon",
);

// — CHAT-D2-01: slash menu keyboard contract ("↵ run · Tab complete · esc cancel") —
const composerKey = source.match(/const onComposerKey = [\s\S]*?\n  \};/)?.[0] ?? "";
const slashBranch = composerKey.match(/if \(slashSuggestions\.length > 0\) \{[\s\S]*?\n    \}/)?.[0] ?? "";

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
  /updateFollowing\(true\);[\s\S]{0,600}prefers-reduced-motion: reduce[\s\S]{0,200}behavior: reduceMotion \? "auto" : "smooth"[\s\S]{0,400}aria-label="Scroll to bottom"/,
  "Scroll FAB must re-engage following and gate its smooth scroll on prefers-reduced-motion",
);
assert.match(
  source,
  /\{!following && \(/,
  "Scroll FAB visibility is driven by the following state",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*updateFollowing\(true\);\s*\}, \[sessionId, updateFollowing\]\)/,
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
  "Both onSlashFromChat sites must report unhandled slash commands honestly (no unconditional return-true wrappers)",
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
assert.ok(
  pasteHandler.indexOf("attachFiles(pastedFiles)") < pasteHandler.indexOf("looksLikeCsv"),
  "Paste precedence: files first, then the plain-text CSV sniff (which must remain intact)",
);
assert.match(
  pasteHandler,
  /const text = e\.clipboardData\.getData\("text\/plain"\);\s*\n\s*if \(looksLikeCsv\(text\)\) \{ setCsvRaw\(text\); \}/,
  "Plain-text paste keeps its current behavior — the CSV sniff still runs and the default text insertion is not prevented",
);

// — CHAT-D1-03: drag-and-drop attach on the chat surface —
assert.match(
  source,
  /onDragEnter=\{\(e\) => \{\s*\n\s*if \(!e\.dataTransfer\.types\.includes\("Files"\)\) return;[\s\S]*?dragDepthRef\.current \+= 1;\s*\n\s*setDropActive\(true\);/,
  "dragenter must guard on a Files-type drag (text selections must not hijack) and use counter-based depth tracking",
);
assert.match(
  source,
  /onDragOver=\{\(e\) => \{\s*\n\s*if \(!e\.dataTransfer\.types\.includes\("Files"\)\) return;\s*\n\s*e\.preventDefault\(\);/,
  "dragover must preventDefault (only for file drags) so the browser allows the drop",
);
assert.match(
  source,
  /onDragLeave=\{\(e\) => \{[\s\S]*?dragDepthRef\.current = Math\.max\(0, dragDepthRef\.current - 1\);\s*\n\s*if \(dragDepthRef\.current === 0\) setDropActive\(false\);/,
  "dragleave must decrement the depth counter and only hide the overlay at depth 0 — child-element transitions must not flicker it",
);
assert.match(
  source,
  /onDrop=\{\(e\) => \{\s*\n\s*dragDepthRef\.current = 0;\s*\n\s*setDropActive\(false\);[\s\S]*?void attachFiles\(e\.dataTransfer\.files\);/,
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
