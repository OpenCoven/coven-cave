import assert from "node:assert/strict";
import { listInput, commaInput, parseListInput } from "./list-input.ts";

// Joiners.
assert.equal(listInput(["/a", "/b"]), "/a\n/b", "listInput joins one per line");
assert.equal(commaInput(["x", "y"]), "x, y", "commaInput joins comma-separated");
assert.equal(listInput([]), "", "empty list → empty string");

// parseListInput accepts newline OR comma OR a mix, trims, and drops blanks.
assert.deepEqual(parseListInput("/a\n/b"), ["/a", "/b"], "splits on newlines");
assert.deepEqual(parseListInput("x, y, z"), ["x", "y", "z"], "splits on commas");
assert.deepEqual(parseListInput("/a\n b , /c "), ["/a", "b", "/c"], "mixed separators + trims");
assert.deepEqual(parseListInput("\n\n, ,\n"), [], "all-blank → empty list");
assert.deepEqual(parseListInput(""), [], "empty input → empty list");

// Round-trips.
assert.deepEqual(parseListInput(listInput(["/a", "/b"])), ["/a", "/b"], "listInput→parse round-trips");
assert.deepEqual(parseListInput(commaInput(["x", "y"])), ["x", "y"], "commaInput→parse round-trips");

console.log("list-input.test.ts: ok");
