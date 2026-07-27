import assert from "node:assert/strict";
import test from "node:test";

import { getBackupPassphraseGuidance } from "./backup-passphrase-strength.ts";

test("backup passphrase guidance uses objective length milestones", () => {
  assert.deepEqual(getBackupPassphraseGuidance(""), {
    score: 0,
    label: "Passphrase required",
  });
  assert.deepEqual(getBackupPassphraseGuidance("short"), {
    score: 1,
    label: "Use at least 8 characters",
  });
  assert.deepEqual(getBackupPassphraseGuidance("password"), {
    score: 2,
    label: "Minimum length met",
  });
  assert.deepEqual(getBackupPassphraseGuidance("password12345!"), {
    score: 3,
    label: "14+ characters",
  });
  assert.deepEqual(getBackupPassphraseGuidance("correct horse battery staple"), {
    score: 4,
    label: "20+ characters",
  });
  assert.doesNotMatch(
    getBackupPassphraseGuidance("password12345!").label,
    /strong|good|secure/i,
    "length-only guidance must not make a security-strength claim",
  );
});
