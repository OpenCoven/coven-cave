import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { notificationPayload } from "./native-notify.ts";

// Regression: the bell's "Sound → Silent" preference used to suppress the OS
// notification entirely, not just its sound. `sound()` in workspace.tsx maps
// silent mode to `null`, and native-notify returned early on `null` before it
// ever called `sendNotification`. The only surviving surface was then the
// in-app toast, which renders inside the Cave window — i.e. behind whatever
// app is frontmost. Users on Silent saw nothing at all while working
// elsewhere. Silence must mean "no ding", never "no banner".

test("silent mode still produces a notification, just without a sound", () => {
  const payload = notificationPayload("Reminder", "Stand up", null);
  assert.equal(payload.title, "Reminder");
  assert.equal(payload.body, "Stand up");
  assert.equal(
    "sound" in payload,
    false,
    "silent omits the sound field — the plugin only attaches a sound when one is supplied",
  );
});

test("platform default omits the sound field too", () => {
  const payload = notificationPayload("Reminder", "Stand up", undefined);
  assert.equal("sound" in payload, false);
});

test("a named sound is passed through verbatim", () => {
  assert.equal(notificationPayload("Reminder", "Stand up", "Glass").sound, "Glass");
  assert.equal(notificationPayload("Reminder", undefined, "Funk").sound, "Funk");
});

test("a missing body stays absent rather than becoming a string", () => {
  assert.equal(notificationPayload("Reminder").body, undefined);
});

// Source contract: guard the specific line that caused the bug, so a future
// "skip the notification when muted" shortcut cannot quietly reintroduce it.
// The mute path is handled upstream in workspace.tsx (`isMuted`), which never
// calls nativeNotify at all — this wrapper must not add a second kill switch.
const src = readFileSync(new URL("./native-notify.ts", import.meta.url), "utf8");

test("native-notify never returns early on a null sound", () => {
  assert.doesNotMatch(
    src,
    /sound\s*===\s*null\)\s*return/,
    "a null sound means silent, not suppressed — do not early-return before sendNotification",
  );
});

test("sendNotification is reached on every granted path", () => {
  assert.match(src, /await mod\.sendNotification\(notificationPayload\(title, body, sound\)\)/);
});
