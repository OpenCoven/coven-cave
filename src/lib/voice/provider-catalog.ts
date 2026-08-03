import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs-shared.ts";
import { DEFAULT_OPENAI_VOICE_ID } from "./openai-voices.ts";
import type { VoiceProviderId } from "./types.ts";

export type SelectableVoiceProviderId = Exclude<VoiceProviderId, "gemini">;

export const OPENAI_REALTIME_MODEL_IDS = Object.freeze([
  "gpt-realtime",
] as const);

export type ReviewedOpenAiRealtimeModelId =
  (typeof OPENAI_REALTIME_MODEL_IDS)[number];

const OPENAI_REALTIME_MODEL_ID_SET: ReadonlySet<string> = new Set(
  OPENAI_REALTIME_MODEL_IDS,
);

export function isReviewedOpenAiRealtimeModelId(
  value: unknown,
): value is ReviewedOpenAiRealtimeModelId {
  return typeof value === "string" && OPENAI_REALTIME_MODEL_ID_SET.has(value);
}

export type VoiceProviderVaultKey =
  | "OPENAI_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "GOOGLE_API_KEY";

export type VoiceProviderDefinition = {
  readonly id: VoiceProviderId;
  readonly label: string;
  readonly available: boolean;
  readonly defaultable: boolean;
  readonly vaultKey: VoiceProviderVaultKey | null;
  readonly defaults: {
    readonly model: string;
    readonly voice: string;
  };
};

function defineVoiceProvider<const T extends VoiceProviderDefinition>(
  definition: T,
) {
  const defaults = Object.freeze({ ...definition.defaults });
  return Object.freeze({ ...definition, defaults });
}

export const VOICE_PROVIDER_CATALOG = Object.freeze(
  [
    defineVoiceProvider({
      id: "familiar",
      label: "Familiar brain (true voice)",
      available: true,
      defaultable: true,
      vaultKey: null,
      defaults: { model: "", voice: "" },
    }),
    defineVoiceProvider({
      id: "elevenlabs",
      label: "ElevenLabs (true voice)",
      available: true,
      defaultable: true,
      vaultKey: "ELEVENLABS_API_KEY",
      defaults: {
        model: DEFAULT_ELEVENLABS_MODEL_ID,
        voice: DEFAULT_ELEVENLABS_VOICE_ID,
      },
    }),
    defineVoiceProvider({
      id: "openai",
      label: "OpenAI Realtime",
      available: true,
      defaultable: true,
      vaultKey: "OPENAI_API_KEY",
      defaults: {
        model: OPENAI_REALTIME_MODEL_IDS[0],
        voice: DEFAULT_OPENAI_VOICE_ID,
      },
    }),
    defineVoiceProvider({
      id: "local",
      label: "Local (on-device)",
      available: true,
      defaultable: true,
      vaultKey: null,
      defaults: { model: "llama3.2", voice: "" },
    }),
    defineVoiceProvider({
      id: "gemini",
      label: "Gemini Live",
      available: false,
      defaultable: false,
      vaultKey: "GOOGLE_API_KEY",
      defaults: { model: "", voice: "" },
    }),
  ] as const satisfies readonly VoiceProviderDefinition[],
);

type CatalogVoiceProviderDefinition = (typeof VOICE_PROVIDER_CATALOG)[number];
type SelectableVoiceProviderDefinition = Extract<
  CatalogVoiceProviderDefinition,
  { available: true; defaultable: true }
>;
type EditableVoiceProviderDefinition = Extract<
  SelectableVoiceProviderDefinition,
  { vaultKey: VoiceProviderVaultKey }
>;

function isSelectableVoiceProviderDefinition(
  provider: CatalogVoiceProviderDefinition,
): provider is SelectableVoiceProviderDefinition {
  return provider.available && provider.defaultable;
}

function isEditableVoiceProviderDefinition(
  provider: SelectableVoiceProviderDefinition,
): provider is EditableVoiceProviderDefinition {
  return provider.vaultKey !== null;
}

export const SELECTABLE_VOICE_PROVIDER_IDS: readonly SelectableVoiceProviderId[] =
  Object.freeze(
    VOICE_PROVIDER_CATALOG
      .filter(isSelectableVoiceProviderDefinition)
      .map((provider) => provider.id),
  );

export const EDITABLE_VOICE_VAULT_KEYS: readonly VoiceProviderVaultKey[] =
  Object.freeze(
    VOICE_PROVIDER_CATALOG
      .filter(isSelectableVoiceProviderDefinition)
      .filter(isEditableVoiceProviderDefinition)
      .map((provider) => provider.vaultKey),
  );

const SELECTABLE_VOICE_PROVIDER_ID_SET: ReadonlySet<string> = new Set(
  SELECTABLE_VOICE_PROVIDER_IDS,
);

export function getVoiceProviderDefinition(
  id: string,
): VoiceProviderDefinition | null {
  return VOICE_PROVIDER_CATALOG.find((provider) => provider.id === id) ?? null;
}

export function isSelectableVoiceProviderId(
  value: unknown,
): value is SelectableVoiceProviderId {
  return typeof value === "string" &&
    SELECTABLE_VOICE_PROVIDER_ID_SET.has(value);
}
