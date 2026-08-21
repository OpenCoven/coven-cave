import assert from "node:assert/strict";
import test from "node:test";
import {
  extractChatResultMarkers,
  RESULT_ID_MAX,
  RESULT_LABEL_MAX,
} from "./chat-result-markers.ts";

test("valid complete result markers are stripped and returned with familiar source", () => {
  const text = [
    "Checks complete.",
    '<coven:result id="tests" state="passed" label="Focused tests passed" />',
    'Still valid <coven:result id="lint" state="running" label="Lint in progress">',
  ].join("\n");

  const result = extractChatResultMarkers(text);

  assert.equal(result.visible, "Checks complete.\n\nStill valid ");
  assert.deepEqual(result.results, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
    { id: "lint", state: "running", label: "Lint in progress", source: "familiar" },
  ]);
});

test("repeated ids keep first-seen order while latest valid marker wins", () => {
  const result = extractChatResultMarkers([
    '<coven:result id="tests" state="running" label="Focused tests running" />',
    '<coven:result id="lint" state="pending" label="Lint queued" />',
    '<coven:result id="tests" state="passed" label="Focused tests passed" />',
    '<coven:result id="lint" state="attention" label="Lint needs review" />',
  ].join("\n"));

  assert.deepEqual(result.results, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
    { id: "lint", state: "attention", label: "Lint needs review", source: "familiar" },
  ]);
});

test("inline-code and fenced-code marker examples stay literal and create no results", () => {
  const text = [
    'Use `<coven:result id="tests" state="passed" label="Focused tests passed" />` in docs.',
    "```xml",
    '<coven:result id="tests" state="failed" label="Should stay literal" />',
    "```",
  ].join("\n");

  const result = extractChatResultMarkers(text);

  assert.equal(result.visible, text);
  assert.deepEqual(result.results, []);
});

test("backticks inside complete marker attributes cannot hide later result markers", () => {
  const text = [
    "Checks complete.",
    '<coven:result id="tests" state="passed" label="`" />',
    '<coven:result id="lint" state="running" label="Lint running" />',
  ].join("\n");

  const result = extractChatResultMarkers(text);

  assert.equal(result.visible, "Checks complete.\n\n");
  assert.deepEqual(result.results, [
    { id: "tests", state: "passed", label: "`", source: "familiar" },
    { id: "lint", state: "running", label: "Lint running", source: "familiar" },
  ]);
});

test("partial trailing result markers stay hidden while pending and after settlement", () => {
  const text = 'Checks complete.\n<coven:result id="tests" state="passed" label="Focused';

  assert.equal(
    extractChatResultMarkers(text, { pending: true }).visible,
    "Checks complete.\n",
  );
  assert.equal(
    extractChatResultMarkers(text, { pending: false }).visible,
    "Checks complete.\n",
  );
});

test("malformed complete markers fail closed and add no result", () => {
  const cases = [
    'Before <coven:result id="tests" state="passed"> after',
    'Before <coven:result state="passed" label="Focused tests passed" /> after',
    'Before <coven:result id="tests" label="Focused tests passed" /> after',
    'Before <coven:result id="" state="passed" label="Focused tests passed" /> after',
    'Before <coven:result id="tests" state="passed" label="" /> after',
    'Before <coven:result id="tests" state="done" label="Focused tests passed" /> after',
    'Before <coven:result id="tests" state="passed" label="Focused tests passed" action="open" /> after',
    'Before <coven:result id="tests" state="passed" label="Focused tests passed" note="extra" /> after',
    'Before <coven:result id="tests" state="passed" label="Focused tests passed" id="again" /> after',
    'Before <coven:result id="tests" state="passed" state="failed" label="Focused tests passed" /> after',
    "Before <coven:result id='tests' state=\"passed\" label=\"Focused tests passed\" /> after",
    "Before <coven:result id=tests state=\"passed\" label=\"Focused tests passed\" /> after",
  ];

  for (const text of cases) {
    const result = extractChatResultMarkers(text);
    assert.equal(result.visible, "Before  after");
    assert.deepEqual(result.results, []);
  }
});

test("oversized ids and labels are rejected and stripped", () => {
  const oversizedId = "i".repeat(RESULT_ID_MAX + 1);
  const oversizedLabel = "l".repeat(RESULT_LABEL_MAX + 1);
  const result = extractChatResultMarkers([
    `Before <coven:result id="${oversizedId}" state="passed" label="Focused tests passed" /> after`,
    `Again <coven:result id="tests" state="passed" label="${oversizedLabel}" /> done`,
  ].join("\n"));

  assert.equal(result.visible, "Before  after\nAgain  done");
  assert.deepEqual(result.results, []);
});
