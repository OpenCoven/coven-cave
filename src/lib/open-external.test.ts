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
assert.doesNotMatch(
  settings,
  /target="_blank"/,
  "Settings links should not bypass the app with new external tabs",
);

console.log("open-external.test.ts: ok");
