// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MicrophoneAccessError,
  classifyMicrophoneCaptureError,
  openMicrophoneSettings,
  requestMicrophoneStream,
} from "./microphone-access.ts";

const stream = { getTracks: () => [] } as unknown as MediaStream;

test("macOS permission is requested before webview capture", async () => {
  const events: string[] = [];
  const result = await requestMicrophoneStream({
    nativeMac: true,
    invoke: async (command) => {
      events.push(command);
      return { status: "granted" };
    },
    getUserMedia: async () => {
      events.push("getUserMedia");
      return stream;
    },
  });

  assert.equal(result, stream);
  assert.deepEqual(events, ["microphone_permission_request", "getUserMedia"]);
});

test("native denial stops capture and enables System Settings recovery", async () => {
  let captured = false;
  await assert.rejects(
    requestMicrophoneStream({
      nativeMac: true,
      invoke: async () => ({ status: "denied" }),
      getUserMedia: async () => {
        captured = true;
        return stream;
      },
    }),
    (error) => {
      assert.ok(error instanceof MicrophoneAccessError);
      assert.equal(error.code, "microphone_denied");
      assert.equal(error.canOpenSettings, true);
      assert.match(error.hint, /System Settings/);
      return true;
    },
  );
  assert.equal(captured, false);
});

test("older macOS falls through to webview capture when native preflight is unavailable", async () => {
  const result = await requestMicrophoneStream({
    nativeMac: true,
    invoke: async () => ({ status: "unavailable" }),
    getUserMedia: async () => stream,
  });

  assert.equal(result, stream);
});

test("missing native platform detection falls through to webview capture", async () => {
  let detected = false;
  const result = await requestMicrophoneStream({
    detectNativeMac: async () => {
      detected = true;
      throw new Error("plugin-os unavailable");
    },
    getUserMedia: async () => stream,
  });

  assert.equal(detected, true);
  assert.equal(result, stream);
});

test("iOS Tauri skips macOS preflight even when its webview identifies as Mac", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {},
      __TAURI_OS_PLUGIN_INTERNALS__: { platform: "ios" },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)" },
  });

  try {
    let invoked = false;
    const result = await requestMicrophoneStream({
      invoke: async () => {
        invoked = true;
        return { status: "denied" };
      },
      getUserMedia: async () => stream,
    });

    assert.equal(result, stream);
    assert.equal(invoked, false);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test("capture failures keep permission, hardware, and availability errors distinct", () => {
  const cases = [
    ["NotAllowedError", "microphone_denied"],
    ["NotFoundError", "microphone_not_found"],
    ["DevicesNotFoundError", "microphone_not_found"],
    ["NotReadableError", "microphone_unavailable"],
    ["TrackStartError", "microphone_unavailable"],
    ["AbortError", "microphone_unavailable"],
    ["OverconstrainedError", "microphone_unavailable"],
  ];

  for (const [name, code] of cases) {
    assert.equal(classifyMicrophoneCaptureError(new DOMException("capture failed", name)).code, code);
  }
});

test("capture disabled by document policy does not offer permission settings recovery", () => {
  const error = classifyMicrophoneCaptureError(
    new DOMException("capture disabled", "SecurityError"),
    true,
  );

  assert.equal(error.code, "microphone_unsupported");
  assert.equal(error.canOpenSettings, false);
  assert.doesNotMatch(error.hint, /System Settings/);
});

test("native prompt failures are not mislabeled as user denial", async () => {
  await assert.rejects(
    requestMicrophoneStream({
      nativeMac: true,
      invoke: async () => {
        throw new Error("IPC unavailable");
      },
      getUserMedia: async () => stream,
    }),
    (error) => {
      assert.ok(error instanceof MicrophoneAccessError);
      assert.equal(error.code, "microphone_permission_failed");
      assert.equal(error.canOpenSettings, false);
      return true;
    },
  );
});

test("desktop recovery opens the macOS microphone privacy pane", async () => {
  const commands: string[] = [];
  await openMicrophoneSettings(async (command) => {
    commands.push(command);
  });
  assert.deepEqual(commands, ["microphone_settings_open"]);
});
