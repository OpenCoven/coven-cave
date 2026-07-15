// @ts-nocheck
// Source pins for the thread pane wiring (threads-986.17.4). Behavior is
// tested in src/lib/weave-rail.test.ts; these pins hold the React layer to
// the §2.5-one-layer-up binding rule and the derived-descriptor treatment.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./thread-pane.tsx", import.meta.url), "utf8");

assert.match(pane, /export function ThreadPane\(/, "ThreadPane must be exported");

// threads render as authority relationships: surface → writer
assert.match(pane, /\{thread\.surface\}/, "pane renders the protected surface");
assert.match(pane, /\{thread\.writer\}/, "pane renders the writer");
assert.match(pane, /surface → writer/, "pane copy binds thread to its referent");

// tension pills come from the view-model, worst-first ordering from paneModel
assert.match(pane, /pillForTension\(thread\.tension\)/, "tension pill derives from the view-model");
assert.match(pane, /paneModel\(weave\)/, "threads are ordered by paneModel (worst first)");

// strand + channel bindings
assert.match(pane, /strand\{thread\.strandCount === 1 \? "" : "s"\} of commitment/, "strand count keeps the fiber referent");
assert.match(pane, /ChannelChips/, "channel bindings render as chips");
assert.match(pane, /requiredStrands\[channel\]/, "chips surface per-channel strand floors");
assert.match(pane, /every mutation fails closed/, "zero-channel thread states the fail-closed consequence");

// descriptor is derived, labeled, and never the verdict
assert.match(pane, /Pattern descriptor \(derived\)/, "descriptor aside is labeled derived");
assert.match(pane, /never what decided/, "descriptor copy denies enforcement authority");
assert.match(pane, /verdicts above come from the predicate/, "predicate named as the authority");

// frayed and snapped copy: honest, calm, actionable
assert.match(pane, /repairable; inspect the strand/, "frayed row points at strand inspection");
assert.match(pane, /fresh authority ceremony/, "snapped row names the repair path");

// trace affordance on the thread pill
assert.match(pane, /onTraceThread/, "thread pill exposes trace-to-source");

// freshness metadata on the pane
assert.match(pane, /meta\.observedAt/, "pane shows observation time");
assert.match(pane, /meta\.sourceCursor/, "pane shows the source cursor");

console.log("thread-pane wiring: all assertions passed");
