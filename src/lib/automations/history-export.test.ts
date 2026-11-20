import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_HISTORY_METADATA_FILENAME,
  AUTOMATION_HISTORY_METADATA_MAX_BYTES,
  serializeAutomationHistoryMetadata,
} from "./history-export.ts";

const readAt = "2026-10-24T07:00:00-05:00";
const entry = (sequence = 0) => ({
  id: `event${String(sequence).padStart(20, "0")}`, sequence,
  recordedAt: readAt, label: "Definition created", detail: "Revision 1",
});
const page = (entries: unknown[] = [entry()], withheld = 0) => ({
  kind: "available", entries, withheld, checkpoint: "synthetic-fixture-checkpoint",
  hasEntries: entries.length + withheld > 0, readAt,
});
const packet = (value: unknown, freshness: "read" | "stale" = "read") =>
  JSON.parse(serializeAutomationHistoryMetadata(value, freshness));
const refuses = (value: unknown) => assert.throws(() => serializeAutomationHistoryMetadata(value, "read"), {
  name: "Error", message: "History metadata is unavailable.",
});

test("metadata has a fixed filename and closed diagnostic one-page scope", () => {
  assert.equal(AUTOMATION_HISTORY_METADATA_FILENAME, "coven-automation-history-metadata.json");
  assert.equal(AUTOMATION_HISTORY_METADATA_MAX_BYTES, 65_536);
  assert.deepEqual(packet(page()), {
    schemaVersion: "cave.automation-history-metadata.v1", source: "cave-history-projection",
    scope: "single-page", completeHistory: false, freshness: "read", readAt: "2026-10-24T12:00:00.000Z",
    withheld: 0, entries: [{ id: entry().id, sequence: 0, recordedAt: "2026-10-24T12:00:00.000Z", type: "definition.created" }],
  });
});

test("stale packets retain their original as-of timestamp and withheld count", () => {
  const exported = packet(page([], 2), "stale");
  assert.equal(exported.freshness, "stale");
  assert.equal(exported.readAt, "2026-10-24T12:00:00.000Z");
  assert.equal(exported.withheld, 2);
  assert.deepEqual(exported.entries, []);
  assert.equal(exported.completeHistory, false);
});

test("a valid empty page exports while unavailable or malformed reads refuse", () => {
  assert.deepEqual(packet(page([])).entries, []);
  for (const input of [null, {}, { kind: "unavailable" }, { kind: "unsupported" }, { kind: "expired" },
    { ...page(), readAt: "invalid" }, { ...page(), hasEntries: false }, { ...page(), checkpoint: "" },
    { ...page(), withheld: -1 }, page([{ ...entry(), recordedAt: "invalid" }]),
    page([{ ...entry(), sequence: Number.MAX_SAFE_INTEGER + 1 }]), page([{ ...entry(), id: "../private" }])]) refuses(input);
});

test("the record bound and ordering are enforced before export", () => {
  assert.equal(packet(page(Array.from({ length: 100 }, (_, i) => entry(i)))).entries.length, 100);
  refuses(page(Array.from({ length: 101 }, (_, i) => entry(i))));
  refuses(page(Array.from({ length: 100 }, (_, i) => entry(i)), 1));
  refuses(page([entry(), entry()]));
  refuses(page([entry(2), entry(1)]));
  refuses(page([{ ...entry(), label: "x".repeat(81) }]));
  refuses(page([{ ...entry(), detail: "x".repeat(201) }]));
});

test("private text and unknown properties never enter the closed packet", () => {
  const secret = "synthetic-fixture-private-credential";
  const input = { ...page([{ ...entry(), label: secret, detail: secret, prompt: secret, receipt: secret }]),
    checkpoint: secret, summary: secret, reason: secret, path: secret, host: secret, unknown: secret };
  const text = serializeAutomationHistoryMetadata(input, "read");
  assert.ok(!text.includes(secret));
  assert.equal(JSON.parse(text).entries[0].type, "unrecognized");
  assert.deepEqual(Object.keys(JSON.parse(text).entries[0]).sort(), ["id", "recordedAt", "sequence", "type"]);
  assert.ok(!text.includes("checkpoint"));
});

test("all known labels map to a closed event vocabulary", () => {
  const labels = [
    ["Definition created", "definition.created"], ["Definition revised", "definition.revised"],
    ["Definition activated", "definition.activated"], ["Definition paused", "definition.paused"],
    ["Definition disabled", "definition.disabled"], ["Definition invalidated", "definition.invalidated"],
    ["Definition removed", "definition.tombstoned"], ["Definition imported", "definition.imported"],
    ["Occurrence changed", "occurrence.transitioned"], ["Run changed", "run.transitioned"],
    ["Attempt changed", "attempt.transitioned"], ["Missed occurrence recorded", "occurrence.misfire_recorded"],
    ["Receipt recorded", "receipt.recorded"], ["History snapshot", "feed.snapshot"],
  ];
  for (const [label, type] of labels) assert.equal(packet(page([{ ...entry(), label }])).entries[0].type, type);
  for (const label of ["constructor", "__proto__", "toString", "Unknown future event"]) {
    assert.equal(packet(page([{ ...entry(), label }])).entries[0].type, "unrecognized");
  }
});

test("maximum valid metadata remains within the UTF-8 byte ceiling", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry(i), id: String(i).padStart(64, "z"),
    sequence: Number.MAX_SAFE_INTEGER - 100 + i, label: "Missed occurrence recorded", detail: "🙂".repeat(100) }));
  const text = serializeAutomationHistoryMetadata(page(entries), "read");
  assert.ok(new TextEncoder().encode(text).length <= AUTOMATION_HISTORY_METADATA_MAX_BYTES);
  assert.equal(JSON.parse(text).entries.length, 100);
});

test("hostile getters and invalid runtime freshness refuse without reflecting inputs", () => {
  const hostile = Object.defineProperty({}, "kind", { get() { throw new Error("synthetic-fixture-private-detail"); } });
  refuses(hostile);
  assert.throws(() => serializeAutomationHistoryMetadata(page(), "live" as "read"), { message: "History metadata is unavailable." });
});

test("changing getters cannot replace validated ids with private serialization hooks", () => {
  let reads = 0;
  const hostileEntry = { ...entry() };
  Object.defineProperty(hostileEntry, "id", { get() {
    return ++reads <= 4 ? entry().id : { toJSON: () => ({ private: "synthetic-fixture-private-payload" }) };
  } });
  refuses(page([hostileEntry]));
});

test("changing page getters cannot substitute an oversized entry array", () => {
  let reads = 0;
  const hostilePage = page();
  Object.defineProperty(hostilePage, "entries", { get() {
    return ++reads <= 4 ? [entry()] : Array.from({ length: 101 }, (_, i) => entry(i));
  } });
  refuses(hostilePage);
});
