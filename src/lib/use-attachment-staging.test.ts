// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-attachment-staging.ts", import.meta.url), "utf8");

// ── Signature ────────────────────────────────────────────────────────────────
assert.match(
  src,
  /export function useAttachmentStaging\(opts\?: \{\s*maxFiles\?: number;/,
  "useAttachmentStaging({ maxFiles, onLimit, onAdded, focus }) — feedback and focus stay per-composer decisions",
);
assert.match(
  src,
  /attachments: ComposerAttachment\[\];\s*addFiles:[\s\S]*?removeAttachment:[\s\S]*?clearAttachments:[\s\S]*?handlePaste:[\s\S]*?dropActive:[\s\S]*?dropHandlers:/,
  "the hook returns the full staging surface: list, add/remove/clear, paste, and the drag-handler bundle",
);

// ── Async staging boundaries ─────────────────────────────────────────────────
assert.match(src, /maxFiles - attachmentsRef\.current\.length - pendingRef\.current/,
  "in-flight reads reserve capacity before another pick or drop can enter");
assert.match(src, /Promise\.allSettled\(selected\.map\(fileToAttachment\)\)/,
  "one read failure cannot discard successful siblings");
assert.match(src, /generation !== generationRef\.current\) return/,
  "stale reads cannot repopulate a cleared or unmounted composer");
assert.match(src, /if \(next\.length\) \{[\s\S]*onAdded\?\.\(next\.length\)/,
  "only captured files are announced as attached");

// ── Drag overlay (dragDepth-counted so child transitions never flicker) ──────
assert.match(
  src,
  /const dragDepthRef = useRef\(0\);/,
  "enter/leave pairs are counted — child-element transitions must not flicker the overlay",
);
assert.match(
  src,
  /if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;/,
  "only file drags arm the overlay — dragging a text selection never hijacks the surface",
);

// ── Paste: files win over text, plain-text paste untouched ───────────────────
const pasteHandler = src.match(/const handlePaste = useCallback\([\s\S]*?\[addFiles\],\s*\);/)?.[0] ?? "";
assert.match(
  pasteHandler,
  /if \(!hasDraggedFiles\(e\.clipboardData\.types\)\) return;/,
  "text-only clipboard data skips WebView file-item inspection so native paste remains responsive",
);
assert.match(
  src,
  /\.filter\(\(item\) => item\.kind === "file"\)[\s\S]*?if \(pastedFiles\.length > 0\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*void addFiles\(pastedFiles\);/,
  "paste consumes clipboard files and only preventDefaults when files were actually staged",
);

console.log("use-attachment-staging.test.ts: ok");
