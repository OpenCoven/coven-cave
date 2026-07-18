// @ts-nocheck
// ProfileCardView audit pins (cave-wczm): the dashboard familiar profile page
// keeps entity switches and live refreshes honest without mounting React.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./profile-card.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const generationRef = useRef\(0\)/,
  "ProfileCardView tracks async generations so stale profile loads cannot settle",
);
assert.match(
  source,
  /void load\("reset"\)/,
  "ProfileCardView resets familiar switches to the loading skeleton",
);
assert.match(
  source,
  /return \(\) => \{\s*generationRef\.current \+= 1;\s*\}/,
  "ProfileCardView cancels the previous generation when the subject changes",
);
assert.match(
  source,
  /mode === "refresh" && dataRef\.current && nextError[\s\S]{0,240}?keeping the previous profile data/,
  "ProfileCardView keeps last-known-good data when a refresh returns fallback errors",
);
assert.match(
  source,
  /usePausablePoll\(\(\) => void load\("refresh"\), 60_000\)/,
  "ProfileCardView polls live data through usePausablePoll",
);
assert.match(
  source,
  /<time dateTime=\{lastUpdatedAt\}>\{relativeTime\(lastUpdatedAt\)\}<\/time>/,
  "ProfileCardView renders a semantic truthful Updated relative-time stamp",
);
assert.match(
  source,
  /<time className="pfc-panel-sub" dateTime=\{props\.sideSubDateTime\}>/,
  "ProfileCard renders the busiest-day date as a semantic time element",
);
assert.match(
  source,
  /const \{ announce \} = useAnnouncer\(\)/,
  "ProfileCardView announces profile load and refresh state changes",
);
assert.match(
  source,
  /<main className="pfc-page" aria-busy=\{refreshing \? "true" : undefined\}>/,
  "ProfileCard keeps aria-busy truthful during live refreshes",
);

console.log("profile-card-view.test.ts: ok");
