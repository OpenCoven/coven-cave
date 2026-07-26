import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const view = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

// Zip helper is parameterized; export-all delegates to it.
assert.match(model, /func exportThreadsZip\(_ threads: \[ChatThread\]\) throws -> URL/, "AppModel should expose exportThreadsZip(_:)");
assert.match(model, /func exportAllThreadsZip\(\) throws -> URL \{ try exportThreadsZip\(threads\) \}/, "exportAllThreadsZip should delegate");

// Select bar gains an Export (N) action that zips the selection and shares it.
assert.match(view, /Button \{ exportSelected\(\) \} label: \{[\s\S]*Text\(selectedIds\.isEmpty \? "Export" : "Export \(\\\(selectedIds\.count\)\)"\)/, "an Export (N) button in the select bar");
assert.match(view, /let chosen = localThreads\.filter \{ selectedIds\.contains\(\$0\.id\) \}/, "exportSelected uses the selected local threads");
assert.match(view, /app\.exportThreadsZip\(chosen\)/, "exportSelected zips the chosen threads");
assert.match(view, /\.sheet\(item: \$exportArchive\) \{ archive in\s*ActivityView\(items: \[archive\.url\]\)/, "shares the zip via the activity sheet");

console.log("ios-export-selected-zip.test.mjs: ok");
