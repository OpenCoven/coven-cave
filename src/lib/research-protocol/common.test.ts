import assert from "node:assert/strict";
import { test } from "node:test";

import { compareUtcTimestamps, isUtcTimestamp } from "./common.ts";

test("UTC RFC 3339 timestamps accept ordinary timestamps and month-end leap-second placement", () => {
  for (const value of [
    "2026-08-15T20:00:00Z",
    "2026-08-15T20:00:00.1Z",
    "2026-08-15T20:00:00.123456789Z",
    "2024-02-29T23:59:59.000000000Z",
    "1972-06-30T23:59:60Z",
    "2023-02-28T23:59:60Z",
    "2024-02-29T23:59:60Z",
    "1900-02-28T23:59:60Z",
    "2000-02-29T23:59:60Z",
    "2026-04-30T23:59:60Z",
    "2016-12-31T23:59:60Z",
    "2016-12-31T23:59:60.123456789Z",
    "2030-12-31T23:59:60Z",
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
    "1972-06-29T23:59:60Z",
    "2026-08-15T23:59:60Z",
    "2016-12-30T23:59:60Z",
    "2024-02-28T23:59:60Z",
    "2023-02-29T23:59:60Z",
    "1900-02-29T23:59:60Z",
    "2000-02-28T23:59:60Z",
    "2016-12-31T22:59:60Z",
    "2016-12-31T23:58:60Z",
    "2016-12-31T23:59:61Z",
    "2016-12-31T23:59:60.1234567890Z",
    "2016-12-31T23:59:60z",
    "2016-12-31T23:59:60+00:00",
    "2016-12-31 23:59:60Z",
  ]) {
    assert.equal(isUtcTimestamp(value), false, value);
  }
});

test("UTC RFC 3339 comparison preserves nanoseconds and month-end leap seconds", () => {
  assert.equal(
    compareUtcTimestamps("2026-08-15T20:00:00Z", "2026-08-15T20:00:00.000000000Z"),
    0,
  );
  assert.equal(
    compareUtcTimestamps("2026-08-15T20:00:00.1Z", "2026-08-15T20:00:00.100000000Z"),
    0,
  );
  assert.equal(
    compareUtcTimestamps("2026-08-15T20:00:00.000000001Z", "2026-08-15T20:00:00.00000001Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2016-12-31T23:59:59.999999999Z", "2016-12-31T23:59:60Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2016-12-31T23:59:60.999999999Z", "2017-01-01T00:00:00Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2026-05-01T00:00:00Z", "2026-04-30T23:59:60.999999999Z"),
    1,
  );
});
