import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: root });
const fixturePath = path.join(root, "src/components/__react-hooks-gate-fixture.tsx");

const [result] = await eslint.lintText(
  `
import { useState } from "react";

export function ConditionalHook({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  const [value] = useState(0);
  return <div>{value}</div>;
}
`,
  { filePath: fixturePath },
);

const hookOrderFailures = result.messages.filter(
  (message) => message.ruleId === "react-hooks/rules-of-hooks",
);

assert.equal(
  hookOrderFailures.length,
  1,
  `expected rules-of-hooks to reject a conditional hook, got ${JSON.stringify(result.messages)}`,
);
assert.equal(hookOrderFailures[0]?.severity, 2, "rules-of-hooks must be an error");

console.log("react-hooks-gate.test.mjs: ok");
