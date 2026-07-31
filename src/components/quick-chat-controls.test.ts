// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("./quick-chat-primitives.tsx", import.meta.url), "utf8");
const thread = readFileSync(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");
const messageBubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const messageFormat = readFileSync(new URL("../lib/quick-chat-message-format.ts", import.meta.url), "utf8");
const tray = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");

assert.match(primitives, /StandardSelect/, "quick-chat select helper should delegate to StandardSelect");
assert.doesNotMatch(primitives, /PopoverBody|PopoverItem|anchorRef/, "quick-chat select helper should not maintain its own popover implementation");
assert.match(primitives, /renderValue=/, "quick-chat select helper should keep its compact trigger rendering through StandardSelect");

// Shared conversation thread — used by both the in-app dropdown and the tray.
assert.match(source, /export \{ QuickChatThread \} from "\.\/quick-chat-thread"/, "controls preserve the shared thread export");
assert.match(
  thread,
  /import \{ ProgressiveMarkdownBlock \} from "@\/components\/message-bubble"/,
  "familiar replies render through the normal chat's progressive Markdown path",
);
assert.match(
  thread,
  /pendingTextIndex[\s\S]*<ProgressiveMarkdownBlock key=\{`text-\$\{index\}`\} text=\{piece\.text\} pending=\{streaming && index === pendingTextIndex\}/,
  "streaming replies use progressive Markdown and show a cursor only on the final visible piece",
);
assert.match(
  messageBubble,
  /export function ProgressiveMarkdownBlock[\s\S]*<MarkdownContent text=\{text\} pending=\{pending\}/,
  "the public progressive wrapper preserves one MarkdownContent instance across stream settlement",
);
assert.doesNotMatch(
  thread,
  /streaming \? <p className="whitespace-pre-wrap/,
  "quick chat must not fork pending replies into an unformatted plain-text branch",
);
assert.match(
  thread,
  /formatQuickChatAssistantMessage\(message\.text, streaming\)/,
  "quick chat uses the shared marker-safe formatter for human-readable reply details",
);
assert.match(thread, /<SkillStageCard/, "quick chat renders live skill details as readable status cards");
assert.match(thread, /<GitHubCard/, "quick chat renders settled GitHub details as preview cards");
assert.match(thread, /<GitHubActionCard/, "quick chat renders GitHub write proposals as explicit action cards");
assert.match(
  thread,
  /if \(streaming\) return null;/,
  "quick chat keeps GitHub placeholders stable while streaming without mounting their cards",
);
assert.match(thread, /copyText\(visible\)/, "each familiar reply can be copied to the clipboard — the visible text, not the raw next-paths trailer");
assert.match(thread, /aria-live="polite"/, "the thread is a polite live region so streamed replies are announced");
assert.match(thread, /quick-chat-caret|quick-chat-typing/, "streaming turns show a caret / thinking affordance");

// ── Shared building blocks: one source of truth for both surfaces ────────────
// The overlay and the tray render the same header identity, controls row, and
// composer — drift between the two (e.g. hint copy, focus behavior) was a bug.
for (const name of [
  "QuickChatControlsRow",
  "QuickChatComposer",
  "useSuggestionPicker",
]) {
  assert.match(
    source,
    new RegExp(`export function ${name}`),
    `controls export the shared ${name} used by both quick-chat surfaces`,
  );
}
assert.match(
  primitives,
  /export const QUICK_CHAT_SUGGESTIONS/,
  "the one-tap starter suggestions are defined once and shared",
);
assert.match(
  primitives,
  /loading \? "Loading familiars…" : familiar \? `@\$\{familiar\.id\}` : "No familiar selected"/,
  "the shared header identity shows a loading state while the roster loads",
);
assert.match(primitives, /export function QuickChatIdentity/, "controls preserve the shared header identity export");
assert.match(
  source,
  /loading && familiars\.length === 0\s*\?\s*\[\{ value: "", label: "Loading…", disabled: true \}\]/,
  "the shared familiar select shows a disabled Loading placeholder while the roster is empty",
);
assert.match(
  source,
  /showFamiliarPicker \? \(\s*<QuickChatSelect[\s\S]*label="Familiar"/,
  "agent selection is conditional — shown only when the host asks for it (new-chat + flow)",
);
assert.match(
  source,
  /<QuickChatSelect[\s\S]*label="Project"[\s\S]*onChange=\{\(next\) => \{[\s\S]*onPickProjectRoot\(next\)/,
  "the shared controls row includes project selection for quick chat",
);
// Once a project is picked the thread is locked to it — the menu collapses
// into a read-only badge that names the selection (dropdown only when unset).
assert.match(
  source,
  /selectedProject \? \(\s*<span[\s\S]*?aria-label=\{`Project: \$\{selectedProjectName\}, \$\{selectedProjectAccess\} access \(locked for this chat\)`\}[\s\S]*?\) : \(\s*<QuickChatSelect[\s\S]*?label="Project"/,
  "a selected project renders as a locked read-only badge instead of the picker menu",
);
assert.match(
  source,
  /title=\{selectedProject\.root\}/,
  "the locked project badge reveals the full root path on hover",
);
assert.match(
  source,
  /ph:lock-simple/,
  "the locked project badge carries a lock glyph so the fixed context is legible",
);
assert.match(
  source,
  /projectsLoading && projects\.length === 0[\s\S]*label: "Loading projects…"/,
  "project select shows a loading placeholder while scoped projects are fetching",
);
assert.doesNotMatch(
  source,
  /label: "No project"/,
  "quick chat must not offer a project-free launch",
);
assert.match(
  source,
  /projectAccessLabel\(project\.access\)/,
  "quick-chat project choices show the familiar's effective access level",
);
assert.match(
  tray,
  /launchReady=\{projectLaunchReady\}/,
  "the tray composer disables message launches until a scoped project is ready",
);
assert.match(
  source,
  /const canDispatch =\s*canSend &&[\s\S]*launchReady/,
  "local slash commands stay available while ordinary sends require a launchable project",
);
assert.match(
  source,
  /<QuickChatSelect[\s\S]*label="Project"/,
  "the remaining project selector uses the shared QuickChatSelect primitive",
);
assert.doesNotMatch(source, /rounded-md/, "controls avoid hard-coded md radius");
assert.ok(source.includes('import { Button } from "@/components/ui/button"'), "controls use the shared Button primitive");
assert.ok(source.includes('import { IconButton } from "@/components/ui/icon-button"'), "controls use the shared IconButton primitive");
assert.doesNotMatch(source, /<button\b/, "controls do not hand-roll button controls");

// ── Composer: Enter sends, Shift+Enter newline, IME left alone ────────────────
assert.match(
  source,
  /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter"/,
  "the shared composer sends on Cmd/Ctrl+Enter",
);
assert.match(
  source,
  /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/,
  "plain Enter sends, Shift+Enter inserts a newline, IME composition is left alone",
);
assert.match(
  source,
  /requestAnimationFrame\(\(\) => composerRef\.current\?\.focus\(\)\)/,
  "picking a suggestion moves the caret into the composer (both surfaces, via useSuggestionPicker)",
);

// ── Reply recommendation: Tab-to-autofill a suggested next reply ──────────────
// After a familiar turn settles, the shared hook proposes the user's next
// message and offers it above the composer; Tab (empty composer) or the Use
// button autofills it.
assert.match(
  source,
  /export function ReplyRecommendationStrip/,
  "controls export the shared recommended-reply strip",
);
assert.ok(
  source.includes("import { useReplyRecommendation"),
  "the composer mounts the shared reply-recommendation hook for zero-wiring parity with Enhance",
);
assert.match(
  source,
  /event\.key === "Tab"[\s\S]*recommendation\.suggestion[\s\S]*!draft\.trim\(\)/,
  "Tab accepts a ready recommendation only into the empty composer (else it falls through to focus traversal)",
);
assert.match(
  source,
  /<ReplyRecommendationStrip/,
  "the composer renders the recommendation strip above the input",
);

// ── Thread auto-scroll must not fight the user ────────────────────────────────
// (cave-o8si) Follow-along uses the shared intent-release hook: scrolling up
// detaches, only returning to the true bottom re-attaches, and pins are
// rAF-coalesced. The old `< 48px` position re-stick — which yanked a reader
// pausing near the bottom — stays gone.
assert.match(
  thread,
  /const \{ schedulePin, stick \} = useStickToBottom\(scrollRef\)/,
  "the thread follows via the shared intent-release hook",
);
assert.doesNotMatch(
  source,
  /clientHeight < 48/,
  "the position-threshold re-stick stays gone",
);
assert.match(
  thread,
  /schedulePin\(\);\s*\}, \[messages\.length, lastText, schedulePin\]\)/,
  "streamed tokens pin through the coalesced scheduler",
);
assert.match(
  thread,
  /stick\(\);\s*\}, \[messages\.length, stick\]\)/,
  "a new turn re-engages follow-along scrolling",
);
{
  const hook = readFileSync(new URL("../lib/use-stick-to-bottom.ts", import.meta.url), "utf8");
  assert.match(hook, /e\.deltaY < 0 && stuckRef\.current && scrollable\(\)/, "wheel-up releases the stick");
  assert.match(hook, /clientHeight <= 4\) setStuck\(true\)/, "only the true bottom re-sticks");
  assert.match(hook, /cancelAnimationFrame\(pinFrameRef\.current\);[\s\S]{0,400}pinFrameRef\.current = null;/, "the rAF guard nulls on cancel (StrictMode wedge)");
}

// ── Copy affordance resets ────────────────────────────────────────────────────
assert.match(
  thread,
  /setTimeout\(\(\) => setCopied\(false\), 1500\)/,
  "the copied ✓ hands the button back to copy after a beat (it used to stick forever)",
);

// ── Next-path suggestions — the agent trailer as tap-to-fill chips ────────────
// Familiar replies carry a parseable <coven:next-paths> trailer (see
// lib/next-paths.ts). The quick chat strips it from EVERY turn (streaming-safe:
// the half-open block hides too) and renders the suggestions as chips on the
// LATEST settled reply only — a compact tray can't afford stale chip rows.
assert.match(
  messageFormat,
  /import \{ extractNextPaths \} from "\.\/next-paths\.ts"/,
  "the quick-chat formatter parses the shared next-paths trailer format — no bespoke parser",
);
assert.match(
  messageFormat,
  /extractNextPaths\(skillSplit\.visible\)/,
  "the formatter strips the trailer from familiar turns after protocol markers (never shown raw)",
);
assert.match(
  thread,
  /isLastAssistant && !streaming && onSuggestion && suggestions\.length > 0/,
  "chips render only on the latest settled reply, and only when a composer can accept them",
);
assert.match(
  thread,
  /const suggestions = typedSuggestions[\s\S]*?\.filter\(\(path\) => path\.kind === "reply"\)[\s\S]*?\.map\(\(path\) => path\.prompt\);/,
  "quick chat filters typed task/action paths before it renders reply chips",
);
assert.doesNotMatch(
  thread,
  /typedSuggestions\.map\(/,
  "raw typed task/action paths never reach quick-chat rendering or the suggestion callback",
);
assert.match(
  thread,
  /className="quick-chat-next-path"[\s\S]*?onClick=\{\(\) => onSuggestion\(suggestion\)\}/,
  "clicking a reply-only chip fills the composer through the shared suggestion path (fill, not send)",
);
assert.match(
  thread,
  /aria-label="Suggested next steps"/,
  "the chip row is a labelled group",
);

// ── Enhance control matches the Send button's height language ────────────────
assert.match(
  source,
  /<EnhanceControl[\s\S]*?size="sm"/,
  "quick chat mounts the compact enhance control — same 26px height as its Send button",
);

// ── Attachments: drag-and-drop + paste, shared staging hook ──────────────────
// Same capture behavior as the home/chat composers (useAttachmentStaging): the
// composer footer is the drop target, the textarea takes paste-to-attach, and
// the send strips the chip-row-local id before handing files to the hook.
assert.ok(
  source.includes('import { useAttachmentStaging } from "@/lib/use-attachment-staging"'),
  "quick chat stages files through the shared hook — no bespoke drag state",
);
assert.match(
  source,
  /<footer[\s\S]*?\{\.\.\.dropHandlers\}/,
  "the composer footer is the drop target (counted enter/leave handlers)",
);
assert.match(source, /onPaste=\{handlePaste\}/, "the textarea accepts paste-to-attach (screenshots)");
assert.match(
  source,
  /dropActive \?[\s\S]*?quick-chat-dropzone/,
  "an active file drag shows the drop veil",
);
assert.match(
  source,
  /onSend\(attachments\.map\(\(\{ id: _id, \.\.\.attachment \}\) => attachment\)\);\s*\n\s*clearAttachments\(\)/,
  "send strips the local chip id and clears staging (mirrors the chat composer)",
);
assert.match(
  source,
  /const canSend = Boolean\(draft\.trim\(\) \|\| attachments\.length > 0\)/,
  "attachment-only sends are allowed — files with no text still go",
);
assert.match(
  source,
  /aria-label="Attached files"[\s\S]*?attachmentIcon\(attachment\)/,
  "staged files render as a labelled chip group with type icons",
);
assert.match(
  source,
  /aria-label=\{`Remove \$\{attachment\.name\}`\}/,
  "each staged file is individually removable",
);
assert.match(
  thread,
  /message\.attachments\?\.length \?[\s\S]*?quick-chat-bubble__files/,
  "a sent user turn keeps its paperclip line in the bubble",
);

// ── Message queueing: sends during a stream park, then auto-send ─────────────
assert.match(
  source,
  /if \(!disabled && canDispatch\) send\(\);/,
  "Enter only dispatches launch-ready messages and still queues while a reply streams",
);
assert.match(
  source,
  /\{sending \? "Queue" : "Send"\}/,
  "the Send button relabels to Queue while a reply streams (and stays enabled)",
);
assert.doesNotMatch(
  source,
  /disabled=\{sending \|\| disabled \|\| !draft\.trim\(\)\}/,
  "the old sending-disables-Send guard stays gone — sending now queues",
);
assert.match(
  source,
  /aria-label="Queued messages"[\s\S]*?onRemoveQueued\(item\.id\)/,
  "queued messages render as a labelled chip list with per-item remove",
);
assert.match(
  source,
  /aria-label="Queued messages"[\s\S]*?onSteerQueued\?\.\(item\.id\)/,
  "queued messages can be steered with keyboard/select (Enter on the steer button)",
);

// ── The hook side of queueing + attachments (use-quick-chat) ─────────────────
{
  const hook = readFileSync(new URL("../lib/use-quick-chat.ts", import.meta.url), "utf8");
  assert.match(
    hook,
    /if \(abortRef\.current\) \{[\s\S]*?queuedRef\.current = \[\.\.\.queuedRef\.current, item\]/,
    "a send during an in-flight turn queues instead of silently dropping",
  );
  assert.match(
    hook,
    /if \(status === "done"\) \{[\s\S]*?sendTextRef\.current\(next\.text, next\.attachments \?\? \[\]\)/,
    "the queue drains only on NATURAL completion — Stop and failures park it",
  );
  assert.match(
    hook,
    /target\.error && !\(target\.familiarId && attachments\.length > 0\)/,
    "only the empty-prompt error is forgiven for attachment-only sends",
  );
  assert.match(
    hook,
    /stripPreviewOnlyAttachmentFieldsKeepingImages\(attachments\)/,
    "outgoing files are stripped to send shape — image payloads kept, previews dropped",
  );
  assert.match(
    hook,
    /loading: projectsLoading,[\s\S]*error: projectsError,[\s\S]*loadedSuccessfully: projectsLoadedSuccessfully,[\s\S]*enabled: Boolean\(selectedFamiliarId\),[\s\S]*familiarId: selectedFamiliarId/,
    "quick chat consumes successful, familiar-scoped project state and never falls back to an unscoped list",
  );
  assert.match(
    hook,
    /const projectLaunchReady =[\s\S]*projectsLoadedSuccessfully[\s\S]*!projectsLoading[\s\S]*!projectsError[\s\S]*selectedProject\?\.access/,
    "quick chat only becomes launch-ready for a fresh accessible project",
  );
  const sendTextIndex = hook.indexOf("const sendText = useCallback");
  const targetResolutionIndex = hook.indexOf(
    "const target = resolveQuickChatTarget(raw, familiars, selectedFamiliarId)",
    sendTextIndex,
  );
  const familiarSwitchIndex = hook.indexOf(
    "if (target.familiarId !== selectedFamiliarId && !abortRef.current)",
    sendTextIndex,
  );
  const launchGateIndex = hook.indexOf("if (!projectLaunchReady)", sendTextIndex);
  const queueIndex = hook.indexOf("if (abortRef.current)", sendTextIndex);
  assert.ok(launchGateIndex > sendTextIndex, "quick-chat send has a client launch guard");
  assert.ok(
    targetResolutionIndex < launchGateIndex && familiarSwitchIndex < launchGateIndex,
    "a leading @mention switches to the target familiar's project scope before launch readiness is checked",
  );
  assert.ok(launchGateIndex < queueIndex, "an invalid quick-chat send is rejected before queue or draft mutation");
  assert.match(
    hook,
    /target\.familiarId !== selectedFamiliarId && !abortRef\.current[\s\S]*setSelectedProjectRoot\(null\)[\s\S]*setDraft\(raw\)[\s\S]*Choose a project/,
    "an @mention familiar switch clears the old project and preserves the draft before any launch",
  );
  assert.match(
    hook,
    /projectRoot: selectedProjectRoot \?\? undefined/,
    "quick chat forwards the selected project root to the chat bridge",
  );
  assert.match(
    hook,
    /queuedRef\.current = \[\];\s*\n\s*setQueued\(\[\]\);/,
    "newThread clears the parked queue with the rest of the thread",
  );
  assert.match(
    hook,
    /const steerQueued = useCallback\(\(id: string\) => \{[\s\S]*?void sendTextRef\.current\(next\.text, next\.attachments \?\? \[\]\);/,
    "steering a queued message reorders it (or immediately resumes it) through the normal send pipeline",
  );
  assert.match(
    hook,
    /void deliver\(target, resume, lastUserAttachmentsRef\.current\)/,
    "regenerate re-sends the last user turn's files, not just its text",
  );
  const stream = readFileSync(new URL("../lib/familiar-stream.ts", import.meta.url), "utf8");
  assert.match(
    stream,
    /\.\.\.\(opts\.attachments\?\.length \? \{ attachments: opts\.attachments \} : \{\}\)/,
    "streamFamiliarText forwards attachments to the chat bridge (native support)",
  );
}

console.log("quick-chat-controls.test.ts OK");
