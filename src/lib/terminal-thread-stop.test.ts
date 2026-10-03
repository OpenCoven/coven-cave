/**
 * A pane closed while its shell was still starting (#5756): the stop found no
 * shell yet, so startup asks whether its thread was stopped, and stops the
 * shell it just made.
 */
import assert from "node:assert/strict";
import { stopTerminalThread, terminalThreadStopped } from "./terminal-thread-stop.ts";

assert.equal(terminalThreadStopped("cave.code.s1.pane-a"), false);
stopTerminalThread("cave.code.s1.pane-a");
assert.equal(terminalThreadStopped("cave.code.s1.pane-a"), true, "a stopped thread stays stopped for this page");
assert.equal(terminalThreadStopped("cave.code.s1.pane-b"), false, "per thread");

console.log("terminal-thread-stop: ok");
