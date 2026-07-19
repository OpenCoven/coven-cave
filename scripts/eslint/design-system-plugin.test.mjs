import assert from "node:assert/strict";

import tsParser from "@typescript-eslint/parser";
import { Linter } from "eslint";

import designSystemPlugin from "./design-system-plugin.mjs";

const linter = new Linter();
const languageOptions = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
};

function lint(code, rule) {
  return linter.verify(
    code,
    [
      {
        files: ["**/*.tsx"],
        languageOptions,
        plugins: { "coven-design": designSystemPlugin },
        rules: { [`coven-design/${rule}`]: "error" },
      },
    ],
    { filename: "component.tsx" },
  );
}

{
  assert.equal(
    lint(`const cls = "text-[length:var(--text-xs)]"; export const A = () => <p className={cls} />;`, "no-raw-px-text").length,
    0,
  );
  assert.equal(
    lint(`export const A = () => <p>{"Use text-[11px] in this example"}</p>;`, "no-raw-px-text").length,
    0,
  );
  assert.equal(
    lint(
      `export const A = ({ variant }) => <p className={variant === "text-[11px]" ? "text-sm" : "text-base"} />;`,
      "no-raw-px-text",
    ).length,
    0,
  );
  assert.equal(
    lint(
      `export const A = () => <p className="before:content-['text-[11px]'] bg-[url(/assets/text-[11px].png)]" />;`,
      "no-raw-px-text",
    ).length,
    0,
  );
  const messages = lint(`export const A = () => <p className="text-[11px]" />;`, "no-raw-px-text");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, "rawText");
  assert.equal(
    lint(
      `export const A = () => <p className="text-[length:11px] text-[11px]/[14px]" />;`,
      "no-raw-px-text",
    ).length,
    1,
  );
  const bindingMessages = lint(
    `const labelClass = "text-[11px]"; export const A = () => <p className={labelClass} />;`,
    "no-raw-px-text",
  );
  assert.equal(bindingMessages.length, 1);
  assert.equal(bindingMessages[0].messageId, "rawText");
  const memberMessages = lint(
    `const data = { className: "text-[11px]", label: "example" };
     export const A = () => <p className={data.className} />;`,
    "no-raw-px-text",
  );
  assert.equal(memberMessages.length, 1);
  assert.equal(memberMessages[0].messageId, "rawText");
  const siblingMessages = lint(
    `const classes = { safe: "text-sm", bad: "text-[11px]" };
     export const A = () => <p className={cn(classes.safe, classes.bad)} />;`,
    "no-raw-px-text",
  );
  assert.equal(siblingMessages.length, 1);
  assert.equal(siblingMessages[0].messageId, "rawText");
  const logicalMessages = lint(
    `const rawClass = "text-[11px]"; export const A = () => <p className={rawClass || "text-sm"} />;`,
    "no-raw-px-text",
  );
  assert.equal(logicalMessages.length, 1);
  assert.equal(logicalMessages[0].messageId, "rawText");
  const mapMessages = lint(
    `export const A = ({ active }) => <p className={cx({ "text-[11px]": active })} />;`,
    "no-raw-px-text",
  );
  assert.equal(mapMessages.length, 1);
  assert.equal(mapMessages[0].messageId, "rawText");
  const sequenceMessages = lint(
    `export const A = () => <p className={(track(), "text-[11px]")} />;`,
    "no-raw-px-text",
  );
  assert.equal(sequenceMessages.length, 1);
  assert.equal(sequenceMessages[0].messageId, "rawText");
  assert.equal(
    lint(
      `const data = { safe: "text-sm", unsafe: "text-[11px]" };
       const { safe } = data; export const A = () => <p className={safe} />;`,
      "no-raw-px-text",
    ).length,
    0,
  );
}

{
  assert.equal(
    lint(`export const A = ({ width }) => <div style={{ width, color: "var(--text-primary)" }} />;`, "no-static-inline-style").length,
    0,
  );
  assert.equal(
    lint(`export const A = ({ width }) => <div style={{ width }} />;`, "no-static-inline-style").length,
    0,
  );
  const messages = lint(
    `export const A = () => <div style={{ color: "var(--text-primary)", opacity: 0.8 }} />;`,
    "no-static-inline-style",
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, "staticStyle");

  const bindingMessages = lint(
    `const fieldStyle = { color: "var(--text-primary)" } as const;
     export const A = () => <div style={fieldStyle} />;`,
    "no-static-inline-style",
  );
  assert.equal(bindingMessages.length, 1);
  assert.equal(bindingMessages[0].messageId, "staticStyle");
  const memberMessages = lint(
    `const styles = { field: { color: "var(--text-primary)" } } as const;
     export const A = () => <div style={styles.field} />;`,
    "no-static-inline-style",
  );
  assert.equal(memberMessages.length, 1);
  assert.equal(memberMessages[0].messageId, "staticStyle");
}

{
  assert.equal(
    lint(`const palette = ["#fff"]; export const A = () => <input type="color" value="#000000" />;`, "no-render-hex-color").length,
    0,
  );
  assert.equal(
    lint(
      `const data = { className: "text-sm", swatch: "#fff" };
       export const A = () => <p className={data.className} />;`,
      "no-render-hex-color",
    ).length,
    0,
  );
  assert.equal(
    lint(
      `export const A = () => <p className="before:content-['#fff'] bg-[url(/icon.svg#fff)]" />;`,
      "no-render-hex-color",
    ).length,
    0,
  );
  assert.equal(
    lint(
      `export const A = () => <svg><defs><linearGradient id="fade" /></defs><rect fill="url(#fade)" /></svg>;`,
      "no-render-hex-color",
    ).length,
    0,
  );
  assert.equal(
    lint(`export const A = ({ width }) => <div style={{ width, color: "var(--color-danger)" }} />;`, "no-render-hex-color").length,
    0,
  );
  const classMessages = lint(
    `export const A = () => <div className="text-[var(--danger,#d95a5a)]" />;`,
    "no-render-hex-color",
  );
  assert.equal(classMessages.length, 1);
  assert.equal(classMessages[0].messageId, "hexColor");
  const mapMessages = lint(
    `export const A = ({ active }) => <p className={cx({ "text-[#fff]": active })} />;`,
    "no-render-hex-color",
  );
  assert.equal(mapMessages.length, 1);
  assert.equal(mapMessages[0].messageId, "hexColor");
  for (const utility of [
    "ring-[#fff]",
    "outline-[#fff]",
    "from-[#123456]",
    "border-s-[#fff]",
    "[background:url(/icon.svg#mark)_#fff]",
  ]) {
    const messages = lint(
      `export const A = () => <p className="${utility}" />;`,
      "no-render-hex-color",
    );
    assert.equal(messages.length, 1, `${utility} should be color-gated`);
    assert.equal(messages[0].messageId, "hexColor");
  }
  const siblingMessages = lint(
    `const classes = { safe: "text-sm", bad: "text-[#fff]" };
     export const A = () => <p className={cn(classes.safe, classes.bad)} />;`,
    "no-render-hex-color",
  );
  assert.equal(siblingMessages.length, 1);
  assert.equal(siblingMessages[0].messageId, "hexColor");

  const styleMessages = lint(
    `export const A = ({ width }) => <div style={{ width, color: "#fff" }} />;`,
    "no-render-hex-color",
  );
  assert.equal(styleMessages.length, 1);
  assert.equal(styleMessages[0].messageId, "hexColor");

  const bindingMessages = lint(
    `const color = "#fff"; export const A = ({ width }) => <div style={{ width, color }} />;`,
    "no-render-hex-color",
  );
  assert.equal(bindingMessages.length, 1);
  assert.equal(bindingMessages[0].messageId, "hexColor");

  const svgMessages = lint(
    `export const A = () => <svg><path fill="#fff" /></svg>;`,
    "no-render-hex-color",
  );
  assert.equal(svgMessages.length, 1);
  assert.equal(svgMessages[0].messageId, "hexColor");
}

console.log("design-system ESLint rules: ok");
