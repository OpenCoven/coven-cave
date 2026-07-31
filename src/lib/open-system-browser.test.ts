import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./open-system-browser.ts", import.meta.url);
assert.ok(existsSync(moduleUrl), "open-system-browser.ts must exist");
const {
  cancelSystemBrowserOpen,
  openSystemBrowser,
  reserveSystemBrowserWindow,
} = await import("./open-system-browser.ts");

function popup() {
  const navigated: string[] = [];
  let closed = false;
  return {
    handle: {
      opener: {} as unknown,
      get closed() {
        return closed;
      },
      location: {
        replace(url: string) {
          navigated.push(url);
        },
      },
      close() {
        closed = true;
      },
    },
    navigated,
    isClosed: () => closed,
  };
}

const validAuthorizationUrl = new URL("https://x.com/i/oauth2/authorize");
validAuthorizationUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: "public-client-id",
  redirect_uri: "http://127.0.0.1:1456/x/oauth/callback",
  scope: "tweet.read users.read offline.access",
  state: "A".repeat(43),
  code_challenge: "B".repeat(43),
  code_challenge_method: "S256",
}).toString();

test("loopback browser reserves a blank window synchronously and navigates only later", async () => {
  const reservedPopup = popup();
  let opens = 0;
  const reservation = reserveSystemBrowserWindow({
    platform: "browser",
    hostname: "localhost",
    openWindow: () => {
      opens += 1;
      return reservedPopup.handle;
    },
  });

  assert.equal(opens, 1);
  assert.equal(reservation.ok, true);
  assert.equal(reservedPopup.handle.opener, null);
  assert.deepEqual(reservedPopup.navigated, []);

  const result = await openSystemBrowser(
    validAuthorizationUrl.toString(),
    reservation,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(reservedPopup.navigated, [
    validAuthorizationUrl.toString(),
  ]);
});

test("a reserved browser window closes when guarded OAuth start fails", () => {
  const reservedPopup = popup();
  const reservation = reserveSystemBrowserWindow({
    platform: "browser",
    hostname: "127.0.0.1",
    openWindow: () => reservedPopup.handle,
  });

  cancelSystemBrowserOpen(reservation);
  assert.equal(reservedPopup.isClosed(), true);
});

test("desktop Tauri invokes only the scoped X OAuth opener and does not reserve a browser window", async () => {
  let opens = 0;
  const calls: Array<[string, unknown]> = [];
  const reservation = reserveSystemBrowserWindow({
    platform: "desktop",
    hostname: "localhost",
    openWindow: () => {
      opens += 1;
      return null;
    },
  });

  assert.equal(opens, 0);
  const result = await openSystemBrowser(
    validAuthorizationUrl.toString(),
    reservation,
    {
      invoke: async (command, args) => {
        calls.push([command, args]);
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [[
    "open_x_oauth_url",
    { url: validAuthorizationUrl.toString() },
  ]]);
});

test("rejects arbitrary or malformed authorization navigation", async () => {
  for (const url of [
    "http://x.com/i/oauth2/authorize",
    "https://example.com/i/oauth2/authorize",
    "https://user:pass@x.com/i/oauth2/authorize",
    "https://x.com/i/oauth2/authorize#fragment",
    "https://x.com/other",
    "https://x.com/i/oauth2/authorize",
    `${validAuthorizationUrl.toString()}&next=https%3A%2F%2Fevil.example`,
    "not a URL",
  ]) {
    const reservedPopup = popup();
    const result = await openSystemBrowser(url, {
      ok: true,
      kind: "browser",
      popup: reservedPopup.handle,
    });
    assert.deepEqual(result, {
      ok: false,
      error: "X returned an invalid authorization URL.",
    }, url);
    assert.equal(reservedPopup.isClosed(), true, url);
    assert.deepEqual(reservedPopup.navigated, [], url);
  }
});

test("Tauri mobile and non-loopback web origins require desktop Cave", async () => {
  for (const input of [
    { platform: "ios" as const, hostname: "localhost" },
    { platform: "android" as const, hostname: "localhost" },
    { platform: "browser" as const, hostname: "cave.example.com" },
  ]) {
    const reservation = reserveSystemBrowserWindow({
      ...input,
      openWindow: () => {
        throw new Error("unsupported contexts must not reserve a window");
      },
    });
    assert.equal(reservation.ok, false);
    if (!reservation.ok) {
      assert.match(reservation.error, /desktop/i);
      assert.match(reservation.error, /localhost/i);
    }
    assert.equal(
      (await openSystemBrowser(validAuthorizationUrl.toString(), reservation)).ok,
      false,
    );
  }
});

test("popup blocking returns an actionable retry error", () => {
  const reservation = reserveSystemBrowserWindow({
    platform: "browser",
    hostname: "::1",
    openWindow: () => null,
  });
  assert.equal(reservation.ok, false);
  if (!reservation.ok) assert.match(reservation.error, /pop-up/i);
});
