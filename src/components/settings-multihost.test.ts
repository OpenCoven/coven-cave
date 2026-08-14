import assert from "node:assert/strict";
import {
  formatHostWorkspaceText,
  parseExecutorUrls,
  parseHostWorkspaceText,
  suggestedHubEndpoint,
} from "./settings-multihost.ts";

assert.deepEqual(
  parseExecutorUrls(" https://one.example,https://two.example\nhttps://one.example "),
  ["https://one.example", "https://two.example"],
  "executor normalization trims, splits, and de-duplicates persisted addresses",
);
assert.deepEqual(
  parseHostWorkspaceText("# ignored\none = /repo/one\ntwo=/repo/two\ninvalid"),
  { one: "/repo/one", two: "/repo/two" },
  "host-workspace parsing ignores comments and malformed lines",
);
assert.equal(
  formatHostWorkspaceText({ one: " /repo/one ", empty: "" }),
  "one=/repo/one",
  "only valid host-workspace mappings round-trip into the textarea",
);
assert.equal(
  suggestedHubEndpoint("cave.tailnet.example.ts.net"),
  "http://cave.tailnet.example.ts.net:8787",
  "direct daemon suggestions preserve tokenless HTTP unless TLS is explicit",
);
assert.equal(
  suggestedHubEndpoint("100.101.102.103"),
  "http://100.101.102.103:8787",
  "raw tailnet IP suggestions preserve explicit tokenless HTTP compatibility",
);
