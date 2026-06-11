// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function splitAutomationPrompt/,
  "Automation detail should split the stored prompt into editable sections",
);

assert.match(
  source,
  /function composeAutomationPrompt/,
  "Automation detail should compose distinct inputs back into the prompt payload",
);

assert.match(source, /<FieldLabel>Goals<\/FieldLabel>/, "Automation detail should show a Goals input");
assert.match(
  source,
  /<FieldLabel>Deliverables<\/FieldLabel>/,
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
  /const automationInputClass = `\$\{automationFieldBaseClass\} h-8 px-2 text-\[12px\]`/,
  "Automation detail should use one standard input primitive",
);
assert.match(
  source,
  /const automationTextareaClass = `\$\{automationFieldBaseClass\} resize-y px-2 py-2 text-\[12px\] leading-relaxed`/,
  "Automation detail should use one standard textarea primitive",
);
assert.match(
  source,
  /const automationSelectClass = `\$\{automationFieldBaseClass\} h-8 px-2 text-\[12px\]`/,
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
