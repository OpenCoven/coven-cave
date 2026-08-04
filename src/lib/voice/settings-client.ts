import {
  isValidElevenLabsModelId,
  isValidElevenLabsVoiceId,
  type ElevenLabsModelOption,
  type ElevenLabsVoiceOption,
} from "./elevenlabs-shared.ts";
import {
  EDITABLE_VOICE_VAULT_KEYS,
  type VoiceProviderVaultKey,
} from "./provider-catalog.ts";

export type FetchLike = typeof fetch;

export type ProviderCredentialState =
  | { status: "loading" }
  | { status: "configured"; storage: VoiceCredentialStorage; source: VoiceCredentialSource }
  | { status: "missing" }
  | { status: "error"; message: string };

export type VoiceCredentialSource = "process-env" | "env-local" | "vault";

export type VoiceCredentialStorage =
  | "1password"
  | "encrypted"
  | "dashlane"
  | null;

export type VoiceCredentialStates = {
  ELEVENLABS_API_KEY: ProviderCredentialState;
  OPENAI_API_KEY: ProviderCredentialState;
};

export type ElevenLabsCatalogErrorCode =
  | "vault_key_unresolved"
  | "elevenlabs_key_invalid"
  | "elevenlabs_unreachable"
  | "elevenlabs_catalog_failed"
  | "http_error"
  | "malformed_response"
  | "network_error"
  | "cancelled";

export type ElevenLabsCatalogState =
  | {
      status: "ready";
      voices: readonly Readonly<ElevenLabsVoiceOption>[];
      models: readonly Readonly<ElevenLabsModelOption>[];
    }
  | {
      status: "error";
      message: string;
      code?: ElevenLabsCatalogErrorCode;
      hint?: string;
      missingKey?: "ELEVENLABS_API_KEY";
    };

export type ElevenLabsCatalogResult = ElevenLabsCatalogState;

export type ReplaceVoiceProviderKeyResult =
  | { ok: true }
  | { ok: false; error: string };

export type LocalVoiceOption = {
  readonly id: string;
  readonly name: string;
  readonly engine: "piper" | "kokoro";
};

export type LocalVoiceCatalogState =
  | { status: "ready"; voices: readonly Readonly<LocalVoiceOption>[] }
  | { status: "error"; message: string };

const VOICE_VAULT_KEYS = [
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
] as const;

type EditableVoiceVaultKey = (typeof VOICE_VAULT_KEYS)[number];

type VaultStatus =
  | "resolved"
  | "encrypted"
  | "env-only"
  | "unresolved"
  | "error"
  | "no-ref";

const VAULT_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "encrypted",
  "env-only",
  "unresolved",
  "error",
  "no-ref",
]);

const VAULT_STORAGES: ReadonlySet<VoiceCredentialStorage> = new Set([
  "1password",
  "encrypted",
  "dashlane",
  null,
]);

const MAX_ELEVENLABS_VOICES = 10_000;
const MAX_ELEVENLABS_MODELS = 1_000;
const MAX_OPTION_NAME_LENGTH = 200;
const MAX_VOICE_CATEGORY_LENGTH = 100;

const GENERIC_VAULT_LOAD_ERROR = "Couldn't load voice credential status.";
const CANCELLED_VAULT_LOAD_ERROR = "Voice credential request was cancelled.";
const GENERIC_KEY_SAVE_ERROR = "Couldn't save the provider key.";
const CANCELLED_KEY_SAVE_ERROR = "Provider key update was cancelled.";
const GENERIC_CATALOG_ERROR = "Couldn't load the ElevenLabs catalog. Try again.";
const MALFORMED_CATALOG_ERROR = "Couldn't load the ElevenLabs catalog. The server returned an invalid response.";
const NETWORK_CATALOG_ERROR = "Couldn't load the ElevenLabs catalog. Check your network connection and try again.";
const CANCELLED_CATALOG_ERROR = "ElevenLabs catalog request was cancelled.";
const GENERIC_LOCAL_VOICE_ERROR = "Couldn't load local voices. Try again after the local speech service starts.";
const CANCELLED_LOCAL_VOICE_ERROR = "Local voice request was cancelled.";

const ELEVENLABS_ERROR_COPY = Object.freeze({
  vault_key_unresolved: "Set ELEVENLABS_API_KEY in Vault settings to browse your saved voices.",
  elevenlabs_key_invalid: "ElevenLabs rejected the API key. Replace ELEVENLABS_API_KEY in Vault settings.",
  elevenlabs_unreachable: "Couldn't reach ElevenLabs. Check your network connection and try again.",
  elevenlabs_catalog_failed: "ElevenLabs couldn't load the voice catalog. Try again.",
} as const);

type ElevenLabsProviderErrorCode = keyof typeof ELEVENLABS_ERROR_COPY;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSingleLineText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (isRecord(error) && error.name === "AbortError");
}

function bothCredentialErrors(message: string): VoiceCredentialStates {
  return {
    ELEVENLABS_API_KEY: { status: "error", message },
    OPENAI_API_KEY: { status: "error", message },
  };
}

type VaultMappingMetadata = {
  key: EditableVoiceVaultKey;
  status: VaultStatus;
  hasValue: boolean;
  storage: VoiceCredentialStorage;
  source: VoiceCredentialSource | null;
};

function isVaultStatus(value: unknown): value is VaultStatus {
  return typeof value === "string" && VAULT_STATUSES.has(value);
}

function isVaultStorage(value: unknown): value is VoiceCredentialStorage {
  return VAULT_STORAGES.has(value as VoiceCredentialStorage);
}

function isVaultSource(value: unknown): value is VoiceCredentialSource | null {
  return value === "process-env" || value === "env-local" || value === "vault" || value === null;
}

function isSensibleVaultMapping(
  status: VaultStatus,
  storage: VoiceCredentialStorage,
  hasValue: boolean,
  source: VoiceCredentialSource | null,
): boolean {
  switch (status) {
    case "resolved":
      return hasValue && source === "vault" && (storage === "1password" || storage === "dashlane");
    case "encrypted":
      return hasValue && source === "vault" && storage === "encrypted";
    case "env-only":
      return hasValue && storage === null && (source === "process-env" || source === "env-local");
    case "unresolved":
    case "error":
      return !hasValue && source === "vault" && storage !== null;
    case "no-ref":
      return !hasValue && storage === null && source === null;
  }
}

function parseVoiceVaultMappings(payload: unknown): Map<EditableVoiceVaultKey, VaultMappingMetadata> | null {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.credentials)) {
    return null;
  }
  if (payload.credentials.length !== VOICE_VAULT_KEYS.length) return null;

  const mappings = new Map<EditableVoiceVaultKey, VaultMappingMetadata>();
  for (const raw of payload.credentials) {
    if (!isRecord(raw) || typeof raw.key !== "string") return null;
    if (!VOICE_VAULT_KEYS.includes(raw.key as EditableVoiceVaultKey)) return null;

    const key = raw.key as EditableVoiceVaultKey;
    if (
      mappings.has(key) ||
      !isVaultStatus(raw.status) ||
      typeof raw.hasValue !== "boolean" ||
      !isVaultStorage(raw.storage) ||
      !isVaultSource(raw.source) ||
      !isSensibleVaultMapping(raw.status, raw.storage, raw.hasValue, raw.source) ||
      !(raw.error === undefined || typeof raw.error === "string")
    ) {
      return null;
    }

    mappings.set(key, {
      key,
      status: raw.status,
      hasValue: raw.hasValue,
      storage: raw.storage,
      source: raw.source,
    });
  }
  return mappings.size === VOICE_VAULT_KEYS.length ? mappings : null;
}

export async function loadVoiceCredentialStates(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<VoiceCredentialStates> {
  let response: Response;
  try {
    response = await fetchImpl("/api/voice/credential-status", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    return bothCredentialErrors(
      isAbortFailure(error, signal) ? CANCELLED_VAULT_LOAD_ERROR : GENERIC_VAULT_LOAD_ERROR,
    );
  }

  if (signal?.aborted) return bothCredentialErrors(CANCELLED_VAULT_LOAD_ERROR);

  if (!response.ok) {
    return bothCredentialErrors(GENERIC_VAULT_LOAD_ERROR);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return bothCredentialErrors(
      isAbortFailure(error, signal) ? CANCELLED_VAULT_LOAD_ERROR : GENERIC_VAULT_LOAD_ERROR,
    );
  }
  if (signal?.aborted) return bothCredentialErrors(CANCELLED_VAULT_LOAD_ERROR);
  const mappings = parseVoiceVaultMappings(payload);
  if (!mappings) return bothCredentialErrors(GENERIC_VAULT_LOAD_ERROR);

  const states = {} as VoiceCredentialStates;
  for (const key of VOICE_VAULT_KEYS) {
    const mapping = mappings.get(key);
    if (!mapping) return bothCredentialErrors(GENERIC_VAULT_LOAD_ERROR);
    if (mapping.status === "no-ref") {
      states[key] = { status: "missing" };
      continue;
    }
    if (mapping.hasValue) {
      states[key] = { status: "configured", storage: mapping.storage, source: mapping.source! };
      continue;
    }
    states[key] = {
      status: "error",
      message: mapping.status === "unresolved"
        ? "Credential could not be resolved."
        : mapping.status === "error"
          ? "Credential could not be read."
          : "Credential is configured but not available.",
    };
  }
  return states;
}

export async function replaceVoiceProviderKey(
  fetchImpl: FetchLike,
  key: VoiceProviderVaultKey,
  value: string,
  signal?: AbortSignal,
): Promise<ReplaceVoiceProviderKeyResult> {
  if (!EDITABLE_VOICE_VAULT_KEYS.includes(key)) {
    return { ok: false, error: "Unsupported voice credential." };
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) return { ok: false, error: "Provider key is required." };

  let response: Response;
  try {
    response = await fetchImpl("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, storage: "encrypted", value: trimmedValue }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: isAbortFailure(error, signal) ? CANCELLED_KEY_SAVE_ERROR : GENERIC_KEY_SAVE_ERROR,
    };
  }

  if (signal?.aborted) return { ok: false, error: CANCELLED_KEY_SAVE_ERROR };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      error: isAbortFailure(error, signal) ? CANCELLED_KEY_SAVE_ERROR : GENERIC_KEY_SAVE_ERROR,
    };
  }
  if (signal?.aborted) return { ok: false, error: CANCELLED_KEY_SAVE_ERROR };
  if (response.ok && isRecord(payload) && payload.ok === true) return { ok: true };
  return { ok: false, error: GENERIC_KEY_SAVE_ERROR };
}

function parseVoiceOption(value: unknown): Readonly<ElevenLabsVoiceOption> | null {
  if (!isRecord(value) || !isValidElevenLabsVoiceId(value.id)) return null;
  const name = safeSingleLineText(value.name, MAX_OPTION_NAME_LENGTH);
  const category = value.category === undefined
    ? undefined
    : safeSingleLineText(value.category, MAX_VOICE_CATEGORY_LENGTH);
  if (!name || (value.category !== undefined && !category)) return null;
  return Object.freeze({
    id: value.id,
    name,
    ...(category ? { category } : {}),
  });
}

function parseModelOption(value: unknown): Readonly<ElevenLabsModelOption> | null {
  if (!isRecord(value) || !isValidElevenLabsModelId(value.id)) return null;
  const name = safeSingleLineText(value.name, MAX_OPTION_NAME_LENGTH);
  return name ? Object.freeze({ id: value.id, name }) : null;
}

function parseCatalogSuccess(payload: unknown): Extract<ElevenLabsCatalogState, { status: "ready" }> | null {
  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    !Array.isArray(payload.voices) ||
    !Array.isArray(payload.models)
  ) {
    return null;
  }
  if (
    payload.voices.length > MAX_ELEVENLABS_VOICES ||
    payload.models.length > MAX_ELEVENLABS_MODELS
  ) {
    return null;
  }

  const voiceIds = new Set<string>();
  const voices: Readonly<ElevenLabsVoiceOption>[] = [];
  for (const raw of payload.voices) {
    const voice = parseVoiceOption(raw);
    if (!voice || voiceIds.has(voice.id)) return null;
    voiceIds.add(voice.id);
    voices.push(voice);
  }

  const modelIds = new Set<string>();
  const models: Readonly<ElevenLabsModelOption>[] = [];
  for (const raw of payload.models) {
    const model = parseModelOption(raw);
    if (!model || modelIds.has(model.id)) return null;
    modelIds.add(model.id);
    models.push(model);
  }

  return {
    status: "ready",
    voices: Object.freeze(voices),
    models: Object.freeze(models),
  };
}

function isElevenLabsProviderErrorCode(value: unknown): value is ElevenLabsProviderErrorCode {
  return typeof value === "string" && Object.hasOwn(ELEVENLABS_ERROR_COPY, value);
}

function catalogError(
  message: string,
  options: { code?: ElevenLabsCatalogErrorCode; hint?: string; missingKey?: "ELEVENLABS_API_KEY" } = {},
): ElevenLabsCatalogState {
  return { status: "error", message, ...options };
}

function catalogResponseError(payload: unknown): ElevenLabsCatalogState {
  if (!isRecord(payload) || !isElevenLabsProviderErrorCode(payload.error)) {
    return catalogError(GENERIC_CATALOG_ERROR, { code: "http_error" });
  }

  const code = payload.error;
  const hint = ELEVENLABS_ERROR_COPY[code];
  return catalogError(hint, {
    code,
    hint,
    ...(code === "vault_key_unresolved" && payload.missingKey === "ELEVENLABS_API_KEY"
      ? { missingKey: "ELEVENLABS_API_KEY" as const }
      : {}),
  });
}

export async function loadElevenLabsCatalog(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<ElevenLabsCatalogResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/voice/elevenlabs/catalog", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    return isAbortFailure(error, signal)
      ? catalogError(CANCELLED_CATALOG_ERROR, { code: "cancelled" })
      : catalogError(NETWORK_CATALOG_ERROR, { code: "network_error" });
  }
  if (signal?.aborted) {
    return catalogError(CANCELLED_CATALOG_ERROR, { code: "cancelled" });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return isAbortFailure(error, signal)
      ? catalogError(CANCELLED_CATALOG_ERROR, { code: "cancelled" })
      : catalogError(MALFORMED_CATALOG_ERROR, { code: "malformed_response" });
  }
  if (signal?.aborted) {
    return catalogError(CANCELLED_CATALOG_ERROR, { code: "cancelled" });
  }
  if (!response.ok || (isRecord(payload) && payload.ok === false)) {
    return catalogResponseError(payload);
  }

  const ready = parseCatalogSuccess(payload);
  if (ready) return ready;
  return catalogError(MALFORMED_CATALOG_ERROR, {
    code: "malformed_response",
  });
}

function parseLocalVoiceCatalog(payload: unknown): LocalVoiceCatalogState | null {
  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    !Array.isArray(payload.ttsVoices) ||
    !isRecord(payload.runtimes)
  ) {
    return null;
  }
  if (payload.ttsVoices.length > MAX_ELEVENLABS_VOICES) return null;

  const runtimes = payload.runtimes;
  const seen = new Set<string>();
  const voices: Readonly<LocalVoiceOption>[] = [];
  for (const raw of payload.ttsVoices) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !raw.id ||
      raw.id.length > MAX_OPTION_NAME_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(raw.id) ||
      seen.has(raw.id) ||
      (raw.engine !== "piper" && raw.engine !== "kokoro") ||
      typeof raw.ready !== "boolean" ||
      typeof raw.verified !== "boolean"
    ) {
      return null;
    }
    const name = safeSingleLineText(raw.name, MAX_OPTION_NAME_LENGTH);
    if (!name) return null;
    seen.add(raw.id);
    const runtime = runtimes[raw.engine];
    if (
      raw.ready &&
      raw.verified &&
      isRecord(runtime) &&
      runtime.available === true
    ) {
      voices.push(Object.freeze({ id: raw.id, name, engine: raw.engine }));
    }
  }
  return { status: "ready", voices: Object.freeze(voices) };
}

export async function loadLocalVoiceCatalog(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<LocalVoiceCatalogState> {
  let response: Response;
  try {
    response = await fetchImpl("/api/voice/engines", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    return {
      status: "error",
      message: isAbortFailure(error, signal)
        ? CANCELLED_LOCAL_VOICE_ERROR
        : GENERIC_LOCAL_VOICE_ERROR,
    };
  }
  if (signal?.aborted) {
    return { status: "error", message: CANCELLED_LOCAL_VOICE_ERROR };
  }
  if (!response.ok) {
    return { status: "error", message: GENERIC_LOCAL_VOICE_ERROR };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      status: "error",
      message: isAbortFailure(error, signal)
        ? CANCELLED_LOCAL_VOICE_ERROR
        : GENERIC_LOCAL_VOICE_ERROR,
    };
  }
  if (signal?.aborted) {
    return { status: "error", message: CANCELLED_LOCAL_VOICE_ERROR };
  }
  return parseLocalVoiceCatalog(payload) ?? {
    status: "error",
    message: GENERIC_LOCAL_VOICE_ERROR,
  };
}
