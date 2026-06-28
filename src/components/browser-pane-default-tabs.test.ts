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

// The "Coven" sidebar surface was folded into the browser — its docs + feedback
// destinations now ship as default pinned tabs here.
assert.match(
  defaults,
  /url: "https:\/\/docs\.opencoven\.ai"[\s\S]*title: "Docs"/,
  "Browser defaults should include the OpenCoven docs tab (was the Coven surface)",
);
assert.match(
  defaults,
  /url: "https:\/\/feedback\.opencoven\.ai"[\s\S]*title: "Feedback"/,
  "Browser defaults should include the OpenCoven feedback tab (was the Coven surface)",
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
