// Mirrors the coven:ui readable-fallback corpus (src/lib/ui-block-fallback-fixtures.ts)
// into the iOS test fixture, so the Swift tests run every case (#6060).
// src/lib/ui-block-fallback-fixtures.test.ts fails while the two differ.
//
// Run: node --experimental-strip-types scripts/write-ui-block-fallback-fixture.mjs

import { writeFileSync } from "node:fs";
import { UI_BLOCK_FALLBACK_CASES } from "../src/lib/ui-block-fallback-fixtures.ts";

const out = new URL("../apps/ios/CovenCave/CovenCaveTests/Fixtures/ui-block-fallback-v1.json", import.meta.url);
const cases = UI_BLOCK_FALLBACK_CASES.map(({ id, kind, input, readable }) => ({ id, kind, input, readable }));
writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
console.log(`wrote ${cases.length} cases to ${out.pathname}`);
