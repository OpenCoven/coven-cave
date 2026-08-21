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
  toolRunDisclosureSource,
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
  /const currentProjection = extractChatRenderedText\(turn\.text, \{ pending: Boolean\(turn\.pending\) \}\);[\s\S]*inlineReasoning,[\s\S]*authoredResults,[\s\S]*\} = currentProjection/,
  "Assistant turns should use the shared current projection for reasoning, results, and control-marker stripping",
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
  /const activityDetails =[\s\S]*?<ReasoningBlock[\s\S]*?reasoning=\{reasoning\}[\s\S]*?durationMs=\{turn\.durationMs\}[\s\S]*?pending=\{pending\}/,
  "assistant reasoning remains available through the shared activityDetails slot",
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
const toolGroup = source.match(/function ToolGroup[\s\S]*?function ToolRuns/)?.[0] ?? "";
assert.equal(
  toolGroup.match(/<ToolRuns tools=\{tools\} \/>/g)?.length,
  1,
  "ToolGroup renders the shared ToolRuns path exactly once",
);

assert.match(
  source,
  /function ToolRuns[\s\S]*groupConsecutiveTools\(tools\)[\s\S]*containsEdit[\s\S]*<ToolBlock[\s\S]*<ToolRunGroup/,
  "adjacent non-edit calls share a stable run shell while edit calls retain standalone blocks",
);
assert.match(
  source,
  /function ToolRuns[\s\S]*?containsEdit = run\.tools\.some\(\(tool\) => toolInputAsDiff\(tool\.name, tool\.input\) != null\)[\s\S]*?const body = containsEdit\s*\? run\.tools\.map\(\(tool\) => <ToolBlock[\s\S]*: <ToolRunGroup/,
  "ToolRuns keeps edits standalone and gives every non-edit run the same stable ToolRunGroup component",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*<ChatToolRunDisclosure[\s\S]*×\{tools\.length\}[\s\S]*tools\.map\(\(tool\) => <ToolBlock/,
  "a tool run's compact summary states its call count as ×N and expands to every underlying tool block",
);
assert.match(
  toolRunDisclosureSource,
  /useToolRunDisclosure\(statuses, repeated\)/,
  "the stable run shell delegates disclosure state to the shared hook",
);
assert.match(
  toolRunDisclosureSource,
  /"details"[\s\S]*ref: disclosure\.detailsRef[\s\S]*open: disclosure\.open[\s\S]*onToggle:[\s\S]*disclosure\.onToggle[\s\S]*onBlurCapture: disclosure\.onBlurCapture/,
  "the stable run shell controls its details element and defers focused collapse",
);
assert.match(
  toolRunDisclosureSource,
  /hidden: !repeated[\s\S]*className: repeated \? "cave-tool-run__list" : undefined/,
  "the same details and list nodes stay mounted while the repeated summary becomes visible",
);
assert.match(
  source,
  /function ToolRunGroup[\s\S]*ariaLabel=\{`\$\{displayName\}, \$\{tools\.length\} \$\{tools\.length === 1 \? "call" : "calls"\}\$\{running \? `, \$\{running\} running` : ""\}\$\{errors \? `, \$\{errors\} \$\{errors === 1 \? "error" : "errors"\}` : ""\}`\}/,
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
assert.match(
  toolRunGroupSrc,
  /summary=\{[\s\S]*?cave-tool-run__status">[^]*?cave-tool-count--running[^]*?cave-tool-count--error[^]*?<\/span>[\s\S]*?\}\s*>/,
  "ToolRunGroup summary content contains the running/error chips",
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

// Both ToolBlock <summary> variants must carry focus-ring so keyboard nav
// can reach the disclosure without custom :focus-visible overrides.
assert.match(
  source,
  /cave-edit-card__summary focus-ring/,
  "edit-card summary (isEditTool path) must carry focus-ring",
);
assert.match(
  source,
  /className="cave-tool-block"[\s\S]{0,200}<summary[^>]*focus-ring/,
  "generic ToolBlock summary (non-edit path) must carry focus-ring",
);

// Tool-use disclosures must never default open (the transcript stays clean).
// ReasoningBlock and ChatToolRunDisclosure are the two exceptions — each open
// state is controlled by a preference/hook, not hardcoded.
assert.doesNotMatch(
  [
    source.match(/function ToolGroup[\s\S]*?function ToolRunGroup/)?.[0] ?? "",
    source.match(/function ToolBlock[\s\S]*?function ToolInputView/)?.[0] ?? "",
  ].join("\n"),
  /<details[^>]*\sopen(?:=|\s|>)/,
  "Tool-use disclosures must not default open",
);
assert.match(
  toolRunDisclosureSource,
  /open: disclosure\.open/,
  "ChatToolRunDisclosure uses only the hook-controlled open state",
);
// A hardcoded `open` (open with no binding) on the reasoning block would defeat
// the toggle — only the controlled `open={showThinking || undefined}` is allowed.
assert.doesNotMatch(
  source.match(/function ReasoningBlock[\s\S]*?function ProgressGroup/)?.[0] ?? "",
  /<details[^>]*\sopen(?:\s|>)/,
  "ReasoningBlock must not hardcode the disclosure open",
);

// --- Tool activity keeps designated slots throughout the turn lifecycle ---

// No per-turn show/hide toggle: the designated section is present whenever
// non-edit activity exists, including while the assistant turn is running.
assert.doesNotMatch(
  turnRow,
  /showTools|showToolsOverride|cave-turn-tools-toggle/,
  "the settled-turn tool show/hide toggle is gone — tools live in a designated section",
);

assert.match(
  turnRow,
  /const proseContent =[\s\S]*?!pending && renderSegments[\s\S]*?renderSegments\.map[\s\S]*?segment\.kind === "text"[\s\S]*?<ProgressiveMarkdownBlock[\s\S]*?segment\.node/,
  "settled artifact-aware segments render as one ordered prose sequence",
);

assert.match(
  turnRow,
  /renderSegments = split\.some\(\((segment|s)\) => (?:segment|s)\.kind === "block"\) \? split : undefined/,
  "settled turns render prose (+ artifacts) only — tool blocks are not woven into the text",
);
const supplementary = turnRow.match(
  /const supplementaryContent = \([\s\S]*?\n  \);\n\n  return \(/,
)?.[0] ?? "";
assert.doesNotMatch(
  supplementary,
  /renderSegments|segment\.node|s\.node/,
  "inline rich blocks are not duplicated in supplementaryContent",
);

assert.match(
  turnRow,
  /const activityDetails =[\s\S]*?!pending && otherTools\.length/,
  "settled turns that used non-edit tools keep a designated activityDetails section",
);
assert.match(
  turnRow,
  /const supplementaryContent =[\s\S]*?cave-edit-cards[\s\S]*editCards\.map\(\(tool\) => <ToolBlock/,
  "edit-tool cards stay visible in supplementaryContent (not buried in activity)",
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
  /const editedFiles = Array\.from\(\s*\n\s*new Set\(\s*\n\s*editCards\s*\n\s*\.map\(\(tool\) => toolTargetFile\(tool\.name, tool\.input\)\)/,
  "the aggregate counts DISTINCT edited files (the same file edited twice is one change)",
);
// Two halves of one contract. They were a single pattern until the edit-card
// block started deriving `editedFiles` inside an IIFE, which put the guard and
// the count test on opposite sides of that derivation — so no contiguous match
// can span them, and the 400-character window between the two anchors was the
// kind of distance constraint docs/source-text-pins.md warns about. Asserting
// each half directly is both stricter and refactor-proof.
assert.match(
  turnRow,
  /\{!pending && turn\.tools\?\.length && editCards\.length/,
  "edit cards render only for settled turns that actually produced tool output",
);
assert.match(
  turnRow,
  /\{editedFiles\.length > 1 \? \([\s\S]{0,600}?\{editedFiles\.length\} files changed/,
  "turns that edited more than one distinct file render the 'N files changed' chip (single-file turns keep just the card's own Review)",
);
assert.match(
  turnRow,
  /aria-label=\{`Review all \$\{editedFiles\.length\} changed files in the Changes tab`\}[\s\S]{0,300}?cave:open-file-diff/,
  "Review all opens the Changes tab through the cards' existing event contract",
);
assert.match(
  turnRow,
  /const activityDetails =[\s\S]*?otherTools\.length \? \(\s*<ToolGroup tools=\{otherTools\}/,
  "non-edit tool activity still collapses into the activityDetails ToolGroup",
);
// This pinned the old `ChatToolActivityLayout` wrapper and, through it, the
// source ORDER of two slots. The calm-streaming work replaced that wrapper with
// StreamingTurnResponse, which owns the ordering itself and renders the
// collapsed activity as a disclosure after the response rather than as a work
// line above it. Source order in TurnRowImpl therefore no longer decides
// anything — all three slots are now props, assembled by the response
// component — so pinning it here would pin a fact that has stopped being the
// contract.
//
// What has NOT changed, and is what this assertion is really for: the two
// sections stay SEPARATE. The collapsed activity rollup carries non-edit tools
// only, the edit cards keep their own visible section, and neither is folded
// into the other. Pin that instead.
assert.match(
  turnRow,
  /<ToolGroup tools=\{otherTools\} \/>/,
  "the collapsed activity rollup renders the non-edit tools",
);
assert.doesNotMatch(
  turnRow,
  /<ToolGroup tools=\{(?:editCards|settledTools|turn\.tools)/,
  "edit cards must never be swept into the collapsed activity rollup",
);
assert.match(
  turnRow,
  /const supplementaryContent =[\s\S]*?editCards\.map\(\(tool\) => <ToolBlock/,
  "edit cards keep their own visible section as individual ToolBlocks",
);
assert.match(
  turnRow,
  /<StreamingTurnResponse[\s\S]*?activityDetails=\{activityDetails\}\s*supplementaryContent=\{supplementaryContent\}/,
  "the activity slot and the edit-card slot reach the response component as two distinct props",
);

assert.match(
  turnRow,
  /<MessageBubble[\s\S]*role="assistant"[\s\S]*content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}[\s\S]*assistantBody=\{[\s\S]*?<StreamingTurnResponse/,
  "MessageBubble keeps filtered source ownership while the shared response owns presentation",
);

// ── Task 4: CSS density contract ────────────────────────────────────────────

// The per-turn "N tools" show/hide toggle (CHAT-D13-01) was removed when tools
// got a designated always-present activity slot; its CSS is dead and must be
// pruned to prevent ghost selector confusion.
assert.doesNotMatch(
  activityCss,
  /\.cave-turn-tools-toggle/,
  "cave-turn-tools-toggle CSS is removed — the per-turn toggle is gone",
);

assert.match(
  styles,
  /\.cave-tool-group\.cave-work-line > \.cave-tool-summary\s*\{[^}]*min-height:\s*var\(--space-8\)/,
  "compact work-line summary must have min-height: var(--space-8) for 32px touch target",
);

// Base standalone framing: ToolRunGroup outside .cave-work-line keeps card framing.
assert.match(
  styles,
  /\.cave-tool-run\s*\{[^}]*border:\s*1px solid[^}]*background:/,
  "base .cave-tool-run must retain standalone card framing (border and background) for use outside .cave-work-line",
);

// Scoped flat override: only flatten when nested inside the work-line disclosure
assert.match(
  styles,
  /\.cave-work-line\s+\.cave-tool-run\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/,
  ".cave-work-line .cave-tool-run must remove nested framing (border: 0, background: transparent) inside the work-line",
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
  activityCss,
  /\.cave-tool-summary::before\s*\{[^}]*transition:\s*transform\s+var\(--duration-fast\)\s+var\(--ease-standard\)/,
  "chevron transition must use design motion tokens, not hardcoded values",
);
assert.match(
  reducedMotionBlocks,
  /\.cave-tool-summary::before\s*\{[^}]*transition:\s*none/,
  "reduced-motion must disable the .cave-tool-summary::before chevron transition",
);
