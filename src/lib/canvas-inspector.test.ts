// @ts-nocheck
import assert from "node:assert/strict";
import vm from "node:vm";

import * as inspector from "./canvas-inspector.ts";

const {
  buildCanvasInspectorScript,
  CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE,
  CANVAS_INSPECTOR_MESSAGE_TYPE,
  CANVAS_INSPECTOR_READY_MESSAGE_TYPE,
  injectCanvasInspector,
} = inspector;

assert.equal(typeof CANVAS_INSPECTOR_READY_MESSAGE_TYPE, "string", "ready bootstrap type is exported");
assert.equal(typeof CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE, "string", "loaded handshake type is exported");

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

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getClientRects() {
    return [{}];
  }
}

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  started = false;
  peer: FakePort | null = null;

  postMessage(message: unknown) {
    if (this.closed) return;
    this.posted.push(message);
    this.peer?.receive(message);
  }

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  receive(data: unknown) {
    if (!this.closed) this.onmessage?.({ data });
  }
}

const scriptTag = buildCanvasInspectorScript();
assert.match(scriptTag, /^<script>/, "returns an inline script tag");
assert.equal((scriptTag.match(/<\/script>/gi) ?? []).length, 1, "script body cannot inject a closing script tag");
assert.doesNotMatch(scriptTag.slice(0, -"</script>".length), /<\/script>/i, "embedded source neutralizes </script>");
assert.doesNotMatch(scriptTag, /parent\.(?:document|location)|document\.cookie/, "does not access parent DOM or cookies");
assert.doesNotMatch(scriptTag, /allow-same-origin/, "does not assume a same-origin sandbox");
assert.match(scriptTag, /new MessageChannel\(\)/, "the trusted inspector creates its own channel");
assert.match(scriptTag, new RegExp(CANVAS_INSPECTOR_READY_MESSAGE_TYPE), "the trusted inspector posts ready immediately");
assert.match(scriptTag, new RegExp(CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE), "the trusted inspector authenticates window load");
assert.doesNotMatch(scriptTag, /cave-canvas-inspector-connect/, "the parent-to-child port transfer is removed");
assert.doesNotMatch(
  scriptTag,
  /querySelectorAll\(["']body \*["']\)/,
  "keyboard promotion does not scan and promote every body descendant",
);

const html = "<!doctype html><html><head><script>artifactHandler()</script></head><body><main>x</main></body></html>";
const injected = injectCanvasInspector(html);
const doctype = "<!doctype html>";
assert.equal(
  injected,
  `${doctype}${scriptTag}${html.slice(doctype.length)}`,
  "inspector executes immediately after a leading doctype without changing any artifact byte",
);
assert.ok(
  injected.indexOf(scriptTag) < injected.indexOf("artifactHandler()"),
  "inspector parser order precedes artifact scripts",
);
assert.equal(
  injectCanvasInspector("<main>x</main>"),
  `${scriptTag}<main>x</main>`,
  "documents without a leading doctype receive the inspector first",
);
const commentedDoctype = "\n<!-- generated artifact -->\n<!doctype html><html><body>x</body></html>";
const commentedDoctypeEnd = commentedDoctype.indexOf(">", commentedDoctype.indexOf("<!doctype")) + 1;
assert.equal(
  injectCanvasInspector(commentedDoctype),
  `${commentedDoctype.slice(0, commentedDoctypeEnd)}${scriptTag}${commentedDoctype.slice(commentedDoctypeEnd)}`,
  "leading comments stay before the doctype while the inspector remains standards-mode safe",
);

const markerStrings = ["<head>", "</head>", "<body>", "</body>", "<html>", "</html>"];
const preservationCases = [
  [
    " \n<!DOCTYPE HTML PUBLIC \"legacy\">",
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
  assert.equal(
    result.replace(scriptTag, ""),
    source,
    "removing the one inserted inspector recovers every original artifact byte",
  );
  assert.equal(result.split(scriptTag).length - 1, 1, "the inspector script is inserted exactly once");
  if (source.includes("artifactHandler")) {
    assert.ok(result.indexOf(scriptTag) < result.indexOf("artifactHandler"), "inspector remains before artifact code");
  }
}

const listeners = new Map<string, Array<{ listener: Function; options?: unknown }>>();
const queryResults = new Map<string, FakeElement[]>();
let keyboardCandidates: FakeElement[] = [];
let readyMessage: unknown = null;
let transferredPort: FakePort | null = null;
const parentWindow = {
  postMessage(message: unknown, _target: string, ports: FakePort[]) {
    readyMessage = message;
    transferredPort = ports[0] ?? null;
  },
};
const addListener = (scope: string, type: string, listener: Function, options?: unknown) => {
  const key = `${scope}:${type}`;
  listeners.set(key, [...(listeners.get(key) ?? []), { listener, options }]);
};
const windowObject = {
  parent: parentWindow,
  CSS: { escape: (value: string) => value.replace(/"/g, '\\"') },
  addEventListener(type: string, listener: Function, options?: unknown) {
    addListener("window", type, listener, options);
  },
  getComputedStyle() {
    return { display: "block", visibility: "visible" };
  },
};
const documentObject = {
  addEventListener(type: string, listener: Function, options?: unknown) {
    addListener("document", type, listener, options);
  },
  querySelectorAll(selector: string) {
    return queryResults.get(selector)
      ?? (selector.includes("[data-testid]") ? keyboardCandidates : []);
  },
};

const scriptSource = scriptTag.slice("<script>".length, -"</script>".length);
vm.runInNewContext(scriptSource, {
  window: windowObject,
  document: documentObject,
  CSS: windowObject.CSS,
  MessageChannel: class FakeMessageChannel {
    port1 = new FakePort();
    port2 = new FakePort();

    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  },
  Map,
  Set,
  Array,
  String,
});

assert.equal(
  JSON.stringify(readyMessage),
  JSON.stringify({ type: CANVAS_INSPECTOR_READY_MESSAGE_TYPE, generation: "" }),
  "the trusted script posts its bootstrap immediately",
);
assert.ok(transferredPort, "the bootstrap transfers one child-created port");
assert.equal(listeners.get("document:click")?.[0]?.options, true, "click interception is registered in capture phase");
assert.equal(listeners.get("document:keydown")?.[0]?.options, true, "keyboard interception is registered in capture phase");

const parentMessages: unknown[] = [];
transferredPort!.onmessage = (event) => parentMessages.push(event.data);
transferredPort!.start();
assert.deepEqual(parentMessages, [], "loaded is not sent during bootstrap");
for (const { listener } of listeners.get("window:load") ?? []) listener({});
assert.equal(
  JSON.stringify(parentMessages),
  JSON.stringify([{ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE }]),
  "loaded is sent only from the inspector's own window.load listener",
);

const root = new FakeElement("main");
root.textContent = "Main content";
root.outerHTML = "<main>Main content</main>";
const button = new FakeElement("button");
root.children.push(button);
button.parentElement = root;
button.id = "x".repeat(600);
button.attributes.set("aria-label", "L".repeat(300));
button.outerHTML = `<button id="${button.id}">${"z".repeat(1_500)}</button>`;
const staticCard = new FakeElement("p");
staticCard.textContent = "Static card";
staticCard.outerHTML = "<p>Static card</p>";
staticCard.attributes.set("tabindex", "-1");
const wrapper = new FakeElement("div");
wrapper.textContent = "Nested title Save details";
const nestedCard = new FakeElement("div");
nestedCard.textContent = "Save details";
const heading = new FakeElement("h2");
heading.textContent = "Nested title";
const paragraph = new FakeElement("p");
paragraph.textContent = "Details";
const leafText = new FakeElement("span");
leafText.textContent = "Leaf label";
const emptyLeaf = new FakeElement("span");
const labelledWrapper = new FakeElement("div");
labelledWrapper.textContent = "Labelled group";
labelledWrapper.attributes.set("aria-label", "Labelled group");
wrapper.children.push(heading, nestedCard);
heading.parentElement = wrapper;
nestedCard.parentElement = wrapper;
nestedCard.children.push(button, paragraph, leafText, emptyLeaf);
button.parentElement = nestedCard;
paragraph.parentElement = nestedCard;
leafText.parentElement = nestedCard;
emptyLeaf.parentElement = nestedCard;
keyboardCandidates = [
  root,
  button,
  staticCard,
  wrapper,
  nestedCard,
  heading,
  paragraph,
  leafText,
  emptyLeaf,
  labelledWrapper,
];
queryResults.set("div > div > button", [button]);
queryResults.set("p", [staticCard]);

function dispatchDocument(type: string, target: FakeElement, key?: string) {
  const calls: string[] = [];
  const event = {
    target,
    key,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  };
  for (const { listener } of listeners.get(`document:${type}`) ?? []) listener(event);
  return calls;
}

assert.deepEqual(dispatchDocument("click", button), [], "inspection is inert before the owned port enables it");
assert.equal(parentMessages.length, 1, "window messages cannot forge a selected target");

transferredPort!.postMessage({ type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: true });
assert.equal(staticCard.getAttribute("tabindex"), "0", "visible static candidates become keyboard focusable");
assert.equal(wrapper.getAttribute("tabindex"), null, "generic outer wrappers are not promoted for descendant text");
assert.equal(nestedCard.getAttribute("tabindex"), null, "generic nested wrappers are not promoted for descendant text");
assert.equal(heading.getAttribute("tabindex"), "0", "headings remain keyboard selectable");
assert.equal(paragraph.getAttribute("tabindex"), "0", "paragraphs remain keyboard selectable");
assert.equal(leafText.getAttribute("tabindex"), "0", "leaf-level visible text remains keyboard selectable");
assert.equal(emptyLeaf.getAttribute("tabindex"), null, "empty generic leaves are skipped");
assert.equal(labelledWrapper.getAttribute("tabindex"), "0", "explicit aria-labelled targets remain selectable");
assert.deepEqual(
  dispatchDocument("click", button),
  ["preventDefault", "stopPropagation", "stopImmediatePropagation"],
  "enabled inspection blocks artifact click handlers",
);
assert.equal(button.style.outline, "2px solid #8b5cf6", "selected element is highlighted");
const selected = parentMessages.at(-1) as {
  type: string;
  target: { selector: string; label: string; excerpt: string };
};
assert.equal(selected.type, CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE);
assert.equal(selected.target.selector, "div > div > button", "an oversized id falls back instead of being truncated");
assert.ok(selected.target.selector.length <= 500, "selector matches the sanitizer bound");
assert.ok(selected.target.label.length <= 200, "label matches the sanitizer bound");
assert.ok(selected.target.excerpt.length <= 1_000, "excerpt matches the sanitizer bound");

dispatchDocument("focusin", staticCard);
assert.equal(staticCard.style.outline, "2px solid #8b5cf6", "keyboard focus uses the same highlight");
assert.deepEqual(
  dispatchDocument("keydown", staticCard, "Enter"),
  ["preventDefault", "stopPropagation", "stopImmediatePropagation"],
  "Enter selects the focused candidate and intercepts activation",
);
assert.equal((parentMessages.at(-1) as { target: { selector: string } }).target.selector, "p");
dispatchDocument("keydown", staticCard, " ");
assert.equal(parentMessages.length, 4, "Space also selects over the authenticated port");

transferredPort!.postMessage({ type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: false });
assert.equal(staticCard.getAttribute("tabindex"), "-1", "disabling restores the candidate's prior tabindex");
assert.equal(staticCard.style.outline, "", "disabling clears the highlight");
assert.deepEqual(dispatchDocument("click", button), [], "disabling restores normal controls");

console.log("canvas-inspector.test.ts ✓");
