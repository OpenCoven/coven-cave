import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowDockedComposer } from "./chat-composer-visibility.ts";

test("keeps the dock visible while following the latest turn", () => {
  assert.equal(
    shouldShowDockedComposer({
      following: true,
      hasStagedInput: false,
      releasedScrollDistance: 800,
      composerHeight: 160,
    }),
    true,
  );
});

test("keeps staged input visible regardless of scroll distance", () => {
  assert.equal(
    shouldShowDockedComposer({
      following: false,
      hasStagedInput: true,
      releasedScrollDistance: 800,
      composerHeight: 160,
    }),
    true,
  );
});

test("hides only after released scroll passes the measured dock height", () => {
  const input = {
    following: false,
    hasStagedInput: false,
    composerHeight: 160,
  };

  assert.equal(shouldShowDockedComposer({ ...input, releasedScrollDistance: 159 }), true);
  assert.equal(shouldShowDockedComposer({ ...input, releasedScrollDistance: 160 }), true);
  assert.equal(shouldShowDockedComposer({ ...input, releasedScrollDistance: 161 }), false);
});

test("fails closed when no dock height has been measured", () => {
  assert.equal(
    shouldShowDockedComposer({
      following: false,
      hasStagedInput: false,
      releasedScrollDistance: 0,
      composerHeight: 0,
    }),
    false,
  );
});
