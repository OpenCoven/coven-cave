// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  chatRoute,
  /coven run <harness> --stream-json/,
  "Native chat should describe the generic Coven harness route instead of a fixed allow-list",
);

assert.doesNotMatch(
  chatRoute,
  /COVEN_RUN_HARNESSES|new Set\(\["codex", "claude"\]\)|new Set\(\["codex", "claude", "hermes"\]\)/,
  "Native chat should not hard-code a local harness allow-list",
);

assert.match(
  boardRoute,
  /binding\.harness === "openclaw"/,
  "Board step enrichment should skip OpenClaw bridge familiars while allowing local Coven harnesses",
);
