// @ts-nocheck
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  buildCanvasInspectorScript,
  CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  CANVAS_INSPECTOR_MESSAGE_TYPE,
  injectCanvasInspector,
} from "./canvas-inspector.ts";

class FakeElement {
  nodeType = 1;
  tagName: string;
  id = "";
  textContent = "";
  outerHTML = "";
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  style = { outline: "", outlineOffset: "" };
  attributes = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
}

const scriptTag = buildCanvasInspectorScript();
assert.match(scriptTag, /^<script>/, "returns an inline script tag");
assert.equal((scriptTag.match(/<\/script>/gi) ?? []).length, 1, "script body cannot inject a closing script tag");
assert.doesNotMatch(scriptTag.slice(0, -"</script>".length), /<\/script>/i, "embedded source neutralizes </script>");
assert.doesNotMatch(scriptTag, /parent\.(?:document|location)|document\.cookie/, "does not access parent DOM or cookies");
assert.doesNotMatch(scriptTag, /allow-same-origin/, "does not assume a same-origin sandbox");

const html = "<!doctype html><html><head></head><body><main>x</main></body></html>";
const injected = injectCanvasInspector(html);
assert.ok(injected.includes(scriptTag), "injects the inspector into a full document");
assert.ok(injected.startsWith(html), "the entire original document is an exact prefix");
assert.equal(injected.slice(html.length), `\n${scriptTag}`, "the inspector is appended after the document bytes");

const markerStrings = ["<head>", "</head>", "<body>", "</body>", "<html>", "</html>"];
const preservationCases = [
  [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<title>${markerStrings.join(" title ")}</title>`,
    `<style>/* ${markerStrings.join(" style ")} */ body::before { content: "</body>"; }</style>`,
    "</head>",
    "<body>",
    `<!-- ${markerStrings.join(" comment ")} -->`,
    `<script>const markers = ${JSON.stringify(markerStrings)}; artifactHandler();</script>`,
    `<textarea>${markerStrings.join(" textarea ")}</textarea>`,
    "</body>",
    "</html>",
  ].join("\n"),
  [
    "<!doctype html>",
    "<html>",
    "<head><title>Fallback containers</title></head>",
    "<body>",
    `<iframe src="about:blank">${markerStrings.join(" iframe ")}</iframe>`,
    `<noscript>${markerStrings.join(" noscript ")}</noscript>`,
    `<template><section>${markerStrings.join(" template ")}</section></template>`,
    "</body>",
    "</html>",
  ].join("\n"),
];

for (const source of preservationCases) {
  const result = injectCanvasInspector(source);
  assert.ok(result.startsWith(source), "raw-text, fallback, template, and comment bytes remain an exact prefix");
  assert.equal(result.slice(source.length), `\n${scriptTag}`, "the inspector appears only after the original source");
  assert.equal(result.split(scriptTag).length - 1, 1, "the inspector script is appended exactly once");
}

const listeners = new Map<string, { listener: Function; options?: unknown }>();
const posted: unknown[] = [];
const parentWindow = { postMessage: (message: unknown) => posted.push(message) };
const windowObject = {
  parent: parentWindow,
  addEventListener(type: string, listener: Function) {
    listeners.set(`window:${type}`, { listener });
  },
};
const documentObject = {
  addEventListener(type: string, listener: Function, options?: unknown) {
    listeners.set(`document:${type}`, { listener, options });
  },
  querySelectorAll(selector: string) {
    return queryResults.get(selector) ?? [];
  },
};
const queryResults = new Map<string, FakeElement[]>();

const scriptSource = scriptTag.slice("<script>".length, -"</script>".length);
vm.runInNewContext(scriptSource, {
  window: windowObject,
  document: documentObject,
  CSS: { escape: (value: string) => value.replace(/"/g, '\\"') },
});

assert.equal(listeners.get("document:click")?.options, true, "click interception is registered in capture phase");

const root = new FakeElement("main");
const button = new FakeElement("button");
root.children.push(button);
button.parentElement = root;
button.id = "x".repeat(600);
button.attributes.set("aria-label", "L".repeat(300));
button.outerHTML = `<button id="${button.id}">${"z".repeat(1_500)}</button>`;
queryResults.set("main > button", [button]);

function click(target: FakeElement) {
  const calls: string[] = [];
  listeners.get("document:click")?.listener({
    target,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  });
  return calls;
}

assert.deepEqual(click(button), [], "inspection is inert by default");
assert.equal(posted.length, 0, "inert clicks do not post messages");

listeners.get("window:message")?.listener({
  source: {},
  data: { type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: true },
});
assert.deepEqual(click(button), [], "messages from non-parent sources are ignored");

listeners.get("window:message")?.listener({
  source: parentWindow,
  data: { type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: true },
});
assert.deepEqual(
  click(button),
  ["preventDefault", "stopPropagation", "stopImmediatePropagation"],
  "enabled inspection blocks artifact click handlers",
);
assert.equal(button.style.outline, "2px solid #8b5cf6", "selected element is highlighted");
assert.equal(posted.length, 1);
assert.deepEqual(Object.keys(posted[0] as object), ["type", "target"], "posts only the selected message shape");
const selected = posted[0] as {
  type: string;
  target: { selector: string; label: string; excerpt: string };
};
assert.equal(selected.type, CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE);
assert.equal(selected.target.selector, "main > button", "an oversized id falls back instead of being truncated");
assert.ok(selected.target.selector.length <= 500, "selector matches the sanitizer bound");
assert.ok(selected.target.label.length <= 200, "label matches the sanitizer bound");
assert.ok(selected.target.excerpt.length <= 1_000, "excerpt matches the sanitizer bound");

listeners.get("window:message")?.listener({
  source: parentWindow,
  data: { type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: false },
});
assert.equal(button.style.outline, "", "disabling clears the highlight");
assert.deepEqual(click(button), [], "disabling restores normal clicks");

const list = new FakeElement("ul");
const first = new FakeElement("li");
const second = new FakeElement("li");
list.children.push(first, second);
first.parentElement = list;
second.parentElement = list;
second.attributes.set("data-testid", "result-row");
second.textContent = "Second result";
second.outerHTML = "<li data-testid=\"result-row\">Second result</li>";
queryResults.set('[data-testid="result-row"]', [first, second]);
queryResults.set("ul > li:nth-of-type(2)", [second]);
listeners.get("window:message")?.listener({
  source: parentWindow,
  data: { type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: true },
});
click(second);
assert.equal(
  (posted.at(-1) as { target: { selector: string } }).target.selector,
  "ul > li:nth-of-type(2)",
  "a duplicate data-testid falls back to a unique structural selector",
);

const uniqueById = new FakeElement("button");
uniqueById.id = "save";
uniqueById.outerHTML = '<button id="save">Save</button>';
queryResults.set("#save", [uniqueById]);
click(uniqueById);
assert.equal(
  (posted.at(-1) as { target: { selector: string } }).target.selector,
  "#save",
  "an id is accepted only after unique exact-match verification",
);

const wrongIdTarget = new FakeElement("button");
wrongIdTarget.id = "duplicate";
wrongIdTarget.outerHTML = '<button id="duplicate">Wrong target</button>';
const otherDuplicate = new FakeElement("button");
const section = new FakeElement("section");
section.children.push(wrongIdTarget);
wrongIdTarget.parentElement = section;
queryResults.set("#duplicate", [otherDuplicate]);
queryResults.set("section > button", [wrongIdTarget]);
click(wrongIdTarget);
assert.equal(
  (posted.at(-1) as { target: { selector: string } }).target.selector,
  "section > button",
  "a selector resolving to another element is rejected in favor of structural fallback",
);

const unresolved = new FakeElement("aside");
unresolved.outerHTML = "<aside>Ambiguous</aside>";
let unresolvedRoot = unresolved;
for (let depth = 0; depth < 6; depth += 1) {
  const ancestor = new FakeElement("section");
  ancestor.children.push(unresolvedRoot);
  unresolvedRoot.parentElement = ancestor;
  unresolvedRoot = ancestor;
}
queryResults.set(
  "section > section > section > section > section > section > aside",
  [unresolved],
);
const postedBeforeUnresolved = posted.length;
click(unresolved);
assert.equal(
  posted.length,
  postedBeforeUnresolved,
  "no selected-target message is posted when uniqueness requires ancestry beyond the bound",
);
assert.equal(unresolved.style.outline, "", "an unresolved target is not highlighted");
assert.equal(wrongIdTarget.style.outline, "", "an unresolved selection clears the previous highlight");

console.log("canvas-inspector.test.ts ✓");
