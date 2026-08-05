// @ts-nocheck
import assert from "node:assert/strict";
import {
  activityCss,
  attachmentsLib,
  attachStagingHook,
  emptyStateSource,
  globalsSrc,
  menuModel,
  menusHookSource,
  sessionHeader,
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
  // Pinned as an ORDER, not an exact chain: marker extractors keep being added
  // between the skill split and next-paths (auto-mission status was the last),
  // and naming the immediate argument makes this assertion stale every time.
  /const reasoningSplit = splitReasoning\(extractAgentAttachmentMarkers\(turn\.text\)\.text\)[\s\S]*const inlineReasoning = reasoningSplit\.reasoning[\s\S]*const skillSplit = extractSkillMarkers\([\s\S]*const \{ visible: visibleWithGh, suggestions: nextPaths \} = extractNextPaths\(/,

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
  /function ReasoningBlock[\s\S]*const \[showThinking\] = useShowThinking\(\)[\s\S]*open=\{pending \|\| showThinking \|\| undefined\}/,
  "ReasoningBlock settles to the global Show-thinking preference after live streaming",
);

assert.match(
  source,
  /function ReasoningBlock\(\{ reasoning, durationMs, pending \}[\s\S]*open=\{pending \|\| showThinking \|\| undefined\}/,
  "live reasoning stays open while a turn is pending, then returns to the Show-thinking preference",
);
assert.match(
  turnRow,
  /<ReasoningBlock reasoning=\{reasoning\} durationMs=\{turn\.durationMs\} pending=\{!!turn\.pending\} \/>[\s\S]*?<MessageBubble/,
  "assistant reasoning renders before the streamed answer instead of trailing it",
);
assert.match(
  sessionHeader,
  /function SessionOverflowMenu[\s\S]*useShowThinking\(\)[\s\S]*setShowThinking\(!showThinking\)/,
  "The session overflow menu carries the global Show-thinking toggle",
);
// The toggle's label/checked state derive from the pure menu model (cave-zolo).
assert.match(
  menuModel,
  /id: "thinking",\s*label: ctx\.showThinking \? "Hide thinking" : "Show thinking",[\s\S]*?checked: ctx\.showThinking/,
  "The menu model flips the thinking item label and checkmark with the preference",
);

// ToolGroup's accessible name is a dedicated helper: the compact activity
// summary plus the running/error counts a sighted reader gets only from a
// tinted (color-only) chip.
assert.match(
  source,
  /function toolGroupAriaLabel\(summary: string, running: number, errors: number\): string \{[\s\S]*?Tool activity: \$\{summary\}/,
  "toolGroupAriaLabel states the compact summary as the disclosure's accessible name",
);

assert.match(
  source,
  /function toolGroupAriaLabel[\s\S]*?running \? `\$\{running\} running` : ""[\s\S]*?errors \? `\$\{errors\} \$\{errors === 1 \? "error" : "errors"\}` : ""/,
  "toolGroupAriaLabel body appends '${running} running' and singular/plural error count — not just the base summary",
);

assert.match(
  source,
  /function ToolGroup[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*aria-label=\{toolGroupAriaLabel\(summary, running, errors\)\}[\s\S]*<ToolRuns tools=\{tools\}/,
  "ToolGroup wraps ONE collapsed disclosure — named by toolGroupAriaLabel — around ToolRuns per assistant turn",
);
const toolGroup = source.match(/function ToolGroup[\s\S]*?function InlineToolRuns/)?.[0] ?? "";
assert.equal(
  toolGroup.match(/<ToolRuns tools=\{tools\} \/>/g)?.length,
  1,
  "ToolGroup renders the shared ToolRuns path exactly once",
);

assert.match(
  source,
  /function ToolRuns[\s\S]*groupConsecutiveTools\(tools\)[\s\S]*<ToolRunGroup[\s\S]*<ToolBlock/,
  "adjacent repeated tool calls roll into an expandable run while one-off calls retain their existing block",
);
assert.match(
  source,
  /function ToolRuns[\s\S]*?containsEdit = run\.tools\.some\(\(tool\) => toolInputAsDiff\(tool\.name, tool\.input\) != null\)[\s\S]*?run\.tools\.length > 1 && !containsEdit \? \(\s*<ToolRunGroup/,
  "ToolRuns computes containsEdit via toolInputAsDiff and gates ToolRunGroup creation on run.tools.length > 1 && !containsEdit",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*<details[\s\S]*×\{tools\.length\}[\s\S]*tools\.map\(\(tool\) => <ToolBlock/,
  "a tool run's compact summary states its call count as ×N and expands to every underlying tool block",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*const disclosure = useToolRunDisclosure\(tools\.map\(\(tool\) => tool\.status\)\);/,
  "a tool run's disclosure state comes from the shared repeated-run hook, not a local useState",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*ref=\{disclosure\.detailsRef\}[\s\S]*open=\{disclosure\.open\}[\s\S]*onToggle=\{\(event\) => disclosure\.onToggle\(event\.currentTarget\.open\)\}[\s\S]*onBlurCapture=\{disclosure\.onBlurCapture\}/,
  "a tool run's <details> is controlled by the disclosure hook (open + ref) and defers collapse via onBlurCapture",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*aria-label=\{`\$\{displayName\}, \$\{tools\.length\} \$\{tools\.length === 1 \? "call" : "calls"\}\$\{running \? `, \$\{running\} running` : ""\}\$\{errors \? `, \$\{errors\} \$\{errors === 1 \? "error" : "errors"\}` : ""\}`\}/,
  "a repeated run's accessible name includes its call, running, and error counts",
);

// Task 3 cont.: Status spans are scoped to their <summary> and wrap the chip markup.
// Narrow to just the <summary> block so neither assertion can cross </summary>
// or reach into ToolRuns / ToolRunGroup.
const toolGroupSummary = toolGroup.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
assert.match(
  toolGroupSummary,
  /cave-work-line__status">[^]*?cave-tool-count--running[^]*?cave-tool-count--error[^]*?<\/span>\s*<\/summary>/,
  "ToolGroup summary: cave-work-line__status span contains the running/error chips before the span closes",
);

const toolRunGroupSrc = source.match(/function ToolRunGroup[\s\S]*?const ToolProjectRootContext/)?.[0] ?? "";
const toolRunGroupSummary = toolRunGroupSrc.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
assert.match(
  toolRunGroupSummary,
  /cave-tool-run__status">[^]*?cave-tool-count--running[^]*?cave-tool-count--error[^]*?<\/span>\s*<\/summary>/,
  "ToolRunGroup summary: cave-tool-run__status span contains the running/error chips before the span closes",
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
// ReasoningBlock and ToolRunGroup are the two exceptions — each `open` is a
// controlled binding (Show-thinking preference / useToolRunDisclosure,
// respectively), not a hardcoded default.
assert.doesNotMatch(
  [
    source.match(/function ToolGroup[\s\S]*?function ToolRunGroup/)?.[0] ?? "",
    source.match(/function ToolBlock[\s\S]*?function ToolInputView/)?.[0] ?? "",
  ].join("\n"),
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Tool-use disclosures must not default open",
);
// A hardcoded `open` (open with no binding) on a repeated tool run would defeat
// the running-forces-open / settle-collapses behaviour — only the controlled
// `open={disclosure.open}` is allowed.
assert.doesNotMatch(
  source.match(/function ToolRunGroup[\s\S]*?function ToolBlock/)?.[0] ?? "",
  /<details[^>]*\sopen(?:\s|>)/,
  "ToolRunGroup must not hardcode the disclosure open",
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
  /const editCards = settledTools\.filter\(isEditCard\);\s*const otherTools = settledTools\.filter\(\(t\) => !isEditCard\(t\)\);/,
  "edit cards are split before the remaining tool activity",
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
  /otherTools\.length \? <ToolGroup[\s\S]*?<MessageBubble[\s\S]*?!turn\.pending && turn\.tools\?\.length && editCards\.length/,
  "TurnRowImpl source order: otherTools ToolGroup precedes MessageBubble; editCards section follows MessageBubble — the two sections are separate and in their current intended positions",
);

assert.match(
  turnRow,
  /<MessageBubble[\s\S]*role="assistant"[\s\S]*content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}/,
  "Assistant turns should render only filtered visible content",
);

// ── Task 4: CSS density contract ────────────────────────────────────────────

assert.match(
  styles,
  /\.cave-tool-group\.cave-work-line > \.cave-tool-summary\s*\{[^}]*min-height:\s*var\(--space-8\)/,
  "compact work-line summary must have min-height: var(--space-8) for 32px touch target",
);

assert.match(
  styles,
  /\.cave-tool-run\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/,
  ".cave-tool-run must remove nested framing (border: 0, background: transparent) inside the work-line",
);

assert.match(
  styles,
  /\.cave-tool-run__list\s*\{[^}]*gap:\s*var\(--space-1\)/,
  ".cave-tool-run__list must use tight gap: var(--space-1) (4px) between tool blocks",
);

// Scope to activity.css directly and extract each @media (prefers-reduced-motion: reduce)
// block using a one-level brace-bounded regex — prevents crossing into later rules or
// into rules from other concatenated stylesheets.
const reducedMotionBlockRe =
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
const reducedMotionBlocks = Array.from(
  activityCss.matchAll(reducedMotionBlockRe),
  (m) => m[0],
).join("\n");
assert.match(
  reducedMotionBlocks,
  /\.cave-tool-summary::before\s*\{[^}]*transition:\s*none/,
  "reduced-motion must disable the .cave-tool-summary::before chevron transition",
);
