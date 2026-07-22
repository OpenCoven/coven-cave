/**
 * Image generation — shared provider/model catalog and per-familiar settings
 * resolution for the `/image` chat command and the Familiar Studio Brain tab.
 *
 * Pure + client-safe (no node imports): the Brain tab renders the catalogs as
 * pickers, while the server route (`/api/images/generate`) resolves the same
 * settings against the vault. Mirrors the stance of
 * `project-icon-image-provider.ts` — providers without an image API fall back
 * to whichever image-capable key the vault can resolve — but generalizes it
 * with per-model size/quality options and an explicit per-familiar override.
 */

export type ImageGenProvider = "openai" | "gemini";

/** Familiar setting sentinel: image generation explicitly disabled. */
export const IMAGE_GEN_OFF = "off";

export const IMAGE_GEN_VAULT_KEYS: Record<ImageGenProvider, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

export type ImageGenModelOption = {
  id: string;
  label: string;
  provider: ImageGenProvider;
  /** Provider-native size tokens (OpenAI `WxH`, Imagen aspect ratios). The
   *  first entry is the model's default. */
  sizes: readonly string[];
  /** Provider-native quality tokens; empty when the model has no quality knob.
   *  The first entry is the model's default. */
  qualities: readonly string[];
};

export const IMAGE_GEN_MODEL_OPTIONS: readonly ImageGenModelOption[] = [
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    provider: "openai",
    sizes: ["1024x1024", "1536x1024", "1024x1536", "auto"],
    qualities: ["medium", "low", "high", "auto"],
  },
  {
    id: "dall-e-3",
    label: "DALL·E 3",
    provider: "openai",
    sizes: ["1024x1024", "1792x1024", "1024x1792"],
    qualities: ["standard", "hd"],
  },
  {
    id: "imagen-3.0-generate-002",
    label: "Imagen 3",
    provider: "gemini",
    sizes: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    qualities: [],
  },
  {
    id: "imagen-3.0-fast-generate-001",
    label: "Imagen 3 Fast",
    provider: "gemini",
    sizes: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    qualities: [],
  },
];

export const DEFAULT_IMAGE_GEN_MODELS: Record<ImageGenProvider, string> = {
  openai: "gpt-image-1",
  gemini: "imagen-3.0-generate-002",
};

export function imageGenModelById(id: string | null | undefined): ImageGenModelOption | null {
  const wanted = (id ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return IMAGE_GEN_MODEL_OPTIONS.find((m) => m.id.toLowerCase() === wanted) ?? null;
}

export function imageGenModelsForProvider(provider: ImageGenProvider): ImageGenModelOption[] {
  return IMAGE_GEN_MODEL_OPTIONS.filter((m) => m.provider === provider);
}

/** Size options for a model id — custom/unknown ids fall back to the
 *  provider's default model so the picker always has something to offer. */
export function imageGenSizesForModel(modelId: string, provider: ImageGenProvider): readonly string[] {
  const model = imageGenModelById(modelId) ?? imageGenModelById(DEFAULT_IMAGE_GEN_MODELS[provider]);
  return model?.sizes ?? [];
}

export function imageGenQualitiesForModel(modelId: string, provider: ImageGenProvider): readonly string[] {
  const model = imageGenModelById(modelId) ?? imageGenModelById(DEFAULT_IMAGE_GEN_MODELS[provider]);
  return model?.qualities ?? [];
}

export function isImageGenProvider(value: unknown): value is ImageGenProvider {
  return value === "openai" || value === "gemini";
}

/** Per-familiar image generation settings, stored on the familiar's
 *  cave-config binding next to the voice fields. Empty/absent = inherit. */
export type FamiliarImageGenSettings = {
  /** "" inherit (follow the chat model) | "openai" | "gemini" | "off". */
  imageProvider?: string | null;
  imageModel?: string | null;
  imageSize?: string | null;
  imageQuality?: string | null;
};

/**
 * Map a connected chat model id to the image provider that should render the
 * image. Only OpenAI and Google ship image APIs here; every other namespace
 * prefers OpenAI as the workhorse default.
 */
export function preferredImageGenProvider(modelId: string | null | undefined): ImageGenProvider {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return "openai";
  if (id.startsWith("openai/") || id.startsWith("gpt")) return "openai";
  if (id.startsWith("google/") || id.includes("gemini") || id.includes("imagen")) {
    return "gemini";
  }
  return "openai";
}

export type ImageGenRequestOverrides = {
  model?: string | null;
  size?: string | null;
  quality?: string | null;
};

export type ImageGenResolution =
  | {
      ok: true;
      provider: ImageGenProvider;
      model: string;
      size: string;
      quality?: string;
      apiKey: string;
    }
  | { ok: false; reason: "disabled" }
  | { ok: false; reason: "missing_key"; missingKey: string };

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Resolve provider + model + size + quality + API key for one generation.
 *
 * Precedence per field: request override → familiar setting → model default.
 * Provider: explicit familiar `imageProvider` pins it (its key missing is a
 * hard miss); otherwise the provider is inferred from the requested/settled
 * image model when it names a catalog model, else from the connected chat
 * model — with cross-provider key fallback, because a rendered image beats
 * provider purity (the `project-icon-image-provider` stance).
 */
export function resolveImageGeneration(
  settings: FamiliarImageGenSettings | null | undefined,
  connectedModel: string | null | undefined,
  resolveKey: (vaultKey: string) => string | undefined,
  overrides: ImageGenRequestOverrides = {},
): ImageGenResolution {
  const providerSetting = clean(settings?.imageProvider).toLowerCase();
  if (providerSetting === IMAGE_GEN_OFF) return { ok: false, reason: "disabled" };

  const requestedModel = clean(overrides.model) || clean(settings?.imageModel);
  const catalogModel = imageGenModelById(requestedModel);

  const pinnedProvider = isImageGenProvider(providerSetting) ? providerSetting : null;
  const preferred: ImageGenProvider =
    pinnedProvider
      ?? catalogModel?.provider
      ?? preferredImageGenProvider(connectedModel);

  const order: ImageGenProvider[] = pinnedProvider
    ? [pinnedProvider]
    : preferred === "gemini"
      ? ["gemini", "openai"]
      : ["openai", "gemini"];

  for (const provider of order) {
    const apiKey = resolveKey(IMAGE_GEN_VAULT_KEYS[provider]);
    if (!apiKey) continue;

    // A requested model only rides along when it belongs to the provider the
    // key landed on (a custom unlisted id is trusted on the preferred
    // provider); otherwise the provider's default model takes over.
    const model =
      catalogModel && catalogModel.provider === provider
        ? catalogModel.id
        : !catalogModel && requestedModel && provider === preferred
          ? requestedModel
          : DEFAULT_IMAGE_GEN_MODELS[provider];

    const sizes = imageGenSizesForModel(model, provider);
    const qualities = imageGenQualitiesForModel(model, provider);
    const requestedSize = clean(overrides.size) || clean(settings?.imageSize);
    const requestedQuality = clean(overrides.quality) || clean(settings?.imageQuality);
    const size = sizes.includes(requestedSize) ? requestedSize : sizes[0] ?? "1024x1024";
    const quality = qualities.includes(requestedQuality)
      ? requestedQuality
      : qualities[0];

    return { ok: true, provider, model, size, ...(quality ? { quality } : {}), apiKey };
  }

  return {
    ok: false,
    reason: "missing_key",
    missingKey: IMAGE_GEN_VAULT_KEYS[preferred],
  };
}
