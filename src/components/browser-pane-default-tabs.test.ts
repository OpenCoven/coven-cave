// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const defaults = source.match(/function defaultPinnedTabs\(\): BrowserTab\[\] \{[\s\S]*?\n\}/)?.[0] ?? "";

assert.match(
  defaults,
  /url: "https:\/\/x\.com\/OpenCvn"[\s\S]*title: "OpenCvn"/,
  "Browser defaults should include the OpenCoven X profile",
);

assert.doesNotMatch(
  defaults,
  /vercel\.com\/dashboard|title: "Vercel"|id: "vercel"/,
  "Browser defaults should not include Vercel",
);

assert.doesNotMatch(
  defaults,
  /frymatic\.us|FTSArcade|id: "arcade"/,
  "Browser defaults should not include the Frymatic arcade tab",
);
