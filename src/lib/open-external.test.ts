// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helper = await readFile(new URL("./open-external.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../components/settings-shell.tsx", import.meta.url), "utf8");

assert.match(
  helper,
  /export const OPEN_IN_APP_BROWSER_EVENT = "cave:open-url-in-browser"/,
  "shared URL helper should expose the in-app browser event name",
);
assert.match(
  helper,
  /export function openInAppBrowserUrl\(url: string\): void/,
  "shared URL helper should expose an explicitly named in-app browser opener",
);
assert.match(
  helper,
  /export function openExternalUrl\(url: string\): void/,
  "legacy openExternalUrl callers should be preserved behind the in-app browser handoff",
);
assert.match(
  helper,
  /window\.dispatchEvent\(new CustomEvent\(OPEN_IN_APP_BROWSER_EVENT, \{ detail: \{ url \} \}\)\)/,
  "same-page callers should dispatch an in-app browser navigation event",
);
assert.match(
  helper,
  /window\.sessionStorage\.setItem\(PENDING_IN_APP_BROWSER_URL_KEY, url\)/,
  "callers outside Workspace should persist a pending browser URL before routing home",
);
assert.match(
  helper,
  /window\.location\.assign\("\/#browser"\)/,
  "callers outside Workspace should route to the Workspace browser surface",
);
assert.doesNotMatch(
  helper,
  /shell_open|window\.open/,
  "shared external URL helper should not open the system browser or a new tab",
);

assert.match(
  settings,
  /import \{ openExternalUrl \} from "@\/lib\/open-external"/,
  "Settings should use the shared in-app browser URL helper",
);
for (const [label, href] of [
  ["GitHub", "https://github.com/OpenCoven/coven-cave"],
  ["Docs", "https://docs.opencoven.ai"],
  ["X", "https://x.com/OpenCvn"],
  ["Discord", "https://discord.gg/opencoven"],
  ["Grimoire", "https://mind.opencoven.ai"],
  ["Podcast", "https://pod.opencoven.ai"],
]) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    settings,
    new RegExp(`label: "${label}"[\\s\\S]{0,80}href: "${escapedHref}"`),
    `${label} routes to its exact Settings destination`,
  );
}
assert.match(
  settings,
  /\]\.map\(\(l\) => \([\s\S]{0,220}onClick=\{\(\) => openExternalUrl\(l\.href\)\}/,
  "every Settings link routes through the acknowledged in-app Browser handoff",
);
assert.doesNotMatch(
  settings,
  /target="_blank"/,
  "Settings links should not bypass the app with new external tabs",
);

console.log("open-external.test.ts: ok");
