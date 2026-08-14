// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helper = await readFile(new URL("./open-external.ts", import.meta.url), "utf8");
const about = await readFile(new URL("../components/settings-about.tsx", import.meta.url), "utf8");
const boardInspector = await readFile(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const homeComposer = await readFile(new URL("../components/home-composer.tsx", import.meta.url), "utf8");
const openExternalModule = await import("./open-external.ts");

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
assert.match(
  helper,
  /export function openExternalUrl\(url: string\): void \{\s*openInAppBrowserUrl\(url\);\s*\}/,
  "legacy external URLs should remain an in-app browser handoff",
);
assert.equal(
  typeof openExternalModule.openSystemBrowserUrl,
  "function",
  "cookie-sensitive destinations should have an explicit system-browser opener",
);
assert.equal(
  typeof openExternalModule.reserveSystemBrowserUrlWindow,
  "function",
  "async session starts should be able to reserve a browser window during user activation",
);

if (typeof openExternalModule.openSystemBrowserUrl === "function") {
  const desktopCalls: Array<[string, unknown]> = [];
  const desktopOpened = await openExternalModule.openSystemBrowserUrl(
    "https://fleet.omnigent.example/session/123",
    {
      tauri: true,
      invoke: async (command, args) => {
        desktopCalls.push([command, args]);
      },
    },
  );
  assert.equal(desktopOpened, true);
  assert.deepEqual(desktopCalls, [[
    "shell_open",
    { url: "https://fleet.omnigent.example/session/123" },
  ]]);

  const navigated: string[] = [];
  let popupClosed = false;
  const popup = {
    opener: {} as unknown,
    closed: false,
    location: { replace: (url: string) => navigated.push(url) },
    close: () => { popupClosed = true; },
  };
  const reservation = openExternalModule.reserveSystemBrowserUrlWindow({
    tauri: false,
    openWindow: () => popup,
  });
  const browserOpened = await openExternalModule.openSystemBrowserUrl(
    "https://fleet.omnigent.example/session/456",
    { reservation },
  );
  assert.equal(browserOpened, true);
  assert.equal(popup.opener, null);
  assert.deepEqual(navigated, ["https://fleet.omnigent.example/session/456"]);
  assert.equal(popupClosed, false);

  const cancelledReservation = openExternalModule.reserveSystemBrowserUrlWindow({
    tauri: false,
    openWindow: () => popup,
  });
  openExternalModule.cancelSystemBrowserUrlWindow(cancelledReservation);
  assert.equal(popupClosed, true);

  const fallbacks: string[] = [];
  const blocked = await openExternalModule.openSystemBrowserUrl(
    "https://fleet.omnigent.example/session/789",
    {
      tauri: false,
      openWindow: () => null,
      fallback: (url) => fallbacks.push(url),
    },
  );
  assert.equal(blocked, false);
  assert.deepEqual(fallbacks, ["https://fleet.omnigent.example/session/789"]);

  let unsafeOpened = false;
  const unsafe = await openExternalModule.openSystemBrowserUrl(
    "javascript:alert(1)",
    {
      tauri: true,
      invoke: async () => { unsafeOpened = true; },
      fallback: () => { unsafeOpened = true; },
    },
  );
  assert.equal(unsafe, false);
  assert.equal(unsafeOpened, false);
}

for (const [surface, source] of [
  ["task inspector", boardInspector],
  ["chat", chatView],
  ["home composer", homeComposer],
] as const) {
  assert.match(
    source,
    /openSystemBrowserUrl\(result\.webUrl, \{ reservation: systemBrowserReservation \}\)/,
    `${surface} should open Omnigent sessions in the system browser`,
  );
  assert.match(
    source,
    /const systemBrowserReservation = reserveSystemBrowserUrlWindow\(\);[\s\S]*?const result = await startOmnigentRunFromBrowser/,
    `${surface} should reserve its browser window before awaiting the Omnigent start`,
  );
}

assert.match(
  about,
  /import \{ openExternalUrl \} from "@\/lib\/open-external"/,
  "About should use the shared in-app browser URL helper",
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
  assert.match(about, new RegExp(escapedHref), `${label} keeps its exact Settings destination`);
}
assert.match(
  about,
  /onClick=\{\(\) => openExternalUrl\(card\.href\)\}/,
  "mapped Settings links route through the acknowledged in-app Browser handoff",
);
assert.match(
  about,
  /onClick=\{\(\) =>\s*openExternalUrl\("https:\/\/mind\.opencoven\.ai"\)\s*\}/,
  "featured Settings links route through the acknowledged in-app Browser handoff",
);
assert.doesNotMatch(
  about,
  /target="_blank"/,
  "Settings links should not bypass the app with new external tabs",
);

console.log("open-external.test.ts: ok");
