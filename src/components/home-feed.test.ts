// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const feed = readFileSync(new URL("./home/home-feed.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");

// Home renders the content feed, not the old RSS/world-news widget.
assert.match(composer, /import \{ HomeFeed \} from "@\/components\/home\/home-feed"/, "home-composer imports HomeFeed");
assert.match(composer, /<HomeFeed/, "home-composer renders HomeFeed");
assert.doesNotMatch(composer, /HomeRssWidget|rss-widget/, "the old RSS widget is gone from home");

// Two tabs: Tweets · Repos. The YouTube/Videos tab was removed.
assert.match(feed, /id: "tweets", label: "Tweets"/, "Tweets tab");
assert.match(feed, /id: "repos", label: "Repos"/, "Repos tab");
assert.doesNotMatch(feed, /id: "videos"|label: "Videos"/, "Videos/YouTube tab removed");
assert.doesNotMatch(feed, /\/api\/youtube/, "feed no longer loads YouTube");

// Each tab hits its data source.
assert.match(feed, /\/api\/github\/repos/, "Repos load from /api/github/repos");
assert.match(feed, /\/api\/home-tweets/, "Tweets load from /api/home-tweets");

// Tweets render as rows (RSS-backed), not the old Twitter embed widget.
assert.doesNotMatch(feed, /platform\.twitter\.com\/widgets\.js/, "no Twitter embed script");
assert.doesNotMatch(feed, /twitter-tweet/, "no twitter-tweet blockquote");
assert.match(feed, /function TweetsTab/, "TweetsTab renders the RSS posts");

console.log("home-feed.test.ts: ok");
