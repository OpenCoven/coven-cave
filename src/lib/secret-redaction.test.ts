// @ts-nocheck
import assert from "node:assert/strict";
import {
  REDACTED_SECRET,
  redactSecretText,
  redactSecretsDeep,
} from "./secret-redaction.ts";

const raw = {
  ok: true,
  authToken: "ghp_1234567890abcdefghijklmnopqrstuv",
  nested: {
    note: "Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 should vanish",
    url: "https://alice:supersecret@example.invalid/path",
    safe: "metric_before stayed visible",
  },
  rows: [
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
    `OPENROUTER_API_KEY=${"sk-" + "or-v1-" + "a".repeat(64)}`,
    "nothing private here",
  ],
};

const redacted = redactSecretsDeep(raw);
const serialized = JSON.stringify(redacted);

assert.equal(redacted.authToken, REDACTED_SECRET, "suspicious object keys are replaced wholesale");
assert.doesNotMatch(
  serialized,
  /ghp_|sk-ant-api03|sk-proj-|sk-or-v1-|supersecret/,
  "known secret forms are removed",
);
assert.match(serialized, /metric_before stayed visible/, "ordinary eval metadata remains readable");
assert.match(serialized, /nothing private here/, "safe strings survive redaction");
assert.match(
  redactSecretText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"),
  new RegExp(REDACTED_SECRET),
  "bearer tokens are redacted in free text",
);

console.log("secret-redaction.test.ts: ok");
