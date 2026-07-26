// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./session-trace-overlay.tsx", import.meta.url), "utf8");
// Trace-overlay CSS is component-imported (cave-5rqi / #3264), so its rules
// live in src/styles/session-trace-overlay.css, not the global facade.
const traceCss = readFileSync(new URL("../styles/session-trace-overlay.css", import.meta.url), "utf8");

describe("SessionTraceOverlay", () => {
  it("is the UI consumer of the session events route", () => {
    assert.match(
      source,
      /\/api\/sessions\/\$\{encodeURIComponent\(target\.id\)\}\/events\?afterSeq=/,
      "overlay fetches the daemon event stream for one session",
    );
    assert.match(source, /TRACE_PAGE_SIZE/, "page size rides the shared session-trace constant");
  });

  it("uses the shared Modal (focus trap + escape) rather than a hand-rolled dialog", () => {
    assert.match(source, /import \{ Modal \} from "@\/components\/ui\/modal"/);
    assert.match(source, /<Modal[\s\S]*onClose=\{onClose\}/);
  });

  it("renders a chronological timeline with tone-tinted kind chips", () => {
    assert.match(source, /traceEventTone\(event\.kind\)/, "each event derives a tone");
    assert.match(source, /trace-kind trace-kind--\$\{tone\}/, "kind chip carries the tone class");
    assert.match(source, /summarizeTracePayload\(event\.payload_json\)/, "payloads are distilled to one line");
    assert.match(source, /<details className="trace-item__raw">/, "full payloads stay reachable via disclosure");
    assert.match(traceCss, /\.trace-kind--error\s*\{/, "error tone style exists");
    assert.match(traceCss, /\.trace-item__marker\s*\{/, "timeline markers are styled");
  });

  it("pages with afterSeq instead of refetching from zero", () => {
    assert.match(source, /afterSeq: lastSeq, append: true/, "load-more continues from the last seq");
    assert.match(source, /mergeTraceEvents\(append \? prev : \[\], incoming\)/, "pages merge deduped");
    assert.match(source, /incoming\.length >= TRACE_PAGE_SIZE/, "a full page signals more may exist");
  });

  it("aborts in-flight fetches and degrades errors to a callout", () => {
    assert.match(source, /AbortController/);
    assert.match(source, /abortRef\.current\?\.abort\(\)/);
    assert.match(source, /if \(controller\.signal\.aborted\) return;/, "aborted loads never surface as errors");
    assert.match(source, /role="alert"/, "fetch failures render an alert callout");
  });

  it("keeps an empty session honest — no fake rows", () => {
    assert.match(source, /No events recorded for this session\./);
  });

  it("treats a missing daemon event log as a calm no-log state, not a raw error", () => {
    // Cave-local chats that never ran through the daemon, rows lost on daemon
    // restart, and pruned logs have no event timeline — expected, so the
    // overlay renders an empty state and suppresses the alert callout for it.
    assert.match(
      source,
      /res\.status === 404 \|\| message === "no_event_timeline" \|\| \/\\b404\\b\/\.test\(message\)/,
      "no-log detection keys on the route's 404/no_event_timeline signal, with the legacy 502-message fallback",
    );
    assert.match(source, /setNoEventLog\(true\);\s*\n\s*return;/, "the no-log path never lands in the error state");
    assert.match(source, /No event log for this session\./);
    assert.match(source, /Expected for Cave-local chats/, "the empty state names the expected local-chat case");
    assert.match(source, /\{error && !noEventLog \? \(/, "the alert callout is reserved for real failures");
  });
});
