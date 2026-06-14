// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 1. Shell exposes onFamiliarOpenChange prop and fires it on familiarOpen state changes.
{
  const src = readFileSync(
    new URL("./shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /onFamiliarOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/,
    "Shell declares onFamiliarOpenChange prop",
  );
  assert.match(
    src,
    /onFamiliarOpenChange\?\.\(familiarOpen\)/,
    "Shell calls onFamiliarOpenChange(familiarOpen) in an effect",
  );
}

// 2. Workspace imports getRailOpen + setRailOpen from familiar-memory.
{
  const src = readFileSync(
    new URL("./workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /import\s+\{[\s\S]*?getRailOpen[\s\S]*?\}\s+from\s+["']@\/lib\/familiar-memory["']/,
    "Workspace imports getRailOpen",
  );
  assert.match(
    src,
    /import\s+\{[\s\S]*?setRailOpen[\s\S]*?\}\s+from\s+["']@\/lib\/familiar-memory["']/,
    "Workspace imports setRailOpen",
  );

  // 3. Workspace passes onFamiliarOpenChange to Shell.
  assert.match(
    src,
    /onFamiliarOpenChange=\{/,
    "Workspace passes onFamiliarOpenChange to Shell",
  );
  assert.match(
    src,
    /setRailOpen\(/,
    "Workspace calls setRailOpen(...) somewhere",
  );

  // 4. Workspace restores rail state on activeId change.
  assert.match(
    src,
    /getRailOpen\(/,
    "Workspace calls getRailOpen(...) somewhere (for restore)",
  );
}

console.log("companion-rail-persistence.test.ts OK");
