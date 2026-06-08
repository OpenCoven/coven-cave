// @ts-nocheck
import assert from "node:assert/strict";
import { validateOpRef } from "./vault.ts";

assert.equal(validateOpRef("op://Personal/GitHub/token"), null);
assert.equal(validateOpRef(42), "ref must be a string");
assert.equal(validateOpRef(null), "ref must be a string");
assert.equal(validateOpRef({ ref: "op://Personal/GitHub/token" }), "ref must be a string");
assert.equal(validateOpRef("https://example.test"), "ref must start with op://");
assert.equal(validateOpRef("op://Personal/GitHub"), "ref must include vault, item, and field segments");
assert.equal(validateOpRef("op://Personal/GitHub/token;rm -rf"), "ref contains invalid characters");
