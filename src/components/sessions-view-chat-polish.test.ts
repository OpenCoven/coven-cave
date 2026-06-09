// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./sessions-view.tsx", import.meta.url), "utf8");

// ───────── Task 1: Header hidden when hideFamiliarFilter is true ─────────
assert.match(
  source,
  /\{!hideFamiliarFilter\s*&&\s*\(\s*<div className="sessions-view-title-wrap">/,
  "Sub-header sessions-view-title-wrap must be gated on !hideFamiliarFilter",
);

console.log("sessions-view-chat-polish.test.ts: ok");
