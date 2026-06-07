// @ts-nocheck
import assert from "node:assert/strict";
import { extractLinks } from "./link-extractor.ts";

const CASES = [
  // happy path
  ["check https://github.com/foo/bar for context", ["https://github.com/foo/bar"]],
  ["two links: https://a.com and https://b.com", ["https://a.com/", "https://b.com/"]],

  // dedup within input
  ["https://a.com twice https://a.com", ["https://a.com/"]],

  // fenced code blocks ignored
  ["check ```\nhttps://example.com/in-code\n```", []],
  ["check ```ts\nfetch('https://example.com/in-code')\n``` and https://outside.com",
    ["https://outside.com/"]],

  // inline backticks ignored
  ["inline `https://example.com/in-backticks`", []],
  ["but `inline` then https://real.com/x", ["https://real.com/x"]],

  // image targets ignored
  ["![alt](https://cdn.example.com/img.png)", []],
  ["text ![a](https://cdn.example.com/img.png) then https://real.com",
    ["https://real.com/"]],

  // localhost / file / non-http rejected
  ["see http://localhost:3000", []],
  ["see http://127.0.0.1:8080", []],
  ["file:///etc/passwd", []],
  ["ftp://files.example.com/x", []],

  // mailto / tel skipped
  ["mailto:foo@bar.com tel:+15555555", []],

  // empty
  ["", []],
  ["no links here at all", []],
];

for (const [input, expected] of CASES) {
  const got = extractLinks(input);
  assert.deepStrictEqual(got, expected, `extractLinks(${JSON.stringify(input)}) → ${JSON.stringify(got)}; want ${JSON.stringify(expected)}`);
}

console.log(`extractLinks: ${CASES.length} cases passed`);
