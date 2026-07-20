// @ts-nocheck
// cave-hlxn: subscribing/unsubscribing to GitHub events is one click away
// everywhere the events surface — the Rituals overview (manager + per-row
// unwatch) and the GitHub surface (watch chip for the repo you're viewing).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automations = [
  readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./automations/inbox-feed-list.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./automations/reminder-detail-panel.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./automations/ritual-overview.tsx", import.meta.url), "utf8"),
].join("\n");
const githubView = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");

// ── Rituals: the Subscriptions manager stays in the overview options menu ────
assert.match(
  automations,
  /<PopoverItem icon="ph:github-logo"[\s\S]{0,200}Subscriptions/,
  "the overview options menu offers Subscriptions",
);
assert.match(
  automations,
  /<GithubSubscriptionsModal\s*hasPat=\{subsHasPat\}/,
  "the button opens the shared GithubSubscriptionsModal",
);
assert.match(
  automations,
  /onConnectPat=\{\(\) => \{\s*setSubsOpen\(false\);\s*navigateToMode\("github"\);/,
  "connecting a PAT hands off to the GitHub surface",
);
assert.match(
  automations,
  /fetch\("\/api\/github\/pat", \{ cache: "no-store" \}\)/,
  "PAT status is resolved on open (not polled with the feed)",
);

// ── Rituals Inbox: one-click unwatch on GitHub-event rows ────────────────────
assert.match(
  automations,
  /const watchedRepo = repoFromGithubSubTag\(item\.auto\);/,
  "feed rows recognize GitHub-subscription notifications by their auto tag",
);
assert.match(
  automations,
  /icon="ph:bell-slash"[\s\S]{0,160}text="Unwatch"/,
  "GitHub-event rows offer a one-click Unwatch action",
);
assert.match(
  automations,
  /body: JSON\.stringify\(\{ repos: repos\.filter\(\(r\) => r !== repo\) \}\)/,
  "unwatch PATCHes the repo out of the subscriptions list",
);
assert.match(
  automations,
  /announce\(`Unwatched \$\{repo\} — no new GitHub notifications from it\.`\);/,
  "unwatch is announced for AT users",
);
assert.match(
  automations,
  /<RitualNeedsRow[\s\S]{0,700}onUnwatch=\{\(next, repo\) => void unwatchRepo\(next, repo\)\}/,
  "the visible Needs-you queue wires the unwatch handler through to GitHub rows",
);

// ── GitHub surface: watch the repo you're viewing ────────────────────────────
assert.match(
  githubView,
  /function WatchRepoChip\(\{ repo \}: \{ repo: string \}\) \{/,
  "the detail panel has a watch chip component",
);
assert.match(
  githubView,
  /<WatchRepoChip repo=\{item\.repo\} \/>/,
  "the glass panel renders the watch chip for the selected item's repo",
);
assert.match(
  githubView,
  /const body = watched \? \{ repos: next \} : \{ repos: next, enabled: true \};/,
  "the first watch also enables the watcher (watching implies notifications on)",
);
assert.match(
  githubView,
  /aria-pressed=\{watched\}/,
  "the chip exposes its toggle state via aria-pressed",
);
assert.match(
  githubView,
  /if \(watched === null\) return null;/,
  "the chip hides until the live watch state is known",
);
assert.match(
  githubView,
  /if \(!res\.ok \|\| !data\?\.ok\) \{/,
  "a failed subscriptions refresh must not derive an empty repos list (it would PATCH the watch list away)",
);

// ── Polish (cave-e4oz): honest labels ────────────────────────────────────────
// The DetailPanel's Link button names its native destination for GitHub items
// instead of printing a raw URL.
assert.match(
  automations,
  /const gh = parseGitHubItemUrl\(link\.ref\);\s*if \(gh\) return `Open in GitHub · \$\{gh\.repo\} #\$\{gh\.number\}`;/,
  "GitHub item links label as 'Open in GitHub · owner/repo #N'",
);

console.log("github-subscribe-ux.test.ts: ok");