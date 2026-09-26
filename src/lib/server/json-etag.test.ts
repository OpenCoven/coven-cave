// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { ifNoneMatchIncludes, serializeJsonWithEtag } from "./json-etag.ts";

test("the same object is serialized and hashed once", () => {
  const payload = { ok: true, sessions: [{ id: "a" }] };
  const first = serializeJsonWithEtag(payload);
  const second = serializeJsonWithEtag(payload);
  assert.equal(first, second, "memoized by identity");
  assert.equal(first.body, JSON.stringify(payload));
  assert.match(first.etag, /^"[A-Za-z0-9_-]+"$/);
});

test("equal content gets an equal tag and different content a different one", () => {
  const a = serializeJsonWithEtag({ ok: true, sessions: [{ id: "a" }] });
  const same = serializeJsonWithEtag({ ok: true, sessions: [{ id: "a" }] });
  const other = serializeJsonWithEtag({ ok: true, sessions: [{ id: "b" }] });
  assert.equal(a.etag, same.etag);
  assert.notEqual(a.etag, other.etag);
});

test("If-None-Match matching handles lists, weak tags and wildcards", () => {
  const etag = '"abc"';
  assert.equal(ifNoneMatchIncludes(null, etag), false);
  assert.equal(ifNoneMatchIncludes('"abc"', etag), true);
  assert.equal(ifNoneMatchIncludes('W/"abc"', etag), true);
  assert.equal(ifNoneMatchIncludes('"x", "abc"', etag), true);
  assert.equal(ifNoneMatchIncludes("*", etag), true);
  assert.equal(ifNoneMatchIncludes('"abd"', etag), false);
});
