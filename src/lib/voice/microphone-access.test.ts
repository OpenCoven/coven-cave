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

test("capture failures keep permission, hardware, and availability errors distinct", () => {
  const cases = [
    ["NotAllowedError", "microphone_denied"],
    ["SecurityError", "microphone_denied"],
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
