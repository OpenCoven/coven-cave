import assert from "node:assert/strict";
import { test } from "node:test";

import { isUtcTimestamp } from "./common.ts";

test("UTC RFC 3339 timestamps accept zero through nine fractional digits", () => {
  for (const value of [
    "2026-08-15T20:00:00Z",
    "2026-08-15T20:00:00.1Z",
    "2026-08-15T20:00:00.123456789Z",
    "2024-02-29T23:59:59.000000000Z",
  ]) {
    assert.equal(isUtcTimestamp(value), true, value);
  }
});

test("UTC RFC 3339 timestamps reject non-UTC syntax and invalid calendar or time values", () => {
  for (const value of [
    "2026-08-15T20:00:00+00:00",
    "2026-08-15T20:00:00-05:00",
    "2026-08-15T20:00:00z",
    "2026-08-15 20:00:00Z",
    "2026-08-15T20:00:00.1234567890Z",
    "2023-02-29T20:00:00Z",
    "2026-04-31T20:00:00Z",
    "2026-13-01T20:00:00Z",
    "2026-08-15T24:00:00Z",
    "2026-08-15T20:60:00Z",
    "2026-08-15T20:00:60Z",
  ]) {
    assert.equal(isUtcTimestamp(value), false, value);
  }
});
