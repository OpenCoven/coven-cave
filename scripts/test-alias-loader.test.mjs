import assert from "node:assert/strict";
import { test } from "node:test";

import { load } from "./test-alias-loader.mjs";

const fallthrough = Symbol("fallthrough");

function nextLoad() {
  return fallthrough;
}

test("repo-owned TSX remains compatible with the Node test loader", async () => {
  const result = await load(
    // Any repo-owned TSX works here — this asserts the LOADER, not the
    // component. It used to point at a canonical-memory file that was only ever
    // a convenient specimen; when that module was deleted with the vault this
    // test broke for a reason unrelated to what it checks. A shared primitive
    // is a steadier specimen.
    new URL("../src/components/ui/empty-state.tsx", import.meta.url).href,
    {},
    nextLoad,
  );
  assert.equal(result.format, "module");
  assert.equal(result.shortCircuit, true);
  assert.match(String(result.source), /EmptyState/);
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

test("the root package manifest remains compatible for app-version imports", async () => {
  const result = await load(
    new URL("../package.json", import.meta.url).href,
    {},
    nextLoad,
  );
  assert.equal(result.format, "module");
  assert.equal(result.shortCircuit, true);
  assert.match(String(result.source), /"version"/);
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
