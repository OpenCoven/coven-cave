// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");

assert.match(source, /StandardSelect/, "quick-chat select helper should delegate to StandardSelect");
assert.doesNotMatch(source, /PopoverBody|PopoverItem|anchorRef/, "quick-chat select helper should not maintain its own popover implementation");
assert.match(source, /renderValue=/, "quick-chat select helper should keep its compact trigger rendering through StandardSelect");

// Shared conversation thread — used by both the in-app dropdown and the tray.
assert.match(source, /export function QuickChatThread/, "controls export the shared multi-turn thread renderer");
assert.match(source, /import \{ MarkdownBlock \} from "@\/components\/message-bubble"/, "familiar replies render markdown via the shared MarkdownBlock");
assert.match(source, /copyText\(visible\)/, "each familiar reply can be copied to the clipboard — the visible text, not the raw next-paths trailer");
assert.match(source, /aria-live="polite"/, "the thread is a polite live region so streamed replies are announced");
assert.match(source, /quick-chat-caret|quick-chat-typing/, "streaming turns show a caret / thinking affordance");

// ── Shared building blocks: one source of truth for both surfaces ────────────
// The overlay and the tray render the same header identity, controls row, and
// composer — drift between the two (e.g. hint copy, focus behavior) was a bug.
for (const name of [
  "QuickChatIdentity",
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
  source,
  /export const QUICK_CHAT_SUGGESTIONS/,
  "the one-tap starter suggestions are defined once and shared",
);
assert.match(
  source,
  /loading \? "Loading familiars…" : familiar \? `@\$\{familiar\.id\}` : "No familiar selected"/,
  "the shared header identity shows a loading state while the roster loads",
);
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
  /<QuickChatSelect[\s\S]*label="Project"[\s\S]*onChange=\{\(next\) => onPickProjectRoot\(/,
  "the shared controls row includes project selection for quick chat",
);
assert.match(
  source,
  /projectsLoading && projects\.length === 0[\s\S]*label: "Loading projects…"/,
  "project select shows a loading placeholder while scoped projects are fetching",
);
assert.match(
  source,
  /CONTROL_SELECT_CLASS =\s*\n?\s*"[^"]*rounded-\[var\(--radius-control\)\]/,
  "selector controls use the shared control radius token",
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
  source,
  /const \{ schedulePin, stick \} = useStickToBottom\(scrollRef\)/,
  "the thread follows via the shared intent-release hook",
);
assert.doesNotMatch(
  source,
  /clientHeight < 48/,
  "the position-threshold re-stick stays gone",
);
assert.match(
  source,
  /schedulePin\(\);\s*\}, \[messages\.length, lastText, schedulePin\]\)/,
  "streamed tokens pin through the coalesced scheduler",
);
assert.match(
  source,
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
  source,
  /setTimeout\(\(\) => setCopied\(false\), 1500\)/,
  "the copied ✓ hands the button back to copy after a beat (it used to stick forever)",
);

// ── Next-path suggestions — the agent trailer as tap-to-fill chips ────────────
// Familiar replies carry a parseable <coven:next-paths> trailer (see
// lib/next-paths.ts). The quick chat strips it from EVERY turn (streaming-safe:
// the half-open block hides too) and renders the suggestions as chips on the
// LATEST settled reply only — a compact tray can't afford stale chip rows.
assert.match(
  source,
  /import \{ extractNextPaths \} from "@\/lib\/next-paths"/,
  "the thread parses the shared next-paths trailer format — no bespoke parser",
);
assert.match(
  source,
  /message\.role === "assistant"\s*\?\s*extractNextPaths\(message\.text\)/,
  "the trailer is stripped from familiar turns (never shown raw)",
);
assert.match(
  source,
  /isLastAssistant && !streaming && onSuggestion && suggestions\.length > 0/,
  "chips render only on the latest settled reply, and only when a composer can accept them",
);
assert.match(
  source,
  /className="quick-chat-next-path"[\s\S]*?onClick=\{\(\) => onSuggestion\(suggestion\)\}/,
  "clicking a chip fills the composer through the shared suggestion path (fill, not send)",
);
assert.match(
  source,
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
  source,
  /message\.attachments\?\.length \?[\s\S]*?quick-chat-bubble__files/,
  "a sent user turn keeps its paperclip line in the bubble",
);

// ── Message queueing: sends during a stream park, then auto-send ─────────────
assert.match(
  source,
  /if \(!disabled && canSend\) send\(\);/,
  "Enter while a reply streams still dispatches — the hook queues it instead of dropping it",
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
    /useProjects\(\{ familiarId: selectedFamiliarId \}\)/,
    "quick chat loads project options scoped to the selected familiar",
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
