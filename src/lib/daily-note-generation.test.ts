// @ts-nocheck
import assert from "node:assert/strict";
import { runDailyNoteBatch } from "./daily-note-generation.ts";
const saved = [];
const seen = [];
const dependencies = {
  load: async (date) => ({ day: date.endsWith("02") ? null : { date, digest: "Work", context: "Evidence", exists: date.endsWith("03") }, continuity: "Yesterday" }),
  generate: async (date, context) => { seen.push([date, context]); if (date.endsWith("04")) throw new Error("Offline"); return "Reflection"; },
  save: async (date) => { saved.push(date); return "generated"; },
};
const result = await runDailyNoteBatch({ dates: ["2026-10-05", "2026-10-03", "2026-10-01", "2026-10-02", "2026-10-04", "2026-10-01"], dependencies });
assert.deepEqual(saved, ["2026-10-01", "2026-10-05"], "oldest first, continue past failed days, deduplicate");
assert.deepEqual(result.map((r) => r.status), ["generated", "inactive", "existing", "failed", "generated"]);
assert.match(seen[0][1], /Yesterday/);
const controller = new AbortController();
const aborted = await runDailyNoteBatch({ dates: ["2026-10-01", "2026-10-05"], signal: controller.signal, dependencies: { ...dependencies, generate: async () => { controller.abort(); return "Partial"; } } });
assert.equal(aborted.length, 0, "cancelled output is not persisted");
assert.equal(saved.length, 2);
console.log("daily-note-generation: all assertions passed");
