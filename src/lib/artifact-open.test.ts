// @ts-nocheck
// Behavioral tests for the artifact open-in-tab carrier (cave-e3ia): the
// escaping is the security boundary that keeps untrusted artifact HTML inside
// the sandboxed srcdoc attribute, so it gets exercised for real here.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_CARRIER_SANDBOX,
  buildArtifactCarrierHtml,
  escapeHtmlAttribute,
  openArtifactInTab,
} from "./artifact-open.ts";

test("escapeHtmlAttribute neutralizes every attribute-breaking character", () => {
  assert.equal(
    escapeHtmlAttribute(`"><script>alert(1)</script>&'`),
    "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&#39;",
  );
  // & first: pre-escaped entities must not double-unescape downstream.
  assert.equal(escapeHtmlAttribute("&quot;"), "&amp;quot;");
});

test("carrier confines the artifact to an escaped srcdoc attribute", () => {
  const hostile = `"><iframe src=x onload=alert(document.domain)>`;
  const html = buildArtifactCarrierHtml(hostile);
  // The raw payload must never appear outside the escaped attribute value.
  assert.ok(!html.includes(hostile), "raw artifact HTML must not appear in the carrier");
  assert.ok(
    html.includes(`srcdoc="${escapeHtmlAttribute(hostile)}"`),
    "artifact travels only as the escaped srcdoc value",
  );
  // Exactly one iframe: the carrier's own. A second iframe tag would mean the
  // payload broke out of the attribute.
  assert.equal(html.match(/<iframe\b/g)?.length, 1, "hostile payload must not add elements to the carrier");
});

test("carrier iframe keeps the opaque-origin sandbox boundary", () => {
  const html = buildArtifactCarrierHtml("<h1>hi</h1>");
  assert.ok(html.includes(`sandbox="${ARTIFACT_CARRIER_SANDBOX}"`), "sandbox attribute present");
  assert.ok(!ARTIFACT_CARRIER_SANDBOX.includes("allow-same-origin"), "sandbox must NOT grant same-origin");
  assert.ok(html.includes('referrerpolicy="no-referrer"'), "iframe must not leak a referrer");
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'), "carrier must not leak a referrer");
});

test("openArtifactInTab writes the carrier, closes the doc, and severs opener", () => {
  const writes = [];
  let closed = false;
  const fakeWindow = {
    document: {
      write: (markup) => writes.push(markup),
      close: () => {
        closed = true;
      },
    },
    opener: {},
  };
  const ok = openArtifactInTab("<p>artifact</p>", () => fakeWindow);
  assert.equal(ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0], buildArtifactCarrierHtml("<p>artifact</p>"));
  assert.equal(closed, true, "document must be closed so the page finishes loading");
  assert.equal(fakeWindow.opener, null, "opener must be severed after writing");
});

test("openArtifactInTab reports popup blocking instead of failing silently", () => {
  // The data:-URL predecessor returned null from window.open without throwing,
  // which is exactly how the feature shipped dead (cave-e3ia). Blocking must
  // be observable to the caller.
  assert.equal(openArtifactInTab("<p>x</p>", () => null), false);
});
