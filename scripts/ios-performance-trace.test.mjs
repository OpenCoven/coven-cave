import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HITCH_BUDGET_MS,
  coverageLead,
  hitchTable,
  hitchesBySpan,
  hitchesInWindow,
  markdownTable,
  pairSpans,
  parseCycleWindow,
  parseFrames,
  parseHitches,
  parseSpanEvents,
  parseTableRows,
  percentile,
  spansInWindow,
  summarize,
  summarizeHitches,
  traceStartSeconds,
} from "./ios-performance-trace.mjs";
import { attachPlan, isCoveredRound, recordArgs, recordingInstruments, withJsonOutput } from "./ios-performance-capture.mjs";

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

test("overlapping intervals of one name are reported, never guessed", () => {
  // Two bubbles each start a first-rich-render; an exclusive signpost id gives
  // no way to tell which end closes which begin.
  const { spans, ambiguous } = pairSpans([
    { at: 1, span: "chat.first-rich-render", phase: "begin" },
    { at: 1.1, span: "chat.first-rich-render", phase: "begin" },
    { at: 1.2, span: "chat.first-rich-render", phase: "end" },
    { at: 1.5, span: "chat.first-rich-render", phase: "end" },
    { at: 2, span: "chat.first-rich-render", phase: "begin" },
    { at: 2.25, span: "chat.first-rich-render", phase: "end" },
  ]);
  assert.deepEqual(ambiguous, [
    { span: "chat.first-rich-render", begin: 1 },
    { span: "chat.first-rich-render", begin: 1.1 },
  ]);
  assert.deepEqual(spans.map((s) => [s.begin, Math.round(s.durationMs)]), [[2, 250]], "a later lone interval still pairs");
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
    ambiguous: [{ span: "a", begin: 7 }, { span: "a", begin: 12 }],
  };
  const inside = spansInWindow(paired, { start: 5, end: 10 });
  assert.deepEqual(inside.ambiguous.map((a) => a.begin), [7]);
  assert.deepEqual(inside.spans.map((s) => s.begin), [5, 9.9], "a span ending after the window belongs to no cycle");
  assert.deepEqual(inside.cancelled.map((c) => c.begin), [6]);
});

test("coverage lead is negative when the recording lost the start of the window", () => {
  const events = [{ at: 50, span: "a", phase: "begin" }];
  assert.equal(coverageLead(events, { start: 57, end: 100 }), 7);
  assert.equal(coverageLead(events, { start: 45, end: 100 }), -5);
  assert.equal(coverageLead([], { start: 45, end: 100 }), -Infinity);
});

test("round coverage requires all cold drawer spans and a positive warm lead", () => {
  const drawerSpans = (count) => Array.from({ length: count }, () => ({ span: "drawer.open" }));
  assert.equal(isCoveredRound({ phase: "cold-app-launch", lead: -Infinity, spans: drawerSpans(3) }), false);
  assert.equal(isCoveredRound({ phase: "cold-app-launch", lead: -Infinity, spans: drawerSpans(4) }), true);
  assert.equal(isCoveredRound({ phase: "warm", lead: 0, spans: [{ span: "drawer.open" }] }), false);
  assert.equal(isCoveredRound({ phase: "warm", lead: 1, spans: [{ span: "drawer.open" }] }), true);
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
    { span: "a", count: 3, medianMs: 2, p95Ms: 3, maxMs: 3, cancelled: 1, ambiguous: 0 },
    { span: "b", count: 1, medianMs: 4, p95Ms: 4, maxMs: 4, cancelled: 0, ambiguous: 0 },
  ]);
  assert.equal(summarize([{ spans: [{ span: "a", durationMs: 1 }, { span: "a", durationMs: 4 }], cancelled: [] }])[0].medianMs, 2.5);
  assert.match(markdownTable(rows, 2), /\| `a` \(1 cancelled, not counted\) \| 3 \| 2\.0 \| 3\.0 \| 3\.0 \|/);
});

test("a boundary with no completed sample is still reported", () => {
  const rows = summarize([
    { spans: [], cancelled: [{ span: "search.query" }, { span: "search.query" }], ambiguous: [{ span: "chat.first-rich-render" }] },
  ]);
  assert.deepEqual(rows, [
    { span: "chat.first-rich-render", count: 0, medianMs: null, p95Ms: null, maxMs: null, cancelled: 0, ambiguous: 1 },
    { span: "search.query", count: 0, medianMs: null, p95Ms: null, maxMs: null, cancelled: 2, ambiguous: 0 },
  ]);
  const table = markdownTable(rows, 1);
  assert.match(table, /\| `search\.query` \(2 cancelled, not counted\) \| 0 \| — \| — \| — \|/);
  assert.match(table, /`chat\.first-rich-render` \(1 overlapping, unpaired, not counted\)/);
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

/**
 * A synthetic export of one Hitches table with the column order Xcode 27.2's
 * `xctrace export` writes. Shared cells are defined once and reused by `ref`,
 * a process cell nests its pid, and `null` writes an empty `<sentinel/>`.
 */
function hitchTableXml(schema, columns, rows) {
  let nextId = 1;
  const ids = new Map();
  const cell = (tag, value, inner = "") => {
    if (value === null) return "<sentinel/>";
    const key = `${tag}:${value}`;
    if (ids.has(key)) return `<${tag} ref="${ids.get(key)}"/>`;
    const id = String(nextId++);
    ids.set(key, id);
    return `<${tag} id="${id}" fmt="${value}">${inner || value}</${tag}>`;
  };
  const head = columns.map(([mnemonic]) => `<col><mnemonic>${mnemonic}</mnemonic><name>${mnemonic}</name></col>`).join("");
  const body = rows.map((row) => `<row>${columns.map(([mnemonic, tag]) => {
    const value = row[mnemonic] ?? null;
    if (tag === "process" && value !== null) {
      const pid = /\((\d+)\)/.exec(value)[1];
      return cell(tag, value, `<pid id="${nextId++}" fmt="${pid}">${pid}</pid>`);
    }
    return cell(tag, value);
  }).join("")}</row>`).join("\n");
  return `<?xml version="1.0"?><trace-query-result><node xpath='//trace-toc[1]/run[1]/data[1]/table[8]'><schema name="${schema}">${head}</schema>${body}</node></trace-query-result>`;
}

const HITCH_COLUMNS = [
  ["start", "start-time"], ["duration", "duration"], ["process", "process"], ["is-system", "boolean"],
  ["swap-id", "uint32"], ["label", "string"], ["display", "display-name"], ["narrative-description", "string"],
];
const FRAME_COLUMNS = [
  ["start", "start-time"], ["duration", "duration"], ["display", "display-name"], ["swap-id", "uint32"],
  ["surface-id", "uint32"], ["frame-color", "event-concept"], ["layout-qualifier", "layout-id"], ["label", "string"],
];
const hitchesXml = (rows) => hitchTableXml("hitches", HITCH_COLUMNS, rows);
const framesXml = (rows) => hitchTableXml("hitches-frame-lifetimes", FRAME_COLUMNS, rows);
const hitchRow = (startNs, durationNs, process, system = "0") => ({
  start: startNs, duration: durationNs, process, "is-system": system, "swap-id": startNs, label: "0x1", display: "Display 1",
  "narrative-description": "Potential Issue: Expensive commit",
});

test("table rows are keyed by column, resolve shared cells, and keep sentinel columns aligned", () => {
  const rows = parseTableRows(hitchesXml([
    hitchRow(1_000, 5_000_000, "CovenCave (412)"),
    { ...hitchRow(2_000, 5_000_000, "CovenCave (412)"), "is-system": null },
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].duration, { fmt: "5000000", text: "5000000" }, "a repeated duration resolves its ref");
  assert.equal(rows[1].process.fmt, "CovenCave (412)");
  assert.equal(rows[1]["is-system"], null);
  assert.equal(rows[1]["swap-id"].text, "2000", "columns after a sentinel stay aligned");
  assert.deepEqual(parseTableRows("<trace-query-result/>"), []);
});

test("hitches are timed from the trace start and attributed to the measured process", () => {
  const xml = hitchesXml([
    hitchRow(3_000_000_000, 120_000_000, "backboardd (60)", "1"),
    hitchRow(1_000_000_000, 42_500_000, "CovenCave (412)"),
  ]);
  assert.deepEqual(parseHitches(xml, START, { pid: 412 }), [
    { at: 1_001, durationMs: 42.5, pid: 412, own: true, system: false },
    { at: 1_003, durationMs: 120, pid: 60, own: false, system: true },
  ]);
  assert.ok(parseHitches(xml, START).every((hitch) => hitch.own), "without a known PID no hitch is hidden");
});

test("rendered frames come from the frame-lifetimes table", () => {
  const frames = parseFrames(framesXml([
    { start: 2_000_000_000, duration: 16_000_000, display: "Display 1", "swap-id": 2, "surface-id": 14, "frame-color": "Green", "layout-qualifier": 0, label: "0x2" },
    { start: 1_000_000_000, duration: 16_000_000, display: "Display 1", "swap-id": 1, "surface-id": 14, "frame-color": "Green", "layout-qualifier": 0, label: "0x1" },
  ]), START);
  assert.deepEqual(frames.map((f) => [f.at, Math.round((f.end - f.at) * 1000)]), [[1_001, 16], [1_002, 16]]);
});

test("each span takes the hitches that overlap it, and a span with no frame is unobserved", () => {
  const spans = [
    { span: "drawer.open", begin: 10, durationMs: 80 },
    { span: "destination.stable-frame", begin: 11, durationMs: 70 },
    { span: "search.query", begin: 12, durationMs: 60 },
  ];
  const hitchData = {
    recorded: true,
    hitches: [
      { at: 9.95, durationMs: 60, own: true },
      { at: 10.05, durationMs: 30, own: true },
      { at: 10.5, durationMs: 200, own: true },
      { at: 11.02, durationMs: 12, own: false },
    ],
    frames: [{ at: 10.02, end: 10.036 }, { at: 11.03, end: 11.046 }],
  };
  assert.deepEqual(hitchesBySpan(spans, hitchData), [
    { span: "drawer.open", recorded: true, observed: true, hitches: [60, 30], other: 0 },
    { span: "destination.stable-frame", recorded: true, observed: true, hitches: [], other: 1 },
    { span: "search.query", recorded: true, observed: false, hitches: [], other: 0 },
  ]);
  assert.deepEqual(hitchesBySpan(spans.slice(0, 1), { recorded: false, hitches: [], frames: [] }), [
    { span: "drawer.open", recorded: false, observed: false, hitches: [], other: 0 },
  ]);
  assert.deepEqual(hitchesInWindow({ start: 10, end: 12 }, hitchData), {
    span: "(cycle window)", recorded: true, observed: true, hitches: [60, 30, 200], other: 1,
  });
});

test("hitch summaries pool rounds and judge the longest hitch against the < 100 ms budget", () => {
  assert.equal(HITCH_BUDGET_MS, 100);
  const entry = (span, hitches, { observed = true, recorded = true, other = 0 } = {}) => ({ span, recorded, observed, hitches, other });
  const rows = summarizeHitches([
    [entry("drawer.open", [40]), entry("search.query", [100]), entry("chat.first-rich-render", [], { observed: false }), entry("(cycle window)", [40, 100])],
    [entry("drawer.open", [], { other: 2 }), entry("search.query", []), entry("chat.first-rich-render", []), entry("destination.stable-frame", [], { observed: false }), entry("(cycle window)", [])],
    [entry("drawer.open", [], { recorded: false, observed: false })],
  ]);
  assert.deepEqual(rows.map((r) => [r.span, r.spans, r.observed, r.notRecorded, r.hitchCount, r.spansWithHitch, r.longestMs, r.otherProcess, r.verdict]), [
    ["chat.first-rich-render", 2, 1, 0, 0, 0, null, 0, "met where observed"],
    ["destination.stable-frame", 1, 0, 0, 0, 0, null, 0, "unobserved"],
    ["drawer.open", 3, 2, 1, 1, 1, 40, 2, "met where observed"],
    ["search.query", 2, 2, 0, 1, 1, 100, 0, "violated"],
    ["(cycle window)", 2, 2, 0, 2, 1, 100, 0, "violated"],
  ]);
  const table = hitchTable(rows, 3, "cold");
  assert.match(table, /^\| span \(cold, 3 cycles\) \| spans \| observed \| hitches \| spans with a hitch \| longest hitch ms \| < 100 ms \|/);
  assert.match(table, /\| `drawer\.open` \(1 not recorded; 2 other-process hitches, not counted\) \| 3 \| 2 \| 1 \| 1 \| 40\.0 \| met where observed \|/);
  assert.match(table, /\| `search\.query` \| 2 \| 2 \| 1 \| 1 \| 100\.0 \| violated \|/);
  assert.match(table, /\| \(cycle window\) \| 2 \| 2 \| 2 \| 1 \| 100\.0 \| violated \|/);
});

test("a capture recorded without Hitches says so instead of reporting zero hitches", () => {
  const notRecorded = { recorded: false, hitches: [], frames: [] };
  const spans = [{ span: "drawer.open", begin: 1, durationMs: 50 }];
  const rows = summarizeHitches([
    [...hitchesBySpan(spans, notRecorded), hitchesInWindow({ start: 0, end: 5 }, notRecorded)],
  ]);
  assert.deepEqual(rows.map((r) => [r.span, r.hitchCount, r.verdict]), [["drawer.open", 0, "not recorded"], ["(cycle window)", 0, "not recorded"]]);
  assert.match(hitchTable(rows, 1), /\| `drawer\.open` \| 1 \| 0 \| 0 \| 0 \| — \| not recorded \|/);
});

test("an exported trace becomes per-span hitch verdicts end to end", () => {
  // Trace starts at START; a drawer span at +1.0 s for 90 ms hitches for 130 ms,
  // a search span at +2.0 s renders without hitching.
  const hitches = parseHitches(hitchesXml([hitchRow(1_010_000_000, 130_000_000, "CovenCave (412)")]), START, { pid: 412 });
  const frames = parseFrames(framesXml([
    { start: 1_020_000_000, duration: 16_000_000, display: "Display 1", "swap-id": 1, "surface-id": 14, "frame-color": "Red", "layout-qualifier": 0, label: "0x1" },
    { start: 2_020_000_000, duration: 16_000_000, display: "Display 1", "swap-id": 2, "surface-id": 14, "frame-color": "Green", "layout-qualifier": 0, label: "0x2" },
  ]), START);
  const spans = [{ span: "drawer.open", begin: 1_001, durationMs: 90 }, { span: "search.query", begin: 1_002, durationMs: 50 }];
  const rows = summarizeHitches([hitchesBySpan(spans, { recorded: true, hitches, frames })]);
  assert.deepEqual(rows.map((r) => [r.span, r.hitchCount, r.longestMs, r.verdict]), [
    ["drawer.open", 1, 130, "violated"],
    ["search.query", 0, null, "met"],
  ]);
});

test("each round records Points of Interest, with Hitches unless turned off", () => {
  assert.deepEqual(recordingInstruments(), ["Points of Interest", "Hitches"]);
  assert.deepEqual(recordingInstruments({ hitches: false }), ["Points of Interest"]);
  assert.deepEqual(recordArgs({ instruments: recordingInstruments(), udid: "U", pid: 7, output: "/o/t.trace" }), [
    "xctrace", "record", "--instrument", "Points of Interest", "--instrument", "Hitches", "--device", "U",
    "--attach", "7", "--time-limit", "5m", "--output", "/o/t.trace",
  ]);
});
