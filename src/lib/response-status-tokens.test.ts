import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  responseStatusTone,
  splitResponseStatusText,
} from "./response-status-tokens.ts";

const source = readFileSync(new URL("./response-status-tokens.ts", import.meta.url), "utf8");

test("response statuses map only the strict allowlist", () => {
  assert.equal(responseStatusTone("ready"), "success");
  assert.equal(responseStatusTone("BLOCKED"), "danger");
  assert.equal(responseStatusTone("paused"), "neutral");
  assert.equal(responseStatusTone("custom"), null);
});

test("response status splitting preserves surrounding text and original token text", () => {
  assert.deepEqual(splitResponseStatusText("Deploy [READY], review [BLOCKED]."), [
    { kind: "text", text: "Deploy " },
    { kind: "status", text: "[READY]", label: "READY", tone: "success" },
    { kind: "text", text: ", review " },
    { kind: "status", text: "[BLOCKED]", label: "BLOCKED", tone: "danger" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(splitResponseStatusText("[NOT_A_STATUS]"), [
    { kind: "text", text: "[NOT_A_STATUS]" },
  ]);
  assert.deepEqual(splitResponseStatusText("prefix[READY]suffix"), [
    { kind: "text", text: "prefix[READY]suffix" },
  ]);
});

test("decorateResponseHtml only rewrites prose text nodes", () => {
  assert.match(
    source,
    /parent\.closest\("code, pre, a, kbd, svg, \.cave-response-status"\)/,
  );
  assert.match(
    source,
    /if \(splitResponseStatusText\(node\.data\)\.some\(\(segment\) => segment\.kind === "status"\)\) \{\s*textNodes\.push\(node\);\s*\}/,
  );
});

test("decorateResponseHtml marks a lead paragraph only when headings exist", () => {
  assert.match(source, /firstBlock\?\.tagName === "P"/);
  assert.match(source, /some\(\(element\) => \/\^H\[1-6\]\$\/\.test\(element\.tagName\)\)/);
  assert.match(source, /firstBlock\.classList\.add\("cave-response-lead"\)/);
});
