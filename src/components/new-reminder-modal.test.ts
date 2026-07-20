// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./new-reminder-modal.tsx", import.meta.url), "utf8");

function requireIndex(source: string, needle: string, message: string): number {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${message} (missing ${JSON.stringify(needle)})`);
  return index;
}

function extractBalancedParenBlock(source: string, startMarker: string, message: string): string {
  const start = requireIndex(source, startMarker, message);
  let index = start + startMarker.length - 1;
  let depth = 0;

  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        const end = source[index + 1] === "}" ? index + 2 : index + 1;
        return source.slice(start, end);
      }
    }
  }

  assert.fail(`${message} (unterminated block starting at ${JSON.stringify(startMarker)})`);
}

function extractJsxOpeningTag(source: string, startIndex: number, message: string): string {
  let index = startIndex;
  let braceDepth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (; index < source.length; index += 1) {
    const ch = source[index];
    const prev = source[index - 1];

    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === ">" && braceDepth === 0) {
      return source.slice(startIndex, index + 1);
    }
  }

  assert.fail(`${message} (unterminated JSX opening tag at index ${startIndex})`);
}

// ── Edit mode ────────────────────────────────────────────────────────────────
assert.match(modal, /editing\?: ReminderEdit;/, "modal should accept an optional editing prop");
assert.match(modal, /onUpdate\?: \(id: string, draft: NewReminderDraft\) => Promise<void> \| void;/, "modal should accept an onUpdate handler");
assert.match(modal, /const isEditing = !!editing;/, "modal should derive an editing flag");
assert.match(
  modal,
  /\{isEditing \? "Edit reminder" : "New reminder"\}/,
  "heading should switch to 'Edit reminder' in edit mode",
);
assert.match(
  modal,
  /if \(editing && onUpdate\) \{\s*await onUpdate\(editing\.id, draft\);/,
  "submit should call onUpdate(id, draft) when editing",
);
assert.match(modal, /: "Save"/, "submit label should read 'Save' in edit mode");
assert.match(modal, /\? "Saving…"/, "submit label should read 'Saving…' while saving an edit");

// ── Edit prefill maps recurrence back to a preset ────────────────────────────
assert.match(modal, /function presetForRecurrence/, "should map a stored recurrence back to a picker preset");
assert.match(modal, /setRecurPreset\(preset\)/, "edit prefill should restore the recurrence preset");
assert.match(modal, /setLink\(editing\.link \?\? null\)/, "edit prefill should restore the link");

// ── Phrase → plan tracking (cave-rdfc) ───────────────────────────────────────
// A parsed schedule that no named preset represents must survive as the
// "custom" preset carrying the exact recurrence — never silently downgrade to
// a one-shot (the old mon,wed,fri bug).
assert.match(modal, /return \{ preset: "custom", customRec: rec \};/, "unrepresentable recurrences map to the custom preset");
assert.match(modal, /if \(preset === "custom"\) return customRec \?\? \{ type: "none" \};/, "submit honors the custom recurrence verbatim");
assert.match(modal, /whenText: whenText\.trim\(\) \|\| null,/, "the human phrase is persisted with the draft");
assert.match(modal, /const \[whenDirty, setWhenDirty\] = useState\(false\);/, "edit mode tracks phrase dirtiness");
assert.match(modal, /if \(isEditing && !whenDirty\) return;/, "retyping the phrase in edit mode retakes the picker");
const whenExamplesBody = (() => {
  const startMarker = "const WHEN_EXAMPLES = [";
  const endMarker = "] as const;";
  const start = requireIndex(modal, startMarker, "phrase examples constant should exist");
  const end = modal.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, "phrase examples constant should terminate with as const");
  assert.ok(end > start, "phrase examples constant should have a body");
  return modal.slice(start + startMarker.length, end);
})();
const whenExampleStringLiterals = [...whenExamplesBody.matchAll(/(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g)].map((match) => match[2]);
assert.match(
  whenExamplesBody.replace(/(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g, ""),
  /^[\s,]*$/,
  "phrase examples should contain only string literals plus commas/whitespace",
);
assert.deepEqual(
  whenExampleStringLiterals,
  ["in 30m", "tomorrow at 9am", "every tuesday 4pm", "jul 20"],
  "phrase examples should be pinned as a four-value constant",
);
const whenExamplesMapBlock = extractBalancedParenBlock(
  modal,
  "{WHEN_EXAMPLES.map((example) => (",
  "phrase examples should render as a bounded map block",
);
assert.ok(whenExamplesMapBlock.includes("<Button"), "mapped phrase examples should render Button controls");
const whenExamplesButtonTag = extractJsxOpeningTag(
  whenExamplesMapBlock,
  requireIndex(whenExamplesMapBlock, "<Button", "mapped phrase examples should render a Button opening tag"),
  "mapped phrase examples should stay within one Button opening tag",
);
assert.ok(
  whenExamplesButtonTag.includes("key={example}"),
  "mapped phrase examples should key each Button by the example",
);
assert.ok(
  whenExamplesButtonTag.includes("onClick={() => selectWhenExample(example)}"),
  "mapped phrase examples should call selectWhenExample(example) from the Button click handler",
);
const selectWhenExampleBody = (() => {
  const startMarker = /const selectWhenExample = \(example(?:\s*:\s*[^)]+)?\) => \{/;
  const endMarker = "\n  };";
  const startMatch = modal.match(startMarker);
  assert.ok(startMatch, "phrase-example selection handler should exist");
  const start = requireIndex(modal, startMatch![0], "phrase-example selection handler should exist");
  const end = modal.indexOf(endMarker, start + startMatch[0].length);
  assert.notEqual(end, -1, "phrase-example selection handler should terminate with a closing };");
  assert.ok(end > start, "phrase-example selection handler should have a bounded body");
  return modal.slice(start, end + endMarker.length);
})();
assert.match(
  selectWhenExampleBody,
  /setWhenText\(example\);[\s\S]*?setManualFireAt\(""\);[\s\S]*?setWhenDirty\(true\);/,
  "phrase-example selection should set the phrase, clear manual fire time, then mark it dirty",
);
assert.match(
  modal,
  /const \[detailsOpen, setDetailsOpen\] = useState\(false\);/,
  "modal should keep advanced controls behind a disclosure toggle",
);
const disclosureAttrIndex = requireIndex(modal, "aria-expanded={detailsOpen}", "advanced disclosure should expose aria-expanded state");
const disclosureButtonIndex = modal.lastIndexOf("<Button", disclosureAttrIndex);
assert.notEqual(
  disclosureButtonIndex,
  -1,
  "advanced disclosure should begin with a Button opening tag before the aria-expanded attribute",
);
const disclosureButtonBlock = extractJsxOpeningTag(
  modal,
  disclosureButtonIndex,
  "advanced disclosure should stay within one Button opening tag",
);
assert.ok(
  disclosureButtonBlock.includes('aria-expanded={detailsOpen}'),
  "advanced disclosure should expose aria-expanded state",
);
assert.ok(
  disclosureButtonBlock.includes('aria-controls="new-reminder-details"'),
  "advanced disclosure should point at the details region",
);
assert.ok(
  disclosureButtonBlock.includes("onClick={() => setDetailsOpen((open) => !open)}"),
  "disclosure trigger should toggle detailsOpen",
);
const detailsRegion = (() => {
  const startMarker = "{detailsOpen ? (";
  const endMarker = ") : null}";
  const start = requireIndex(modal, startMarker, "controlled details region should begin with the detailsOpen conditional");
  const end = modal.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, "controlled details region should close with a null branch");
  assert.ok(end > start, "controlled details region should have bounded content");
  return modal.slice(start, end + endMarker.length);
})();
assert.ok(
  detailsRegion.includes('id="new-reminder-details"'),
  "controlled details region should carry the details id",
);
assert.match(
  modal,
  /setDetailsOpen\(mapped\.preset !== "none"\s*\|\|\s*editing\.link != null\);/,
  "edit prefill should open details only when recurrence or link state requires it",
);

// The plan echo shows the cadence sentence and upcoming fires, announced to AT.
assert.match(modal, /describeRecurrence\(planRecurrence, \{ hour12 \}\)/, "plan echo describes the cadence in words");
assert.match(modal, /nextOccurrences\(planRecurrence, Date\.now\(\), 3\)/, "plan echo lists the next 3 concrete fires");
assert.match(modal, /aria-live="polite"/, "plan echo is announced politely to AT");
assert.match(modal, /\{planCadence \? "Repeats" : "Once"\}/, "plan echo distinguishes one-shots from repeats");
assert.match(modal, /data-reminder-plan="true"/, "plan echo should identify the reminder plan container");
assert.match(modal, /id="new-reminder-plan-summary"/, "plan echo should have a stable summary id");

// ── Both paths carry link ────────────────────────────────────────────────────
assert.match(modal, /link,/, "draft submitted to create/update should include the link");

// Accessible dialog: role/aria-modal/labelled heading + focus trap.
assert.ok(modal.includes('import { useFocusTrap } from "@/lib/use-focus-trap"'), "imports useFocusTrap");
assert.ok(modal.includes("useFocusTrap(open, dialogRef, { onEscape: onClose })"), "traps focus + closes on Escape");
assert.ok(modal.includes('role="dialog"') && modal.includes('aria-modal="true"'), "overlay exposes dialog semantics");
assert.ok(modal.includes('aria-labelledby="new-reminder-title"'), "dialog labelled by heading");
assert.ok(modal.includes('id="new-reminder-title"'), "heading carries labelledby id");

// Shared control primitives/radius tokens.
assert.ok(modal.includes('import { Button } from "@/components/ui/button"'), "modal action buttons use the shared Button primitive");
assert.ok(modal.includes('import { IconButton } from "@/components/ui/icon-button"'), "modal close button uses the shared IconButton primitive");
assert.doesNotMatch(modal, /<button\b/, "modal should not hand-roll button controls");
assert.doesNotMatch(modal, /rounded-md/, "modal should use control radius tokens instead of hard-coded rounded-md");

console.log("new-reminder-modal.test.ts: ok");
