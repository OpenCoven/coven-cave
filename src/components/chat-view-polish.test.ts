// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
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

// --- CHAT-D13-01: tool activity hidden by default on settled turns ---

assert.match(
  turnRow,
  /const showTools = turn\.pending \? true : \(showToolsOverride \?\? false\)/,
  "Tool activity should stay visible while streaming and default hidden once the response has fully generated",
);

assert.match(
  turnRow,
  /cave-turn-tools-toggle[\s\S]{0,300}aria-pressed=\{showTools\}/,
  "Settled turns with tools should expose an always-visible toggle chip with pressed state",
);

assert.match(
  turnRow,
  /segments=\{showTools \? bubbleSegments : undefined\}/,
  "Hiding tools should fall back to plain prose rendering instead of segment interleaving",
);

assert.match(
  turnRow,
  /showTools && !segments && turn\.tools\?\.length \? <ToolGroup/,
  "The legacy trailing ToolGroup should honor the same hidden-by-default contract",
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

assert.match(
  source,
  /className="cave-chat-icon-button cave-chat-back-button/,
  "Open chat back control should use the shared minimal icon-button treatment",
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
  /Ready for the next thread\./,
  "Empty-state hint uses the redesigned launch-screen ready copy",
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
  /projectRoot: activeProjectRoot/,
  "The send body must use the selected project root",
);
assert.match(
  mentionSource,
  /\/api\/project\/files\?root=\$\{encodeURIComponent\(mentionRoot\)\}/,
  "The picker must fetch the file index for the chat's project root",
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
    mentionComposerKey.indexOf("if (slashSuggestions.length > 0) {"),
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
