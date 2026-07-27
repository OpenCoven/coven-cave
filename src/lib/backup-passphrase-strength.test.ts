import assert from "node:assert/strict";
import test from "node:test";

import { getBackupPassphraseStrength } from "./backup-passphrase-strength.ts";

test("backup passphrase strength follows the four-step General design scale", () => {
  assert.deepEqual(getBackupPassphraseStrength(""), {
    score: 0,
    label: "Passphrase required",
  });
  assert.deepEqual(getBackupPassphraseStrength("password"), {
    score: 1,
    label: "Weak passphrase",
  });
  assert.deepEqual(getBackupPassphraseStrength("longpasswordvalue"), {
    score: 2,
    label: "Fair passphrase",
  });
  assert.deepEqual(getBackupPassphraseStrength("password123456"), {
    score: 3,
    label: "Good passphrase",
  });
  assert.deepEqual(getBackupPassphraseStrength("password12345!"), {
    score: 4,
    label: "Strong passphrase",
  });
});
