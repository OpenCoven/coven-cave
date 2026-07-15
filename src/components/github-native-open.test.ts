// @ts-nocheck
// cave-qcsv: GitHub-event inbox notifications open the NATIVE GitHub surface.
// github-watcher writes `link: { kind: "url", ref: <github html_url> }` on its
// items; every open path must route PR/issue URLs to mode "github" with a
// deep-link target — never a browser tab. Non-item GitHub URLs (actions runs,
// repo roots) keep the in-app browser fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const githubView = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");

// ── Workspace: one shared interceptor, used by every open path ───────────────
assert.match(
  workspace,
  /const openGitHubTarget = useCallback\(\(url: string \| null \| undefined\): boolean => \{\s*const target = parseGitHubItemUrl\(url\);\s*if \(!target\) return false;\s*setGithubTarget\(target\);\s*setMode\("github"\);\s*return true;/,
  "openGitHubTarget parses the URL and routes to the native GitHub surface",
);
assert.match(
  workspace,
  /if \(link\.ref\.startsWith\("\/"\)\) \{[\s\S]{0,120}\}\s*if \(openGitHubTarget\(link\.ref\)\) return;\s*openUrlInAppBrowser\(link\.ref\);/,
  "openReminderLink prefers the native GitHub surface before the in-app browser",
);
assert.match(
  workspace,
  /if \(item\.link\?\.kind === "url" && openGitHubTarget\(item\.link\.ref\)\) return;/,
  "inspector inbox opens route GitHub items natively before falling back to the Inbox surface",
);
assert.match(
  workspace,
  /\} else if \(item\.link\) \{[\s\S]{0,200}openReminderLink\(item\.link\);\s*\}/,
  "bell rows without a session fall through to the item link (native GitHub for watcher items)",
);
assert.match(
  workspace,
  /<GitHubView[\s\S]{0,200}initialTarget=\{githubTarget\}/,
  "the GitHub surface receives the deep-link target",
);
assert.match(
  workspace,
  /if \(mode !== "github" && githubTarget\) setGithubTarget\(null\);/,
  "leaving the surface clears the target so later visits don't re-open a stale item",
);

// ── GitHubView: deep link selects/synthesizes the item ───────────────────────
assert.match(
  githubView,
  /initialTarget\?: GitHubItemTarget \| null;/,
  "GitHubView accepts the deep-link target prop",
);
assert.match(
  githubView,
  /const listed = sorted\.find\(\(it\) => it\.repo === deepLink\.repo && it\.number === deepLink\.number\);/,
  "a listed activity row is preferred (real title/state + row highlight)",
);
assert.match(
  githubView,
  /id: `deeplink:\$\{deepLink\.repo\}#\$\{deepLink\.number\}`/,
  "an unlisted target synthesizes a minimal item so the detail pane can fetch it",
);
assert.match(
  githubView,
  /deepLinkItem \?\? sorted\.find\(\(item\) => item\.id === selectedItemId\) \?\? sorted\[0\] \?\? null/,
  "the deep-linked item wins the detail selection until the user picks a row",
);
assert.match(
  githubView,
  /const selectRow = useCallback\(\(id: string\) => \{\s*setDeepLink\(null\);\s*setSelectedItemId\(id\);/,
  "manual row selection clears the deep link",
);
assert.match(
  githubView,
  /sorted\.length === 0 && !deepLinkItem \?/,
  "an empty activity list still shows the deep-linked detail instead of the empty state",
);

console.log("github-native-open.test.ts: ok");
