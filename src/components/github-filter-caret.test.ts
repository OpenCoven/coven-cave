// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const selectSrc = readFileSync(new URL("./ui/select.tsx", import.meta.url), "utf8");
const githubListCss = readFileSync(new URL("../styles/board/github-list.css", import.meta.url), "utf8");

function extractRule(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  assert.ok(match, `missing ${selector} rule`);
  return match[1];
}

assert.match(selectSrc, /ph:caret-down-bold/, "StandardSelect still renders the shared caret icon");

const ghSelectRule = extractRule(githubListCss, String.raw`\.gh-select`);

assert.doesNotMatch(ghSelectRule, /background-image\s*:/, ".gh-select no longer uses a legacy background-image");
assert.doesNotMatch(ghSelectRule, /background-repeat\s*:/, ".gh-select no longer uses a legacy background-repeat");
assert.doesNotMatch(ghSelectRule, /background-position\s*:/, ".gh-select no longer uses a legacy background-position");
assert.match(ghSelectRule, /padding\s*:\s*0 8px;/, ".gh-select keeps the shared trigger padding");

console.log("github-filter-caret.test.ts ok");
