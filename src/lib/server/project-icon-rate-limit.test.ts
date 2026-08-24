import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROJECT_ICON_COOLDOWN_MS,
  createProjectIconRateLimiter,
} from "./project-icon-rate-limit.ts";

test("a second generation for the same normalized project is throttled", () => {
  let now = 1_000;
  const limiter = createProjectIconRateLimiter({ now: () => now });

  assert.deepEqual(limiter.consume("C:\\Users\\dev\\app\\"), { allowed: true });
  assert.deepEqual(limiter.consume("C:/Users/dev/app"), {
    allowed: false,
    retryAfterSeconds: 60,
  });

  now += PROJECT_ICON_COOLDOWN_MS - 1;
  assert.deepEqual(limiter.consume("C:/Users/dev/app"), {
    allowed: false,
    retryAfterSeconds: 1,
  });
});

test("another project has its own generation budget", () => {
  const limiter = createProjectIconRateLimiter({ now: () => 1_000 });
  assert.deepEqual(limiter.consume("/tmp/one"), { allowed: true });
  assert.deepEqual(limiter.consume("/tmp/two"), { allowed: true });
});

test("the project may regenerate once its cooldown expires", () => {
  let now = 5_000;
  const limiter = createProjectIconRateLimiter({ now: () => now });
  assert.deepEqual(limiter.consume("/tmp/app"), { allowed: true });
  now += PROJECT_ICON_COOLDOWN_MS;
  assert.deepEqual(limiter.consume("/tmp/app"), { allowed: true });
});

test("a backwards clock step never reports more than one cooldown", () => {
  let now = 10_000;
  const limiter = createProjectIconRateLimiter({ now: () => now });
  assert.deepEqual(limiter.consume("/tmp/app"), { allowed: true });
  now = -1_000_000;
  assert.deepEqual(limiter.consume("/tmp/app"), {
    allowed: false,
    retryAfterSeconds: 60,
  });
});
