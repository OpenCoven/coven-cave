// @ts-nocheck
import assert from "node:assert/strict";
import {
  isSafeGitHubUrl,
  isSafeHttpUrl,
  isSafeVscodeFileUrl,
  parseSafeHttpUrl,
} from "./url-safety.ts";

assert.equal(parseSafeHttpUrl(" https://example.test/path ")?.href, "https://example.test/path");
assert.equal(isSafeHttpUrl("http://example.test"), true);
assert.equal(isSafeHttpUrl("https://example.test"), true);
assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
assert.equal(isSafeHttpUrl("data:text/html,owned"), false);

assert.equal(isSafeGitHubUrl("https://github.com/OpenCoven/coven-cave"), true);
assert.equal(isSafeGitHubUrl("https://www.github.com/OpenCoven/coven-cave"), true);
assert.equal(isSafeGitHubUrl("https://gist.github.com/OpenCoven/coven-cave"), false);
assert.equal(isSafeGitHubUrl("https://example.test/OpenCoven/coven-cave"), false);

assert.equal(isSafeVscodeFileUrl("vscode://file/Users/buns/example.md"), true);
assert.equal(isSafeVscodeFileUrl(" vscode://file/C:/Users/buns/example.md "), true);
assert.equal(isSafeVscodeFileUrl("vscode://extension/ms-python.python"), false);
assert.equal(isSafeVscodeFileUrl("javascript:alert(1)"), false);
