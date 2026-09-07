import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidResearchSourceUrl,
  RESEARCH_SOURCE_URL_RE,
} from "./research-source-url.ts";

test("source URL regex admits http(s) URLs", () => {
  for (const url of [
    "https://example.com",
    "https://example.com/path?q=1#frag",
    "http://example.com",
    "http://example.com:8080/a/b",
    "https://example.com/path",
    "https://example.com?query=1",
    "https://example.com#hash",
    "HTTPS://EXAMPLE.COM",
    "http://127.0.0.1:3000/x",
  ]) {
    assert.equal(RESEARCH_SOURCE_URL_RE.test(url), true, url);
  }
});

test("source URL regex rejects non-http(s) schemes and bare strings", () => {
  for (const url of [
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:user@example.com",
    "data:text/plain,hi",
    "example.com",
    "www.example.com",
    "example.com/path",
    "https://",
    "https:/example.com",
    "//example.com",
    "not a url",
    "",
  ]) {
    assert.equal(RESEARCH_SOURCE_URL_RE.test(url), false, url);
  }
});

test("isValidResearchSourceUrl trims and gates the same scheme", () => {
  assert.equal(isValidResearchSourceUrl("  https://example.com  "), true);
  assert.equal(isValidResearchSourceUrl("\thttps://example.com/x\n"), true);
  assert.equal(isValidResearchSourceUrl("ftp://example.com"), false);
  assert.equal(isValidResearchSourceUrl("https://"), false);
  assert.equal(isValidResearchSourceUrl(""), false);
  assert.equal(isValidResearchSourceUrl("   "), false);
});
