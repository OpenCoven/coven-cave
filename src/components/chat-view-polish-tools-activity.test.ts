// @ts-nocheck
import assert from "node:assert/strict";
import { groupConsecutiveTools } from "../lib/turn-segments.ts";
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

const runsAcrossExtractedEdit = groupConsecutiveTools([
  { id: "read-before", name: "Read", originalIndex: 0 },
  { id: "read-after", name: "Read", originalIndex: 2 },
]);
assert.deepEqual(
  runsAcrossExtractedEdit.map((run) => run.tools.map((tool) => tool.id)),
  [["read-before"], ["read-after"]],
  "Read → Edit → Read keeps two Read runs after the edit card is extracted",
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
  /inlineReasoning,[\s\S]*\} = extractChatRenderedText\(turn\.text, \{ pending: Boolean\(turn\.pending\) \}\)/,
  "Assistant turns should use the shared visible-text projection for reasoning and control-marker stripping",
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
  /function ToolGroup[\s\S]*<details[\s\S]*data-default-collapsed="true"[\s\S]*title=\{summary\.label\}[\s\S]*aria-label=\{toolGroupAriaLabel\(summary\.label, running, errors\)\}[\s\S]*<ToolRuns tools=\{tools\}/,
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
  /function ToolRuns[\s\S]*?containsEdit = run\.tools\.some\(\(tool\) => isFileMutationTool\(tool\.name\)\)[\s\S]*?const body = containsEdit\s*\? run\.tools\.map\(\(tool\) => <ToolBlock[\s\S]*: <ToolRunGroup/,
  "ToolRuns reserves edit slots by mutation name and gives every non-edit run the same shell",
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
  /function ProgressGroup[\s\S]*<summary className="cave-tool-summary focus-ring">/,
  "the progress disclosure summary uses the shared keyboard focus ring",
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
  /segments=\{renderSegments\}/,
  "MessageBubble renders the artifact-aware renderSegments",
);

assert.match(
  turnRow,
  /renderSegments = split\.some\(\(segment\) => segment\.kind === "block"\) \? split : undefined/,
  "settled turns render prose (+ artifacts) only — tool blocks are not woven into the text",
);

assert.match(
  turnRow,
  /const indexedTurnTools = turnTools\.map\(\(tool, originalIndex\) => \(\{ tool, originalIndex \}\)\)[\s\S]{0,500}?const otherTools = indexedTurnTools[\s\S]{0,300}?originalIndex/,
  "non-edit extraction retains each tool's original transcript index for adjacency",
);
assert.match(
  turnRow,
  /activity=\{otherTools\.length \? <ToolGroup tools=\{otherTools\} \/> : null\}/,
  "non-edit activity always occupies the compact ToolGroup slot",
);
assert.match(
  turnRow,
  /cave-edit-cards[\s\S]*editCards\.map\(\(tool\) => <ToolBlock/,
  "edit-tool cards stay visible inline throughout the turn (not buried in the collapsed rollup)",
);
assert.match(
  turnRow,
  /isFileMutationTool\(tool\.name\)/,
  "recognized mutation names occupy the edit-card slot before streamed input is complete",
);
// Golden path 4 (cave-qva4): a multi-file turn gets ONE aggregate entry into
// the working-tree review, riding the per-card cave:open-file-diff contract.
assert.match(
  turnRow,
  /const editedFiles = dedupeAbsoluteProjectPaths\(\s*editCards\.flatMap\(\(tool\) =>\s*actionReadyMutationTargetFiles\([\s\S]*?toolProjectRoot,[\s\S]*?\)\s*,?\s*\)\s*,?\s*\)/,
  "the aggregate counts every distinct action-ready file within the turn's captured project boundary",
);
assert.match(
  source,
  /new Map\(turns\.map\(\(turn\) => \[turn\.id, turnToolProjectRoot\(turn\)\]\)\)/,
  "tool actions derive only from immutable per-turn execution metadata",
);
assert.doesNotMatch(
  source,
  /sessionToolProjectRootForIdentity|sessionToolProjectRootsRef|projectRootSnapshotForIdentity|turnProjectRoots[\s\S]{0,500}activeProjectRoot/,
  "historical tool roots never use a component cache or mutable session/project selection",
);
assert.match(
  turnRow,
  /\{!turn\.pending && turn\.tools\?\.length && editedFiles\.length > 1 \? \([\s\S]{0,400}?\{editedFiles\.length\} files changed/,
  "turns that edited more than one distinct file render the 'N files changed' chip (single-file turns keep just the card's own Review)",
);
assert.match(
  turnRow,
  /aria-label=\{`Review all \$\{editedFiles\.length\} changed files in the Changes tab`\}[\s\S]{0,350}?cave:open-file-diff[\s\S]{0,320}?detail: \{[\s\S]{0,200}?path: editedFiles\[0\],[\s\S]{0,100}?projectRoot: toolProjectRoot,[\s\S]{0,100}?sourceSessionId,[\s\S]{0,100}?turnId: turn\.id/,
  "Review all opens Changes with complete immutable transcript provenance",
);
assert.match(
  turnRow,
  /otherTools\.length \? <ToolGroup tools=\{otherTools\}/,
  "non-edit tool activity still collapses into the designated ToolGroup",
);
assert.match(
  turnRow,
  /<ChatToolActivityLayout[\s\S]*activity=\{otherTools\.length \? <ToolGroup[\s\S]*?<MessageBubble[\s\S]*editCards=\{\s*editCards\.length/,
  "TurnRowImpl source order: otherTools ToolGroup precedes MessageBubble; editCards section follows MessageBubble — the two sections are separate and in their current intended positions",
);

assert.match(
  turnRow,
  /<MessageBubble[\s\S]*role="assistant"[\s\S]*content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}/,
  "Assistant turns should render only filtered visible content",
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
assert.match(
  styles,
  /\.cave-work-line__count\s*\{[^}]*flex:\s*none[^}]*white-space:\s*nowrap/,
  "the call count never shrinks out of the collapsed work line",
);
assert.match(
  styles,
  /\.cave-work-line__categories\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/,
  "only the category phrase truncates when the work line is narrow",
);

// ToolRuns (chat-view.tsx) has exactly one call site, and it always renders
// inside the .cave-work-line compact disclosure — ToolRunGroup's
// .cave-tool-run class never reaches the page unnested. A standalone card
// rule "for use outside .cave-work-line" is therefore dead weight: the flat,
// borderless framing is the only framing a repeated run ever actually shows,
// so it lives directly on .cave-tool-run with no .cave-work-line scoping
// needed to override a card rule that never renders.
assert.doesNotMatch(
  styles,
  /\.cave-work-line\s+\.cave-tool-run\s*\{/,
  "no scoped override remains once .cave-tool-run carries its only live framing directly",
);
assert.match(
  styles,
  /\.cave-tool-run\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*padding:\s*var\(--space-1\)\s*0/,
  ".cave-tool-run must keep the flat, borderless framing a repeated run actually renders with",
);
// The card-framing values that .cave-work-line .cave-tool-run used to
// override (a bordered/backgrounded box) must not resurface as a competing
// bare .cave-tool-run rule.
assert.doesNotMatch(
  activityCss,
  /\.cave-tool-run\s*\{[^}]*border:\s*1px solid/,
  "a bordered standalone .cave-tool-run card rule must not come back — ToolRunGroup never renders outside .cave-work-line",
);

// The one-off summary hide rule this cleanup must not disturb.
assert.match(
  activityCss,
  /details\[data-one-off\]\s*>\s*\.cave-tool-summary\s*\{[^}]*display\s*:\s*none/,
  "the scoped one-off summary hide rule must survive the framing cleanup untouched",
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
