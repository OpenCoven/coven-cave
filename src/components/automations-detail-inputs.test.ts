// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /splitAutomationPrompt/,
  "Automation detail should split the stored prompt into editable sections",
);

assert.match(
  source,
  /composeAutomationPrompt/,
  "Automation detail should compose distinct inputs back into the prompt payload",
);

assert.match(source, /<FieldLabel htmlFor=\{`cron-goals-\$\{auto\.id\}`\}>Goals<\/FieldLabel>/, "Automation detail should show a Goals input");
assert.match(
  source,
  /<FieldLabel htmlFor=\{`cron-deliverables-\$\{auto\.id\}`\}>Deliverables<\/FieldLabel>/,
  "Automation detail should show a Deliverables input",
);

assert.doesNotMatch(
  source,
  /<FieldLabel>Prompt<\/FieldLabel>/,
  "Automation detail should not collapse goals and deliverables into one Prompt input",
);

assert.match(
  source,
  /prompt:\s*nextPrompt/,
  "Automation save should persist the composed goals and deliverables prompt",
);

assert.match(
  source,
  /const automationInputClass = `\$\{automationFieldBaseClass\} h-8 px-2 text-\[length:var\(--text-sm\)\]`/,
  "Automation detail should use one standard input primitive",
);
assert.match(
  source,
  /const automationTextareaClass = `\$\{automationFieldBaseClass\} resize-y px-2 py-2 text-\[length:var\(--text-sm\)\] leading-relaxed`/,
  "Automation detail should use one standard textarea primitive",
);
assert.match(
  source,
  /const automationSelectClass = `\$\{automationFieldBaseClass\} h-8 px-2 text-\[length:var\(--text-sm\)\]`/,
  "Automation detail should use one standard select primitive",
);
assert.doesNotMatch(
  source,
  /className="h-8 w-full rounded-md border px-2 text-\[12px\] outline-none focus:border-white\/30"/,
  "Automation detail inputs should not use one-off control classes",
);
assert.doesNotMatch(
  source,
  /className="w-full resize-y rounded-md border px-2 py-2/,
  "Automation detail textareas should not use one-off control classes",
);

// ── Reminder detail panel: edit + link affordances ───────────────────────────
assert.match(
  source,
  /onEdit\?: \(item: InboxItem\) => void;/,
  "Reminder detail panel should accept an onEdit handler",
);
assert.match(
  source,
  /onOpenLink\?: \(link: LinkRef\) => void;/,
  "Reminder detail panel should accept an onOpenLink handler",
);
assert.match(
  source,
  /onClick=\{\(\) => onEdit\(item\)\}/,
  "Reminder detail panel should render an Edit button wired to onEdit",
);
assert.match(
  source,
  /leadingIcon="ph:pencil-simple"/,
  "Edit button should use a pencil icon",
);
assert.match(
  source,
  /\{item\.link && \(/,
  "Reminder detail panel should render a link chip when item.link is set",
);
assert.match(
  source,
  /onClick=\{\(\) => item\.link && onOpenLink\?\.\(item\.link\)\}/,
  "Link chip should call onOpenLink with the item's link",
);
assert.match(
  source,
  /function linkLabel/,
  "Should derive a sensible label per link kind",
);
// ── Field a11y (cave-dgli) ───────────────────────────────────────────────────
// Detail-form labels are programmatically associated (FieldLabel htmlFor +
// input id), bare schedule controls carry aria-labels, and the run-status
// signal is a status-shaped icon (not a color-only dot).
assert.match(source, /function FieldLabel\(\{ htmlFor, children \}/, "FieldLabel supports htmlFor association");
for (const f of ["name", "tags", "goals", "deliverables", "model"]) {
  assert.match(source, new RegExp(String.raw`htmlFor=\{\x60cron-${f}-\$\{auto\.id\}\x60\}`), `the ${f} field label points at its control`);
  assert.match(source, new RegExp(String.raw`id=\{\x60cron-${f}-\$\{auto\.id\}\x60\}`), `the ${f} control carries its id`);
}
assert.match(source, /aria-label="Schedule time"/, "the schedule time input is named");
assert.match(source, /aria-label="Raw RRULE"/, "the raw RRULE textarea is named");
assert.match(source, /runStatusIcon\(r\.status\)/, "run rows encode status by icon shape, not color alone");
{
  const cwd = await readFile(new URL("./cwd-picker-field.tsx", import.meta.url), "utf8");
  assert.match(cwd, /aria-label="Working directories, one per line"/, "the cwd textarea is named");
}
