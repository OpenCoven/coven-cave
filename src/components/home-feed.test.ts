// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const feed = readFileSync(new URL("./home/home-feed.tsx", import.meta.url), "utf8");
const reposRoute = readFileSync(new URL("../app/api/github/repos/route.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
const familiarsView = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const familiarsSections = readFileSync(new URL("./familiars-view-sections.tsx", import.meta.url), "utf8");

// The content feed now lives as a per-familiar "Feed" tab in the Familiars
// detail panel, not on the Home composer.
assert.match(familiarsSections, /import \{ HomeFeed \} from "@\/components\/home\/home-feed"/, "detail sections import HomeFeed");
assert.match(familiarsSections, /<HomeFeed onOpenUrl=\{onOpenUrl\}/, "detail sections render HomeFeed in the Feed tab");
assert.match(familiarsSections, /\{ id: "feed", label: "Feed" \}/, "detail panel exposes a Feed tab");
assert.doesNotMatch(familiarsView, /HomeFeed/, "the controller does not retain feed rendering ownership");
assert.doesNotMatch(composer, /<HomeFeed/, "the content feed no longer renders on the Home composer");
assert.doesNotMatch(composer, /HomeRssWidget|rss-widget/, "the old RSS widget is gone from home");

// Two tabs: Tweets · Repos. The YouTube/Videos tab was removed.
assert.match(feed, /id: "tweets", label: "Tweets"/, "Tweets tab");
assert.match(feed, /id: "repos", label: "Repos"/, "Repos tab");
assert.doesNotMatch(feed, /id: "videos"|label: "Videos"/, "Videos/YouTube tab removed");
assert.doesNotMatch(feed, /\/api\/youtube/, "feed no longer loads YouTube");

// Each tab hits its data source.
assert.match(feed, /\/api\/github\/repos/, "Repos load from /api/github/repos");
assert.match(
  feed,
  /\/api\/github\/repos\$\{refresh \? "\?refresh=1" : ""\}/,
  "a user-triggered repo refresh bypasses the server-side curated-feed cache",
);
assert.match(
  reposRoute,
  /searchParams\.has\("refresh"\)/,
  "the repos route bypasses its process-local cache only for an explicit refresh",
);
assert.match(feed, /\/api\/home-tweets/, "Tweets load from /api/home-tweets");
assert.match(
  reposRoute,
  /scope: \{ mode: "curated", limit: MAX_ITEMS, hasMore/,
  "repos API should disclose its curated scope and cap",
);
assert.match(
  reposRoute,
  /const SOURCE_PAGE_SIZE = 30/,
  "curated repository sources should remain bounded without letting org rows displace the curated list",
);
assert.match(
  reposRoute,
  /nextGitHubPagePath\(res\.headers\.get\("link"\)\) !== null/,
  "the REST repository source should disclose omitted pages",
);
assert.match(
  reposRoute,
  /pageInfo\?\.\s*hasNextPage === true/,
  "the GraphQL repository source should disclose omitted pages",
);
assert.match(
  reposRoute,
  /orgRepos\.hasMore \|\| listRepos\.hasMore \|\| out\.length > items\.length/,
  "curated feed hasMore should include source-level pagination, not only merged rows",
);
assert.match(
  reposRoute,
  /incomplete: errors\.length > 0/,
  "repos API should expose partial upstream failures instead of returning a trustworthy empty list",
);
assert.match(
  reposRoute,
  /items: nodes\.map\(graphToItem\)/,
  "GraphQL partial responses should preserve usable repository rows",
);
assert.match(
  feed,
  /home-feed__note home-feed__note--err/,
  "repo feed should render upstream failure detail even when another source still has rows",
);
assert.match(
  feed,
  /Curated repositories: OpenCoven and the opencoven-openclaw list\./,
  "repo feed should tell users it is curated rather than complete account discovery",
);
assert.match(
  feed,
  /No repositories in the curated feed yet\./,
  "the empty repo state should remain explicit about curated scope",
);
assert.match(
  feed,
  /setRepoWarning\("Couldn't refresh curated repositories\."\)/,
  "a failed refresh should remain visible when stale repository rows stay mounted",
);
assert.doesNotMatch(
  feed,
  /setRepoState\("idle"\);\s*void loadRepos\(true\)/,
  "manual repository refresh should not replace stale rows with a skeleton or error state",
);
assert.match(
  feed,
  /Add a GitHub token in Settings to load the curated OpenCoven repository feed\./,
  "the unconfigured state should not describe the fixed curated feed as the user's own starred list",
);

// Tweets render as rows (RSS-backed), not the old Twitter embed widget.
assert.doesNotMatch(feed, /platform\.twitter\.com\/widgets\.js/, "no Twitter embed script");
assert.doesNotMatch(feed, /twitter-tweet/, "no twitter-tweet blockquote");
assert.match(feed, /function TweetsTab/, "TweetsTab renders the RSS posts");

console.log("home-feed.test.ts: ok");
