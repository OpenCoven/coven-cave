import assert from "node:assert/strict";
import { test } from "node:test";

import { readStableProjectFile, sha256Text } from "./canvas-project-file-guard.ts";

test("accepts an unchanged project file at the imported baseline", async () => {
  const code = "export default function App() { return <main />; }";
  assert.deepEqual(
    await readStableProjectFile(async () => code, sha256Text(code)),
    { ok: true, originalCode: code },
  );
});

test("rejects a clean checkout whose file no longer matches the import", async () => {
  const imported = "old";
  assert.deepEqual(
    await readStableProjectFile(async () => "new upstream content", sha256Text(imported)),
    { ok: false, reason: "stale" },
  );
});

test("rejects a mutation that lands between the two guarded reads", async () => {
  const imported = "original";
  let reads = 0;
  const result = await readStableProjectFile(async () => {
    reads += 1;
    return reads === 1 ? imported : "concurrent editor change";
  }, sha256Text(imported));
  assert.deepEqual(result, { ok: false, reason: "changed_during_apply" });
});
