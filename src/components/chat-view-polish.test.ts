// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const reasoningBlock = source.match(/function ReasoningBlock[\s\S]*?\n}\n\n\/\/ ── ToolGroup/)?.[0] ?? "";

assert.match(
  source,
  /fetch\("\/api\/chat\/send"[\s\S]*body: JSON\.stringify\(\{[\s\S]*attachments: stripPreviewOnlyAttachmentFields\(outgoingAttachments\)/,
  "Chat send should strip preview-only attachment fields before POSTing",
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

assert.doesNotMatch(
  reasoningBlock,
  /setManuallyToggled/,
  "ReasoningBlock should not reference tool-group manual toggle state",
);

assert.match(
  source,
  /const \[open, setOpen\] = useState\(anyRunning\)/,
  "Tool groups that mount while running should start open",
);

assert.match(
  source,
  /onClick=\{\(\) => \{ setManuallyToggled\(true\); setOpen\(\(v\) => !v\); \}\}/,
  "Tool group header clicks should pin manual open/closed state",
);

assert.match(
  source,
  /<header className="flex w-full items-center gap-2/,
  "Chat header should span the full side-panel width",
);

assert.match(
  source,
  /<FamiliarSwitcher familiar=\{familiar\} familiars=\{familiars\} onSelect=\{onFamiliarSelect\} \/>/,
  "Chat header should expose familiar switching through the side-panel picker",
);
