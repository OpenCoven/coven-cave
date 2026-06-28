// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEB_VITAL_THRESHOLDS,
  rateWebVital,
  formatWebVital,
} from "./web-vitals-format.ts";

test("rateWebVital classifies against the good/poor thresholds", () => {
  // LCP: good ≤2500, poor >4000
  assert.equal(rateWebVital("LCP", 1200), "good");
  assert.equal(rateWebVital("LCP", 2500), "good"); // boundary is inclusive-good
  assert.equal(rateWebVital("LCP", 3200), "needs-improvement");
  assert.equal(rateWebVital("LCP", 4001), "poor");
  // CLS is unitless
  assert.equal(rateWebVital("CLS", 0.05), "good");
  assert.equal(rateWebVital("CLS", 0.2), "needs-improvement");
  assert.equal(rateWebVital("CLS", 0.3), "poor");
});

test("rateWebVital returns unknown for unrecognized metrics or bad values", () => {
  assert.equal(rateWebVital("FID", 10), "unknown");
  assert.equal(rateWebVital("LCP", Number.NaN), "unknown");
});

test("every threshold metric has a sane [goodMax, poorMin] pair", () => {
  for (const [name, [goodMax, poorMin]] of Object.entries(WEB_VITAL_THRESHOLDS)) {
    assert.ok(goodMax < poorMin, `${name}: goodMax must be below poorMin`);
  }
});

test("formatWebVital renders ms for timings and 3-decimals for CLS", () => {
  assert.equal(formatWebVital("LCP", 2499.6), "2500 ms");
  assert.equal(formatWebVital("CLS", 0.1234), "0.123");
  assert.equal(formatWebVital("LCP", Number.NaN), "—");
});

console.log("web-vitals-format.test.ts: ok");
