// @ts-nocheck
// Source pins for the thread pane wiring (threads-986.17.4, redesigned in
// cave-f8rdi). Behavior is tested in src/lib/weave-rail.test.ts; these pins
// hold the React layer to the §2.5-one-layer-up binding rule and the
// derived-descriptor treatment.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./thread-pane.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./weaves-view.tsx", import.meta.url), "utf8");
const map = await readFile(new URL("./weave-map.tsx", import.meta.url), "utf8");

assert.match(pane, /export function ThreadPane\(/, "ThreadPane must be exported");

// threads render as authority relationships: surface → writer
assert.match(pane, /\{thread\.surface\}/, "pane renders the protected surface");
assert.match(pane, /\{thread\.writer\}/, "pane renders the writer");
assert.match(pane, /surface → writer/, "pane copy binds thread to its referent");
assert.match(pane, /binds one protected surface to one writer/, "the thread referent heads the section");

// tension pills come from the view-model, worst-first ordering from paneModel
assert.match(pane, /pillForTension\(thread\.tension\)/, "tension pill derives from the view-model");
assert.match(pane, /paneModel\(weave\)/, "threads are ordered by paneModel (worst first)");
assert.match(pane, /Threads — worst first/, "the ordering is stated, not just applied");

// strand + channel bindings
assert.match(pane, /strand\{thread\.strandCount === 1 \? "" : "s"\} of commitment/, "strand count keeps the fiber referent");
assert.match(pane, /ChannelChips/, "channel bindings render as chips");
assert.match(pane, /requiredStrands\[channel\]/, "chips surface per-channel strand floors");
assert.match(pane, /every mutation fails closed/, "zero-channel thread states the fail-closed consequence");

// descriptor is derived, labeled, and never the verdict
assert.match(view, /Pattern descriptor \(derived\)/, "descriptor aside is labeled derived");
assert.match(view, /never what decided/, "descriptor copy denies enforcement authority");
assert.match(view, /verdict above comes from\s+the predicate/, "predicate named as the authority");

// frayed and snapped copy: honest, calm, actionable, with the consequence
assert.match(pane, /repairable; inspect the strand/, "frayed row points at strand inspection");
assert.match(pane, /degrade to proposals until a predicate passes/, "frayed row names the write consequence");
assert.match(pane, /fresh authority ceremony/, "snapped row names the repair path");
assert.match(pane, /No write through it will be treated as authorized/, "unknown tension fails closed in copy");

// trace affordance reaches the tension evidence
assert.match(pane, /onTraceThread\(thread\)/, "thread exposes trace-to-source");

// a staged write is surfaced where the fray is, and deep-links to its decision
assert.match(pane, /stagedThreadIds\.has\(thread\.id\)/, "a staged write is claimed only from the queue");
assert.match(pane, /staged and waiting on your decision/, "the staged-write call to action is explicit");
assert.match(view, /\/proposals\?proposal=\$\{encodeURIComponent\(proposalId\)\}/, "Review it deep-links the proposal");

// the map is evidence, never decoration, and never the only copy of its data
assert.match(map, /export function WeaveMapCanvas\(/, "the weave map is exported");
assert.match(map, /buildBipartiteWeaveMap\(\{ threads, proposals \}\)/, "map geometry comes from the view-model");
assert.match(map, /weaveMapRows\(\{ threads, audit, proposals \}\)/, "the List view comes from the same view-model");
assert.match(map, /aria-label="Map presentation"/, "the Map/List toggle is labeled");
assert.match(map, /The List view carries the same rows as text/, "the diagram names its text equivalent");
assert.match(map, /no edge can be drawn as evidence/, "an unreadable weave draws no map");
assert.match(map, /Memory reads\s*\n?\s*aren&rsquo;t audited yet/, "unaudited reads are still disclosed");

console.log("thread-pane wiring: all assertions passed");
