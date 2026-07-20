// @ts-nocheck
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const inspector = buildCanvasInspectorScript();
  await page.setContent(`
    <script>
      window.events = [];
      window.inspectorPort = null;
      window.addEventListener("message", (event) => {
        if (event.data?.type === ${JSON.stringify(CANVAS_INSPECTOR_READY_MESSAGE_TYPE)}) {
          window.events.push("ready");
          window.inspectorPort = event.ports[0];
          window.inspectorPort.onmessage = (portEvent) => {
            window.events.push(portEvent.data?.type || "unknown");
          };
          window.inspectorPort.start();
        } else if (event.data?.type === "artifact-ran") {
          window.events.push("artifact");
        }
      });
    </script>
  `);
  await page.evaluate((srcdoc) => {
    const frame = document.createElement("iframe");
    frame.id = "normal";
    frame.sandbox.add("allow-scripts");
    frame.srcdoc = srcdoc;
    frame.addEventListener("load", () => {
      window.events.push("frame-load");
      setTimeout(() => window.events.push("load-settled"), 100);
    });
    document.body.append(frame);
  }, `${inspector}<button id="target">Target</button><script>parent.postMessage({type:"artifact-ran"},"*")</script>`);

  await page.waitForFunction(
    (loadedType) => window.events.includes(loadedType),
    CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE,
  );
  const events = await page.evaluate(() => window.events);
  assert.ok(events.indexOf("ready") < events.indexOf("artifact"), "trusted ready precedes artifact script");
  assert.ok(
    events.indexOf("artifact") < events.indexOf(CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE),
    "loaded is sent only from the inspector window.load listener",
  );
  await page.waitForFunction(() => window.events.includes("load-settled"));
  const settledEvents = await page.evaluate(() => window.events);
  assert.ok(
    settledEvents.indexOf(CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE) < settledEvents.indexOf("load-settled"),
    "the navigation fallback lets the retained-port load handshake arrive before classification",
  );

  await page.evaluate((enableType) => {
    window.inspectorPort.postMessage({ type: enableType, enabled: true });
  }, CANVAS_INSPECTOR_MESSAGE_TYPE);
  await page.locator("#normal").contentFrame().locator("#target").click();
  await page.waitForFunction(
    (selectedType) => window.events.includes(selectedType),
    CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  );

  await page.setContent(`
    <script>
      window.events = [];
      window.destinationMessages = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === ${JSON.stringify(CANVAS_INSPECTOR_READY_MESSAGE_TYPE)}) {
          window.events.push("ready");
          window.inspectorPort = event.ports[0];
          window.inspectorPort.onmessage = (portEvent) => window.events.push(portEvent.data?.type || "unknown");
          window.inspectorPort.start();
        } else {
          window.destinationMessages.push(event.data);
        }
      });
    </script>
  `);
  await page.evaluate((srcdoc) => {
    const frame = document.createElement("iframe");
    frame.id = "navigated";
    frame.sandbox.add("allow-scripts");
    frame.srcdoc = srcdoc;
    document.body.append(frame);
  }, `${inspector}<script>location.replace("about:blank")</script>`);
  await page.waitForFunction(() => window.events.includes("ready"));
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() => window.events),
    ["ready"],
    "immediate pre-load navigation prevents the inspector loaded signal",
  );
  assert.equal(
    await page.evaluate(() => document.querySelector("#navigated").contentWindow.location.href).catch(() => "opaque"),
    "opaque",
    "the opaque destination exposes no parent-readable state or transferred port",
  );

  await page.setContent(injectCanvasInspector("<!-- banner --><!doctype html><html><body>standards</body></html>"));
  assert.equal(await page.evaluate(() => document.compatMode), "CSS1Compat", "leading comments preserve standards mode");
} finally {
  await browser.close();
}

console.log("canvas-inspector-chromium.test.ts ✓");
