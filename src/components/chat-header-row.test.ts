// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

const linearHeader = source.match(/<header className="cave-chat-linear-header"[\s\S]*?<\/header>/)?.[0] ?? "";
const linearHeaderRule = styles.match(/\.cave-chat-linear-header\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

assert.match(
  linearHeader,
  /<div className="cave-chat-linear-header-row"[\s\S]*<ChatContextStrip/,
  "Task/session context should render inside the single chat header row",
);

assert.doesNotMatch(
  linearHeader,
  /<\/div>\s*<ChatContextStrip[\s\S]*?\/>\s*<\/header>/,
  "Task/session context should not sit on a second row below the identity bar",
);

assert.match(
  linearHeaderRule,
  /flex-direction\s*:\s*row/,
  "Linear chat header should keep identity and task context on one row",
);

assert.match(
  styles,
  /\.cave-chat-linear-header-row\s*\{[\s\S]*min-width\s*:\s*0[\s\S]*\}/,
  "Header row should be able to shrink without forcing overflow",
);

assert.match(
  styles,
  /\.cave-chat-linear-header-context\s*\{[\s\S]*overflow\s*:\s*hidden[\s\S]*\}/,
  "Header context area should truncate instead of wrapping the header taller",
);

console.log("chat-header-row.test.ts: ok");
