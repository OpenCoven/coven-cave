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

assert.match(
  source,
  /const platform = useTauriPlatform\(\);[\s\S]{0,120}const nativeBrowserAvailable = platform === "desktop";/,
  "BrowserPane should only treat desktop Tauri as native-browser capable",
);

assert.match(
  source,
  /if \(platform === "unknown"\) return;[\s\S]{0,160}if \(!nativeBrowserAvailable\) \{[\s\S]{0,120}setBridge\(null\);[\s\S]{0,120}setUnavailable\(true\);[\s\S]{0,120}return;/,
  "BrowserPane should use the iframe fallback instead of loading browser_* IPC on Tauri mobile",
);

assert.match(
  source,
  /if \(!bridge \|\| !nativeBrowserAvailable\) return;[\s\S]*browser_hide/,
  "BrowserPane should guard browser_* IPC behind nativeBrowserAvailable",
);

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
