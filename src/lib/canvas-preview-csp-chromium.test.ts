// @ts-nocheck
// Behavioural pin for the preview CSP: a policy is only worth having if the
// browser both HONORS it (no egress) and doesn't over-apply it (our own offline
// runtime still loads). String assertions in canvas-preview-csp.test.ts can't
// tell either way — `'self'` from an opaque origin looks perfectly reasonable
// in a string and blanks every React preview in practice.
//
// Every probe runs twice: once with the policy and once without (the control).
// The control is what proves the harness can actually observe egress, so a
// green run means "blocked", not "the request was never attempted".
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

import { buildPreviewSrcDoc } from "./canvas-artifacts.ts";
import { buildReactSrcDoc, SANDBOX_RUNTIME_SRC, SANDBOX_TAILWIND_SRC } from "./canvas-react-harness.ts";

const executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
  console.log(`canvas-preview-csp-chromium.test.ts skipped: browser not installed at ${executablePath}`);
} else {
  /** Everything the sandbox document tries to pull from us, in order. */
  const hits = [];

  // A stand-in for the real sandbox runtime: proves script-src admits our
  // origin, then attempts the two cheapest exfil channels a sketch has.
  const runtimeStub = `
    parent.postMessage({ type: "runtime-loaded" }, "*");
    try {
      parent.postMessage({ type: "eval-ok", value: new Function("return 21 * 2")() }, "*");
    } catch (err) {
      parent.postMessage({ type: "eval-blocked", message: String(err) }, "*");
    }
    // Same-origin script beacon. script-src has to name our origin for the
    // runtime to load at all, so scoping it to /sandbox/ is the only thing
    // standing between an artifact and a working GET channel back to the app.
    const beaconScript = document.createElement("script");
    beaconScript.onload = () => parent.postMessage({ type: "script-beacon-loaded" }, "*");
    beaconScript.onerror = () => parent.postMessage({ type: "script-beacon-failed" }, "*");
    beaconScript.src = ORIGIN + "/beacon-script?leak=secret";
    document.head.append(beaconScript);
    const img = new Image();
    img.onload = () => parent.postMessage({ type: "img-loaded" }, "*");
    img.onerror = () => parent.postMessage({ type: "img-failed" }, "*");
    img.src = ORIGIN + "/beacon-img";
    fetch(ORIGIN + "/beacon-fetch", { mode: "no-cors" })
      .then(() => parent.postMessage({ type: "fetch-settled" }, "*"))
      .catch(() => parent.postMessage({ type: "fetch-failed" }, "*"));
  `;

  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/") hits.push(path);
    if (path === SANDBOX_RUNTIME_SRC || path === SANDBOX_TAILWIND_SRC) {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(path === SANDBOX_RUNTIME_SRC ? runtimeStub.replace(/ORIGIN/g, JSON.stringify(origin)) : ";");
      return;
    }
    if (path === "/beacon-img") {
      res.writeHead(200, { "content-type": "image/gif" });
      // 1x1 transparent GIF, so a successful load fires onload rather than onerror.
      res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><body><h1>host</h1></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await page.evaluate(() => {
      window.events = [];
      window.addEventListener("message", (event) => window.events.push(event.data));
    });

    /** Mount `srcdoc` in the same opaque-origin sandbox the app uses and
     *  collect what the document managed to do. */
    const run = async (srcdoc, label) => {
      await page.evaluate(({ doc, id }) => {
        const frame = document.createElement("iframe");
        frame.id = id;
        frame.sandbox.add("allow-scripts");
        frame.srcdoc = doc;
        document.body.append(frame);
      }, { doc: srcdoc, id: label });
      await page.waitForFunction(
        () => window.events.some((e) => e?.type === "img-loaded" || e?.type === "img-failed"),
        undefined,
        { timeout: 10_000 },
      ).catch(() => {});
      // Give the fetch probe a beat to settle either way.
      await page.waitForTimeout(300);
      const events = await page.evaluate(() => {
        const seen = window.events;
        window.events = [];
        return seen;
      });
      return events;
    };

    // ── Control: the same document with NO policy (no origin supplied) ──────
    hits.length = 0;
    const controlEvents = await run(buildReactSrcDoc("export default function App(){return null}", "", ""), "control");
    assert.ok(
      controlEvents.some((e) => e?.type === "runtime-loaded"),
      "control: the sandbox runtime loads from our origin",
    );
    assert.ok(controlEvents.some((e) => e?.type === "img-loaded"), "control: a remote image load succeeds");
    assert.ok(hits.includes("/beacon-img"), "control: the beacon reached the server — the probe can observe egress");
    assert.ok(hits.includes("/beacon-fetch"), "control: the fetch reached the server too");
    assert.ok(hits.includes("/beacon-script"), "control: the same-origin script beacon reached the server as well");

    // ── Policy on: the runtime still loads, the beacons never leave ─────────
    hits.length = 0;
    const guardedEvents = await run(
      buildReactSrcDoc("export default function App(){return null}", "", origin),
      "guarded",
    );
    assert.ok(
      guardedEvents.some((e) => e?.type === "runtime-loaded"),
      "the policy names our origin, so the offline runtime still loads — this is what 'self' would have broken",
    );
    assert.ok(
      guardedEvents.some((e) => e?.type === "eval-ok" && e.value === 42),
      "'unsafe-eval' survives: the JSX transpiler mounts components through new Function",
    );
    assert.ok(guardedEvents.some((e) => e?.type === "img-failed"), "the remote image is refused");
    assert.ok(!hits.includes("/beacon-img"), "and the request never reached the network");
    assert.ok(!hits.includes("/beacon-fetch"), "connect-src 'none' stops fetch before it is sent");
    assert.ok(
      !hits.includes("/beacon-script"),
      "scoping script-src to /sandbox/ closes the same-origin script channel that naming the bare origin would leave open",
    );
    assert.ok(
      guardedEvents.some((e) => e?.type === "script-beacon-failed"),
      "and the artifact sees it refused rather than silently pending",
    );

    // ── The HTML path gets the same treatment ──────────────────────────────
    const htmlArtifact = [
      "<!doctype html>",
      "<html><head></head><body>",
      "<script>",
      '  const img = new Image();',
      '  img.onload = () => parent.postMessage({ type: "img-loaded" }, "*");',
      '  img.onerror = () => parent.postMessage({ type: "img-failed" }, "*");',
      `  img.src = ${JSON.stringify(`${origin}/beacon-img`)};`,
      '  parent.postMessage({ type: "inline-ran" }, "*");',
      "</script>",
      "</body></html>",
    ].join("\n");

    hits.length = 0;
    const htmlControl = await run(buildPreviewSrcDoc(htmlArtifact, "", ""), "html-control");
    assert.ok(htmlControl.some((e) => e?.type === "img-loaded"), "control: an HTML artifact can beacon out today");
    assert.ok(hits.includes("/beacon-img"), "control: that beacon reaches the server");

    hits.length = 0;
    const htmlGuarded = await run(buildPreviewSrcDoc(htmlArtifact, "", origin), "html-guarded");
    assert.ok(
      htmlGuarded.some((e) => e?.type === "inline-ran"),
      "'unsafe-inline' survives: an artifact's own inline script still runs",
    );
    assert.ok(htmlGuarded.some((e) => e?.type === "img-failed"), "the HTML artifact's beacon is refused");
    assert.ok(!hits.includes("/beacon-img"), "and never reaches the network");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("canvas-preview-csp-chromium.test.ts ✓");
}
