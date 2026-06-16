import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCssColorToRgb, readableTextColor } from "./readable-text-color.ts";

describe("readableTextColor", () => {
  it("chooses dark text on light accents", () => {
    assert.equal(readableTextColor("#f1dfbf"), "#111111");
    assert.equal(readableTextColor("rgb(241 223 191)"), "#111111");
  });

  it("chooses white text on dark accents", () => {
    assert.equal(readableTextColor("#2e2a45"), "#ffffff");
    assert.equal(readableTextColor("rgb(46, 42, 69)"), "#ffffff");
  });

  it("parses short and alpha hex without letting alpha affect contrast", () => {
    assert.deepEqual(parseCssColorToRgb("#abc"), [170, 187, 204]);
    assert.deepEqual(parseCssColorToRgb("#aabbcc88"), [170, 187, 204]);
  });
});
