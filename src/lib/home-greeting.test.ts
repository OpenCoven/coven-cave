// @ts-nocheck
import assert from "node:assert/strict";
import { greetingForHour } from "./home-greeting.ts";

// Boundaries: [5,12) morning · [12,18) afternoon · [18,22) evening · else night.
assert.equal(greetingForHour(5), "Good morning");
assert.equal(greetingForHour(11), "Good morning");
assert.equal(greetingForHour(12), "Good afternoon");
assert.equal(greetingForHour(17), "Good afternoon");
assert.equal(greetingForHour(18), "Good evening");
assert.equal(greetingForHour(21), "Good evening");
assert.equal(greetingForHour(22), "Deep night in the cave");
assert.equal(greetingForHour(0), "Deep night in the cave");
assert.equal(greetingForHour(4), "Deep night in the cave");

console.log("home-greeting.test.ts: ok");
