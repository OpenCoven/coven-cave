// @ts-nocheck
import assert from "node:assert/strict";
import {
  GLOBAL_SEARCH_REQUEST_EVENT,
  globalSearchRequestDetail,
  globalSearchRequestFromDetail,
} from "./global-search-request.ts";

// The event name is a stable, namespaced contract the workspace listens for.
{
  assert.equal(GLOBAL_SEARCH_REQUEST_EVENT, "cave:global-search-request");
}

// The detail is the exact query the surface wants global search to open with.
{
  assert.deepEqual(globalSearchRequestDetail("type:chat"), { query: "type:chat" });
  assert.deepEqual(globalSearchRequestDetail(""), { query: "" });
}

// Reading a well-formed detail back yields the query.
{
  assert.equal(globalSearchRequestFromDetail(globalSearchRequestDetail("type:file project:\"p\"")), "type:file project:\"p\"");
}

// Foreign or malformed details fail closed to null rather than guessing.
{
  assert.equal(globalSearchRequestFromDetail(null), null);
  assert.equal(globalSearchRequestFromDetail("type:chat"), null);
  assert.equal(globalSearchRequestFromDetail({}), null);
  assert.equal(globalSearchRequestFromDetail({ query: 42 }), null);
  assert.equal(globalSearchRequestFromDetail({ query: "" }), null);
  assert.equal(globalSearchRequestFromDetail({ query: "  " }), null);
}

console.log("global-search-request.test.ts: ok");
