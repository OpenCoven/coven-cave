# Central Voice Settings Implementation Plan

> **For Val:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task, or `subagent-driven-development` if Val explicitly selects delegated execution.

**Goal:** Add a dedicated Settings → Voice provider hub, make ElevenLabs a first-class TTS option there, centralize provider labels/defaults/catalog behavior, and use the saved non-secret default only when creating new familiars.

**Architecture:** Introduce a dependency-light provider catalog and pure default-binding helper under `src/lib/voice/`. Canonical Cave preferences persist the non-secret creation default; Vault continues to own provider keys. A focused `VoiceProviderSettings` component owns cloud-provider readiness/catalog/default controls, while the existing `VoiceEngineSettings` component moves unchanged from General to Voice. Familiar Studio and the voice-session route consume the shared provider catalog so labels and fallback IDs cannot drift.

**Tech Stack:** TypeScript, React 19, Next.js App Router, Node test runner, Vitest for rendered TSX behavior where needed, canonical Cave preferences, existing Vault/voice APIs, existing Coven design primitives.

**Design reference:** `docs/superpowers/specs/2026-08-03-central-voice-settings-design.md`

**Bead/worktree:** `cave-ti4j9` on `feat/cave-ti4j9-voice-settings` in `.worktrees/cave-ti4j9-voice-settings`. This is an approved plain-worktree fallback, so retirement remains manual and bounded.

**Delivery guard:** Do not commit, push, open a PR, merge, close the Bead, or retire the fallback worktree without current authority. The commit commands below are checkpoints to use only after Val explicitly grants commit authority and the preceding verification passes.

---

## Task 1: Centralize provider metadata and runtime defaults

**Files:**

- Create: `src/lib/voice/provider-catalog.ts`
- Create: `src/lib/voice/provider-catalog.test.ts`
- Modify: `src/lib/voice/registry.ts`
- Modify: `src/lib/voice/registry.test.ts`
- Modify: `src/lib/voice/vault-key-recovery.ts`
- Modify: `src/lib/voice/vault-key-recovery.test.ts`
- Modify: `src/app/api/voice/session/route.ts`
- Modify: `src/app/api/voice/session/route.test.ts`
- Modify: `scripts/run-tests.mjs`

### Step 1: Write the failing provider-catalog test

Create `src/lib/voice/provider-catalog.test.ts` with the contract below. It pins one visible order for Settings and Familiar Studio, excludes unavailable Gemini from creation defaults, and proves existing OpenAI/ElevenLabs constants remain authoritative.

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECTABLE_VOICE_PROVIDER_IDS,
  VOICE_PROVIDER_CATALOG,
  getVoiceProviderDefinition,
  isSelectableVoiceProviderId,
} from "./provider-catalog.ts";
import { DEFAULT_OPENAI_VOICE_ID } from "./openai-voices.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs-shared.ts";

test("voice provider catalog has one stable UI order", () => {
  assert.deepEqual(
    VOICE_PROVIDER_CATALOG.map((provider) => provider.id),
    ["familiar", "elevenlabs", "openai", "local", "gemini"],
  );
  assert.deepEqual(
    SELECTABLE_VOICE_PROVIDER_IDS,
    ["familiar", "elevenlabs", "openai", "local"],
  );
});

test("Gemini remains visible but unavailable and cannot seed a familiar", () => {
  const gemini = getVoiceProviderDefinition("gemini");
  assert.equal(gemini?.available, false);
  assert.equal(gemini?.defaultable, false);
  assert.equal(isSelectableVoiceProviderId("gemini"), false);
});

test("cloud defaults compose their existing authoritative constants", () => {
  assert.deepEqual(getVoiceProviderDefinition("openai")?.defaults, {
    model: "gpt-realtime",
    voice: DEFAULT_OPENAI_VOICE_ID,
  });
  assert.deepEqual(getVoiceProviderDefinition("elevenlabs")?.defaults, {
    model: DEFAULT_ELEVENLABS_MODEL_ID,
    voice: DEFAULT_ELEVENLABS_VOICE_ID,
  });
});
```

Add the file next to the other voice tests in the app suite and to `ALIAS_LOADER` only if its final imports reach an `@/` alias. Run:

```bash
node --experimental-strip-types src/lib/voice/provider-catalog.test.ts
```

Expected: FAIL because `provider-catalog.ts` does not exist.

### Step 2: Implement the dependency-light catalog

Create `src/lib/voice/provider-catalog.ts`. Keep this module free of React, server-only code, and provider runtime adapters.

```ts
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs-shared.ts";
import { DEFAULT_OPENAI_VOICE_ID } from "./openai-voices.ts";
import type { VoiceProviderId } from "./types.ts";

export type SelectableVoiceProviderId = Exclude<VoiceProviderId, "gemini">;
export type VoiceProviderVaultKey =
  | "OPENAI_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "GOOGLE_API_KEY";

export type VoiceProviderDefinition = {
  id: VoiceProviderId;
  label: string;
  available: boolean;
  defaultable: boolean;
  vaultKey: VoiceProviderVaultKey | null;
  defaults: { model: string; voice: string };
};

export const VOICE_PROVIDER_CATALOG: readonly VoiceProviderDefinition[] = [
  {
    id: "familiar",
    label: "Familiar brain (true voice)",
    available: true,
    defaultable: true,
    vaultKey: null,
    defaults: { model: "", voice: "" },
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs (true voice)",
    available: true,
    defaultable: true,
    vaultKey: "ELEVENLABS_API_KEY",
    defaults: {
      model: DEFAULT_ELEVENLABS_MODEL_ID,
      voice: DEFAULT_ELEVENLABS_VOICE_ID,
    },
  },
  {
    id: "openai",
    label: "OpenAI Realtime",
    available: true,
    defaultable: true,
    vaultKey: "OPENAI_API_KEY",
    defaults: { model: "gpt-realtime", voice: DEFAULT_OPENAI_VOICE_ID },
  },
  {
    id: "local",
    label: "Local (on-device)",
    available: true,
    defaultable: true,
    vaultKey: null,
    defaults: { model: "llama3.2", voice: "" },
  },
  {
    id: "gemini",
    label: "Gemini Live",
    available: false,
    defaultable: false,
    vaultKey: "GOOGLE_API_KEY",
    defaults: { model: "", voice: "" },
  },
] as const;

export const SELECTABLE_VOICE_PROVIDER_IDS = VOICE_PROVIDER_CATALOG
  .filter((provider): provider is VoiceProviderDefinition & { id: SelectableVoiceProviderId } => provider.defaultable)
  .map((provider) => provider.id);

export const EDITABLE_VOICE_VAULT_KEYS = VOICE_PROVIDER_CATALOG
  .filter((provider) => provider.available && provider.defaultable && provider.vaultKey)
  .map((provider) => provider.vaultKey as VoiceProviderVaultKey);

export function getVoiceProviderDefinition(id: string): VoiceProviderDefinition | null {
  return VOICE_PROVIDER_CATALOG.find((provider) => provider.id === id) ?? null;
}

export function isSelectableVoiceProviderId(value: unknown): value is SelectableVoiceProviderId {
  return typeof value === "string" && SELECTABLE_VOICE_PROVIDER_IDS.includes(value as SelectableVoiceProviderId);
}
```

Do not duplicate OpenAI voice entries or ElevenLabs model/voice defaults here; import them.

### Step 3: Make the runtime registry and session route consume the catalog

In `src/lib/voice/registry.ts`, keep the adapter map unchanged and replace the hand-maintained `listVoiceProviders()` array with:

```ts
import { VOICE_PROVIDER_CATALOG } from "./provider-catalog.ts";

export function listVoiceProviders(): Array<{ id: VoiceProviderId; label: string }> {
  return VOICE_PROVIDER_CATALOG.map(({ id, label }) => ({ id, label }));
}
```

Update `src/lib/voice/registry.test.ts` to expect the centralized order.

In `src/lib/voice/vault-key-recovery.ts`, derive `VOICE_VAULT_KEY_BY_PROVIDER`
from `VOICE_PROVIDER_CATALOG` so provider-to-key identity is declared once.
Keep all error-code recovery behavior unchanged and update
`vault-key-recovery.test.ts` to prove OpenAI, ElevenLabs, and the unavailable
Gemini runtime retain their existing keys.

In `src/app/api/voice/session/route.ts`, delete both the local `DEFAULTS` object
and `KEYLESS_PROVIDERS` set. Resolve one definition after the runtime provider,
use `definition.vaultKey === null` as the keyless contract, and use:

```ts
import { getVoiceProviderDefinition } from "../../../../lib/voice/provider-catalog.ts";

const defaults = getVoiceProviderDefinition(familiar.voiceProvider)?.defaults ?? {
  model: "",
  voice: "",
};
```

Remove now-unused direct default imports. Extend `src/app/api/voice/session/route.test.ts` with source/behavior assertions proving the route imports the shared definition and no longer declares `const DEFAULTS` or `KEYLESS_PROVIDERS`.

### Step 4: Run the focused tests

```bash
node --experimental-strip-types src/lib/voice/provider-catalog.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/voice/registry.test.ts
node --experimental-strip-types src/lib/voice/vault-key-recovery.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/voice/session/route.test.ts
pnpm check:tests-wired
```

Expected: PASS.

### Step 5: Optional commit checkpoint

Only with explicit commit authority after the tests pass:

```bash
git add src/lib/voice/provider-catalog.ts src/lib/voice/provider-catalog.test.ts src/lib/voice/registry.ts src/lib/voice/registry.test.ts src/lib/voice/vault-key-recovery.ts src/lib/voice/vault-key-recovery.test.ts src/app/api/voice/session/route.ts src/app/api/voice/session/route.test.ts scripts/run-tests.mjs
git commit -m "refactor(voice): centralize provider catalog"
```

Otherwise leave the verified changes uncommitted and continue.

---

## Task 2: Add canonical non-secret voice preferences

**Files:**

- Modify: `src/lib/preferences-schema.ts`
- Modify: `src/lib/preferences-schema.test.ts`
- Modify: `src/lib/app-preferences.ts`
- Modify: `src/lib/app-preferences.test.ts`
- Modify: `scripts/sidecar-runtime-smoke.mjs`

### Step 1: Add failing preference tests

In `src/lib/preferences-schema.test.ts`, add cases for:

```ts
test("voice creation defaults are empty and non-secret", () => {
  assert.deepEqual(createDefaultPreferences().voice, {
    defaultProvider: "",
    defaultModel: "",
    defaultVoice: "",
  });
  assert.equal(JSON.stringify(createDefaultPreferences()).includes("API_KEY"), false);
});

test("voice defaults normalize bounded strings and reject unavailable providers", () => {
  assert.deepEqual(normalizeCavePreferences({ voice: {
    defaultProvider: "elevenlabs",
    defaultModel: " eleven_turbo_v2_5 ",
    defaultVoice: " 21m00Tcm4TlvDq8ikWAM ",
  }}).voice, {
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_turbo_v2_5",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
  });
  assert.deepEqual(normalizeCavePreferences({ voice: {
    defaultProvider: "gemini",
    defaultModel: "ignored",
    defaultVoice: "ignored",
  }}).voice, createDefaultPreferences().voice);
});

test("changing voice provider clears stale model and voice unless supplied", () => {
  const current = applyPreferencesPatch(createDefaultPreferences(), {
    voice: {
      defaultProvider: "elevenlabs",
      defaultModel: "eleven_turbo_v2_5",
      defaultVoice: "21m00Tcm4TlvDq8ikWAM",
    },
  });
  assert.deepEqual(applyPreferencesPatch(current, {
    voice: { defaultProvider: "local" },
  }).voice, {
    defaultProvider: "local",
    defaultModel: "",
    defaultVoice: "",
  });
});

test("voice patch validation rejects Gemini, secrets, and oversized ids", () => {
  assert.throws(() => validatePreferencesPatch({
    voice: { defaultProvider: "gemini" },
  }), /voice.defaultProvider/);
  assert.throws(() => validatePreferencesPatch({
    voice: { apiKey: "secret" },
  }), /voice.apiKey is not a supported preference/);
  assert.throws(() => validatePreferencesPatch({
    voice: { defaultModel: "x".repeat(129) },
  }), /voice.defaultModel/);
});
```

Run the focused schema test and confirm it fails before implementation:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/preferences-schema.test.ts
```

### Step 2: Extend the schema through every canonical seam

In `src/lib/preferences-schema.ts`:

```ts
import {
  isSelectableVoiceProviderId,
  type SelectableVoiceProviderId,
} from "./voice/provider-catalog.ts";

export const VOICE_PREFERENCE_ID_MAX_LENGTH = 128;
export type CaveVoicePreferences = {
  defaultProvider: "" | SelectableVoiceProviderId;
  defaultModel: string;
  defaultVoice: string;
};
```

Add `voice: CaveVoicePreferences` to `CavePreferences` and `voice?: Partial<CaveVoicePreferences>` to `CavePreferencesPatch`. Add the empty object to `createDefaultPreferences()`.

Add a bounded normalizer:

```ts
function normalizeVoicePreferenceId(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, VOICE_PREFERENCE_ID_MAX_LENGTH)
    : "";
}
```

In `normalizeCavePreferences()`, read `const voice = record(source.voice)` and emit no default when the provider is invalid:

```ts
const defaultProvider = isSelectableVoiceProviderId(voice.defaultProvider)
  ? voice.defaultProvider
  : "";

voice: {
  defaultProvider,
  defaultModel: defaultProvider ? normalizeVoicePreferenceId(voice.defaultModel) : "",
  defaultVoice: defaultProvider ? normalizeVoicePreferenceId(voice.defaultVoice) : "",
},
```

Add `voice` to the top-level patch allowlist. Strictly allow only `defaultProvider`, `defaultModel`, and `defaultVoice`; use `isSelectableVoiceProviderId()` for the provider and a `strictBoundedString()` helper for IDs.

In `applyPreferencesPatch()`, clear stale IDs on a provider switch unless the same patch explicitly supplies them:

```ts
const voicePatch = patch.voice;
const providerChanged = Boolean(
  voicePatch &&
  Object.hasOwn(voicePatch, "defaultProvider") &&
  voicePatch.defaultProvider !== current.voice.defaultProvider,
);

voice: {
  ...current.voice,
  ...(voicePatch ?? {}),
  ...(providerChanged && !Object.hasOwn(voicePatch!, "defaultModel")
    ? { defaultModel: "" }
    : {}),
  ...(providerChanged && !Object.hasOwn(voicePatch!, "defaultVoice")
    ? { defaultVoice: "" }
    : {}),
},
```

In `src/lib/app-preferences.ts`, include `candidate.voice` in `isCanonicalPreferencesPayload()`. Add a focused `src/lib/app-preferences.test.ts` assertion that an authoritative payload containing `voice` commits and a payload missing it is normalized only through the explicit legacy/bootstrap path, not accepted as already canonical.

### Step 3: Extend the packaged sidecar persistence proof

In `scripts/sidecar-runtime-smoke.mjs`, add this representative patch:

```js
voice: {
  defaultProvider: "elevenlabs",
  defaultModel: "eleven_turbo_v2_5",
  defaultVoice: "21m00Tcm4TlvDq8ikWAM",
},
```

After restart, assert:

```js
assert.deepEqual(restored.voice, preferencePatch.voice);
```

This is the end-to-end proof that the sidecar file preserves the new top-level object across port/process changes.

### Step 4: Run focused verification

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/preferences-schema.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/app-preferences.test.ts
pnpm check:tests-wired
```

Expected: PASS. Defer the full packaged sidecar smoke to Task 7 because it builds and restarts the application.

### Step 5: Optional commit checkpoint

Only with explicit commit authority:

```bash
git add src/lib/preferences-schema.ts src/lib/preferences-schema.test.ts src/lib/app-preferences.ts src/lib/app-preferences.test.ts scripts/sidecar-runtime-smoke.mjs
git commit -m "feat(voice): persist creation defaults"
```

---

## Task 3: Seed only newly created familiars

**Files:**

- Create: `src/lib/voice/new-familiar-defaults.ts`
- Create: `src/lib/voice/new-familiar-defaults.test.ts`
- Modify: `src/app/api/familiars/route.ts`
- Modify: `src/app/api/familiars/route.test.ts`
- Modify: `scripts/run-tests.mjs`

### Step 1: Write failing pure behavior tests

Create `src/lib/voice/new-familiar-defaults.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { voiceBindingForNewFamiliar } from "./new-familiar-defaults.ts";

test("no selected default leaves a new familiar voice-unconfigured", () => {
  assert.deepEqual(voiceBindingForNewFamiliar({
    defaultProvider: "",
    defaultModel: "",
    defaultVoice: "",
  }), {});
});

test("every selectable provider seeds only its explicit binding", () => {
  for (const defaultProvider of ["openai", "local", "familiar", "elevenlabs"]) {
    assert.deepEqual(voiceBindingForNewFamiliar({
      defaultProvider,
      defaultModel: " model-id ",
      defaultVoice: " voice-id ",
    }), {
      voiceProvider: defaultProvider,
      voiceModel: "model-id",
      voiceName: "voice-id",
    });
  }
});

test("corrupt or unavailable providers fail closed", () => {
  assert.deepEqual(voiceBindingForNewFamiliar({
    defaultProvider: "gemini",
    defaultModel: "gemini-model",
    defaultVoice: "Puck",
  }), {});
  assert.deepEqual(voiceBindingForNewFamiliar({
    defaultProvider: "unknown",
    defaultModel: "x",
    defaultVoice: "y",
  }), {});
});
```

Run it and confirm FAIL because the helper is absent.

### Step 2: Implement a server-safe, fail-closed binding helper

Create `src/lib/voice/new-familiar-defaults.ts`:

```ts
import type { FamiliarBinding } from "../cave-config.ts";
import { isSelectableVoiceProviderId } from "./provider-catalog.ts";

type StoredVoiceDefaults = {
  defaultProvider?: unknown;
  defaultModel?: unknown;
  defaultVoice?: unknown;
};

function boundedId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

export function voiceBindingForNewFamiliar(
  defaults: StoredVoiceDefaults,
): Pick<FamiliarBinding, "voiceProvider" | "voiceModel" | "voiceName"> {
  if (!isSelectableVoiceProviderId(defaults.defaultProvider)) return {};
  const voiceModel = boundedId(defaults.defaultModel);
  const voiceName = boundedId(defaults.defaultVoice);
  return {
    voiceProvider: defaults.defaultProvider,
    ...(voiceModel ? { voiceModel } : {}),
    ...(voiceName ? { voiceName } : {}),
  };
}
```

If `FamiliarBinding` is not exported at implementation time, export the existing type without changing its shape rather than creating a duplicate.

### Step 3: Wire the creation route without touching global defaults

In `src/app/api/familiars/route.ts`, import `loadPreferences` from `@/lib/server/preferences-store` and `voiceBindingForNewFamiliar` from the new helper. Immediately before `saveConfig`, load the canonical preference:

```ts
const preferences = await loadPreferences();
const voiceBinding = voiceBindingForNewFamiliar(preferences.voice);
```

Then extend only the new familiar entry:

```ts
await saveConfig({
  familiars: {
    [draft.id]: {
      harness: draft.harness,
      model: draft.model,
      ...voiceBinding,
      ...(draft.hermesProfile ? { hermesProfile: draft.hermesProfile } : {}),
      ...(draft.runtime ? { runtime: draft.runtime } : {}),
    },
  },
});
```

Do not add a `defaults` object and do not add voice fields to the onboarding request body. This ensures the server, not the dialog, decides the one-time seed at creation.

Extend `src/app/api/familiars/route.test.ts` to assert the preference load/helper call precede `saveConfig`, the spread lands inside `[draft.id]`, and the existing `assert.doesNotMatch(source, /defaults:\s*\{/)` continues to pass.

### Step 4: Run focused tests

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/voice/new-familiar-defaults.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/familiars/route.test.ts
pnpm check:tests-wired
```

Expected: PASS.

### Step 5: Optional commit checkpoint

Only with explicit commit authority:

```bash
git add src/lib/voice/new-familiar-defaults.ts src/lib/voice/new-familiar-defaults.test.ts src/app/api/familiars/route.ts src/app/api/familiars/route.test.ts scripts/run-tests.mjs
git commit -m "feat(familiars): seed voice defaults on creation"
```

---

## Task 4: Add a tested client boundary for Vault status and cloud catalogs

**Files:**

- Create: `src/lib/voice/settings-client.ts`
- Create: `src/lib/voice/settings-client.test.ts`
- Modify: `scripts/run-tests.mjs`

### Step 1: Write failing request/response tests

Create `src/lib/voice/settings-client.test.ts` around an injected `fetchImpl`. Cover:

- `/api/vault` returns only metadata for `OPENAI_API_KEY` and `ELEVENLABS_API_KEY`.
- Missing mappings are reported as `missing`, while a failed GET is `error`, never `missing`.
- key replacement POSTs exactly `{ key, storage: "encrypted", value }`.
- only the two catalog-declared Vault keys are accepted.
- the helper never returns or echoes the submitted secret.
- ElevenLabs catalog success preserves saved opaque model/voice IDs.
- malformed, missing-key, invalid-key, and network failures retain actionable `hint` text.

Use a public result type with explicit state:

```ts
export type ProviderCredentialState =
  | { status: "loading" }
  | { status: "configured"; storage: string | null }
  | { status: "missing" }
  | { status: "error"; message: string };
```

Run the file and confirm FAIL because the module is absent.

### Step 2: Implement the client API adapter

Create `src/lib/voice/settings-client.ts` with injected fetch functions so component behavior is independently testable:

```ts
import type {
  ElevenLabsModelOption,
  ElevenLabsVoiceOption,
} from "./elevenlabs-shared.ts";
import {
  EDITABLE_VOICE_VAULT_KEYS,
  type VoiceProviderVaultKey,
} from "./provider-catalog.ts";

export type FetchLike = typeof fetch;

export async function replaceVoiceProviderKey(
  fetchImpl: FetchLike,
  key: VoiceProviderVaultKey,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!EDITABLE_VOICE_VAULT_KEYS.includes(key)) {
    return { ok: false, error: "Unsupported voice credential." };
  }
  const response = await fetchImpl("/api/vault", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, storage: "encrypted", value }),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  return response.ok && body?.ok !== false
    ? { ok: true }
    : { ok: false, error: body?.error ?? "Couldn't save the provider key." };
}
```

Implement adjacent `loadVoiceCredentialStates()` and `loadElevenLabsCatalog()` functions with strict shape guards. Do not import `VaultPanel`; the Voice page needs a narrow provider-specific surface, not the full familiar-scoped Vault editor.

### Step 3: Run focused tests

```bash
node --experimental-strip-types src/lib/voice/settings-client.test.ts
pnpm check:tests-wired
```

Expected: PASS.

### Step 4: Optional commit checkpoint

Only with explicit commit authority:

```bash
git add src/lib/voice/settings-client.ts src/lib/voice/settings-client.test.ts scripts/run-tests.mjs
git commit -m "feat(voice): add settings provider data boundary"
```

---

## Task 5: Build the Voice provider settings surface

**Files:**

- Create: `src/components/voice-provider-settings.tsx`
- Create: `src/components/voice-provider-settings.test.tsx`
- Modify: `scripts/run-tests.mjs`

### Step 1: Write rendered behavior tests first

Add `src/components/voice-provider-settings.test.tsx` to `VITEST_TESTS`. Mock `fetch`, the preference store, `URL.createObjectURL`, and audio playback. Cover these user-visible contracts:

1. The provider picker contains None, Familiar brain, ElevenLabs, OpenAI Realtime, and Local in catalog order; Gemini is explanatory/disabled and is not a selectable default.
2. Changing from ElevenLabs to Local clears stale model/voice values through one typed preference patch.
3. ElevenLabs renders credential status, saved voices, TTS-capable models, refresh, and an opaque stored ID even when the latest catalog omits it.
4. Vault failure renders an error with Retry instead of “Not configured.”
5. Key replacement uses a labeled password input, never prefills it, clears it after success, refreshes Vault/catalog state, and announces the outcome.
6. OpenAI renders the reviewed `OPENAI_REALTIME_VOICES` details and preview controls; preview failures remain visible and retryable.
7. Local renders creation-default model/voice controls while local model download management remains a separate child in the page.
8. Familiar brain is keyless and explains that its runtime owns the brain.
9. Labels and errors are connected through `aria-describedby`; mutations use `useAnnouncer()`.

Run:

```bash
pnpm exec vitest run src/components/voice-provider-settings.test.tsx
```

Expected: FAIL because the component does not exist.

### Step 2: Implement focused provider/default controls

Create `src/components/voice-provider-settings.tsx` as a client component. Use:

```ts
const preferences = useAppPreferences();
const defaults = preferences.voice;

function saveDefaults(patch: Partial<CaveVoicePreferences>) {
  updateAppPreferences({ voice: patch });
  announce("Voice default updated.");
}
```

Render a `SettingsGroup label="Default for new familiars"` with a `StandardSelect` sourced from `VOICE_PROVIDER_CATALOG.filter(provider => provider.defaultable)`, preceded by `{ value: "", label: "None" }`. On provider change, send the provider plus its catalog defaults in one patch:

```ts
const definition = getVoiceProviderDefinition(next);
saveDefaults({
  defaultProvider: isSelectableVoiceProviderId(next) ? next : "",
  defaultModel: definition?.defaults.model ?? "",
  defaultVoice: definition?.defaults.voice ?? "",
});
```

Provider-specific controls:

- **ElevenLabs:** model and voice selects from `/api/voice/elevenlabs/catalog`, each augmented with a “Saved … ID” option if the persisted opaque ID is absent. Show configured/missing/error Vault status separately from catalog status. A Replace key disclosure uses a labeled password field and `replaceVoiceProviderKey()`.
- **OpenAI Realtime:** model defaults to `gpt-realtime`; voice select maps `OPENAI_REALTIME_VOICES` and `openAiVoiceDetail()`. Preview via `/api/voice/preview?voice=<id>` and stop/revoke the old object URL before a new preview.
- **Local:** a free-text “Local model” field plus a voice select derived from verified `/api/voice/engines` TTS entries, preserving an unavailable saved ID.
- **Familiar brain:** no model field; an optional platform/system voice ID and explanatory text.
- **Gemini:** a non-interactive note: “Gemini Live is not available yet.”

Use existing `SettingsGroup`, `SettingsRow`, `StandardSelect`, `Button`, `ErrorState`, `Skeleton`, and `useAnnouncer`. Use only design-token utility classes or existing settings classes; do not add raw colors, font px values, inline static styles, or motion.

Keep provider key state in local component state only. Never pass it to preferences, query parameters, error text, Beads, logs, or announcements.

### Step 3: Run rendered and static gates

```bash
pnpm exec vitest run src/components/voice-provider-settings.test.tsx
pnpm lint -- --no-cache
```

Expected: PASS. If the repo lint script does not forward `--no-cache`, run `pnpm lint` instead and record the exact command used.

### Step 4: Optional commit checkpoint

Only with explicit commit authority:

```bash
git add src/components/voice-provider-settings.tsx src/components/voice-provider-settings.test.tsx scripts/run-tests.mjs
git commit -m "feat(settings): add voice provider hub"
```

---

## Task 6: Wire Settings navigation, move Local speech, and share Studio ordering

**Files:**

- Modify: `src/components/settings-sections.ts`
- Modify: `src/components/settings-shell.tsx`
- Modify: `src/components/settings-overview.test.ts`
- Modify: `src/components/settings-search.test.ts`
- Modify: `src/components/settings-shell-polish.test.ts`
- Modify: `src/components/voice-engine-settings.tsx`
- Modify: `src/components/voice-engine-settings.test.ts`
- Modify: `src/components/familiar-studio-brain-tab.tsx`
- Modify: `src/components/familiar-studio-brain-tab.test.ts`

### Step 1: Add failing navigation and ownership assertions

Update the tests before implementation:

- `settings-overview.test.ts`: expected section IDs include `voice` between General and Daemon; Voice has icon/description/highlights; shell renders `section="voice"`.
- `settings-search.test.ts`: `Voice › Default for new familiars`, `Voice › ElevenLabs`, `Voice › OpenAI Realtime`, `Voice › Local speech`, and `Voice › Familiar brain` are unique destinations. General has no Local speech destination.
- `settings-shell-polish.test.ts`: General does not render `VoiceEngineSettings`; `VoiceSection` renders `VoiceProviderSettings` followed by `VoiceEngineSettings`.
- `voice-engine-settings.test.ts`: ownership copy says Settings → Voice while all download/remove/refresh/announcement contracts remain unchanged.
- `familiar-studio-brain-tab.test.ts`: provider options are mapped from `VOICE_PROVIDER_CATALOG`, not a local literal containing `ElevenLabs (true voice)`.

Run those files and confirm they fail on the absent Voice section.

### Step 2: Add the Voice section to the canonical Settings catalog

In `src/components/settings-sections.ts`:

```ts
export type Section =
  | "profile"
  | "general"
  | "voice"
  | "daemon"
  | "mobile"
  | "appearance"
  | "about";
```

Add this section metadata, using the already checked-in icon:

```ts
{
  id: "voice",
  label: "Voice",
  icon: "ph:waveform",
  description: "Providers, voices, local speech, and defaults for new familiars.",
  accent: "#73d9d0",
},
```

Add highlights:

```ts
voice: ["Provider readiness", "Voices & models", "New familiar defaults"],
```

Move the existing General Local speech index entry and add one unique entry per Voice group:

```ts
{ section: "voice", group: "Default for new familiars", keywords: "voice provider model default new familiar tts speech" },
{ section: "voice", group: "ElevenLabs", keywords: "elevenlabs key vault saved voices tts models cloud" },
{ section: "voice", group: "OpenAI Realtime", keywords: "openai realtime key vault voices preview cloud" },
{ section: "voice", group: "Local speech", keywords: "local speech piper kokoro offline download model remove" },
{ section: "voice", group: "Familiar brain", keywords: "familiar brain true voice runtime keyless" },
```

### Step 3: Add `VoiceSection` and remove Local speech from General

In `src/components/settings-shell.tsx`, import `VoiceProviderSettings`, add the renderer:

```tsx
{section === "voice" && <VoiceSection />}
```

Define:

```tsx
function VoiceSection() {
  return (
    <SettingsPage
      section="voice"
      title="Voice"
      description="Providers, models, voices, and creation defaults."
    >
      <VoiceProviderSettings />
      <VoiceEngineSettings />
    </SettingsPage>
  );
}
```

Delete only `<VoiceEngineSettings />` from `GeneralSection`; leave the component implementation and its live summary events intact. Update its doc comment to “Settings → Voice controls…”.

Do not opt Voice into General’s control-sheet summary variant unless rendered review demonstrates a concrete need; the approved design uses the standard section overview.

### Step 4: Make Familiar Studio consume the same provider options

In `src/components/familiar-studio-brain-tab.tsx`, import `VOICE_PROVIDER_CATALOG` and replace the local provider option literals with:

```ts
const voiceProviderOptions = useMemo(() => [
  { value: "", label: "None" },
  ...VOICE_PROVIDER_CATALOG.map((provider) => ({
    value: provider.id,
    label: provider.label,
    disabled: !provider.available,
  })),
], []);
```

Pass `options={voiceProviderOptions}` to `StandardSelect`. Provider-specific Studio behavior remains untouched; this step centralizes only ordering, labels, and availability.

### Step 5: Run focused integration tests

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/settings-overview.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/settings-search.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/settings-shell-polish.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/voice-engine-settings.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/familiar-studio-brain-tab.test.ts
```

Expected: PASS.

### Step 6: Optional commit checkpoint

Only with explicit commit authority:

```bash
git add src/components/settings-sections.ts src/components/settings-shell.tsx src/components/settings-overview.test.ts src/components/settings-search.test.ts src/components/settings-shell-polish.test.ts src/components/voice-engine-settings.tsx src/components/voice-engine-settings.test.ts src/components/familiar-studio-brain-tab.tsx src/components/familiar-studio-brain-tab.test.ts
git commit -m "feat(settings): centralize voice configuration"
```

---

## Task 7: Full verification, rendered review, and handoff

**Files:**

- Verify all changed files
- Update Bead `cave-ti4j9` with evidence; do not close it without completion authority

### Step 1: Prove every new test is wired

```bash
pnpm check:tests-wired
```

Expected: PASS with no unregistered `*.test.ts` or `*.test.tsx` files.

### Step 2: Run focused Voice and Settings tests together

```bash
node --experimental-strip-types src/lib/voice/provider-catalog.test.ts
node --experimental-strip-types src/lib/voice/settings-client.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/voice/new-familiar-defaults.test.ts
pnpm exec vitest run src/components/voice-provider-settings.test.tsx
pnpm test:api
pnpm test:app
```

Expected: PASS. If an unrelated pre-existing failure occurs, capture the exact failing test and reproduce it from clean `origin/main` before classifying it as unrelated.

### Step 3: Run static, design, and build gates

```bash
pnpm typecheck
pnpm lint
pnpm codemod:design:check
pnpm build
git diff --check
```

Expected: all PASS and `git diff --check` produces no output.

### Step 4: Run the packaged sidecar persistence smoke

Run the repository-owned packaged sidecar smoke:

```bash
pnpm test:sidecar-runtime
```

Expected: the restarted sidecar restores `preferences.voice` byte-for-value alongside the existing appearance/general/phone proof.

### Step 5: Verify the rendered Settings surface

For this web-only surface, use the user’s default browser or the native Tauri app; do not use a Codex browser preview. Preferred native command:

```bash
bash scripts/dev-app.sh
```

Keep it in the foreground. Verify:

- desktop width and a narrow width;
- dark mode, light mode, and one non-default theme;
- Settings nav/search opens Voice and each exact group;
- General no longer contains Local speech;
- default provider/model/voice changes persist after reload;
- a newly created disposable familiar receives the selected default while an existing familiar remains unchanged;
- ElevenLabs missing/configured/error states are distinguishable;
- catalog refresh preserves an opaque saved model/voice ID;
- key fields are blank on mount and after success; no secret appears in network responses;
- OpenAI preview play/stop/error behavior;
- Local model download/remove behavior remains intact;
- keyboard traversal, visible focus, labels, live announcements, and reduced-motion behavior.

Stop with `Ctrl-C`; confirm the wrapper tears down the processes it owns.

### Step 6: Walk the design-language §9 checklist

Explicitly record:

- only tokens/design primitives are used;
- all 42 theme combinations are structurally supported, with rendered spot checks noted above;
- no raw px text, inline static style, or render hex was added;
- sentence-case copy and exact `Search <items>…` grammar remain valid;
- focus rings, labels, `aria-describedby`, error roles, announcements, and reduced motion are covered;
- no new icon subset generation was needed because `ph:waveform` already exists.

### Step 7: Review the final diff and update the Bead

```bash
git status --short
git diff --stat
git diff -- docs/superpowers/specs/2026-08-03-central-voice-settings-design.md docs/superpowers/plans/2026-08-03-central-voice-settings.md src/lib/voice src/lib/preferences-schema.ts src/lib/app-preferences.ts src/app/api/familiars/route.ts src/app/api/voice/session/route.ts src/components/settings-sections.ts src/components/settings-shell.tsx src/components/voice-provider-settings.tsx src/components/voice-engine-settings.tsx src/components/familiar-studio-brain-tab.tsx scripts/run-tests.mjs scripts/sidecar-runtime-smoke.mjs
```

Check for accidental secret values, unrelated edits, copied provider arrays, and changes outside the approved scope.

Append exact verification evidence to `cave-ti4j9`, including worktree path, branch, commands, results, rendered proof, and any gap. Keep it `in_progress` unless the work is actively paused; if waiting on commit/push/PR authority, mark the precise maintainer action as the blocker according to the Beads protocol.

### Step 8: Delivery checkpoint

If Val has granted commit authority and all gates pass, make one clean squashable implementation commit (or retain the verified task commits if explicitly requested):

```bash
git add docs/superpowers/specs/2026-08-03-central-voice-settings-design.md docs/superpowers/plans/2026-08-03-central-voice-settings.md src scripts
git commit -m "feat(settings): centralize voice providers"
git status --short
```

Do not use this broad `git add` if unrelated changes appear; stage the exact reviewed file list instead. Do not push or open a PR unless separately authorized.

At handoff report:

- exact changed files;
- focused and full verification results;
- rendered proof and any gap;
- Bead status;
- commit/PR state;
- that fallback-worktree retirement is manual after merge.
