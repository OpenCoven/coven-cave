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
  /function ReasoningBlock[\s\S]*<details[\s\S]*Reasoning[\s\S]*<RichText text=\{reasoning\}/,
  "ReasoningBlock should render reasoning in a collapsed disclosure with formatted text",
);

assert.match(
  source,
  /function ToolGroup[\s\S]*<details[\s\S]*Tool activity[\s\S]*tools\.map[\s\S]*<ToolBlock/,
  "ToolGroup should render tool calls in a collapsed disclosure",
);

assert.match(
  source,
  /function ToolBlock[\s\S]*<SyntaxBlock text=\{tool\.input\}[\s\S]*<SyntaxBlock text=\{tool\.output\}/,
  "ToolBlock should format tool input and output with SyntaxBlock",
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
  /const turnNumber = String\(index \+ 1\)\.padStart\(2, "0"\)/,
  "Chat turns should expose stable turn numbers for dense review",
);

assert.match(
  turnRow,
  /cave-linear-turn[\s\S]*cave-linear-turn-index[\s\S]*cave-linear-turn-content/,
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
