// Does the Rules-of-Hooks gate actually FIRE?
//
// Taken from PR #4671, which reached cave-hmltt in parallel with #4668 and
// carried the better check. Its sibling, scripts/rules-of-hooks-gate.test.mjs,
// pins the config text and the lint globs — that catches a re-stub or a lint
// script that stops running the pass, but it only ever asserts that the config
// SAYS the right words. This runs eslint against the real config and asserts it
// DOES the right thing, which is the property that was actually missing for as
// long as react-hooks was a no-op stub.
//
// Extended here past #4671's single component fixture. #4668 widened the gate
// to src/lib and src/app because hooks live there too, and that widening is
// only real if eslint is handed those paths — a claim the sibling test can make
// no better than by reading globs out of package.json. Linting one fixture per
// scope settles it from eslint's own answer.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: root });

// lintText with a virtual filePath: eslint resolves the config exactly as it
// would for a real file at that path, and nothing is written to disk, so a
// crashed run cannot strand a fixture that then fails the repo's own lint.
async function hookErrorsFor(relativePath, source) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(root, relativePath),
  });
  return result.messages.filter((message) => message.ruleId === "react-hooks/rules-of-hooks");
}

// A hook after an early return — the exact shape that crashed the Relations
// graph (cave-qxq4l) with "Rendered more hooks than during the previous
// render". One case per linted scope; the src/lib fixture is a custom hook in a
// .ts file rather than a component, because .ts cannot carry JSX.
const OFFENDERS = [
  [
    "src/components/__react-hooks-gate-fixture.tsx",
    `import { useState } from "react";

export function ConditionalHook({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  const [value] = useState(0);
  return <div>{value}</div>;
}
`,
  ],
  [
    "src/lib/__react-hooks-gate-fixture.ts",
    `import { useState } from "react";

export function useConditional(enabled: boolean) {
  if (!enabled) return null;
  const [value] = useState(0);
  return value;
}
`,
  ],
  [
    "src/app/__react-hooks-gate-fixture.tsx",
    `import { useState } from "react";

export default function Page({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  const [value] = useState(0);
  return <div>{value}</div>;
}
`,
  ],
];

for (const [relativePath, source] of OFFENDERS) {
  const failures = await hookErrorsFor(relativePath, source);
  assert.equal(
    failures.length,
    1,
    `expected rules-of-hooks to reject a conditional hook in ${relativePath}, got ${JSON.stringify(failures)}`,
  );
  assert.equal(
    failures[0]?.severity,
    2,
    `rules-of-hooks must be an error in ${relativePath}, not a warning --max-warnings could pass`,
  );
}

// Control: the assertions above are worthless if the rule fires on everything.
// A correct hook in the same scope must produce nothing.
const clean = await hookErrorsFor(
  "src/lib/__react-hooks-gate-clean.ts",
  `import { useState } from "react";

export function useClean() {
  const [value] = useState(0);
  return value;
}
`,
);
assert.equal(
  clean.length,
  0,
  `a correctly ordered hook must pass cleanly, got ${JSON.stringify(clean)}`,
);

console.log("react-hooks-gate.test.mjs: ok");
