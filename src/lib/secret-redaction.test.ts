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

assert.equal(
  redactSecretText("NPM_TOKEN=npm_example-token-123456789"),
  `NPM_TOKEN=${REDACTED_SECRET}`,
  "uppercase underscore-prefixed credential assignments are redacted",
);
assert.equal(
  redactSecretText("my-client-secret: client-secret-value-123456789"),
  `my-client-secret: ${REDACTED_SECRET}`,
  "hyphenated credential keys are redacted",
);
assert.equal(
  redactSecretText('OPENAI_API_KEY="example-openai-key-value"'),
  `OPENAI_API_KEY=${REDACTED_SECRET}`,
  "quoted assignment values are replaced as one complete value",
);
assert.equal(
  redactSecretText('GOOGLE_CREDENTIALS="{\\"private_key\\":\\"short-private-secret\\"}"'),
  `GOOGLE_CREDENTIALS=${REDACTED_SECRET}`,
  "escaped quotes in a double-quoted assignment do not leave secret fragments behind",
);
assert.equal(
  redactSecretText('GOOGLE_CREDENTIALS="{\\"type\\": \\"service_account\\", \\"private_key\\": \\"short private secret\\"}" && echo done'),
  `GOOGLE_CREDENTIALS=${REDACTED_SECRET} && echo done`,
  "spaces and commas inside quoted JSON are consumed while trailing shell text is preserved",
);
assert.equal(
  redactSecretText("CLIENT_SECRET='escaped \\'quote\\', path \\\\ value' ; echo done"),
  `CLIENT_SECRET=${REDACTED_SECRET} ; echo done`,
  "single-quoted escaped content is consumed through its actual closing quote",
);
assert.equal(
  redactSecretText("env NPM_TOKEN=npm_example-token-123456789 npm publish"),
  `env NPM_TOKEN=${REDACTED_SECRET} npm publish`,
  "credential assignments are redacted inside surrounding command text",
);
assert.equal(
  redactSecretText("metrics token_count=12 authorship=collaboration"),
  "metrics token_count=12 authorship=collaboration",
  "ordinary metric and word assignments are not treated as credential keys",
);

console.log("secret-redaction.test.ts: ok");
