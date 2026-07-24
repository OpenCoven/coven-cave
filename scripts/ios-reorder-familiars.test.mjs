import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);

// Persisted custom order, applied over the server's order.
assert.match(model, /var familiarOrder: \[String\] = \[\]/, "AppModel should hold a familiarOrder");
assert.match(model, /loadFamiliarOrder\(\)/, "init should load the saved familiar order");
assert.match(
  model,
  /familiars = applyFamiliarOrder\(try await client\.familiars\(\)\)/,
  "loadFamiliars should apply the saved order",
);
assert.match(
  model,
  /func moveFamiliar\(fromOffsets source: IndexSet, toOffset destination: Int\) \{[\s\S]*familiars\.move\(fromOffsets: source, toOffset: destination\)[\s\S]*familiarOrder = familiars\.map\(\\\.id\)[\s\S]*persistFamiliarOrder\(\)/,
  "moveFamiliar should reorder, recompute, and persist the order",
);
assert.match(model, /private func applyFamiliarOrder\(_ loaded: \[Familiar\]\) -> \[Familiar\]/, "applyFamiliarOrder should exist");
assert.match(model, /cave-familiar-order\.json/, "order should persist to cave-familiar-order.json");
assert.match(model, /private func persistFamiliarOrder\(\)/, "persistFamiliarOrder should exist");

// Chats tab exposes drag-reorder behind a header button that opens a dedicated
// sheet (rail avatars aren't List rows, so reordering can't use inline edit mode).
assert.match(home, /@State private var showReorder = false/, "ChatsHomeView should track the reorder sheet");
assert.match(
  home,
  /\.onMove \{ source, destination in\s*app\.moveFamiliar\(fromOffsets: source, toOffset: destination\)/,
  "the reorder sheet should reorder via moveFamiliar",
);
assert.match(home, /\.environment\(\\\.editMode, \.constant\(\.active\)\)/, "the sheet list should stay in active edit mode");
assert.match(home, /Button\("Reorder"\) \{ showReorder = true \}/, "the header should offer a Reorder button");
assert.match(home, /\.sheet\(isPresented: \$showReorder\) \{ ReorderFamiliarsSheet\(\) \}/, "the Reorder button should present the sheet");
assert.match(
  home,
  /private var canReorder: Bool \{[\s\S]*app\.familiars\.count > 1[\s\S]*query\.trimmingCharacters[\s\S]*isEmpty/,
  "reorder should require >1 familiar and no active search",
);

console.log("ios-reorder-familiars.test.mjs: ok");
