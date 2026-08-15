import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint();
const invalidSource = `
import { useState } from "react";

export function useConditionalState(enabled) {
  if (!enabled) {
    return null;
  }

  return useState(false);
}
`;

for (const filePath of [
  "src/components/__react-hooks-gate-fixture.tsx",
  "src/app/__react-hooks-gate-fixture.tsx",
  "src/lib/__react-hooks-gate-fixture.ts",
]) {
  const [result] = await eslint.lintText(invalidSource, { filePath });
  const violations = result.messages.filter(
    (message) => message.ruleId === "react-hooks/rules-of-hooks",
  );

  assert.equal(
    violations.length,
    1,
    `${filePath} must report a conditional hook call`,
  );
  assert.equal(violations[0].severity, 2, `${filePath} must fail lint`);
}

console.log("react-hooks-gate.test.mjs: ok");
