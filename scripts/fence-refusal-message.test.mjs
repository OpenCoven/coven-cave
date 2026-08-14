import assert from "node:assert/strict";
import { test } from "node:test";

import { fenceRefusalMessage } from "./fence-refusal-message.mjs";

const NOW = Date.parse("2026-08-12T10:00:00.000Z");

test("a held lease names the holder, its process, and how long the wait is", () => {
  const message = fenceRefusalMessage(
    {
      reason: "local-acquire-failed: gate-held",
      holder: "worktree-lifecycle-create:cave-123",
      holderPid: 4242,
      holderHost: "somehost",
      phase: "held",
      expiresAt: "2026-08-12T10:05:00.000Z",
    },
    NOW,
  );

  assert.match(message, /^maintenance fence acquisition failed: local-acquire-failed: gate-held$/m);
  assert.match(message, /held by: worktree-lifecycle-create:cave-123 \(pid 4242 on somehost\)/);
  assert.match(message, /phase: held/);
  assert.match(message, /lease expires: 2026-08-12T10:05:00\.000Z \(in ~300s\)/);
  assert.match(message, /Wait for the lease to expire, then rerun this command\./);
  assert.match(message, /Do NOT fall back to `git worktree add`/);
});

// The bug this file exists for. `gate-stale` refuses an ALREADY-EXPIRED lease:
// the TTL lapsed but the owner is not provably gone, and nothing in shipping
// code passes `takeoverStale`. Telling that reader to wait is the same
// unactionable advice cave-8zkkj set out to remove — the wait already happened.
test("an already-expired lease never advises waiting", () => {
  const message = fenceRefusalMessage(
    {
      reason: "local-acquire-failed: gate-stale",
      holder: "worktree-lifecycle-create:cave-999",
      holderPid: 4242,
      phase: "held",
      expiresAt: "2026-08-12T09:58:00.000Z",
    },
    NOW,
  );

  assert.doesNotMatch(message, /Wait for the lease to expire/);
  assert.doesNotMatch(message, /in ~0s/, "an expired lease is not reported as a zero-second wait");
  assert.match(message, /lease expired: 2026-08-12T09:58:00\.000Z \(120s ago\)/);
  assert.match(message, /Waiting will NOT clear this/);
  assert.match(message, /check whether the holder process above is alive/);
  assert.match(message, /Do NOT fall back to `git worktree add`/);
});

// The Coven plane refuses without any lease at all, so neither the wait advice
// nor the expiry line can be supported — but the fallback warning still can.
test("a refusal with no lease reports neither an expiry nor a wait", () => {
  const message = fenceRefusalMessage({ reason: "coven-acquire-failed" }, NOW);

  assert.equal(message.includes("lease expires"), false);
  assert.equal(message.includes("lease expired"), false);
  assert.doesNotMatch(message, /Wait for the lease/);
  assert.doesNotMatch(message, /Waiting will NOT/);
  assert.match(message, /Do NOT fall back to `git worktree add`/);
});

test("missing detail degrades instead of rendering undefined", () => {
  const bare = fenceRefusalMessage({}, NOW);
  assert.match(bare, /^maintenance fence acquisition failed: unknown$/m);
  assert.equal(bare.includes("undefined"), false);
  assert.equal(bare.includes("held by"), false);

  // A record predating host recording carries a pid but no host: the pid is
  // still worth printing, and the parenthesis must still close.
  const noHost = fenceRefusalMessage({ reason: "gate-held", holder: "owner", holderPid: 7 }, NOW);
  assert.match(noHost, /held by: owner \(pid 7\)$/m);

  // A malformed expiry is dropped rather than rendered as "Invalid Date".
  const badExpiry = fenceRefusalMessage({ reason: "gate-held", expiresAt: "not-a-date" }, NOW);
  assert.equal(badExpiry.includes("lease expir"), false);
  assert.equal(badExpiry.includes("NaN"), false);
});
