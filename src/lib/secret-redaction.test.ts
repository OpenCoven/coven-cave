// @ts-nocheck
import assert from "node:assert/strict";
import {
  REDACTED_SECRET,
  containsSecretText,
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
  `{"TOKEN":"${REDACTED_SECRET}"}`,
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
for (const secretParameter of [
  "client_secret",
  "access_token",
  "refresh_token",
  "api_key",
  "password",
]) {
  const embeddedUrl =
    `See https://example.invalid/callback?${secretParameter}=query-secret&safe=visible`
    + `#${secretParameter}=fragment-secret&tab=details`;
  assert.equal(
    containsSecretText(embeddedUrl),
    true,
    `${secretParameter} URL query and fragment parameters are secret evidence`,
  );
  assert.equal(
    redactSecretText(embeddedUrl),
    `See https://example.invalid/callback?${secretParameter}=${REDACTED_SECRET}&safe=visible`
    + `#${secretParameter}=${REDACTED_SECRET}&tab=details`,
    `${secretParameter} URL query and fragment values are redacted in embedded URLs`,
  );
}
const safeOrdinaryUrl = "See https://example.invalid/callback?state=visible#tab=details";
assert.equal(
  containsSecretText(safeOrdinaryUrl),
  false,
  "ordinary URL query and fragment parameters remain safe evidence",
);
assert.equal(
  redactSecretText(safeOrdinaryUrl),
  safeOrdinaryUrl,
  "ordinary URLs remain intact during redaction",
);
const encodedUrlKey = "See https://example.invalid/callback?%6bey=short&safe=visible#%4b%45%59=fragment-secret&tab=details";
assert.equal(
  containsSecretText(encodedUrlKey),
  true,
  "decoded URL key parameters remain secret evidence",
);
assert.equal(
  redactSecretText(encodedUrlKey),
  `See https://example.invalid/callback?%6bey=${REDACTED_SECRET}&safe=visible#%4b%45%59=${REDACTED_SECRET}&tab=details`,
  "decoded URL key parameters redact while preserving the original encoding",
);
for (const [url, expected] of [
  [
    "/callback?key=relative-secret&safe=visible#key=fragment-secret&tab=details",
    `/callback?key=${REDACTED_SECRET}&safe=visible#key=${REDACTED_SECRET}&tab=details`,
  ],
  [
    "//example.invalid/callback?%6bey=protocol-relative-secret#%4b%45%59=fragment-secret",
    `//example.invalid/callback?%6bey=${REDACTED_SECRET}#%4b%45%59=${REDACTED_SECRET}`,
  ],
] as const) {
  assert.equal(
    containsSecretText(url),
    true,
    "relative and protocol-relative URL key parameters remain secret evidence",
  );
  assert.equal(
    redactSecretText(url),
    expected,
    "relative and protocol-relative URL key parameters redact without rewriting the URL",
  );
}
const safeRelativeUrl = "/callback?state=visible#tab=details";
assert.equal(
  containsSecretText(safeRelativeUrl),
  false,
  "ordinary relative URL query and fragment parameters remain safe evidence",
);
assert.equal(
  redactSecretText(safeRelativeUrl),
  safeRelativeUrl,
  "ordinary relative URLs remain intact during redaction",
);
for (const [ref, expected] of [
  ["?key=credential", `?key=${REDACTED_SECRET}`],
  ["#key=credential", `#key=${REDACTED_SECRET}`],
  ["?%6bey=credential", `?%6bey=${REDACTED_SECRET}`],
  ["#%6bey=credential", `#%6bey=${REDACTED_SECRET}`],
] as const) {
  assert.equal(
    containsSecretText(ref),
    true,
    "query-only and fragment-only relative references with secret parameters remain secret evidence",
  );
  assert.equal(
    redactSecretText(ref),
    expected,
    "query-only and fragment-only relative references redact without rewriting the reference",
  );
}
for (const safeReference of ["?state=visible", "#tab=details"] as const) {
  assert.equal(
    containsSecretText(safeReference),
    false,
    "ordinary query-only and fragment-only relative references remain safe evidence",
  );
  assert.equal(
    redactSecretText(safeReference),
    safeReference,
    "ordinary query-only and fragment-only relative references remain intact",
  );
}
assert.equal(
  containsSecretText("key=value"),
  false,
  "ordinary prose key assignments remain safe evidence",
);
assert.equal(
  redactSecretText("key=value"),
  "key=value",
  "ordinary prose key assignments remain intact",
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
  redactSecretText("passwords=hunter2"),
  `passwords=${REDACTED_SECRET}`,
  "password plurals are redacted in assignments",
);
assert.deepEqual(
  redactSecretsDeep({ databasePasswords: ["hunter2"] }),
  { databasePasswords: REDACTED_SECRET },
  "password plurals are redacted in compound object keys",
);
assert.equal(
  redactSecretText(
    "token_count=12 sessionDuration=30 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  ),
  "token_count=12 sessionDuration=30 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  "controlled compound matching does not absorb lookalike metric or ordinary keys",
);

const embeddedCompoundSecrets = {
  passwordConfirmation: "hunter2",
  passwordValue: "hunter2",
  passwordsByDatabase: ["hunter2"],
  authTokenValue: "hunter2",
  apiKeyValue: "hunter2",
  privateKeyValue: "hunter2",
  clientSecretUsage: "hunter2",
  refreshTokenCount: "hunter2",
  secretAccessKeyTotal: "hunter2",
};
assert.deepEqual(
  redactSecretsDeep(embeddedCompoundSecrets),
  Object.fromEntries(
    Object.keys(embeddedCompoundSecrets).map((key) => [key, REDACTED_SECRET]),
  ),
  "exact secret words and strong credential pairs are classified anywhere in compound keys",
);
assert.equal(
  redactSecretText(
    "passwordConfirmation=one passwordValue=two passwordsByDatabase=three authTokenValue=four apiKeyValue=five privateKeyValue=six clientSecretUsage=seven refreshTokenCount=eight secretAccessKeyTotal=nine",
  ),
  `passwordConfirmation=${REDACTED_SECRET} passwordValue=${REDACTED_SECRET} passwordsByDatabase=${REDACTED_SECRET} authTokenValue=${REDACTED_SECRET} apiKeyValue=${REDACTED_SECRET} privateKeyValue=${REDACTED_SECRET} clientSecretUsage=${REDACTED_SECRET} refreshTokenCount=${REDACTED_SECRET} secretAccessKeyTotal=${REDACTED_SECRET}`,
  "compound assignment classification matches structural key classification",
);

const safeMetricCompounds = {
  tokenCount: 12,
  token_count: 12,
  tokenUsage: 12,
  sessionDuration: 30,
  passwordLength: 24,
  tokenLimit: 4_096,
  secretTotal: 3,
  authorship: "collaboration",
  secretariat: "office",
  apiKeyboard: "mechanical",
};
assert.deepEqual(
  redactSecretsDeep(safeMetricCompounds),
  safeMetricCompounds,
  "controlled metric suffixes exempt exact secret-looking words without exempting credential pairs",
);
assert.equal(
  redactSecretText(
    "tokenCount=12 token_count=12 tokenUsage=12 sessionDuration=30 passwordLength=24 tokenLimit=4096 secretTotal=3 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  ),
  "tokenCount=12 token_count=12 tokenUsage=12 sessionDuration=30 passwordLength=24 tokenLimit=4096 secretTotal=3 authorship=collaboration secretariat=office apiKeyboard=mechanical",
  "safe metric compounds and ordinary lookalikes remain visible in assignment text",
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
  containsSecretText("Authorization: Basic authentication is disabled"),
  false,
  "Authorization documentation without a credential remains safe evidence",
);
assert.equal(
  containsSecretText("Authorization: Basic dXNlcjpwYXNz"),
  true,
  "Basic authorization with a credential-shaped base64 value remains secret text",
);
assert.equal(
  containsSecretText("Authorization: Bearer x"),
  true,
  "short Bearer authorization credentials remain secret text",
);
assert.equal(
  containsSecretText("Authorization: Token x"),
  true,
  "short Token authorization credentials remain secret text",
);
assert.equal(
  containsSecretText("Authorization: DPoP x"),
  true,
  "DPoP authorization with a one-token credential remains secret text",
);
assert.equal(
  redactSecretText("Authorization: DPoP x"),
  `Authorization: ${REDACTED_SECRET}`,
  "DPoP authorization headers redact the full credential regardless of length",
);
assert.equal(
  containsSecretText("Authorization: Proof_v1+demo x"),
  true,
  "arbitrary valid HTTP auth schemes with single-token credentials remain secret text",
);
assert.equal(
  containsSecretText("Authorization: DPoP proof is required"),
  false,
  "multi-word authorization documentation remains safe evidence for arbitrary schemes",
);
for (const authorization of [
  "Authorization: Signature keyId=demo,signature=abc123",
  "Authorization: Signature keyId=demo signature=abc123",
  "AUTHORIZATION=ApiKey key=abc123",
]) {
  assert.equal(
    containsSecretText(authorization),
    true,
    "authorization parameter credentials remain secret text for valid schemes",
  );
  assert.equal(
    redactSecretText(authorization),
    authorization.startsWith("AUTHORIZATION=")
      ? `AUTHORIZATION=${REDACTED_SECRET}`
      : `Authorization: ${REDACTED_SECRET}`,
    "authorization parameter credentials redact the complete authorization value",
  );
}
assert.equal(
  containsSecretText("Authorization: Signature request signing is required"),
  false,
  "authorization documentation without a credential token or parameter remains safe evidence",
);
const digestCredential = 'Authorization: Digest username="Mufasa", realm="test@example.invalid", nonce="abcdef1234567890", response="0123456789abcdef"';
assert.equal(
  containsSecretText(digestCredential),
  true,
  "Digest Authorization headers with credential parameters remain secret text",
);
assert.equal(
  redactSecretText(digestCredential),
  `Authorization: ${REDACTED_SECRET}`,
  "Digest Authorization headers redact all credential parameters as one value",
);
assert.equal(
  containsSecretText("Authorization: Bearer Abc123_def456-ghi789.jkl012Mno345"),
  true,
  "Bearer authorization with a token-shaped value remains secret text",
);
const ordinaryHexValues = [
  "0123456789abcdef0123456789abcdef",
  "0123456789abcdef0123456789abcdef01234567",
];
for (const ordinaryHexValue of ordinaryHexValues) {
  assert.equal(
    containsSecretText(`value ${ordinaryHexValue}`),
    true,
    "ordinary 32- and 40-character hexadecimal values remain secret-shaped globally",
  );
  assert.equal(
    containsSecretText(JSON.stringify({ value: ordinaryHexValue })),
    true,
    "ordinary hexadecimal JSON values remain secret-shaped globally",
  );
  assert.equal(
    redactSecretText(`value ${ordinaryHexValue}`),
    `value ${REDACTED_SECRET}`,
    "ordinary hexadecimal values are redacted outside scoped GitHub evidence handling",
  );
}
const hexApiKey = "a".repeat(64);
assert.equal(
  containsSecretText(`api key ${hexApiKey}`),
  true,
  "64-character hexadecimal API keys remain credential material outside explicit evidence handling",
);
assert.equal(
  redactSecretText(`api key ${hexApiKey}`),
  `api key ${REDACTED_SECRET}`,
  "64-character hexadecimal API keys are redacted rather than globally exempted",
);
assert.equal(
  containsSecretText(JSON.stringify({
    token: "QmFzZTY0Q3JlZGVudGlh" + "bFZhbHVlMTIzNDU2",
  })),
  true,
  "credential-shaped base64 in a sensitive JSON field remains secret text",
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

assert.equal(
  redactSecretText('{"token":\n"short private secret"}'),
  `{"token":"${REDACTED_SECRET}"}`,
  "complete JSON text redacts scalar values after JSON whitespace",
);
assert.equal(
  redactSecretText(String.raw`{"authori\u007Aation":"Basic dXNlcjpwYXNz"}`),
  `{"authorization":"${REDACTED_SECRET}"}`,
  "complete JSON text recognizes Unicode-escaped secret keys",
);

assert.equal(
  redactSecretText(String.raw`"\u0070assword=hunter2"`),
  JSON.stringify(`password=${REDACTED_SECRET}`),
  "complete JSON scalar strings are decoded before assignment redaction",
);
assert.deepEqual(
  redactSecretsDeep({
    stdout: String.raw`{"pass\u0077ord":"hunter2"}`,
  }),
  {
    stdout: JSON.stringify({ password: REDACTED_SECRET }),
  },
  "JSON represented inside structural string values is decoded and redacted",
);
const nestedJsonString = JSON.stringify(JSON.stringify("password=hunter2"));
assert.doesNotMatch(
  redactSecretText(nestedJsonString),
  /hunter2/,
  "nested JSON-looking strings are repeatedly decoded through the bounded work queue",
);
assert.equal(
  redactSecretText('"ordinary JSON scalar"'),
  '"ordinary JSON scalar"',
  "semantically safe JSON scalar strings remain intact",
);
assert.deepEqual(
  redactSecretsDeep({ stdout: '{"safe":"ordinary","count":3}' }),
  { stdout: '{"safe":"ordinary","count":3}' },
  "semantically safe JSON represented inside strings remains intact",
);

let repeatedlyEncodedSecret = "password=hunter2";
while (repeatedlyEncodedSecret.length < 100_000) {
  repeatedlyEncodedSecret = JSON.stringify(repeatedlyEncodedSecret);
}
assert.equal(
  redactSecretsDeep(repeatedlyEncodedSecret),
  REDACTED_SECRET,
  "repeated JSON string decoding fails closed when the cumulative byte budget is exhausted",
);

assert.equal(
  redactSecretText("password: correct horse battery staple\nnext: visible"),
  `password: ${REDACTED_SECRET}\nnext: visible`,
  "colon-style secret fields redact their complete multi-word value",
);
assert.equal(
  redactSecretText("password: first line\n  second line\n\tthird line\nnext: visible"),
  `password: ${REDACTED_SECRET}\nnext: visible`,
  "colon-style secret fields consume indented continuation lines",
);
assert.equal(
  redactSecretText("password:\nnext: visible"),
  `password:${REDACTED_SECRET}\nnext: visible`,
  "an empty colon field preserves a following non-indented line",
);
assert.equal(
  redactSecretText("Authorization: ApiKey short credential with suffix\nX-Trace: visible"),
  `Authorization: ${REDACTED_SECRET}\nX-Trace: visible`,
  "Authorization headers redact the full line for any scheme",
);
assert.equal(
  containsSecretText("authorization=opaque-credential"),
  true,
  "authorization assignments treat opaque nonempty credentials as secret evidence",
);
assert.equal(
  redactSecretText("authorization=opaque-credential"),
  `authorization=${REDACTED_SECRET}`,
  "authorization assignments redact opaque non-scheme credential values",
);
assert.equal(
  redactSecretText("password=short-secret && echo done\nnext=safe"),
  `password=${REDACTED_SECRET} && echo done\nnext=safe`,
  "equals assignments retain shell suffix operators and following lines",
);

const safeJsonValue = {
  safe: "ordinary value",
  nested: [{ count: 3, enabled: true }, null],
};
assert.deepEqual(
  JSON.parse(redactSecretText(` \n${JSON.stringify(safeJsonValue)}\t`)),
  safeJsonValue,
  "safe complete JSON text remains semantically intact",
);
for (const value of [null, false, 0, [], {}]) {
  const json = JSON.stringify({ token: value });
  assert.equal(
    containsSecretText(json),
    false,
    `decoded JSON token values such as ${json} use structured traversal without assignment-text false positives`,
  );
  assert.deepEqual(JSON.parse(redactSecretText(json)), { token: value });
}
const opaqueAuthorizationJson = JSON.stringify({ authorization: "opaque-credential" });
assert.equal(
  containsSecretText(opaqueAuthorizationJson),
  true,
  "decoded JSON authorization values treat opaque nonempty scalars as secret evidence",
);
assert.deepEqual(
  JSON.parse(redactSecretText(opaqueAuthorizationJson)),
  { authorization: REDACTED_SECRET },
  "decoded JSON authorization values redact opaque non-scheme credentials",
);
for (const value of [null, false, 0] as const) {
  const json = JSON.stringify({ authorization: value });
  assert.equal(
    containsSecretText(json),
    false,
    "authorization preserves the existing safe null/false/0 JSON semantics",
  );
  assert.deepEqual(
    JSON.parse(redactSecretText(json)),
    { authorization: value },
    "authorization preserves safe null/false/0 JSON values during redaction",
  );
}
for (const [key, value] of [["password", 123456], ["token", true]] as const) {
  const json = JSON.stringify({ [key]: value });
  assert.equal(
    containsSecretText(json),
    true,
    `meaningful ${typeof value} values under ${key} are secret evidence`,
  );
  assert.deepEqual(
    JSON.parse(redactSecretText(json)),
    { [key]: REDACTED_SECRET },
    `meaningful ${typeof value} values under ${key} are redacted from JSON`,
  );
  assert.deepEqual(
    redactSecretsDeep({ [key]: value }),
    { [key]: REDACTED_SECRET },
    `meaningful ${typeof value} values under ${key} are redacted from objects`,
  );
}

let veryDeep: Record<string, unknown> = { leaf: "raw-leaf-value" };
for (let depth = 0; depth < 20_000; depth += 1) {
  veryDeep = { child: veryDeep };
}
assert.doesNotThrow(
  () => redactSecretsDeep(veryDeep),
  "iterative structural redaction does not overflow on deeply nested objects",
);
assert.equal(
  redactSecretsDeep(veryDeep),
  REDACTED_SECRET,
  "values beyond the structural depth bound fail closed without retaining a raw leaf",
);

const veryWide = Object.fromEntries(
  Array.from({ length: 10_000 }, (_, index) => [`safe${index}`, `raw-${index}`]),
);
assert.equal(
  redactSecretsDeep(veryWide),
  REDACTED_SECRET,
  "objects beyond the structural entry bound fail closed",
);

const descriptorHeavyArray: unknown[] = [];
for (let index = 0; index < 10_000; index += 1) {
  Object.defineProperty(descriptorHeavyArray, `hidden${index}`, { value: index });
}
assert.equal(
  redactSecretsDeep(descriptorHeavyArray),
  REDACTED_SECRET,
  "arrays with excessive own entries fail closed even when the entries are not enumerable",
);

const cyclic: Record<string, unknown> = { visible: "raw-cycle-value" };
cyclic.self = cyclic;
assert.equal(
  redactSecretsDeep(cyclic),
  REDACTED_SECRET,
  "cyclic values fail closed",
);

let getterCalls = 0;
const accessorValue = {};
Object.defineProperty(accessorValue, "unsafe", {
  enumerable: true,
  get() {
    getterCalls += 1;
    return "raw-accessor-value";
  },
});
assert.equal(
  redactSecretsDeep(accessorValue),
  REDACTED_SECRET,
  "enumerable accessors fail closed",
);
assert.equal(getterCalls, 0, "structural redaction does not invoke enumerable getters");

assert.equal(
  redactSecretsDeep("x".repeat(256 * 1024 + 1)),
  REDACTED_SECRET,
  "structural strings beyond the cumulative byte bound fail closed",
);

console.log("secret-redaction.test.ts: ok");
