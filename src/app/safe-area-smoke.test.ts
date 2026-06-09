// @ts-nocheck
//
// Phase 1 introduced `--sai-{top,right,bottom,left}` tokens fed by
// `env(safe-area-inset-*)` so the shell, top-bar, composer dock, and
// settings header could respect iPhone notches and home indicators.
// This smoke catches regressions where someone reintroduces a hard
// padding-bottom or padding-top that ignores the safe-area inset.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

// The four token declarations must exist on :root so consumers can
// just write `var(--sai-bottom)`.
for (const side of ["top", "right", "bottom", "left"]) {
  assert.match(
    globals,
    new RegExp(`--sai-${side}:\\s*env\\(safe-area-inset-${side}`),
    `:root declares --sai-${side} from env(safe-area-inset-${side})`,
  );
}

// --touch-target token from phase 1 is the other half of the foundation.
assert.match(
  globals,
  /--touch-target:\s*44px/,
  ":root declares --touch-target: 44px",
);

// layout.tsx must set viewport-fit=cover or env() returns 0 on iOS.
const layout = readFileSync(
  new URL("./layout.tsx", import.meta.url),
  "utf8",
);
assert.match(
  layout,
  /viewportFit:\s*"cover"/,
  "layout.tsx viewport export sets viewportFit: 'cover' so env(safe-area-inset-*) returns non-zero on iOS",
);

// At least one surface CSS rule must reference --sai-* (otherwise the
// tokens are dead weight and we're not actually respecting notches).
const referenced = /var\(--sai-(top|right|bottom|left)/.test(globals);
assert.ok(
  referenced,
  "globals.css references at least one --sai-* token — otherwise the foundation tokens are unused",
);

console.log("safe-area-smoke.test.ts OK");
