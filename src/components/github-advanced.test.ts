// @ts-nocheck
// Guards for the "advanced GitHub surface" work: clickable user-profile cards,
// PR review summaries + reactions merged into the conversation timeline, and the
// per-PR CI action-details (checks) section. These are source-shape assertions
// (matching the sibling github-view-polish.test.ts convention) so they run in
// the daemon-less CI without spinning up React.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");
const boardCss = readFileSync(new URL("../styles/board.css", import.meta.url), "utf8");
const userRoute = readFileSync(
  new URL("../app/api/github/user/route.ts", import.meta.url),
  "utf8",
);
const checksRoute = readFileSync(
  new URL("../app/api/github/checks/route.ts", import.meta.url),
  "utf8",
);
const commentsRoute = readFileSync(
  new URL("../app/api/github/comments/route.ts", import.meta.url),
  "utf8",
);

// ── User profiles ─────────────────────────────────────────────────────────────

// The /users/{login} route validates the login before interpolation and returns
// the public profile fields the card renders.
assert.match(userRoute, /export async function GET/, "user route exposes GET");
assert.match(userRoute, /const LOGIN_RE =/, "user route validates the login shape");
assert.match(userRoute, /\/users\/\$\{login\}/, "user route hits the /users endpoint with the validated login");
assert.match(userRoute, /followers[\s\S]{0,80}following[\s\S]{0,120}publicRepos/, "user route returns follower/repo counts");
assert.match(userRoute, /invalid login/, "user route rejects a malformed login");

// A profile viewer context owns a single card; person chips open it, but only
// for real logins (bots have no profile).
assert.match(source, /const ProfileViewerContext = createContext/, "a profile viewer context exists");
assert.match(source, /function GitHubProfileProvider/, "the profile provider owns the single open card");
assert.match(source, /function UserProfileCard/, "the floating profile card component exists");
assert.match(source, /<GitHubProfileProvider>/, "GitHubView is wrapped in the profile provider");
assert.match(source, /useContext\(ProfileViewerContext\)/, "PersonChip consumes the profile viewer");
assert.match(source, /const LOGIN_RE = \/\^\[A-Za-z0-9\]/, "PersonChip gates clickability on a real login (not a bot)");
assert.match(source, /viewer!\.open\(person\.login, e\.currentTarget\)/, "clicking a person chip opens their profile");
assert.match(source, /fetch\(`\/api\/github\/user\?login=/, "the card fetches the profile route");
assert.match(source, /useFocusTrap\(true, cardRef/, "the profile card traps focus and closes on Escape");
assert.match(source, /aria-modal="true"[\s\S]{0,80}aria-label=\{`GitHub profile for/, "the profile card is a labelled modal dialog");
assert.match(boardCss, /\.gh-profile-card \{[\s\S]*?position:fixed;/, "the profile card is a fixed floating panel");
// The card must portal to <body> so its fixed positioning escapes the
// workspace's transformed content area (otherwise it lands offset by the nav).
assert.match(source, /import \{ createPortal \} from "react-dom"/, "the profile card uses createPortal");
assert.match(source, /createPortal\(\s*<UserProfileCard[\s\S]{0,120}document\.body/, "the profile card portals to document.body");
// github-view carries its own stylesheet so the surface is styled even when it
// loads before the Board surface (both are code-split; board.css lived only in board-view).
assert.match(source, /import "@\/styles\/board\.css"/, "github-view imports board.css directly");
assert.match(boardCss, /\.gh-person--button/, "the clickable person chip has a button affordance style");

// ── Advanced conversation (reviews + reactions) ───────────────────────────────

// The comments route now also returns PR review summaries and per-comment
// reaction rollups. COMMENTED-with-no-body reviews are dropped as noise.
assert.match(commentsRoute, /async function fetchReviews/, "comments route fetches PR review summaries");
assert.match(commentsRoute, /\/pulls\/\$\{number\}\/reviews/, "reviews come from the pulls/{n}/reviews endpoint");
assert.match(commentsRoute, /state !== "PENDING" && \(r\.state !== "COMMENTED" \|\| r\.body\.trim\(\)\.length > 0\)/, "empty COMMENTED / PENDING reviews are filtered out");
assert.match(commentsRoute, /reviews,/, "the comments payload includes reviews");
assert.match(commentsRoute, /function reactions\(/, "comments route maps reaction rollups");
assert.match(commentsRoute, /reactions: reactions\(co\.reactions\)/, "issue comments carry their reaction counts");

// The timeline interleaves comments and reviews chronologically, with a review
// verdict badge and reaction chips.
assert.match(source, /function ReviewEntry/, "a PR review timeline entry component exists");
assert.match(source, /const REVIEW_STATE:/, "review states map to presentation");
assert.match(source, /APPROVED:[\s\S]{0,120}approved these changes/, "an approved review reads as an approval");
assert.match(source, /CHANGES_REQUESTED:[\s\S]{0,120}requested changes/, "a changes-requested review reads as such");
assert.match(source, /const timeline: Array<[\s\S]{0,200}kind: "comment"[\s\S]{0,200}kind: "review"/, "comments + reviews share one timeline array");
assert.match(source, /\.sort\(\(a, b\) => a\.at\.localeCompare\(b\.at\)\)/, "the timeline is sorted chronologically");
assert.match(source, /entry\.kind === "review"[\s\S]{0,120}<ReviewEntry/, "reviews render inline in the timeline");
assert.match(source, /function CommentReactions/, "a reaction summary component exists");
assert.match(source, /<CommentReactions reactions=\{entry\.comment\.reactions\}/, "reactions render under each comment");
assert.match(source, /const REACTION_EMOJI:/, "reaction slugs map to emoji glyphs");
assert.match(boardCss, /\.gh-reaction \{/, "reaction chips are styled");
assert.match(boardCss, /\.gh-review-entry \{/, "review timeline entries are styled");
assert.match(boardCss, /\.gh-review-entry\.is-approved \{ border-left-color:var\(--color-success\)/, "approved reviews get a success accent");

// ── CI action details (per-PR checks) ─────────────────────────────────────────

// The checks route resolves the PR head SHA and returns individual check-runs
// (with timing + logs URL) plus the legacy combined statuses and a rollup.
assert.match(checksRoute, /export async function GET/, "checks route exposes GET");
assert.match(checksRoute, /\/pulls\/\$\{number\}`/, "checks route resolves the PR head");
assert.match(checksRoute, /\/commits\/\$\{sha\}\/check-runs/, "checks route reads the head commit's check-runs");
assert.match(checksRoute, /\/commits\/\$\{sha\}\/status/, "checks route reads the legacy combined status");
assert.match(checksRoute, /summarizeChecks\(runs as CheckRun\[\], combinedState\)/, "checks route rolls up a single summary");
assert.match(checksRoute, /detailsUrl:[\s\S]{0,60}details_url/, "each run carries its logs URL");

// The detail panel renders an expandable checks section for PRs only.
assert.match(source, /function GitHubChecks/, "the checks section component exists");
assert.match(source, /<GitHubChecks item=\{item\} \/>/, "the checks section is wired into the detail panel");
assert.match(source, /const isPull = item\.kind === "pr" \|\| item\.kind === "review_request";\s*\n\s*const state = useGitHubChecks/, "checks only load for pull requests");
assert.match(source, /fetch\(`\/api\/github\/checks\?repo=/, "the section fetches the checks route");
assert.match(source, /function checkPresentation/, "check runs map status/conclusion to icon + tint");
assert.match(source, /function checkDuration/, "check runs show a human duration");
assert.match(source, /useEffect\(\(\) => \{ setOpen\(rollup === "failing"\); \}/, "a failing rollup auto-expands the list");
assert.match(source, /gh-check-logs[\s\S]{0,200}openExternalUrl\(r\.detailsUrl!\)/, "a run's logs open in the system browser");
assert.match(boardCss, /\.gh-checks-list \{/, "the checks list is styled");
assert.match(boardCss, /\.gh-checks-rollup--failing \{ color:var\(--color-danger\)/, "the failing rollup pill is danger-tinted");

// ── Wave 2 polish ─────────────────────────────────────────────────────────────

// Profile cache: reopening a person's card is instant and doesn't respend the
// rate limit — cache-first, populated on the first successful fetch.
assert.match(source, /const profileCache = new Map<string, UserProfile>\(\)/, "a session-lifetime profile cache exists");
assert.match(source, /const cached = profileCache\.get\(login\);[\s\S]{0,120}status: "ready", profile: cached/, "the card serves a cached profile without refetching");
assert.match(source, /profileCache\.set\(login, profile\)/, "a fetched profile populates the cache");

// Checks live-refresh: while the rollup is pending, poll every 30s; the same-PR
// refresh is silent (no skeleton flash) and a hidden tab spends no rate limit.
assert.match(source, /if \(rollup !== "pending"\) return;[\s\S]{0,240}setInterval[\s\S]{0,160}30_000/, "a pending rollup schedules a 30s live-refresh");
assert.match(source, /document\.hidden\) return;[\s\S]{0,60}setTick/, "the live-refresh skips fetching while the tab is hidden");
assert.match(source, /const silent = keyRef\.current === key;[\s\S]{0,120}if \(!silent\) setState\(\{ status: "loading" \}\)/, "a same-PR refresh keeps the list mounted (no loading flash)");
assert.match(source, /else if \(!silent\) setState\(\{ status: "error" \}\)/, "a failed silent refresh keeps the last good list");

// Reaction parity: inline review-thread comments (GraphQL) carry reactionGroups
// mapped to the same REST slugs the timeline chips render.
assert.match(commentsRoute, /reactionGroups\{content reactors\{totalCount\}\}/, "the GraphQL thread query requests reactionGroups");
assert.match(commentsRoute, /const GQL_REACTION: Record<string, string> = \{[\s\S]{0,200}THUMBS_UP: "\+1"/, "GraphQL reaction enums map to REST slugs");
assert.match(commentsRoute, /reactions: gqlReactions\(co\.reactionGroups\)/, "thread comments carry their reaction counts");
assert.match(source, /thread\.comments\.map\(\(c\) => \([\s\S]{0,300}<CommentReactions reactions=\{c\.reactions\}/, "reactions render under inline thread comments");

console.log("github-advanced.test.ts OK");
