// @ts-nocheck
import assert from "node:assert/strict";
import {
  attachmentsLib,
  attachStagingHook,
  emptyStateSource,
  globalsSrc,
  menusHookSource,
  source,
  splitReasoning,
  styles,
  turnRow,
} from "./chat-view-polish-fixtures.ts";

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
  /const reasoningSplit = splitReasoning\(extractAgentAttachmentMarkers\(turn\.text\)\.text\)[\s\S]*const inlineReasoning = reasoningSplit\.reasoning[\s\S]*const \{ visible: visibleWithGh, suggestions: nextPaths \} = extractNextPaths\(skillSplit\.visible\)/,
  "Assistant turns should split visible content from collapsible reasoning before extracting next-path suggestions",
);

assert.match(
  source,
  /function ReasoningBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Thinking[\s\S]*<RichText text=\{reasoning\}/,
  "ReasoningBlock should render thinking in a collapsed disclosure with formatted text",
);

// Thinking is togglable: the global Show-thinking preference opens every
// reasoning block at once via a controlled `open` (default-collapsed in markup).
assert.match(
  source,
  /function ReasoningBlock[\s\S]*const \[showThinking\] = useShowThinking\(\)[\s\S]*open=\{showThinking \|\| undefined\}/,
  "ReasoningBlock open state is driven by the global Show-thinking preference",
);
assert.match(
  source,
  /function SessionOverflowMenu[\s\S]*useShowThinking\(\)[\s\S]*checked=\{showThinking\}[\s\S]*\{showThinking \? "Hide thinking" : "Show thinking"\}/,
  "The session overflow menu carries the global Show-thinking toggle",
);

assert.match(
  source,
  /function ToolGroup[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*Tool activity[\s\S]*tools\.map[\s\S]*<ToolBlock/,
  "ToolGroup should render tool calls in a collapsed disclosure",
);

assert.match(
  source,
  /function ToolBlock[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*<summary[\s\S]*tool\.name[\s\S]*<ToolInputView input=\{tool\.input\}[\s\S]*<SyntaxBlock text=\{prettyToolOutput\(tool\.output\)\}/,
  "ToolBlock keeps payloads collapsed, renders readable input fields, and pretty-prints output",
);

// JSON tool input is converted to a human-readable labelled field list, with
// the raw JSON available behind a toggle.
assert.match(
  source,
  /function ToolInputView[\s\S]*toolReadableFields\(input\)[\s\S]*showRaw \? <SyntaxBlock text=\{input\}/,
  "ToolInputView renders readable fields by default and raw JSON on toggle",
);
assert.match(
  source,
  /function ToolFieldList[\s\S]*field\.label[\s\S]*field\.value/,
  "ToolFieldList renders each readable field's humanised label and value",
);

// Tool rows are color-coded by category for quick visual inspection.
assert.match(source, /import \{ toolVisual \} from "@\/lib\/tool-visual"/, "chat view imports the tool visual map");
assert.match(
  source,
  /function ToolBlock[\s\S]*const visual = toolVisual\(tool\.name\)[\s\S]*data-tool-category=\{visual\.category\}[\s\S]*<Icon name=\{visual\.icon\}/,
  "ToolBlock should color-code by tool category (data-tool-category + per-category icon)",
);

// Tool-use disclosures must never default open (the transcript stays clean).
// ReasoningBlock is the one exception — its `open` is a controlled binding to
// the global Show-thinking preference (asserted above), not a hardcoded default.
assert.doesNotMatch(
  [
    source.match(/function ToolGroup[\s\S]*?function ToolBlock/)?.[0] ?? "",
    source.match(/function ToolBlock[\s\S]*?function ToolInputView/)?.[0] ?? "",
  ].join("\n"),
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Tool-use disclosures must not default open",
);
// A hardcoded `open` (open with no binding) on the reasoning block would defeat
// the toggle — only the controlled `open={showThinking || undefined}` is allowed.
assert.doesNotMatch(
  source.match(/function ReasoningBlock[\s\S]*?function ProgressGroup/)?.[0] ?? "",
  /<details[^>]*\sopen(?:\s|>)/,
  "ReasoningBlock must not hardcode the disclosure open",
);

// --- Tool activity renders in a designated section on settled turns ---

// No per-turn show/hide toggle: the designated section is always present
// (collapsed) instead, so prose and tool usage are cleanly separated.
assert.doesNotMatch(
  turnRow,
  /showTools|showToolsOverride|cave-turn-tools-toggle/,
  "the settled-turn tool show/hide toggle is gone — tools live in a designated section",
);

assert.match(
  turnRow,
  /segments=\{renderSegments\}/,
  "MessageBubble renders the artifact-aware renderSegments",
);

assert.match(
  turnRow,
  /renderSegments = split\.some\(\(s\) => s\.kind === "block"\) \? split : undefined/,
  "settled turns render prose (+ artifacts) only — tool blocks are not woven into the text",
);

assert.match(
  turnRow,
  /!turn\.pending && turn\.tools\?\.length/,
  "settled turns that used tools render a designated tool section",
);
assert.match(
  turnRow,
  /cave-edit-cards[\s\S]*editCards\.map\(\(tool\) => <ToolBlock/,
  "edit-tool cards stay visible inline on settled turns (not buried in the collapsed rollup)",
);
assert.match(
  turnRow,
  /const isEditCard = \(t: ToolEvent\) =>\s*toolInputAsDiff\(t\.name, t\.input\) != null;/,
  "any structured file mutation diff stays visible inline, even when the tool input only has a relative path",
);
// Golden path 4 (cave-qva4): a multi-file turn gets ONE aggregate entry into
// the working-tree review, riding the per-card cave:open-file-diff contract.
assert.match(
  turnRow,
  /const editedFiles = Array\.from\(\s*\n\s*new Set\(\s*\n\s*editCards\s*\n\s*\.map\(\(t\) => toolTargetFile\(t\.name, t\.input\)\)/,
  "the aggregate counts DISTINCT edited files (the same file edited twice is one change)",
);
assert.match(
  turnRow,
  /\{editedFiles\.length > 1 \? \([\s\S]{0,400}?\{editedFiles\.length\} files changed/,
  "turns that edited more than one distinct file render the 'N files changed' chip (single-file turns keep just the card's own Review)",
);
assert.match(
  turnRow,
  /aria-label=\{`Review all \$\{editedFiles\.length\} changed files in the Changes tab`\}[\s\S]{0,300}?cave:open-file-diff/,
  "Review all opens the Changes tab through the cards' existing event contract",
);
assert.match(
  turnRow,
  /otherTools\.length \? <ToolGroup tools=\{otherTools\}/,
  "non-edit tool activity still collapses into the designated ToolGroup",
);

assert.match(
  turnRow,
  /<MessageBubble[\s\S]*role="assistant"[\s\S]*content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}/,
  "Assistant turns should render only filtered visible content",
);


