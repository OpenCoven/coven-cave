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

// ── Cap semantics ────────────────────────────────────────────────────────────
assert.match(
  src,
  /const room = Math\.max\(0, maxFiles - attachments\.length\);\s*\n\s*const selected = Array\.from\(files\)\.slice\(0, room\);/,
  "adds are capped to the remaining room, not rejected wholesale",
);
assert.match(
  src,
  /if \(selected\.length === 0\) \{\s*\n\s*onLimit\?\.\(\);\s*\n\s*return;\s*\n\s*\}/,
  "a fully-swallowed pick fires onLimit (home toasts; chat passes nothing and stays silent)",
);
assert.match(
  src,
  /onAdded\?\.\(next\.length\);\s*\n\s*focus\?\.\(\);/,
  "staged adds report their count and return focus via the caller's own callbacks",
);

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
assert.match(
  src,
  /\.filter\(\(item\) => item\.kind === "file"\)[\s\S]*?if \(pastedFiles\.length > 0\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*void addFiles\(pastedFiles\);/,
  "paste consumes clipboard files and only preventDefaults when files were actually staged",
);

console.log("use-attachment-staging.test.ts: ok");
