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

assert.equal(
  redactSecretText('PASSWORD=""correct-horse-battery-staple'),
  `PASSWORD=${REDACTED_SECRET}`,
  "adjacent quoted and unquoted shell segments are consumed as one value",
);
assert.equal(
  redactSecretText("CLIENT_SECRET=short\\ private\\ secret"),
  `CLIENT_SECRET=${REDACTED_SECRET}`,
  "escaped shell whitespace remains part of the secret value",
);
assert.equal(
  redactSecretText('{"TOKEN":"short private secret"}'),
  `{"TOKEN":${REDACTED_SECRET}}`,
  "matching quoted JSON keys and values are redacted",
);
assert.equal(
  redactSecretText(
    'GOOGLE_CREDENTIALS={"type":"service_account","private_key":"short private secret"} && echo done',
  ),
  `GOOGLE_CREDENTIALS=${REDACTED_SECRET} && echo done`,
  "balanced JSON assignment values are consumed without swallowing a shell suffix",
);
assert.equal(
  redactSecretText('TOKEN=["short",{"nested":"private"}], safe=visible'),
  `TOKEN=${REDACTED_SECRET}, safe=visible`,
  "balanced array values are consumed through nested objects and strings",
);
assert.equal(
  redactSecretText('TOKEN="unterminated private value'),
  `TOKEN=${REDACTED_SECRET}`,
  "an unclosed secret quote fails safe through the end of the input",
);
assert.equal(
  redactSecretText('GOOGLE_CREDENTIALS={"private_key":"unterminated"'),
  `GOOGLE_CREDENTIALS=${REDACTED_SECRET}`,
  "an unclosed secret object fails safe through the end of the input",
);

const shortDeepSecrets = redactSecretsDeep({
  authToken: "short",
  GOOGLE_CREDENTIALS: "short",
  googleCredentials: { private_key: "short" },
  privateKey: "short",
  "client-secret": "short",
  refresh_token: "short",
  OPENAI_API_KEY: "short",
  NPM_TOKEN: "short",
});
assert.deepEqual(
  shortDeepSecrets,
  {
    authToken: REDACTED_SECRET,
    GOOGLE_CREDENTIALS: REDACTED_SECRET,
    googleCredentials: REDACTED_SECRET,
    privateKey: REDACTED_SECRET,
    "client-secret": REDACTED_SECRET,
    refresh_token: REDACTED_SECRET,
    OPENAI_API_KEY: REDACTED_SECRET,
    NPM_TOKEN: REDACTED_SECRET,
  },
  "camelCase, plural, paired, and prefixed credential keys replace whole deep values",
);

const ordinaryDeepValues = {
  authorship: "collaboration",
  token_count: 12,
  sessionDuration: 30,
  secretariat: "office",
  apiKeyboard: "mechanical",
  requestCount: 5,
};
assert.deepEqual(
  redactSecretsDeep(ordinaryDeepValues),
  ordinaryDeepValues,
  "ordinary words and metric keys are not classified as secrets",
);
assert.equal(
  redactSecretText(
    "authorship=collaboration token_count=12 sessionDuration=30 secretariat=office apiKeyboard=mechanical",
  ),
  "authorship=collaboration token_count=12 sessionDuration=30 secretariat=office apiKeyboard=mechanical",
  "ordinary assignments remain visible",
);

assert.equal(
  redactSecretText("token=short authorization=short bearer=short cookie=short jwt=short oauth=short password=short session=short"),
  `token=${REDACTED_SECRET} authorization=${REDACTED_SECRET} bearer=${REDACTED_SECRET} cookie=${REDACTED_SECRET} jwt=${REDACTED_SECRET} oauth=${REDACTED_SECRET} password=${REDACTED_SECRET} session=${REDACTED_SECRET}`,
  "common terminal credential terms are classified consistently",
);
assert.equal(
  redactSecretText("https://example.invalid/callback?token=short&safe=visible"),
  `https://example.invalid/callback?token=${REDACTED_SECRET}&safe=visible`,
  "URL query secret redaction remains intact",
);
assert.equal(
  redactSecretText("https://user:short-password@example.invalid/path"),
  `https://user:${REDACTED_SECRET}@example.invalid/path`,
  "basic-auth password redaction remains intact",
);
assert.equal(
  redactSecretText(`prefix sk-proj-${"a".repeat(32)} suffix`),
  `prefix ${REDACTED_SECRET} suffix`,
  "whole-token redaction remains intact",
);

const controlledCompoundSecrets = redactSecretsDeep({
  SECRET_KEY: "literal-secret",
  AWS_SECRET_ACCESS_KEY: "literal-secret",
  authTokens: "literal-secret",
  apiKeys: "literal-secret",
  clientSecrets: "literal-secret",
  credentials: "literal-secret",
});
assert.deepEqual(
  controlledCompoundSecrets,
  {
    SECRET_KEY: REDACTED_SECRET,
    AWS_SECRET_ACCESS_KEY: REDACTED_SECRET,
    authTokens: REDACTED_SECRET,
    apiKeys: REDACTED_SECRET,
    clientSecrets: REDACTED_SECRET,
    credentials: REDACTED_SECRET,
  },
  "controlled plurals and compound credential keys replace whole deep values",
);
assert.equal(
  redactSecretText(
    "SECRET_KEY=one AWS_SECRET_ACCESS_KEY=two authTokens=three apiKeys=four clientSecrets=five credentials=six",
  ),
  `SECRET_KEY=${REDACTED_SECRET} AWS_SECRET_ACCESS_KEY=${REDACTED_SECRET} authTokens=${REDACTED_SECRET} apiKeys=${REDACTED_SECRET} clientSecrets=${REDACTED_SECRET} credentials=${REDACTED_SECRET}`,
  "controlled plurals and compound credential assignments are redacted",
);
assert.equal(
  redactSecretText(
    "token_count=12 sessionDuration=30 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  ),
  "token_count=12 sessionDuration=30 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  "controlled compound matching does not absorb lookalike metric or ordinary keys",
);

assert.equal(
  redactSecretText(
    'GOOGLE_CREDENTIALS:\n  {"type":"service_account","private_key":"literal-secret"}\nnext=safe',
  ),
  `GOOGLE_CREDENTIALS:
  ${REDACTED_SECRET}
next=safe`,
  "balanced JSON values may begin after separator whitespace and a newline",
);
assert.equal(
  redactSecretText(
    `TOKEN=$(printf '%s' "literal-secret (nested)" \\) $(printf '%s' inner)) && echo done`,
  ),
  `TOKEN=${REDACTED_SECRET} && echo done`,
  "balanced shell command substitutions consume nested commands, quotes, and escapes",
);
assert.equal(
  redactSecretText('TOKEN=`printf "%s" "literal-secret" \\`` && echo done'),
  `TOKEN=${REDACTED_SECRET} && echo done`,
  "backtick command values consume escaped backticks as one secret assignment",
);
assert.equal(
  redactSecretText("Authorization: Basic dXNlcjpwYXNz"),
  `Authorization: ${REDACTED_SECRET}`,
  "Authorization schemes consume and redact the complete credential",
);
assert.equal(
  redactSecretText("TOKEN=$(printf 'literal-secret' && echo exposed"),
  `TOKEN=${REDACTED_SECRET}`,
  "an unclosed command substitution fails closed through the end of the input",
);
assert.equal(
  redactSecretText("TOKEN=`printf 'literal-secret' && echo exposed"),
  `TOKEN=${REDACTED_SECRET}`,
  "an unclosed backtick command fails closed through the end of the input",
);

console.log("secret-redaction.test.ts: ok");
