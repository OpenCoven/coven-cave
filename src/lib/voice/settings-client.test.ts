// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadElevenLabsCatalog,
  loadLocalVoiceCatalog,
  loadVoiceCredentialStates,
  replaceVoiceProviderKey,
} from "./settings-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function assertOmits(serializedValue: unknown, fragments: readonly string[]): void {
  const serialized = JSON.stringify(serializedValue);
  for (const fragment of fragments) assert.ok(!serialized.includes(fragment), `leaked ${fragment}`);
}

test("loads each editable Vault key independently and returns metadata only", async () => {
  const fixtureValue = "xi-secret-that-must-not-escape";
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const states = await loadVoiceCredentialStates(async (url, init) => {
    calls.push([url, init]);
    return jsonResponse({
      ok: true,
      credentials: [
        {
          key: "ELEVENLABS_API_KEY",
          status: "encrypted",
          hasValue: true,
          storage: "encrypted",
          source: "vault",
          ref: "op://private/secret",
          description: "private",
          scope: "shared",
          value: fixtureValue,
        },
        {
          key: "OPENAI_API_KEY",
          status: "no-ref",
          hasValue: false,
          storage: null,
          source: null,
        },
      ],
    });
  });

  assert.deepEqual(calls, [["/api/voice/credential-status", { cache: "no-store" }]]);
  assert.deepEqual(states, {
    ELEVENLABS_API_KEY: { status: "configured", storage: "encrypted", source: "vault" },
    OPENAI_API_KEY: { status: "missing" },
  });
  assert.doesNotMatch(JSON.stringify(states), new RegExp(fixtureValue));
  assert.deepEqual(Object.keys(states).sort(), ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"]);
});

test("accepts resolved and env-only Vault metadata with nullable storage", async () => {
  const states = await loadVoiceCredentialStates(async () => jsonResponse({
    ok: true,
    credentials: [
      { key: "ELEVENLABS_API_KEY", status: "resolved", hasValue: true, storage: "1password", source: "vault" },
      { key: "OPENAI_API_KEY", status: "env-only", hasValue: true, storage: null, source: "env-local" },
    ],
  }));

  assert.deepEqual(states, {
    ELEVENLABS_API_KEY: { status: "configured", storage: "1password", source: "vault" },
    OPENAI_API_KEY: { status: "configured", storage: null, source: "env-local" },
  });
});

test("classifies all current Vault status and storage combinations independently", async () => {
  const configured = [
    ["resolved", "1password", "vault"],
    ["resolved", "dashlane", "vault"],
    ["encrypted", "encrypted", "vault"],
    ["env-only", null, "process-env"],
    ["env-only", null, "env-local"],
  ];
  for (const [status, storage, source] of configured) {
    const states = await loadVoiceCredentialStates(async () => jsonResponse({
      ok: true,
      credentials: [
        { key: "OPENAI_API_KEY", status, hasValue: true, storage, source },
        { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
      ],
    }));
    assert.deepEqual(states.OPENAI_API_KEY, { status: "configured", storage, source });
    assert.deepEqual(states.ELEVENLABS_API_KEY, { status: "missing" });
  }

  const unavailable = [
    ["unresolved", "1password", "Credential could not be resolved."],
    ["unresolved", "dashlane", "Credential could not be resolved."],
    ["unresolved", "encrypted", "Credential could not be resolved."],
    ["error", "1password", "Credential could not be read."],
    ["error", "dashlane", "Credential could not be read."],
    ["error", "encrypted", "Credential could not be read."],
  ];
  for (const [status, storage, message] of unavailable) {
    const states = await loadVoiceCredentialStates(async () => jsonResponse({
      ok: true,
      credentials: [
        { key: "OPENAI_API_KEY", status, hasValue: false, storage, source: "vault" },
        { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
      ],
    }));
    assert.deepEqual(states.OPENAI_API_KEY, { status: "error", message });
    assert.deepEqual(states.ELEVENLABS_API_KEY, { status: "missing" });
  }
});

test("a Vault HTTP failure makes both providers error, never missing", async () => {
  const states = await loadVoiceCredentialStates(async () =>
    jsonResponse({ ok: false, error: "vault unavailable" }, 503));

  assert.equal(states.ELEVENLABS_API_KEY.status, "error");
  assert.equal(states.OPENAI_API_KEY.status, "error");
});

test("a malformed Vault success makes both providers error", async () => {
  for (const payload of [
    { ok: true },
    { ok: true, credentials: "not-an-array" },
    { ok: true, credentials: [{ key: "OPENAI_API_KEY", status: "resolved", hasValue: "yes", storage: null, source: "vault" }] },
    { ok: true, credentials: [
      { key: "OPENAI_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
      { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
      { key: "UNRELATED_API_KEY", status: "resolved", hasValue: true, storage: "1password", source: "vault" },
    ] },
  ]) {
    const states = await loadVoiceCredentialStates(async () => jsonResponse(payload));
    assert.equal(states.ELEVENLABS_API_KEY.status, "error");
    assert.equal(states.OPENAI_API_KEY.status, "error");
  }
});

test("a Vault network failure makes both providers error without leaking thrown text", async () => {
  const fixtureValue = "network-secret";
  const states = await loadVoiceCredentialStates(async () => {
    throw new Error(`offline ${fixtureValue}`);
  });

  assert.equal(states.ELEVENLABS_API_KEY.status, "error");
  assert.equal(states.OPENAI_API_KEY.status, "error");
  assert.doesNotMatch(JSON.stringify(states), new RegExp(fixtureValue));
});

test("unresolved and error Vault mappings use provider-specific static errors", async () => {
  const secretFragments = ["raw-secret", "RAW-SECRET", "r4w-s3cret"];
  const states = await loadVoiceCredentialStates(async () => jsonResponse({
    ok: true,
    credentials: [
      {
        key: "ELEVENLABS_API_KEY",
        status: "unresolved",
        hasValue: false,
        storage: "1password",
        source: "vault",
        error: `Sign in with ${secretFragments.join(" / ")}`,
      },
      {
        key: "OPENAI_API_KEY",
        status: "error",
        hasValue: false,
        storage: "encrypted",
        source: "vault",
        error: `Encrypted value ${secretFragments.join(" / ")} could not be read.`,
      },
    ],
  }));

  assert.deepEqual(states, {
    ELEVENLABS_API_KEY: { status: "error", message: "Credential could not be resolved." },
    OPENAI_API_KEY: { status: "error", message: "Credential could not be read." },
  });
  assertOmits(states, secretFragments);
});

test("rejects forged Vault enums and inconsistent status metadata without exporting input", async () => {
  const secretFragments = ["forged-secret", "FORGED-SECRET", "f0rg3d"];
  const mappings = [
    { key: "OPENAI_API_KEY", status: secretFragments[0], hasValue: true, storage: "encrypted", source: "vault" },
    { key: "OPENAI_API_KEY", status: "resolved", hasValue: true, storage: secretFragments[1], source: "vault" },
    { key: "OPENAI_API_KEY", status: "resolved", hasValue: false, storage: "1password", source: "vault" },
    { key: "OPENAI_API_KEY", status: "error", hasValue: true, storage: "encrypted", source: "vault" },
    { key: "OPENAI_API_KEY", status: "encrypted", hasValue: true, storage: "1password", source: "vault" },
    { key: "OPENAI_API_KEY", status: "no-ref", hasValue: false, storage: "encrypted", source: null },
    { key: "OPENAI_API_KEY", status: "resolved", hasValue: true, storage: "1password", source: "process-env" },
  ];

  for (const mapping of mappings) {
    const states = await loadVoiceCredentialStates(async () => jsonResponse({ ok: true, credentials: [
      mapping,
      { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
    ] }));
    assert.equal(states.ELEVENLABS_API_KEY.status, "error");
    assert.equal(states.OPENAI_API_KEY.status, "error");
    assertOmits(states, secretFragments);
  }
});

test("rejects credential responses that are not exactly the two allowlisted keys", async () => {
  const credentials = Array.from({ length: 10_001 }, (_, index) => ({ key: `UNRELATED_${index}` }));
  const states = await loadVoiceCredentialStates(async () => jsonResponse({ ok: true, credentials }));
  assert.equal(states.ELEVENLABS_API_KEY.status, "error");
  assert.equal(states.OPENAI_API_KEY.status, "error");
});

test("replaces either editable provider key with one exact encrypted Vault POST", async () => {
  for (const key of ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"]) {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const result = await replaceVoiceProviderKey(async (url, init) => {
      calls.push([url, init]);
      return jsonResponse({ ok: true, key, storage: "encrypted", value: "response-secret" });
    }, key, "  submitted-secret  ");

    assert.deepEqual(calls, [["/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, storage: "encrypted", value: "submitted-secret" }),
    }]]);
    assert.deepEqual(result, { ok: true });
    assert.doesNotMatch(JSON.stringify(result), /submitted-secret|response-secret/);
  }
});

test("rejects Gemini, unknown, and blank credential writes before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ ok: true });
  };

  assert.deepEqual(
    await replaceVoiceProviderKey(fetchImpl, "GOOGLE_API_KEY", "google-secret"),
    { ok: false, error: "Unsupported voice credential." },
  );
  assert.deepEqual(
    await replaceVoiceProviderKey(fetchImpl, "UNKNOWN_API_KEY", "unknown-secret"),
    { ok: false, error: "Unsupported voice credential." },
  );
  assert.deepEqual(
    await replaceVoiceProviderKey(fetchImpl, "OPENAI_API_KEY", "   "),
    { ok: false, error: "Provider key is required." },
  );
  assert.equal(calls, 0);
});

test("replacement returns safe errors for HTTP, application, malformed, and network failures", async () => {
  const submitted = "submitted-secret";
  const secretFragments = [submitted, "SUBMITTED-SECRET", "subm1tted"];
  const cases = [
    async () => jsonResponse({ ok: false, error: `Rejected ${secretFragments.join(" / ")}` }, 400),
    async () => jsonResponse({ ok: false, error: secretFragments[1] }),
    async () => new Response("not-json", { status: 200 }),
    async () => { throw new Error(`offline ${secretFragments.join(" / ")}`); },
  ];

  for (const fetchImpl of cases) {
    const result = await replaceVoiceProviderKey(fetchImpl, "OPENAI_API_KEY", submitted);
    assert.equal(result.ok, false);
    assert.deepEqual(result, { ok: false, error: "Couldn't save the provider key." });
    assertOmits(result, secretFragments);
  }
});

test("loads only verified ready local voices backed by an available runtime", async () => {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const result = await loadLocalVoiceCatalog(async (url, init) => {
    calls.push([url, init]);
    return jsonResponse({
      ok: true,
      ttsVoices: [
        { id: "piper-ready", name: "Piper ready", engine: "piper", ready: true, verified: true },
        { id: "piper-unverified", name: "Piper unverified", engine: "piper", ready: true, verified: false },
        { id: "kokoro-hidden", name: "Kokoro hidden", engine: "kokoro", ready: true, verified: true },
      ],
      runtimes: {
        piper: { available: true },
        kokoro: { available: false, hint: "response-controlled prose" },
      },
    });
  });

  assert.deepEqual(calls, [["/api/voice/engines", { cache: "no-store" }]]);
  assert.deepEqual(result, {
    status: "ready",
    voices: [{ id: "piper-ready", name: "Piper ready", engine: "piper" }],
  });
  assert.ok(Object.isFrozen(result.voices));
});

test("local voice catalog failures return static copy and honor cancellation", async () => {
  const malformed = await loadLocalVoiceCatalog(async () => jsonResponse({
    ok: true,
    ttsVoices: [{ id: "unsafe", name: "raw\nsecret", engine: "piper", ready: true, verified: true }],
    runtimes: { piper: { available: true } },
    error: "raw-secret",
  }));
  assert.deepEqual(malformed, {
    status: "error",
    message: "Couldn't load local voices. Try again after the local speech service starts.",
  });
  assert.doesNotMatch(JSON.stringify(malformed), /raw-secret/);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await loadLocalVoiceCatalog(async () => {
    throw Object.assign(new Error("secret"), { name: "AbortError" });
  }, controller.signal);
  assert.deepEqual(cancelled, {
    status: "error",
    message: "Local voice request was cancelled.",
  });
});

test("loads a strictly valid ElevenLabs catalog without changing opaque metadata", async () => {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const voices = [
    { id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
  ];
  const models = [
    { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
    { id: "eleven_flash_v2_5", name: "Flash v2.5" },
  ];
  const result = await loadElevenLabsCatalog(async (url, init) => {
    calls.push([url, init]);
    return jsonResponse({ ok: true, voices, models });
  });

  assert.deepEqual(calls, [["/api/voice/elevenlabs/catalog", { cache: "no-store" }]]);
  assert.deepEqual(result, { status: "ready", voices, models });
  assert.ok(Object.isFrozen(result.voices));
  assert.ok(Object.isFrozen(result.models));
  assert.ok(result.voices.every(Object.isFrozen));
  assert.ok(result.models.every(Object.isFrozen));
  assert.throws(() => result.voices.push({ id: "Frozen123", name: "Nope" }), TypeError);
  assert.throws(() => { result.voices[0].name = "Changed"; }, TypeError);
});

test("rejects a successful catalog when either option array is malformed", async () => {
  const validVoice = { id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" };
  const validModel = { id: "eleven_turbo_v2_5", name: "Turbo v2.5" };
  const payloads = [
    { ok: true, voices: "bad", models: [validModel] },
    { ok: true, voices: [validVoice], models: null },
    { ok: true, voices: [{ ...validVoice, id: "../secret" }], models: [validModel] },
    { ok: true, voices: [validVoice], models: [{ ...validModel, name: " " }] },
    { ok: true, voices: [{ ...validVoice, category: 42 }], models: [validModel] },
  ];

  for (const payload of payloads) {
    const result = await loadElevenLabsCatalog(async () => jsonResponse(payload));
    assert.equal(result.status, "error");
    assert.equal(result.code, "malformed_response");
  }
});

test("sanitizes catalog names and categories to bounded single-line text", async () => {
  const exactVoiceName = "v".repeat(200);
  const exactModelName = "m".repeat(200);
  const exactCategory = "c".repeat(100);
  const result = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: [{
      id: "AbCdEf123456",
      name: `${" ".repeat(20_000)}${exactVoiceName}${" ".repeat(20_000)}`,
      category: `   ${exactCategory}   `,
    }],
    models: [{ id: "eleven_turbo_v2_5", name: `   ${exactModelName}   ` }],
  }));

  assert.deepEqual(result, {
    status: "ready",
    voices: [{ id: "AbCdEf123456", name: exactVoiceName, category: exactCategory }],
    models: [{ id: "eleven_turbo_v2_5", name: exactModelName }],
  });

  const invalidTexts = [
    "line\nbreak",
    "tab\tbreak",
    "del\u007fbreak",
    "control\u0001break",
    "next-line\u0085break",
    "line-separator\u2028break",
    "paragraph-separator\u2029break",
    "n".repeat(201),
  ];
  for (const name of invalidTexts) {
    const invalid = await loadElevenLabsCatalog(async () => jsonResponse({
      ok: true,
      voices: [{ id: "AbCdEf123456", name }],
      models: [{ id: "eleven_turbo_v2_5", name: "Turbo" }],
    }));
    assert.equal(invalid.status, "error");
    assert.equal(invalid.code, "malformed_response");
  }

  const overlongCategory = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: [{ id: "AbCdEf123456", name: "Morgan", category: "c".repeat(101) }],
    models: [{ id: "eleven_turbo_v2_5", name: "Turbo" }],
  }));
  assert.equal(overlongCategory.status, "error");

  for (const category of [
    "line\nbreak",
    "tab\tbreak",
    "del\u007fbreak",
    "control\u0001break",
    "next-line\u0085break",
    "line-separator\u2028break",
    "paragraph-separator\u2029break",
  ]) {
    const invalid = await loadElevenLabsCatalog(async () => jsonResponse({
      ok: true,
      voices: [{ id: "AbCdEf123456", name: "Morgan", category }],
      models: [{ id: "eleven_turbo_v2_5", name: "Turbo" }],
    }));
    assert.equal(invalid.status, "error");
  }
});

test("rejects duplicate and excessive catalog options", async () => {
  const duplicateVoices = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: [
      { id: "AbCdEf123456", name: "Morgan" },
      { id: "AbCdEf123456", name: "Morgan again" },
    ],
    models: [{ id: "eleven_turbo_v2_5", name: "Turbo" }],
  }));
  assert.equal(duplicateVoices.status, "error");

  const duplicateModels = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: [{ id: "AbCdEf123456", name: "Morgan" }],
    models: [
      { id: "eleven_turbo_v2_5", name: "Turbo" },
      { id: "eleven_turbo_v2_5", name: "Turbo again" },
    ],
  }));
  assert.equal(duplicateModels.status, "error");

  const tooManyVoices = Array.from({ length: 10_001 }, (_, index) => ({
    id: `Voice${String(index).padStart(8, "0")}`,
    name: `Voice ${index}`,
  }));
  const excessiveVoices = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: tooManyVoices,
    models: [],
  }));
  assert.equal(excessiveVoices.status, "error");

  const tooManyModels = Array.from({ length: 1_001 }, (_, index) => ({
    id: `model_${index}`,
    name: `Model ${index}`,
  }));
  const excessiveModels = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: true,
    voices: [],
    models: tooManyModels,
  }));
  assert.equal(excessiveModels.status, "error");
});

test("maps allowlisted ElevenLabs errors to static local hints and exact missing key", async () => {
  const result = await loadElevenLabsCatalog(async () => jsonResponse({
    ok: false,
    error: "vault_key_unresolved",
    hint: "attacker-controlled raw-secret RAW-SECRET r4w-s3cret",
    missingKey: "ELEVENLABS_API_KEY",
    value: "raw-secret",
  }, 400));

  assert.deepEqual(result, {
    status: "error",
    message: "Set ELEVENLABS_API_KEY in Vault settings to browse your saved voices.",
    code: "vault_key_unresolved",
    hint: "Set ELEVENLABS_API_KEY in Vault settings to browse your saved voices.",
    missingKey: "ELEVENLABS_API_KEY",
  });
  assertOmits(result, ["raw-secret", "RAW-SECRET", "r4w-s3cret"]);
});

test("maps every allowlisted provider code to actionable local static copy", async () => {
  const expectations = [
    ["elevenlabs_key_invalid", "ElevenLabs rejected the API key. Replace ELEVENLABS_API_KEY in Vault settings."],
    ["elevenlabs_unreachable", "Couldn't reach ElevenLabs. Check your network connection and try again."],
    ["elevenlabs_catalog_failed", "ElevenLabs couldn't load the voice catalog. Try again."],
  ];
  for (const [code, hint] of expectations) {
    const result = await loadElevenLabsCatalog(async () => jsonResponse({
      ok: false,
      error: code,
      hint: "attacker-controlled raw-secret RAW-SECRET r4w-s3cret",
    }, 502));
    assert.equal(result.status, "error");
    assert.equal(result.code, code);
    assert.equal(result.hint, hint);
    assert.equal(result.message, hint);
    assertOmits(result, ["raw-secret", "RAW-SECRET", "r4w-s3cret"]);
  }
});

test("unknown catalog errors never preserve response-controlled code, hint, or missing key", async () => {
  const secretFragments = ["raw-secret", "RAW-SECRET", "r4w-s3cret"];
  for (const payload of [
    { error: secretFragments[0], hint: secretFragments.join(" / "), missingKey: "OPENAI_API_KEY" },
    { error: `elevenlabs_key_invalid_${secretFragments[1]}`, hint: secretFragments[2], missingKey: "ELEVENLABS_API_KEY" },
  ]) {
    const result = await loadElevenLabsCatalog(async () => jsonResponse({ ok: false, ...payload }, 502));
    assert.deepEqual(result, {
      status: "error",
      message: "Couldn't load the ElevenLabs catalog. Try again.",
      code: "http_error",
    });
    assertOmits(result, secretFragments);
  }
});

test("returns actionable safe errors for catalog HTTP, malformed JSON, and network failures", async () => {
  const cases = [
    async () => jsonResponse({ ok: false }, 503),
    async () => new Response("not-json", { status: 200 }),
    async () => { throw new Error("offline xi-secret-that-must-not-escape"); },
  ];

  for (const fetchImpl of cases) {
    const result = await loadElevenLabsCatalog(fetchImpl);
    assert.equal(result.status, "error");
    assert.equal(typeof result.message, "string");
    assert.ok(result.message.length > 0);
    assert.doesNotMatch(JSON.stringify(result), /xi-secret-that-must-not-escape/);
  }
});

test("propagates AbortSignal and returns static cancellation states", async () => {
  const secretFragments = ["abort-secret", "ABORT-SECRET", "ab0rt"];

  const vaultController = new AbortController();
  vaultController.abort();
  const vault = await loadVoiceCredentialStates(async (_url, init) => {
    assert.equal(init?.signal, vaultController.signal);
    throw new Error(secretFragments.join(" / "));
  }, vaultController.signal);
  assert.deepEqual(vault, {
    ELEVENLABS_API_KEY: { status: "error", message: "Voice credential request was cancelled." },
    OPENAI_API_KEY: { status: "error", message: "Voice credential request was cancelled." },
  });

  const replaceController = new AbortController();
  replaceController.abort();
  const replacement = await replaceVoiceProviderKey(async (_url, init) => {
    assert.equal(init?.signal, replaceController.signal);
    throw new DOMException(secretFragments.join(" / "), "AbortError");
  }, "OPENAI_API_KEY", "submitted-secret", replaceController.signal);
  assert.deepEqual(replacement, { ok: false, error: "Provider key update was cancelled." });

  const catalogController = new AbortController();
  catalogController.abort();
  const catalog = await loadElevenLabsCatalog(async (_url, init) => {
    assert.equal(init?.signal, catalogController.signal);
    throw new Error(secretFragments.join(" / "));
  }, catalogController.signal);
  assert.deepEqual(catalog, {
    status: "error",
    message: "ElevenLabs catalog request was cancelled.",
    code: "cancelled",
  });

  assertOmits({ vault, replacement, catalog }, secretFragments);
});

test("an AbortSignal cancelled as fetch resolves still wins over response data", async () => {
  const vaultController = new AbortController();
  const vault = await loadVoiceCredentialStates(async () => {
    vaultController.abort();
    return jsonResponse({ ok: true, credentials: [] });
  }, vaultController.signal);
  assert.equal(vault.OPENAI_API_KEY.status, "error");
  assert.equal(vault.OPENAI_API_KEY.message, "Voice credential request was cancelled.");

  const replaceController = new AbortController();
  const replacement = await replaceVoiceProviderKey(async () => {
    replaceController.abort();
    return jsonResponse({ ok: true });
  }, "OPENAI_API_KEY", "submitted-secret", replaceController.signal);
  assert.deepEqual(replacement, { ok: false, error: "Provider key update was cancelled." });

  const catalogController = new AbortController();
  const catalog = await loadElevenLabsCatalog(async () => {
    catalogController.abort();
    return jsonResponse({ ok: true, voices: [], models: [] });
  }, catalogController.signal);
  assert.deepEqual(catalog, {
    status: "error",
    message: "ElevenLabs catalog request was cancelled.",
    code: "cancelled",
  });
});
