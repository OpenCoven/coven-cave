// Pure analysis for iOS performance captures (#5292): parse an `xctrace export`
// of the `os-signpost-arg` table, pair Cave's `span=<name> phase=<phase>`
// signposts, keep the spans that begin inside each measured warm window, and
// summarize them. `scripts/ios-performance-capture.mjs` drives the device; this
// module only reads files, so it is unit-tested with synthetic exports.

const SUBSYSTEM = "ai.opencoven.cave";

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeEntities(match[1]) : null;
}

/**
 * The top-level children of one `<row>`: `{ tag, id, ref, fmt, text }`.
 * Nested elements (a thread's tid and process) are skipped, but every element
 * that defines an `id` is recorded in `definitions`, because later rows refer
 * back to it with `ref`.
 */
function rowChildren(rowXml, definitions) {
  const children = [];
  const tokens = /<(\/?)([\w-]+)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
  const stack = [];
  let match;
  while ((match = tokens.exec(rowXml))) {
    const [, closing, name, attrs, selfClosing, text] = match;
    if (text !== undefined) {
      if (stack.length > 0) stack[stack.length - 1].text += text;
      continue;
    }
    if (closing) {
      const node = stack.pop();
      if (!node) continue;
      node.text = decodeEntities(node.text);
      if (node.id) definitions.set(node.id, { fmt: node.fmt, text: node.text });
      if (stack.length === 0) children.push(node);
      continue;
    }
    const node = { tag: name, id: attribute(attrs, "id"), ref: attribute(attrs, "ref"), fmt: attribute(attrs, "fmt"), text: "" };
    if (selfClosing) {
      if (node.id) definitions.set(node.id, { fmt: node.fmt, text: "" });
      if (stack.length === 0) children.push(node);
    } else {
      stack.push(node);
    }
  }
  return children;
}

function resolve(node, definitions) {
  if (node.ref) return definitions.get(node.ref) ?? { fmt: null, text: "" };
  return { fmt: node.fmt, text: node.text };
}

/**
 * Cave's span signposts from an exported `os-signpost-arg` table, ordered by
 * time. `startSeconds` is the trace's start date (Unix seconds); event times
 * in the export are nanoseconds from that start.
 */
export function parseSpanEvents(xml, startSeconds) {
  const definitions = new Map();
  const events = [];
  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const children = rowChildren(row[1], definitions);
    let nanoseconds = null;
    let subsystem = null;
    let message = null;
    for (const child of children) {
      const value = resolve(child, definitions);
      if (child.tag === "event-time") nanoseconds = Number(value.text);
      else if (child.tag === "subsystem") subsystem = value.text || value.fmt;
      else if (child.tag === "string" && (value.text ?? "").startsWith("span=")) message = value.text;
    }
    if (message === null || subsystem !== SUBSYSTEM || !Number.isFinite(nanoseconds)) continue;
    const fields = Object.fromEntries(message.split(/\s+/).map((part) => part.split("=")));
    if (!fields.span || !fields.phase) continue;
    events.push({ at: startSeconds + nanoseconds / 1e9, span: fields.span, phase: fields.phase });
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Pair begin/end per span name. The app emits every span with an exclusive
 * signpost id, so a trace cannot say which end belongs to which begin when two
 * intervals of the same name overlap (renderer spans run once per mounted
 * bubble). A group runs from a begin until nothing of that name is open; a
 * group that never overlapped pairs exactly, and a group that did is counted
 * as `ambiguous` and contributes no samples rather than guessed ones.
 */
export function pairSpans(events) {
  const groups = new Map();
  const spans = [];
  const cancelled = [];
  const ambiguous = [];
  for (const event of events) {
    let group = groups.get(event.span);
    if (event.phase === "begin") {
      if (!group) {
        group = { open: [], outcomes: [], begins: [], overlapped: false };
        groups.set(event.span, group);
      }
      if (group.open.length > 0) group.overlapped = true;
      group.open.push(event.at);
      group.begins.push(event.at);
      continue;
    }
    if (!group || group.open.length === 0 || (event.phase !== "end" && event.phase !== "cancel")) continue;
    const begin = group.open.shift();
    group.outcomes.push(event.phase === "end"
      ? { kind: "span", value: { span: event.span, begin, durationMs: (event.at - begin) * 1000 } }
      : { kind: "cancel", value: { span: event.span, begin } });
    if (group.open.length > 0) continue;
    if (group.overlapped) {
      for (const at of group.begins) ambiguous.push({ span: event.span, begin: at });
    } else {
      for (const outcome of group.outcomes) (outcome.kind === "span" ? spans : cancelled).push(outcome.value);
    }
    groups.delete(event.span);
  }
  return { spans, cancelled, ambiguous };
}

/**
 * Seconds of span data retained before a window starts. The device keeps
 * only about the last 48 s of signposts per recording, so a negative lead
 * means the start of the measured cycle was lost and the round is unusable.
 */
export function coverageLead(events, window) {
  if (events.length === 0) return -Infinity;
  return window.start - events[0].at;
}

/** Nearest-rank percentile of a non-empty list. */
export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));
  return sorted[rank - 1];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Completed spans wholly inside a window, and cancellations that began in it.
 * A span that straddles either edge belongs to no single cycle, so it is left out.
 */
export function spansInWindow({ spans, cancelled, ambiguous = [] }, window) {
  const inside = (at) => at >= window.start && at <= window.end;
  return {
    spans: spans.filter((s) => inside(s.begin) && inside(s.begin + s.durationMs / 1000)),
    cancelled: cancelled.filter((c) => inside(c.begin)),
    ambiguous: ambiguous.filter((a) => inside(a.begin)),
  };
}

/**
 * Per-span count, median, p95, and max over the spans of every round. A span
 * with no completed sample still gets a row (null statistics) so a boundary
 * that was only ever cancelled or ambiguous is reported, not silently dropped.
 */
export function summarize(rounds) {
  const durations = new Map();
  const tally = (map, span) => map.set(span, (map.get(span) ?? 0) + 1);
  const cancelledCounts = new Map();
  const ambiguousCounts = new Map();
  for (const round of rounds) {
    for (const span of round.spans) {
      if (!durations.has(span.span)) durations.set(span.span, []);
      durations.get(span.span).push(span.durationMs);
    }
    for (const cancel of round.cancelled) tally(cancelledCounts, cancel.span);
    for (const overlap of round.ambiguous ?? []) tally(ambiguousCounts, overlap.span);
  }
  const names = new Set([...durations.keys(), ...cancelledCounts.keys(), ...ambiguousCounts.keys()]);
  return [...names].sort((a, b) => a.localeCompare(b)).map((span) => {
    const values = durations.get(span) ?? [];
    return {
      span,
      count: values.length,
      medianMs: values.length ? median(values) : null,
      p95Ms: values.length ? percentile(values, 0.95) : null,
      maxMs: values.length ? Math.max(...values) : null,
      cancelled: cancelledCounts.get(span) ?? 0,
      ambiguous: ambiguousCounts.get(span) ?? 0,
    };
  });
}

/** The measured window from a driver's `performance-cycle-*.json` attachment. */
export function parseCycleWindow(json) {
  const value = JSON.parse(json);
  if (typeof value?.startUnixSeconds !== "number" || typeof value?.endUnixSeconds !== "number") return null;
  return { phase: value.phase, cycle: value.cycle, start: value.startUnixSeconds, end: value.endUnixSeconds };
}

/** The trace's start date (Unix seconds) from `xctrace export --toc` output. */
export function traceStartSeconds(tocXml) {
  const match = /<start-date>([^<]+)<\/start-date>/.exec(tocXml);
  if (!match) throw new Error("trace table of contents has no start-date");
  const seconds = Date.parse(match[1]) / 1000;
  if (!Number.isFinite(seconds)) throw new Error(`unreadable trace start-date: ${match[1]}`);
  return seconds;
}

export function markdownTable(rows, cycles, phase = "warm") {
  const format = (ms) => (ms === null ? "—" : ms.toFixed(1));
  const lines = [
    `| span (${phase}, ${cycles} cycles) | n | median ms | p95 ms | max ms |`,
    "|---|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    const notes = [
      row.cancelled ? `${row.cancelled} cancelled` : null,
      row.ambiguous ? `${row.ambiguous} overlapping, unpaired` : null,
    ].filter(Boolean);
    const note = notes.length ? ` (${notes.join("; ")}, not counted)` : "";
    lines.push(`| \`${row.span}\`${note} | ${row.count} | ${format(row.medianMs)} | ${format(row.p95Ms)} | ${format(row.maxMs)} |`);
  }
  return lines.join("\n");
}

// Main-thread hitches (#5748). The Hitches instrument exports a `hitches`
// table, one row per hitch with the process it is attributed to, and a
// `hitches-frame-lifetimes` table with one row per rendered frame. Hitches
// are attributed to the measured spans they overlap. Frames prove the
// instrument was live: a span with no frame in the trace is unobserved, which
// is reported apart from a span that rendered without hitching.

/** The ratified #5292 budget: every hitch during a measured navigation is shorter than this. */
export const HITCH_BUDGET_MS = 100;

/**
 * Rows of one exported table as objects keyed by the schema's column
 * mnemonics, each value `{ fmt, text }`. Cells are positional, so an empty
 * `<sentinel/>` cell keeps the columns after it aligned.
 */
export function parseTableRows(xml) {
  const schema = /<schema\b[^>]*>([\s\S]*?)<\/schema>/.exec(xml);
  if (!schema) return [];
  const columns = [...schema[1].matchAll(/<mnemonic>([^<]*)<\/mnemonic>/g)].map((match) => match[1]);
  const definitions = new Map();
  const rows = [];
  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const children = rowChildren(row[1], definitions);
    const cells = {};
    columns.forEach((column, index) => {
      const child = children[index];
      cells[column] = child && child.tag !== "sentinel" ? resolve(child, definitions) : null;
    });
    rows.push(cells);
  }
  return rows;
}

function nanosecondsOf(cell) {
  const value = Number(cell?.text);
  return Number.isFinite(value) ? value : null;
}

/** The PID in a process cell's display format, such as `CovenCave (412)`. */
function processPid(cell) {
  const match = /\((\d+)\)\s*$/.exec(cell?.fmt ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Hitches from an exported `hitches` table, ordered by time. `own` is whether
 * the hitch belongs to the measured process `pid`. Without a known PID every
 * hitch counts as Cave's, so attribution can overcount but never hide one.
 */
export function parseHitches(xml, startSeconds, { pid = null } = {}) {
  const hitches = [];
  for (const row of parseTableRows(xml)) {
    const start = nanosecondsOf(row.start);
    const duration = nanosecondsOf(row.duration);
    if (start === null || duration === null) continue;
    const hitchPid = processPid(row.process);
    hitches.push({
      at: startSeconds + start / 1e9,
      durationMs: duration / 1e6,
      pid: hitchPid,
      own: pid === null || hitchPid === pid,
      system: row["is-system"]?.text === "1" || /^(yes|true)$/i.test(row["is-system"]?.fmt ?? ""),
    });
  }
  return hitches.sort((a, b) => a.at - b.at);
}

/** Rendered frames from an exported `hitches-frame-lifetimes` table: `{ at, end }` in Unix seconds. */
export function parseFrames(xml, startSeconds) {
  const frames = [];
  for (const row of parseTableRows(xml)) {
    const start = nanosecondsOf(row.start);
    if (start === null) continue;
    const at = startSeconds + start / 1e9;
    frames.push({ at, end: at + (nanosecondsOf(row.duration) ?? 0) / 1e9 });
  }
  return frames.sort((a, b) => a.at - b.at);
}

const overlaps = (at, end, from, to) => at <= to && end >= from;

/**
 * Per measured span: whether a frame was rendered during it, Cave's hitches
 * that overlap it, and other processes' overlapping hitches (not counted).
 * `hitchData` is `{ recorded, hitches, frames }` for the round, or null when
 * the round's recording had no Hitches instrument.
 */
export function hitchesBySpan(spans, hitchData) {
  return spans.map((span) => {
    const from = span.begin;
    const to = span.begin + span.durationMs / 1000;
    if (!hitchData?.recorded) return { span: span.span, recorded: false, observed: false, hitches: [], other: 0 };
    const touching = hitchData.hitches.filter((h) => overlaps(h.at, h.at + h.durationMs / 1000, from, to));
    return {
      span: span.span,
      recorded: true,
      observed: hitchData.frames.some((frame) => overlaps(frame.at, frame.end, from, to)),
      hitches: touching.filter((h) => h.own).map((h) => h.durationMs),
      other: touching.filter((h) => !h.own).length,
    };
  });
}

/** The same attribution for a whole measured cycle window, under the name `(cycle window)`. */
export function hitchesInWindow(window, hitchData) {
  const durationMs = (window.end - window.start) * 1000;
  return hitchesBySpan([{ span: "(cycle window)", begin: window.start, durationMs }], hitchData)[0];
}

function hitchVerdict({ spans, observed, longestMs }) {
  if (spans === 0 || observed === 0) return "unobserved";
  if (longestMs !== null && longestMs >= HITCH_BUDGET_MS) return "violated";
  return observed < spans ? "met where observed" : "met";
}

/**
 * Per-span hitch totals over every round: spans measured, spans with a frame
 * in the trace (`observed`), spans with no Hitches data at all (`notRecorded`),
 * Cave's hitch count, spans with any hitch, the longest hitch, other
 * processes' hitches, and the verdict against the < 100 ms budget. The
 * `(cycle window)` row, when present, covers each whole measured cycle.
 */
export function summarizeHitches(rounds) {
  const totals = new Map();
  for (const round of rounds) {
    for (const entry of round) {
      const row = totals.get(entry.span) ?? {
        span: entry.span, spans: 0, observed: 0, notRecorded: 0, hitchCount: 0, spansWithHitch: 0, longestMs: null, otherProcess: 0,
      };
      row.spans += 1;
      if (!entry.recorded) row.notRecorded += 1;
      if (entry.observed) row.observed += 1;
      row.hitchCount += entry.hitches.length;
      if (entry.hitches.length) row.spansWithHitch += 1;
      for (const ms of entry.hitches) row.longestMs = row.longestMs === null ? ms : Math.max(row.longestMs, ms);
      row.otherProcess += entry.other;
      totals.set(entry.span, row);
    }
  }
  return [...totals.values()]
    .sort((a, b) => (a.span === "(cycle window)") - (b.span === "(cycle window)") || a.span.localeCompare(b.span))
    .map((row) => ({ ...row, verdict: row.notRecorded === row.spans ? "not recorded" : hitchVerdict(row) }));
}

export function hitchTable(rows, cycles, phase = "warm") {
  const lines = [
    `| span (${phase}, ${cycles} cycles) | spans | observed | hitches | spans with a hitch | longest hitch ms | < ${HITCH_BUDGET_MS} ms |`,
    "|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const row of rows) {
    const notes = [
      row.notRecorded && row.notRecorded < row.spans ? `${row.notRecorded} not recorded` : null,
      row.otherProcess ? `${row.otherProcess} other-process hitches, not counted` : null,
    ].filter(Boolean);
    const name = row.span.startsWith("(") ? row.span : `\`${row.span}\``;
    const note = notes.length ? ` (${notes.join("; ")})` : "";
    const longest = row.longestMs === null ? "—" : row.longestMs.toFixed(1);
    lines.push(`| ${name}${note} | ${row.spans} | ${row.observed} | ${row.hitchCount} | ${row.spansWithHitch} | ${longest} | ${row.verdict} |`);
  }
  return lines.join("\n");
}
