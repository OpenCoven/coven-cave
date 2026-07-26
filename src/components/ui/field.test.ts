// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const field = readFileSync(new URL("./field.tsx", import.meta.url), "utf8");
const input = readFileSync(new URL("./text-input.tsx", import.meta.url), "utf8");
const area = readFileSync(new URL("./text-area.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

assert.match(field, /createContext<FieldContextValue \| null>/, "Field owns typed context");
assert.match(field, /const generatedId = useId\(\)/, "Field generates a stable React id");
assert.match(field, /<label className="ui-field__label" htmlFor=\{controlId\}>/, "label targets the control");
assert.match(field, /id=\{descriptionId\}/, "description has a stable id");
assert.match(field, /id=\{errorId\} role="alert"/, "error has a stable announced slot");
assert.match(field, /optional && !required/, "optional marker cannot conflict with required");
assert.match(field, /export function useFieldControlProps/, "controls consume shared field semantics");
assert.match(field, /joinIds\(context\?\.describedBy, props\["aria-describedby"\]\)/, "consumer descriptions are preserved");

for (const [source, component, element, className] of [
  [input, "TextInput", "input", "ui-text-input"],
  [area, "TextArea", "textarea", "ui-text-area"],
] as const) {
  assert.match(source, new RegExp(`forwardRef<.*${component}`), `${component} forwards its ref`);
  assert.match(source, /useFieldControlProps\(rest\)/, `${component} consumes field context`);
  assert.match(source, new RegExp(`<${element}`), `${component} renders native ${element}`);
  assert.match(source, new RegExp(className), `${component} uses shared chrome`);
}

const fieldCss = css.match(/\/\* ---- Field family[\s\S]*?\/\* ---- Button/)?.[0] ?? "";
assert.match(fieldCss, /\.ui-text-input,[\s\S]*\.ui-text-area/, "controls share base chrome");
assert.match(fieldCss, /\[aria-invalid="true"\]/, "invalid controls have a visual state");
assert.match(fieldCss, /:focus-visible[\s\S]*var\(--ring-focus\)/, "focus is token driven");
assert.match(fieldCss, /:disabled/, "disabled controls are explicit");
assert.match(fieldCss, /:read-only/, "read-only controls are distinct");
assert.match(fieldCss, /::placeholder/, "placeholder styling is centralized");
assert.match(
  fieldCss,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*font-size:\s*16px/,
  "touch fields prevent iOS input zoom",
);
assert.doesNotMatch(fieldCss, /#[0-9a-f]{3,8}\b|rgba?\(/i, "field family has no hardcoded colors");

console.log("field.test.ts: ok");
