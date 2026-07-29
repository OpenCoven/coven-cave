import assert from "node:assert/strict";
import { test } from "node:test";

import { load } from "./test-alias-loader.mjs";

const fallthrough = Symbol("fallthrough");

function nextLoad() {
  return fallthrough;
}

test("repo-owned TSX remains compatible with the Node test loader", async () => {
  const result = await load(
    new URL("../src/components/canonical-memory-overview.tsx", import.meta.url).href,
    {},
    nextLoad,
  );
  assert.equal(result.format, "module");
  assert.equal(result.shortCircuit, true);
  assert.match(String(result.source), /CanonicalMemoryOverviewPanel/);
});

test("repo-owned JSON remains compatible with the Node test loader", async () => {
  const result = await load(
    new URL("../src/lib/ph-familiar-core.json", import.meta.url).href,
    {},
    nextLoad,
  );
  assert.equal(result.format, "module");
  assert.equal(result.shortCircuit, true);
  assert.match(String(result.source), /^export default /);
});

test("dependency TSX and JSON URLs fall through without being transformed", async () => {
  for (const relative of [
    "../node_modules/example-package/private.tsx",
    "../node_modules/example-package/private.json",
  ]) {
    assert.equal(
      await load(new URL(relative, import.meta.url).href, {}, nextLoad),
      fallthrough,
      relative,
    );
  }
});
