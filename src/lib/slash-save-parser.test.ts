// @ts-nocheck
import assert from "node:assert/strict";
import { slashSaveParse } from "./slash-save-parser.ts";

const CASES = [
  ["https://a.com",                    { url: "https://a.com", listHint: undefined, tags: [] }],
  ["https://a.com reading",            { url: "https://a.com", listHint: "reading", tags: [] }],
  ["https://a.com bookmarks",          { url: "https://a.com", listHint: "bookmarks", tags: [] }],
  ["https://a.com github",             { url: "https://a.com", listHint: "github", tags: [] }],
  ["https://a.com #ai #ml",            { url: "https://a.com", listHint: undefined, tags: ["ai", "ml"] }],
  ["https://a.com reading #ai",        { url: "https://a.com", listHint: "reading", tags: ["ai"] }],
  ["  https://a.com   reading  #ai ",  { url: "https://a.com", listHint: "reading", tags: ["ai"] }],
  ["",                                 { error: "url_required" }],
  ["   ",                              { error: "url_required" }],
  ["not-a-url",                        { error: "url_required" }],
  ["reading https://a.com",            { error: "url_required" }],  // URL must be first
];

for (const [input, want] of CASES) {
  const got = slashSaveParse(input);
  assert.deepStrictEqual(got, want, `slashSaveParse(${JSON.stringify(input)})`);
}
console.log(`slashSaveParse: ${CASES.length} cases passed`);
