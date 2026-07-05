// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./csv-import-modal.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ useEffect, useMemo, useState \} from "react";/,
  "CsvImportModal imports useMemo for render-stable parsed CSV data",
);

assert.match(
  source,
  /const parsed = useMemo\(\(\) => parseCsv\(raw\), \[raw\]\);/,
  "CsvImportModal memoizes parsed CSV data by raw content",
);

assert.doesNotMatch(
  source,
  /const parsed = parseCsv\(raw\);/,
  "CsvImportModal must not create a fresh headers array on every render",
);

assert.ok(source.includes('import { Button } from "@/components/ui/button"'), "CsvImportModal actions use the shared Button primitive");
assert.ok(source.includes('import { StandardSelect } from "@/components/ui/select"'), "CsvImportModal column mapping uses StandardSelect");
assert.doesNotMatch(source, /<button\b/, "CsvImportModal should not hand-roll button controls");
assert.doesNotMatch(source, /rounded-md|rounded(?=\s|")/, "CsvImportModal should use control radius tokens instead of hard-coded rounded classes");

console.log("csv-import-modal.test.ts: ok");
