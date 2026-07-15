import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STITCH_PATTERNS, stitchPatternById } from "@/lib/stitch-patterns";

describe("stitch patterns", () => {
  it("every pattern is a complete, unique shape", () => {
    const ids = new Set<string>();
    for (const pattern of STITCH_PATTERNS) {
      assert.ok(pattern.id && !ids.has(pattern.id), `unique id: ${pattern.id}`);
      ids.add(pattern.id);
      assert.ok(pattern.name.trim(), `${pattern.id} has a name`);
      assert.ok(pattern.description.trim(), `${pattern.id} has a description`);
      assert.ok(pattern.bodyScaffold.length >= 2, `${pattern.id} scaffolds at least two sections`);
      assert.ok(pattern.tagHints.length >= 1, `${pattern.id} suggests at least one tag`);
      for (const tag of pattern.tagHints) {
        assert.equal(tag, tag.toLowerCase(), `${pattern.id} tag hints are lowercase`);
      }
    }
  });

  it("looks up patterns by id and rejects everything else", () => {
    assert.equal(stitchPatternById("decision-record")?.name, "Decision record");
    assert.equal(stitchPatternById("nope"), null);
    assert.equal(stitchPatternById(""), null);
    assert.equal(stitchPatternById(null), null);
    assert.equal(stitchPatternById(42), null);
  });
});
