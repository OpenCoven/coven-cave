import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coverageLead,
  markdownTable,
  pairSpans,
  parseCycleWindow,
  parseSpanEvents,
  percentile,
  spansInWindow,
  summarize,
  traceStartSeconds,
} from "./ios-performance-trace.mjs";
import { attachPlan, withJsonOutput } from "./ios-performance-capture.mjs";

/**
 * A synthetic `os-signpost-arg` export with the real shape: shared values
 * are defined once with `id` and reused with `ref`, a nested thread element,
 * and two `string` children per row (the argument name, then its value).
 */
function exportXml(rows) {
  let nextId = 100;
  const ids = new Map();
  const cell = (tag, value) => {
    const key = `${tag}:${value}`;
    if (ids.has(key)) return `<${tag} ref="${ids.get(key)}"/>`;
    const id = String(nextId++);
    ids.set(key, id);
    return `<${tag} id="${id}" fmt="${value}">${value}</${tag}>`;
  };
  const body = rows.map(({ ns, message, subsystem = "ai.opencoven.cave" }) => [
    "<row>",
    `<event-time id="${nextId++}" fmt="t">${ns}</event-time>`,
    cell("format-string", "%{public}s"),
    cell("signpost-name", "Measure"),
    cell("string", "arg0"),
    `<thread id="${nextId++}" fmt="Main Thread"><tid id="${nextId++}" fmt="0x1">1</tid><process id="${nextId++}" fmt="Coven Cave (7)"><pid id="${nextId++}" fmt="7">7</pid></process></thread>`,
    cell("subsystem", subsystem),
    cell("category", "PointsOfInterest"),
    cell("string", message),
    "</row>",
  ].join("")).join("\n");
  return `<?xml version="1.0"?><trace-query-result><node><schema name="os-signpost-arg"/>${body}</node></trace-query-result>`;
}

const START = 1_000;

test("span events resolve shared values and keep only Cave's spans, in time order", () => {
  const xml = exportXml([
    { ns: 2_000_000_000, message: "span=drawer.open phase=end" },
    { ns: 1_000_000_000, message: "span=drawer.open phase=begin" },
    { ns: 1_500_000_000, message: "span=drawer.open phase=begin", subsystem: "com.apple.UIKit" },
    { ns: 1_600_000_000, message: "Interface orientation changed to Portrait" },
    { ns: 3_000_000_000, message: "span=drawer.open phase=begin" },
  ]);
  assert.deepEqual(parseSpanEvents(xml, START), [
    { at: 1_001, span: "drawer.open", phase: "begin" },
    { at: 1_002, span: "drawer.open", phase: "end" },
    { at: 1_003, span: "drawer.open", phase: "begin" },
  ]);
});

test("pairing matches begins to ends per name and drops cancelled work", () => {
  const events = [
    { at: 10, span: "search.query", phase: "begin" },
    { at: 10.2, span: "search.query", phase: "cancel" },
    { at: 11, span: "search.query", phase: "begin" },
    { at: 11.05, span: "drawer.open", phase: "begin" },
    { at: 11.1, span: "search.query", phase: "end" },
    { at: 11.2, span: "drawer.open", phase: "end" },
    { at: 12, span: "drawer.open", phase: "end" },
  ];
  const { spans, cancelled } = pairSpans(events);
  assert.deepEqual(spans.map((s) => [s.span, s.begin, Math.round(s.durationMs)]), [
    ["search.query", 11, 100],
    ["drawer.open", 11.05, 150],
  ]);
  assert.deepEqual(cancelled, [{ span: "search.query", begin: 10 }]);
});

test("only spans wholly inside the warm window count", () => {
  const paired = {
    spans: [
      { span: "a", begin: 4.9, durationMs: 1 },
      { span: "a", begin: 5, durationMs: 2 },
      { span: "a", begin: 9.9, durationMs: 50 },
      { span: "a", begin: 9.99, durationMs: 50 },
      { span: "a", begin: 10.1, durationMs: 4 },
    ],
    cancelled: [{ span: "a", begin: 6 }, { span: "a", begin: 11 }],
  };
  const inside = spansInWindow(paired, { start: 5, end: 10 });
  assert.deepEqual(inside.spans.map((s) => s.begin), [5, 9.9], "a span ending after the window belongs to no cycle");
  assert.deepEqual(inside.cancelled.map((c) => c.begin), [6]);
});

test("coverage lead is negative when the recording lost the start of the window", () => {
  const events = [{ at: 50, span: "a", phase: "begin" }];
  assert.equal(coverageLead(events, { start: 57, end: 100 }), 7);
  assert.equal(coverageLead(events, { start: 45, end: 100 }), -5);
  assert.equal(coverageLead([], { start: 45, end: 100 }), -Infinity);
});

test("percentiles use the nearest rank and summaries pool every round", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19);
  assert.equal(percentile([7], 0.95), 7);

  const rows = summarize([
    { spans: [{ span: "b", durationMs: 4 }, { span: "a", durationMs: 1 }], cancelled: [{ span: "a" }] },
    { spans: [{ span: "a", durationMs: 3 }, { span: "a", durationMs: 2 }], cancelled: [] },
  ]);
  assert.deepEqual(rows, [
    { span: "a", count: 3, medianMs: 2, p95Ms: 3, maxMs: 3, cancelled: 1 },
    { span: "b", count: 1, medianMs: 4, p95Ms: 4, maxMs: 4, cancelled: 0 },
  ]);
  assert.equal(summarize([{ spans: [{ span: "a", durationMs: 1 }, { span: "a", durationMs: 4 }], cancelled: [] }])[0].medianMs, 2.5);
  assert.match(markdownTable(rows, 2), /\| `a` \(1 cancelled, not counted\) \| 3 \| 2\.0 \| 3\.0 \| 3\.0 \|/);
});

test("cycle windows and trace start dates parse, and bad input is refused", () => {
  assert.deepEqual(
    parseCycleWindow('{"phase":"warm","cycle":1,"startUnixSeconds":1790485853.97,"endUnixSeconds":1790485896.78}'),
    { phase: "warm", cycle: 1, start: 1790485853.97, end: 1790485896.78 },
  );
  assert.equal(parseCycleWindow('{"phase":"warm"}'), null);
  assert.equal(traceStartSeconds("<start-date>2026-09-27T00:58:13.629-05:00</start-date>"), 1790488693.629);
  assert.throws(() => traceStartSeconds("<toc/>"), /no start-date/);
});

test("devicectl JSON output never lands among an app's launch arguments", () => {
  assert.deepEqual(
    withJsonOutput(["device", "process", "launch", "--device", "D", "--terminate-existing", "ai.opencoven.cave", "--performance-fixture"], "/tmp/o.json"),
    ["device", "process", "launch", "--device", "D", "--json-output", "/tmp/o.json", "--terminate-existing", "ai.opencoven.cave", "--performance-fixture"],
  );
  assert.throws(() => withJsonOutput(["device", "info"], "/tmp/o.json"), /--device/);
});

test("the attach plan runs one warm cycle against the installed, running app", () => {
  const generated = {
    CovenCaveUITests: {
      EnvironmentVariables: { OS_ACTIVITY_DT_MODE: "YES" },
      OnlyTestIdentifiers: ["PerformanceBaselineUITests"],
      TestBundlePath: "__TESTHOST__/PlugIns/CovenCaveUITests.xctest",
      TestHostPath: "__TESTROOT__/Release-iphoneos/CovenCaveUITests-Runner.app",
      UITargetAppPath: "__TESTROOT__/Release-iphoneos/CovenCave.app",
      UserAttachmentLifetime: "deleteOnSuccess",
    },
    __xctestrun_metadata__: { FormatVersion: 1 },
  };
  const plan = attachPlan(generated);
  assert.deepEqual(plan.CovenCaveUITests, {
    EnvironmentVariables: {
      OS_ACTIVITY_DT_MODE: "YES",
      CAVE_PERFORMANCE_REPETITIONS: "1",
      CAVE_PERFORMANCE_ATTACH_RUNNING: "1",
    },
    OnlyTestIdentifiers: ["PerformanceBaselineUITests/testCurrentShellWarmJourneys"],
    UseDestinationArtifacts: true,
    UITargetAppBundleIdentifier: "ai.opencoven.cave",
    TestBundleDestinationRelativePath: "__TESTHOST__/PlugIns/CovenCaveUITests.xctest",
    UserAttachmentLifetime: "keepAlways",
  });
  assert.equal(plan.__xctestrun_metadata__.FormatVersion, 1);
  assert.equal(generated.CovenCaveUITests.TestHostPath, "__TESTROOT__/Release-iphoneos/CovenCaveUITests-Runner.app", "the generated plan is not mutated");
  assert.throws(() => attachPlan({}), /CovenCaveUITests/);
});
