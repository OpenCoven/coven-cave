import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./familiars/[id]/outcomes/route.ts", import.meta.url)),
  "utf8",
);

describe("familiar outcomes route", () => {
  it("rejects an invalid familiar id before reading any store", () => {
    assert.match(source, /if \(!isValidFamiliarId\(id\)\) \{\s*return NextResponse\.json\(\{ ok: false, error: "path not allowed" \}, \{ status: 403 \}\);/);
    assert.ok(source.indexOf("isValidFamiliarId(id)") < source.indexOf("loadBoard()"));
  });

  it("derives outcomes through the shared pure summary", () => {
    assert.match(source, /summarizeFamiliarOutcomes\(id, board\.cards, reports\.reports\)/);
    assert.match(source, /listSelfReports\(id, \{ limit: "all" \}\)/);
  });

  it("keeps the thread id: redacts prose fields, never the whole outcome", () => {
    // The generic deep redactor treats `sessionId` as a session secret. Using
    // it here would erase the thread link calibration depends on (#5666).
    assert.doesNotMatch(source, /redactSecretsDeep\(/);
    assert.match(source, /cardTitle: redactSecretText\(outcome\.cardTitle\)/);
    assert.match(source, /detail: redactSecretText\(outcome\.detail\)/);
  });
});
