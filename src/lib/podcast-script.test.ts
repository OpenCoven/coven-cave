// Coven Podcast.dc.html — "Transcript · screenplay".
//
// The drafter emits speaker-attributed segments. Before this, the app threw
// that structure away and printed a flat list with a bold "Host"/"Guest" run in
// front of every line, so a two-voice dialogue read as one undifferentiated
// column. These pin the two things that make it a screenplay instead: runs
// group by voice, and a narrator script is never assigned a voice it never had.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { castOf, groupBySpeaker } from "./podcast-script.ts";

const component = readFileSync(new URL("../components/role-surfaces/podcast-transcript.tsx", import.meta.url), "utf8");

const seg = (id: string, text: string, speaker?: "host" | "guest") =>
  speaker ? { id, text, speaker } : { id, text };

test("consecutive lines from one voice share a single attribution", () => {
  const runs = groupBySpeaker([
    seg("1", "Welcome back.", "host"),
    seg("2", "Today we open the ward.", "host"),
    seg("3", "Glad to be here.", "guest"),
    seg("4", "So — the contract.", "host"),
  ]);
  assert.equal(runs.length, 3, "four segments collapse into three speaker runs");
  assert.deepEqual(runs.map((run) => run.speaker), ["host", "guest", "host"]);
  assert.equal(runs[0].segments.length, 2, "the host's two opening lines stay together");
  // Order is the script's order — a transcript that reorders is a different
  // episode.
  assert.deepEqual(
    runs.flatMap((run) => run.segments.map((s) => s.id)),
    ["1", "2", "3", "4"],
  );
});

test("a single-narrator script produces one unattributed run", () => {
  const runs = groupBySpeaker([seg("1", "One."), seg("2", "Two.")]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].speaker, null, "no speaker means no attribution to invent");
  assert.deepEqual(castOf([seg("1", "One."), seg("2", "Two.")]), [], "a narrator script has no cast");
});

test("the cast is first-appearance order, deduplicated", () => {
  assert.deepEqual(
    castOf([seg("1", "a", "guest"), seg("2", "b", "host"), seg("3", "c", "guest")]),
    ["guest", "host"],
  );
});

test("an empty script says so instead of rendering an empty screenplay", () => {
  assert.deepEqual(groupBySpeaker([]), []);
  assert.match(component, /This episode has no script segments yet\./);
});

test("the transcript states the voice each speaker was rendered in", () => {
  // The one fact a transcript can carry that the audio cannot.
  assert.match(component, /voices\?\.\[speaker\] \? <span>\{voices\[speaker\]\}<\/span> : null/);
  assert.match(component, /Single narrator/, "a narrator script names its one voice");
  assert.match(component, /Cold open/, "the opening run is cued as the cold open");
});


console.log("podcast-script.test.ts OK");
