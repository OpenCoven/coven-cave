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
  /isTrustedChatHarness\(binding\.harness\)/,
  "Native chat should enforce the trusted Coven harness gate before spawning coven run",
);

assert.match(
  chatRoute,
  /COMPATIBILITY_ADAPTERS\.find/,
  "Native chat should consult bundled adapter metadata before spawning a harness",
);

assert.match(
  chatRoute,
  /!adapter\.chatSupported/,
  "Native chat should reject bundled adapters that opt out of native chat",
);

assert.doesNotMatch(
  chatRoute,
  /binding\.harness === "openclaw"/,
  "Native chat should enforce chat support metadata instead of special-casing OpenClaw",
);

assert.match(
  boardRoute,
  /isTrustedChatHarness\(binding\.harness\)/,
  "Board step enrichment should enforce the same trusted Coven harness gate",
);
