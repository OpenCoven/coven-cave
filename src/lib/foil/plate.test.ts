import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPlate, selectMarks, tagsForTheme, MARK_NAMES } from "./plate.ts";
import { deriveSeed, makeRng, FALLOFFS } from "./field.ts";

const base = { width: 96, height: 134, theme: "reaper sever blade", seed: 19 } as const;

test("identical inputs render byte-identical plates", () => {
  const a = renderPlate({ ...base });
  const b = renderPlate({ ...base });
  assert.deepEqual([...a.data], [...b.data]);
  assert.equal(a.meta.seed, b.meta.seed);
});

test("a different seed produces a different plate", () => {
  const a = renderPlate({ ...base });
  const b = renderPlate({ ...base, seed: 20 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("nothing in the pipeline reads ambient entropy", () => {
  // Guard the determinism contract against a future Math.random creeping in:
  // if anything called it, these two renders would diverge.
  const realRandom = Math.random;
  let called = 0;
  Math.random = () => { called++; return 0.5; };
  try {
    renderPlate({ ...base });
  } finally {
    Math.random = realRandom;
  }
  assert.equal(called, 0, "renderPlate must not call Math.random");
});

test("the seed is derived from identity only, so presentation knobs are orthogonal", () => {
  // Dimensions, variation, markCount and a forced template are all excluded
  // from the seed. Changing them must not reshuffle which marks were chosen.
  const a = renderPlate({ ...base });
  const wide = renderPlate({ ...base, width: 192, height: 268 });
  const varied = renderPlate({ ...base, variation: "high" });
  assert.deepEqual(a.meta.marks, wide.meta.marks);
  assert.deepEqual(a.meta.marks, varied.meta.marks);
  assert.equal(a.meta.template, wide.meta.template);
});

test("markCount is nested rather than a reshuffle", () => {
  const one = renderPlate({ ...base, markCount: 1 });
  const three = renderPlate({ ...base, markCount: 3 });
  assert.deepEqual(three.meta.marks.slice(0, 1), one.meta.marks);
});

test("forcing a template does not disturb the falloff or marks", () => {
  const auto = renderPlate({ ...base });
  const forced = renderPlate({ ...base, template: "split" });
  assert.equal(forced.meta.template, "split");
  assert.deepEqual(forced.meta.marks, auto.meta.marks);
  assert.equal(forced.meta.falloff, auto.meta.falloff);
});

test("pitchScale changes density without changing composition", () => {
  const coarse = renderPlate({ ...base, pitchScale: 1 });
  const dense = renderPlate({ ...base, pitchScale: 0.5 });
  assert.ok(dense.meta.ringPitch < coarse.meta.ringPitch);
  assert.equal(dense.meta.template, coarse.meta.template);
  assert.deepEqual(dense.meta.marks, coarse.meta.marks);
});

test("the flat falloff is constant, so a masked carrier has no shape of its own", () => {
  // A composed plate under a mask punches holes in the masked subject; the
  // carrier must be even so the MASK supplies the shape.
  assert.equal(FALLOFFS.flat(0), 1);
  assert.equal(FALLOFFS.flat(0.5), 1);
  assert.equal(FALLOFFS.flat(1), 1);
});

test("full-bleed carrier covers the frame", () => {
  const plate = renderPlate({ ...base, template: "full-bleed", falloff: "flat" });
  // Sample the four corners; a full-bleed carrier must reach all of them.
  const { data, width, height } = plate;
  const corners = [
    [4, 4], [width - 5, 4], [4, height - 5], [width - 5, height - 5],
  ] as const;
  for (const [x, y] of corners) {
    let any = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) any = Math.max(any, data[(y + dy) * width + (x + dx)]);
    }
    assert.ok(any > 0, `carrier should reach corner ${x},${y}`);
  }
});

test("plate output is pure black and white apart from edge pixels", () => {
  const { data } = renderPlate({ ...base });
  let mid = 0;
  for (const v of data) if (v > 8 && v < 247) mid++;
  // Antialiasing is deliberate — a hard threshold on curved geometry crawls
  // once the CSS stack moves it — but it must stay confined to boundaries.
  assert.ok(mid / data.length < 0.2, `too many midtones: ${(mid / data.length * 100).toFixed(1)}%`);
});

test("themes select from the fixed vocabulary, never invent geometry", () => {
  const rng = makeRng(deriveSeed(1, "quantum trader"));
  for (const mark of selectMarks("quantum trader", rng, 3)) {
    assert.ok(MARK_NAMES.includes(mark), `${mark} is not in the mark library`);
  }
});

test("an unknown theme still yields usable tags rather than throwing", () => {
  assert.ok(tagsForTheme("asdfqwerty").length > 0);
});

test("deriveSeed is order-sensitive, which is why its signature is a contract", () => {
  assert.notEqual(deriveSeed(1, "a"), deriveSeed("a", 1));
});
