// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reader = readFileSync(new URL("./chat-markdown-reader.tsx", import.meta.url), "utf8");
const fileReader = readFileSync(new URL("./chat-file-reader.tsx", import.meta.url), "utf8");
const wiring = readFileSync(new URL("./message-dom-wiring.ts", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── The shared reader shell ─────────────────────────────────────────────────
assert.match(reader, /createPortal\(reader, document\.body\)/);
assert.match(reader, /useFocusTrap\(true, dialogRef/);
assert.match(reader, /role="dialog"/);
assert.match(reader, /aria-modal="true"/);
assert.match(reader, /aria-live="polite"/);
assert.match(reader, /readerOutline\(markdown \?\? ""\)/);
assert.match(reader, /<MarkdownBlock[\s\S]*?text=\{markdown\}/);
assert.match(reader, /<MarkdownBlock[\s\S]*?onOpenUrl=\{onOpenUrl\}/);
assert.match(reader, /copyText\(markdown\)/);
assert.match(reader, /new Blob\(\[markdown\]/);
assert.match(
  reader,
  /className="chat-spec-reader__document focus-ring-inset"[\s\S]*?role="region"[\s\S]*?aria-label=\{`\$\{title\} document`\}[\s\S]*?tabIndex=\{0\}/,
  "the scrollable document is a labeled keyboard focus target",
);
// A document that failed to load must not offer Copy/Markdown for bytes that
// were never read, and must say so rather than render an empty reader.
assert.match(reader, /\{markdown \? \(\s*<>/, "export controls only exist once the document is loaded");
assert.match(reader, /<ErrorState[\s\S]*?subtitle=\{error\}/, "a load failure states itself in the reader");
assert.match(reader, /loading \? \(\s*<SkeletonRows/, "loading shows a skeleton, not a blank sheet");

// ── The spec card delegates to it ───────────────────────────────────────────
const specCard = readFileSync(new URL("./chat-spec-card.tsx", import.meta.url), "utf8");
assert.match(
  specCard,
  /<ChatMarkdownReader[\s\S]*?markdown=\{spec\.markdown\}/,
  "spec/handoff cards read through the same shared reader",
);

// ── Project .md files open in that reader, not the Code workspace ───────────
// The routing itself (offer to the chat reader, fall through to Code when
// unclaimed) is exercised directly in src/lib/file-ref-open.test.ts; here we
// only pin that the bubble wiring uses it.
assert.match(
  wiring,
  /const open = \(\) => openFileRef\(\{ path, line \}, dispatchFileRefEvent\);/,
  "a clicked ref routes through the shared open decision",
);
assert.match(
  chatView,
  /window\.addEventListener\("cave:open-markdown-document", onOpenDocument as EventListener\)/,
  "the chat transcript claims markdown opens",
);
assert.match(
  chatView,
  /if \(!path \|\| !transcriptFileRoot \|\| fileRefIndex\?\.root !== transcriptFileRoot\) return;\s*const rel = resolveFileRefTarget\(\{ path \}, transcriptFileRoot, fileRefIndex\.files\);\s*if \(!rel\) return;\s*event\.preventDefault\(\);/,
  "only a path this transcript's own index can resolve is claimed — everything else falls through",
);
assert.match(
  chatView,
  /if \(event\.defaultPrevented\) return;/,
  "a second mounted transcript never stacks a second reader over one click",
);
assert.match(
  chatView,
  /<ChatFileReader\s+target=\{documentTarget\}/,
  "the resolved document renders in the chat reader",
);

// ── The file reader reads real bytes and keeps the Code route reachable ─────
assert.match(
  fileReader,
  /fetch\(\s*`\/api\/project-file\?path=\$\{encodeURIComponent\(absPath\)\}`/,
  "the document body comes from the project-file API",
);
assert.match(fileReader, /if \(status === 404\)/, "a missing file reports as missing");
assert.match(fileReader, /if \(status === 403\)/, "a path outside a granted root reports as such");
assert.match(
  fileReader,
  /headerActions=\{codeButton\}[\s\S]*?errorActions=\{codeButton\}/,
  "Open in Code stays one click away, including when the read fails",
);
assert.match(
  fileReader,
  /new CustomEvent\("cave:open-project-file", \{\s*detail: \{ path, line \},/,
  "that escape hatch reuses the existing shell route",
);

console.log("chat-markdown-reader: all assertions passed");
