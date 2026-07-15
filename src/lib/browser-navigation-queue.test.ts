import assert from "node:assert/strict";
import {
  consumeBrowserNavigation,
  createExpectedBrowserNavigation,
  decideBrowserNavigationEvent,
  enqueueBrowserNavigation,
  type BrowserNavigationRequest,
} from "./browser-navigation-queue.ts";

const urls = [
  "https://github.com/OpenCoven/coven-cave",
  "https://docs.opencoven.ai",
  "https://x.com/OpenCvn",
  "https://discord.gg/opencoven",
  "https://mind.opencoven.ai",
  "https://pod.opencoven.ai",
];

let queue: BrowserNavigationRequest[] = [];
for (const [index, url] of urls.entries()) {
  queue = enqueueBrowserNavigation(queue, { id: index + 1, url });
}
assert.deepEqual(queue.map((request) => request.url), urls, "all Settings links survive until Browser mounts");

const duplicate = enqueueBrowserNavigation(queue, { id: 99, url: urls[0] });
assert.equal(duplicate, queue, "duplicate mount/hash events do not navigate twice");

for (const request of [...queue]) {
  queue = consumeBrowserNavigation(queue, request.id);
}
assert.deepEqual(queue, [], "acknowledging each lazy-mounted navigation consumes it exactly once");

const now = 10_000;
const newest = createExpectedBrowserNavigation(urls[0], now);
assert.deepEqual(
  decideBrowserNavigationEvent("about:blank", newest, "started", now),
  { accept: false, nextExpected: newest },
  "transient WebView2 attachment events never replace the requested URL",
);
const newestStarted = decideBrowserNavigationEvent(`${urls[0]}#readme`, newest, "started", now);
assert.equal(newestStarted.accept, true);
assert.deepEqual(
  newestStarted.nextExpected,
  { ...newest, currentUrl: `${urls[0]}#readme`, started: true },
  "the newest started event is accepted without retiring its generation guard",
);
assert.deepEqual(
  decideBrowserNavigationEvent(urls[5], newestStarted.nextExpected ?? undefined, "finished", now),
  { accept: false, nextExpected: newestStarted.nextExpected },
  "an older finished event between the newest start and finish is ignored",
);
assert.deepEqual(
  decideBrowserNavigationEvent(urls[5], newestStarted.nextExpected ?? undefined, "title", now),
  { accept: false, nextExpected: newestStarted.nextExpected },
  "an older title event between the newest start and finish is ignored",
);
const redirectStarted = decideBrowserNavigationEvent(
  "https://discord.com/invite/opencoven",
  decideBrowserNavigationEvent(urls[3], createExpectedBrowserNavigation(urls[3], now), "started", now).nextExpected ?? undefined,
  "started",
  now,
);
assert.equal(redirectStarted.accept, true, "redirect starts belong to the newest navigation generation");
assert.equal(redirectStarted.nextExpected?.currentUrl, "https://discord.com/invite/opencoven");
const redirectFinished = decideBrowserNavigationEvent(
  "https://discord.com/invite/opencoven",
  redirectStarted.nextExpected ?? undefined,
  "finished",
  now,
);
assert.equal(redirectFinished.accept, true);
assert.equal(redirectFinished.nextExpected?.completed, true, "redirect finish keeps a completed stale-event guard");
assert.deepEqual(
  decideBrowserNavigationEvent(urls[5], redirectFinished.nextExpected ?? undefined, "finished", now),
  { accept: false, nextExpected: redirectFinished.nextExpected },
  "an older completion after the newest finish is still ignored",
);
assert.deepEqual(
  decideBrowserNavigationEvent("https://discord.com/channels/@me", redirectFinished.nextExpected ?? undefined, "started", now),
  { accept: true, nextExpected: null },
  "a new user-driven start after completion retires the programmatic guard",
);
assert.deepEqual(
  decideBrowserNavigationEvent(urls[5], newest, "title", newest.expiresAt + 1),
  { accept: true, nextExpected: null },
  "the guard expires so later user-driven navigation is not blocked forever",
);
assert.deepEqual(
  decideBrowserNavigationEvent(urls[2], undefined, "finished", now),
  { accept: true, nextExpected: null },
  "ordinary WebView navigation is accepted when no request is pending",
);
const generated = createExpectedBrowserNavigation(urls[3], now, 200);
const generatedStarted = decideBrowserNavigationEvent(urls[3], generated, "started", now, 200);
assert.equal(generatedStarted.accept, true);
assert.deepEqual(
  decideBrowserNavigationEvent(urls[5], generatedStarted.nextExpected ?? undefined, "finished", now, 199),
  { accept: false, nextExpected: generatedStarted.nextExpected },
  "an older native generation cannot overwrite the newest URL after it starts",
);
const generatedRedirect = decideBrowserNavigationEvent(
  "https://discord.com/invite/opencoven",
  generatedStarted.nextExpected ?? undefined,
  "finished",
  now,
  200,
);
assert.equal(generatedRedirect.accept, true, "same-generation redirect finish is accepted without a redirect start event");
assert.equal(generatedRedirect.nextExpected?.currentUrl, "https://discord.com/invite/opencoven");
assert.equal(generatedRedirect.nextExpected?.completed, true);
assert.deepEqual(
  decideBrowserNavigationEvent(
    "https://docs.opencoven.ai/late-redirect",
    generatedRedirect.nextExpected ?? undefined,
    "finished",
    now,
    0,
  ),
  { accept: false, nextExpected: generatedRedirect.nextExpected },
  "an unattributed late redirect stays rejected after the newest generation completes",
);
assert.deepEqual(
  decideBrowserNavigationEvent(
    "https://docs.opencoven.ai/much-later",
    generatedRedirect.nextExpected ?? undefined,
    "finished",
    generatedRedirect.nextExpected!.expiresAt + 60_000,
    0,
  ),
  { accept: false, nextExpected: generatedRedirect.nextExpected },
  "the legacy timeout never bypasses an authoritative generation guard",
);
const generatedUserNavigation = decideBrowserNavigationEvent(
  "https://discord.com/channels/@me",
  generatedRedirect.nextExpected ?? undefined,
  "started",
  now,
  201,
);
assert.equal(generatedUserNavigation.accept, true, "a newer attributed user navigation is accepted");
assert.equal(
  generatedUserNavigation.nextExpected?.sequence,
  201,
  "the user generation becomes the persistent high-water guard",
);
assert.deepEqual(
  decideBrowserNavigationEvent(
    "https://discord.com/invite/opencoven",
    generatedUserNavigation.nextExpected ?? undefined,
    "title",
    now,
    200,
  ),
  { accept: false, nextExpected: generatedUserNavigation.nextExpected },
  "an old title remains rejected after a newer user navigation advances the guard",
);
assert.deepEqual(
  decideBrowserNavigationEvent(
    "https://pod.opencoven.ai/late",
    generatedUserNavigation.nextExpected ?? undefined,
    "finished",
    now,
    0,
  ),
  { accept: false, nextExpected: generatedUserNavigation.nextExpected },
  "an unattributed callback remains rejected after the user guard advances",
);
const initiallyAuthoritative = decideBrowserNavigationEvent(
  urls[1],
  undefined,
  "finished",
  now,
  300,
);
assert.equal(initiallyAuthoritative.accept, true);
assert.equal(
  initiallyAuthoritative.nextExpected?.sequence,
  300,
  "the first authoritative native event establishes a generation guard",
);
console.log("browser-navigation-queue.test.ts: ok");
