// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.doesNotMatch(
  css,
  /\.cave-code-header::before/,
  "Terminal code chrome should not inject traffic lights before the language label",
);

assert.match(
  css,
  /\.cave-code-header::after[\s\S]*box-shadow:/,
  "Terminal code chrome should render traffic lights after the language label",
);

assert.match(
  css,
  /\.cave-code-lang[\s\S]*order:\s*0/,
  "The language label should be first in terminal code headers",
);

assert.match(
  css,
  /\.cave-code-header::after[\s\S]*order:\s*1/,
  "Traffic lights should sit immediately to the right of the language label",
);

assert.match(
  css,
  /\.cave-code-header \.cave-copy-btn[\s\S]*order:\s*3[\s\S]*margin-left:\s*auto/,
  "The copy button should stay at the far edge after the label and traffic lights",
);
