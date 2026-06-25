// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const feed = readFileSync(new URL("./home/home-feed.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
const familiarsView = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");

// The content feed now lives as a per-familiar "Feed" tab in the Familiars
// detail panel, not on the Home composer.
assert.match(familiarsView, /import \{ HomeFeed \} from "@\/components\/home\/home-feed"/, "familiars-view imports HomeFeed");
assert.match(familiarsView, /<HomeFeed onOpenUrl=\{onOpenUrl\}/, "familiars-view renders HomeFeed in the Feed tab");
assert.match(familiarsView, /\{ id: "feed", label: "Feed" \}/, "detail panel exposes a Feed tab");
assert.doesNotMatch(composer, /<HomeFeed/, "the content feed no longer renders on the Home composer");
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
