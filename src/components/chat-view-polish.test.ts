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
  source.match(/function ReasoningBlock[\s\S]*?function ToolBlock/)?.[0] ?? "",
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Thinking and tool-use disclosures must not default open",
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
  /<MetaLine\b/,
  "ChatView header should render the new MetaLine component",
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
