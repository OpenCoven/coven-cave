import {
  CAVE_PREFERENCES_VERSION,
  normalizeCavePreferences,
  VOICE_PREFERENCE_ID_MAX_LENGTH,
  type CavePreferences,
  type CavePreferencesPatch,
} from "./preferences-schema.ts";
import { isSelectableVoiceProviderId } from "./voice/provider-catalog.ts";

const BOOTSTRAP_ID = "cave-preferences-bootstrap";

type BootstrapEnvironment = {
  window?: {
    __COVEN_CAVE_PREFERENCES__?: unknown;
    __COVEN_CAVE_PREFERENCES_AUTHORITATIVE__?: boolean;
  };
  document?: {
    getElementById(id: string): {
      textContent: string | null;
      getAttribute(name: string): string | null;
    } | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCanonicalPreferencesPayload(value: unknown): value is CavePreferences {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<CavePreferences>;
  const voice = candidate.voice;
  if (!isRecord(voice)) return false;
  if (
    Object.keys(voice).length !== 3 ||
    !Object.hasOwn(voice, "defaultProvider") ||
    !Object.hasOwn(voice, "defaultModel") ||
    !Object.hasOwn(voice, "defaultVoice") ||
    typeof voice.defaultProvider !== "string" ||
    typeof voice.defaultModel !== "string" ||
    typeof voice.defaultVoice !== "string"
  ) return false;
  if (voice.defaultProvider !== "" && !isSelectableVoiceProviderId(voice.defaultProvider)) return false;
  if (
    voice.defaultModel !== voice.defaultModel.trim() ||
    voice.defaultVoice !== voice.defaultVoice.trim() ||
    voice.defaultModel.length > VOICE_PREFERENCE_ID_MAX_LENGTH ||
    voice.defaultVoice.length > VOICE_PREFERENCE_ID_MAX_LENGTH
  ) return false;
  if (voice.defaultProvider === "" && (voice.defaultModel !== "" || voice.defaultVoice !== "")) return false;

  return candidate.version === CAVE_PREFERENCES_VERSION &&
    typeof candidate.initialized === "boolean" &&
    typeof candidate.revision === "number" &&
    isRecord(candidate.appearance) &&
    isRecord(candidate.general) &&
    isRecord(candidate.phone);
}

/** Read only a complete canonical bootstrap; normalization follows validation. */
export function readBootstrap(environment: BootstrapEnvironment): CavePreferences | null {
  const direct = environment.window?.__COVEN_CAVE_PREFERENCES__;
  if (direct && environment.window?.__COVEN_CAVE_PREFERENCES_AUTHORITATIVE__ !== false) {
    return isCanonicalPreferencesPayload(direct) ? normalizeCavePreferences(direct) : null;
  }
  const node = environment.document?.getElementById(BOOTSTRAP_ID);
  if (!node?.textContent) return null;
  if (node.getAttribute("data-authoritative") === "false") return null;
  try {
    const raw = JSON.parse(node.textContent) as unknown;
    return isCanonicalPreferencesPayload(raw) ? normalizeCavePreferences(raw) : null;
  } catch {
    return null;
  }
}

export function mergePreferencesPatches(
  left: CavePreferencesPatch,
  right: CavePreferencesPatch,
): CavePreferencesPatch {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return b;
    const base = a && typeof a === "object" && !Array.isArray(a) ? a as Record<string, unknown> : {};
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
      out[key] = merge(base[key], value);
    }
    return out;
  };
  return merge(left, right) as CavePreferencesPatch;
}

/** Preserve provider-transition clears when optimistic writes are coalesced. */
export function queueAppPreferencesPatch(
  current: CavePreferences,
  pending: CavePreferencesPatch,
  incoming: CavePreferencesPatch,
): { pendingPatch: CavePreferencesPatch; patch: CavePreferencesPatch } {
  const incomingVoice = incoming.voice;
  let queued = incoming;
  if (
    incomingVoice &&
    Object.hasOwn(incomingVoice, "defaultProvider") &&
    incomingVoice.defaultProvider !== current.voice.defaultProvider
  ) {
    queued = {
      ...incoming,
      voice: {
        ...incomingVoice,
        ...(!Object.hasOwn(incomingVoice, "defaultModel") ? { defaultModel: "" } : {}),
        ...(!Object.hasOwn(incomingVoice, "defaultVoice") ? { defaultVoice: "" } : {}),
      },
    };
  }
  return {
    pendingPatch: mergePreferencesPatches(pending, queued),
    patch: queued,
  };
}
