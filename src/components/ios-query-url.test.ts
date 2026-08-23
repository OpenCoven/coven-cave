// @ts-nocheck
// Regression guard for the iOS reader-view 404 ("Couldn't load this entry —
// Server returned status 404"). CaveClient.request() used
// `base.appendingPathComponent(path)`, which percent-encodes "?" to "%3F" — so
// a query-bearing path like "api/chat/model-state?familiarId=…" became a bogus
// percent-encoded path segment ("…%3FfamiliarId=…") that the
// server 404s on. The builder must split the query off the path and reattach it
// as a real query string. iOS isn't compiled in CI, so this source-text test is
// the guard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(
  new URL("../../apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift", import.meta.url),
  "utf8",
);

// The visibility is deliberately open-ended. This test guards how the request
// is BUILT — split the query off, append only the path, reattach without
// double-encoding — and none of that depends on whether the builder is private
// or internal. Anchoring the locator on `private` made a widening of the
// visibility (so sibling client extensions in other files could reuse the one
// correct builder instead of copying it) read as "request() must exist" going
// false, which is the least informative way this test could ever fail.
const requestFn =
  client.match(/(?:private\s+)?func request\([\s\S]*?\n    \}/)?.[0] ?? "";
assert.ok(requestFn, "CaveClient.request(_:) must exist");

// The query must be split off the path before path-appending…
assert.match(
  requestFn,
  /split\(separator:\s*"\?",\s*maxSplits:\s*1/,
  "request() must split the query string off the path",
);
// …only the path part is appended as a path component…
assert.match(
  requestFn,
  /appendingPathComponent\(pathPart\)/,
  "request() must append only the path part (not the raw query-bearing path)",
);
// …and the query is reattached without double-encoding.
assert.match(
  requestFn,
  /percentEncodedQuery\s*=\s*queryPart/,
  "request() must reattach the query via percentEncodedQuery",
);
// The old bug — appending the whole raw `path` (with its "?") — must be gone.
assert.doesNotMatch(
  requestFn,
  /appendingPathComponent\(path\)/,
  "request() must not append the raw query-bearing path (the 404 cause)",
);

// A live caller still requests the query-string form that this fix repairs.
// (Journal was removed in the iOS purge; chat model-state is the surviving guard.)
assert.match(
  client,
  /"api\/chat\/model-state\?familiarId=\\\(urlQuery\(familiarId\)\)"/,
  "chatModelState still builds api/chat/model-state?familiarId=…",
);

console.log("ios-query-url.test.ts: ok");
