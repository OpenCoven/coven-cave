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
 * Pair begin/end per span name. A span of one name never overlaps itself
 * (the recorder uses an exclusive signpost id), so a later begin replaces an
 * unfinished one, and `cancel` discards the open begin.
 */
export function pairSpans(events) {
  const open = new Map();
  const spans = [];
  const cancelled = [];
  for (const event of events) {
    if (event.phase === "begin") {
      open.set(event.span, event.at);
    } else if (event.phase === "end" && open.has(event.span)) {
      const begin = open.get(event.span);
      open.delete(event.span);
      spans.push({ span: event.span, begin, durationMs: (event.at - begin) * 1000 });
    } else if (event.phase === "cancel" && open.has(event.span)) {
      cancelled.push({ span: event.span, begin: open.get(event.span) });
      open.delete(event.span);
    }
  }
  return { spans, cancelled };
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
export function spansInWindow({ spans, cancelled }, window) {
  const inside = (at) => at >= window.start && at <= window.end;
  return {
    spans: spans.filter((s) => inside(s.begin) && inside(s.begin + s.durationMs / 1000)),
    cancelled: cancelled.filter((c) => inside(c.begin)),
  };
}

/** Per-span count, median, p95, and max over the spans of every round. */
export function summarize(rounds) {
  const durations = new Map();
  const cancelledCounts = new Map();
  for (const round of rounds) {
    for (const span of round.spans) {
      if (!durations.has(span.span)) durations.set(span.span, []);
      durations.get(span.span).push(span.durationMs);
    }
    for (const cancel of round.cancelled) {
      cancelledCounts.set(cancel.span, (cancelledCounts.get(cancel.span) ?? 0) + 1);
    }
  }
  return [...durations.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([span, values]) => ({
      span,
      count: values.length,
      medianMs: median(values),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
      cancelled: cancelledCounts.get(span) ?? 0,
    }));
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

export function markdownTable(rows, cycles) {
  const format = (ms) => ms.toFixed(1);
  const lines = [
    `| span (warm, ${cycles} cycles) | n | median ms | p95 ms | max ms |`,
    "|---|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    const note = row.cancelled ? ` (${row.cancelled} cancelled, not counted)` : "";
    lines.push(`| \`${row.span}\`${note} | ${row.count} | ${format(row.medianMs)} | ${format(row.p95Ms)} | ${format(row.maxMs)} |`);
  }
  return lines.join("\n");
}
