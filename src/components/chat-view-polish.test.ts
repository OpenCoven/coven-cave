// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const turnRow = source.match(/function TurnRow[\s\S]*?\n}\n\nfunction AttachmentLightbox/)?.[0] ?? "";
const splitReasoning = source.match(/function splitReasoning[\s\S]*?\n}\n\n\/\/ ── ChatEmptyState/)?.[0] ?? "";

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

assert.doesNotMatch(
  turnRow,
  /<ToolGroup|<ReasoningBlock/,
  "Assistant turns should hide tool-use and reasoning chrome from the transcript",
);

assert.match(
  turnRow,
  /const \{ visible \} = splitReasoning\(turn\.text\)/,
  "Assistant turns should render only reasoning-filtered visible content",
);

assert.match(
  source,
  /<header className="flex w-full items-center gap-2/,
  "Chat header should span the full side-panel width",
);

assert.doesNotMatch(
  source,
  /FamiliarSwitcher/,
  "Chat header should not duplicate the avatar rail's familiar switcher",
);
