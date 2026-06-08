// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

function extractFunctionBody(name: string): string {
  const marker = `const ${name} = (`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} function should exist`);

  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a function body`);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, i);
      }
    }
  }

  assert.fail(`${name} function body should close`);
}

const navigateToBody = extractFunctionBody("navigateTo");
const imperativeHandleCalls = source.match(/useImperativeHandle\(/g) ?? [];

assert.equal(
  imperativeHandleCalls.length,
  1,
  "BrowserPane should register a single imperative handle during render",
);

assert.doesNotMatch(
  navigateToBody,
  /use[A-Z][A-Za-z0-9_]*\(/,
  "navigateTo must not call React hooks when invoked through the imperative ref",
);

console.log("browser-pane-hooks.test.ts: ok");
