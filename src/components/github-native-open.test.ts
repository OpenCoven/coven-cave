// @ts-nocheck
// cave-qcsv: GitHub-event inbox notifications open natively in Code Workshop.
// github-watcher writes `link: { kind: "url", ref: <github html_url> }` on its
// items; every open path must route PR/issue URLs into Code Workshop with a
// pending GitHub-item target — never a browser tab. Non-item GitHub URLs
// (actions runs, repo roots) keep the in-app browser fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const pendingNavigation = readFileSync(
  new URL("../lib/pending-code-navigation.ts", import.meta.url),
  "utf8",
);
const githubView = [
  readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./github-view-data.ts", import.meta.url), "utf8"),
].join("\n");

// ── Workspace: one shared interceptor, used by every open path ───────────────
assert.match(
  workspace,
  /const openGitHubTarget = useCallback\(\(url: string \| null \| undefined\): boolean => \{[\s\S]*?parseGitHubItemUrl\(url\)[\s\S]*?enqueuePendingCodeNavigation\(\{\s*kind: "github-item",\s*target,\s*nonce: Date\.now\(\),?\s*\}\);[\s\S]*?setMode\("code"\);[\s\S]*?return true;/,
  "PR/issue URLs enqueue native detail and enter Code Workshop",
);
assert.match(
  workspace,
  /if \(link\.ref\.startsWith\("\/"\)\) \{[\s\S]{0,120}\}\s*if \(openGitHubTarget\(link\.ref\)\) return;\s*openUrlInAppBrowser\(link\.ref\);/,
  "openReminderLink prefers the native GitHub surface before the in-app browser",
);
assert.doesNotMatch(
  workspace,
  /const openInspectorInboxItem/,
  "the retired inspector inbox helper stays removed; live inbox links use openReminderLink",
);
assert.match(
  workspace,
  /\} else if \(item\.link\) \{[\s\S]{0,200}openReminderLink\(item\.link\);\s*\}/,
  "bell rows without a session fall through to the item link (native GitHub for watcher items)",
);
assert.match(
  pendingNavigation,
  /acknowledgePendingCodeNavigation\(nonce: number\)[\s\S]*pending\?\.nonce !== nonce/,
  "a stale consumer cannot clear a newer GitHub target",
);
assert.match(
  workspace,
  /if \(mode !== roleSurfaceMode\(CODE_SURFACE_ID\)\) \{[\s\S]{0,80}?clearPendingCodeNavigation\(\);[\s\S]{0,40}?\}/,
  "leaving Code Workshop discards an unavailable room's unconsumed target",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*if \(mode !== roleSurfaceMode\(CODE_SURFACE_ID\)\) \{[\s\S]*?clearPendingCodeNavigation\(\);[\s\S]*?return;\s*\}\s*if \(!roleSurfaceSession\.context\) \{\s*if \(\s*!activeFamiliarHydrated\s*\|\|\s*!familiarsLoaded\s*\|\|\s*!familiarRosterLoadedSuccessfully\s*\) return;\s*clearPendingCodeNavigation\(\);[\s\S]*?return;\s*\}\s*if \(!roleSurfaceSession\.rolesLoaded\) return;\s*if \(!roleSurfaceSession\.visibleSurfaces\.some\(\(surface\) => surface\.id === CODE_SURFACE_ID\)\) \{[\s\S]*?clearPendingCodeNavigation\(\);[\s\S]*?\}\s*\}, \[\s*mode,\s*roleSurfaceSession\.context,\s*roleSurfaceSession\.rolesLoaded,\s*roleSurfaceSession\.visibleSurfaces,\s*activeFamiliarHydrated,\s*familiarsLoaded,\s*familiarRosterLoadedSuccessfully,\s*\]\);/,
  "pending Code navigation survives cold-load familiar settlement and only clears once no-context is definitive or loaded roles still exclude Code",
);
assert.doesNotMatch(workspace, /setGithubTarget|githubTarget/, "Workspace owns no standalone GitHub detail state");
assert.doesNotMatch(workspace, /<GitHubView/, "Workspace never renders GitHubView directly");

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
  /deepLinkItem \?\? sorted\.find\(sameSelectedTarget\) \?\? sorted\.find\(\(item\) => item\.id === transientSelectedItemId\) \?\? sorted\[0\] \?\? null/,
  "the deep-linked item wins the detail selection until the user picks a row",
);
assert.match(
  githubView,
  /const selectRow = useCallback\(\(id: string\) => \{\s*setDeepLink\(null\);[\s\S]{0,360}setSelectedTarget\(/,
  "manual row selection clears the deep link",
);
assert.match(
  githubView,
  /setTransientSelectedItemId\(id\);[\s\S]{0,360}setSelectedTarget\(/,
  "a notification without a durable issue number remains selected for the current visit",
);
assert.match(
  githubView,
  /sorted\.find\(sameSelectedTarget\) \?\? sorted\.find\(\(item\) => item\.id === transientSelectedItemId\)/,
  "the transient notification selection wins over the default first row",
);
assert.match(
  githubView,
  /sorted\.length === 0 && !deepLinkItem \?/,
  "an empty activity list still shows the deep-linked detail instead of the empty state",
);

console.log("github-native-open.test.ts: ok");
