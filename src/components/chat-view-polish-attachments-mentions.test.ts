// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachmentCards,
  attachmentsLib,
  attachStagingHook,
  chatRuntimeSource,
  emptyStateSource,
  globalsSrc,
  menusHookSource,
  mentionAttachmentSource,
  source,
  splitReasoning,
  styles,
  turnRow,
} from "./chat-view-polish-fixtures.ts";

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
  attachmentCards,
  /const isImage = \(attachment\.mimeType \?\? attachment\.type\)\?\.startsWith\("image\/"\)/,
  "Attachment lightbox should fall back to legacy attachment.type for images",
);

assert.match(
  attachmentCards,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Attachment lightbox should expose modal dialog semantics",
);
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
// The slash branches live behind the shared hook's dispatcher, so the #402
// ordering contract anchors on the dispatch call: mention branch → menu
// dispatcher (consumes Esc while any menu is open) → busy-cancel.
assert.ok(
  mentionComposerKey.indexOf("if (mentionOpen) {") <
    mentionComposerKey.indexOf("handleMenuKey(e)"),
  "The mention branch must run before the slash-menu dispatcher in onComposerKey",
);
assert.ok(
  mentionComposerKey.indexOf("setMentionDismissed(true)") <
    mentionComposerKey.indexOf("handleMenuKey(e)") &&
    mentionComposerKey.indexOf("handleMenuKey(e)") <
      mentionComposerKey.indexOf("cancelSend()"),
  "Esc precedence: mention dismiss before slash dismiss (inside the dispatcher) before busy-cancel",
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
  /\.\.\.\(outgoingMentions\.length && mentionedFilesRootForRequest\s*\n\s*\? \{\s*\n\s*mentionedFiles: outgoingMentions\.slice\(0, MAX_FILE_MENTIONS\),\s*\n\s*mentionedFilesRoot: mentionedFilesRootForRequest,/,
  "The send body must carry mentionedFiles plus the root they are relative to",
);
assert.match(
  mentionSource,
  /mentionedFiles\s*\n?\s*\.filter\(\(p\) => text\.includes\(`@\$\{p\}`\)\)/,
  "Only mentions whose @path token survived editing may ride the send",
);
assert.match(
  mentionSource,
  /setInput\(""\);[\s\S]{0,400}?clearAttachments\(\);\s*\n\s*setMentionedFiles\(\[\]\);/,
  "Sending must clear staged mentions with the composer",
);

// Pins: send route validates mentions and appends the prompt block.
const mentionSendSource = readFileSync(
  new URL("../app/api/chat/send/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  mentionAttachmentSource,
  /async function resolveMentionedFiles\([\s\S]*?relPaths\.slice\(0, MAX_MENTIONED_FILES\)[\s\S]*?\.includes\("\.\."\)[\s\S]*?candidate\.startsWith\(realRoot \+ path\.sep\)/,
  "/chat/send must validate each mention: cap, repo-relative only, no `..`, prefix containment under the realpathed root",
);
assert.match(
  chatRuntimeSource,
  /async function resolveFamiliarWorkspace\([\s\S]*?readFamiliarWorkspaces\(\)[\s\S]*?path\.resolve\(familiarsRoot, familiarId\)[\s\S]*?path\.relative\(familiarsRoot, candidate\)[\s\S]*?relative\.startsWith\("\.\."\)/,
  "/chat/send must validate default familiar workspace paths under the familiar root while preserving configured workspaces",
);
assert.match(
  mentionAttachmentSource,
  /const real = await realpath\(candidate\);[\s\S]*?real\.startsWith\(realRoot \+ path\.sep\)/,
  "/chat/send must re-check containment on the realpathed file so in-repo symlinks cannot smuggle outside paths",
);
assert.match(
  mentionAttachmentSource,
  /"Referenced files \(open with the Read tool\):",\s*\n\s*\.\.\.absPaths\.map\(\(item\) => `- \$\{item\}`\)/,
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
