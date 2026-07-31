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
    "https://x.com/i/oauth2/authorize?state=safe",
    reservation,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(reservedPopup.navigated, [
    "https://x.com/i/oauth2/authorize?state=safe",
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

test("desktop Tauri invokes only shell_open and does not reserve a browser window", async () => {
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
    "https://x.com/i/oauth2/authorize",
    reservation,
    {
      invoke: async (command, args) => {
        calls.push([command, args]);
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [[
    "shell_open",
    { url: "https://x.com/i/oauth2/authorize" },
  ]]);
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
      (await openSystemBrowser("https://x.com/i/oauth2/authorize", reservation)).ok,
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
