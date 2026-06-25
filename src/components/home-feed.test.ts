// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const feed = readFileSync(new URL("./home/home-feed.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");

// Home renders the new content feed, not the old RSS/world-news widget.
assert.match(composer, /import \{ HomeFeed \} from "@\/components\/home\/home-feed"/, "home-composer imports HomeFeed");
assert.match(composer, /<HomeFeed/, "home-composer renders HomeFeed");
assert.doesNotMatch(composer, /HomeRssWidget|rss-widget/, "the old RSS widget is gone from home");

// Three tabs: Videos · Tweets · Repos.
assert.match(feed, /id: "videos", label: "Videos"/, "Videos tab");
assert.match(feed, /id: "tweets", label: "Tweets"/, "Tweets tab");
assert.match(feed, /id: "repos", label: "Repos"/, "Repos tab");

// Each tab hits its data source.
assert.match(feed, /\/api\/youtube/, "Videos load from /api/youtube");
assert.match(feed, /\/api\/github\/repos/, "Repos load from /api/github/repos");
assert.match(feed, /\/api\/home-tweets/, "Tweets load from /api/home-tweets");

// Tweets are embedded via Twitter's widget script with a configurable list.
assert.match(feed, /platform\.twitter\.com\/widgets\.js/, "tweets use the X embed script");
assert.match(feed, /class="twitter-tweet"|"twitter-tweet"/, "tweets render the twitter-tweet blockquote");

console.log("home-feed.test.ts: ok");
