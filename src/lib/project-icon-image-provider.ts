/**
 * Image-provider selection for AI-generated project icons.
 *
 * The icon endpoint doesn't hardcode a provider: it follows the connected
 * model of the selected runtime (`provider/model` ids like `openai/gpt-5.5`,
 * `anthropic/claude-sonnet-5`, `github/gemini-3.1-pro`). Providers without an
 * image API (Anthropic, Copilot's GPT models, runtime-managed adapters) fall
 * back to whichever image-capable key the vault can actually resolve, so a
 * Claude-connected Cave still generates icons when OPENAI_API_KEY or
 * GOOGLE_API_KEY is present.
 */

export type IconImageProvider = "openai" | "gemini";

export const ICON_IMAGE_VAULT_KEYS: Record<IconImageProvider, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

export const ICON_IMAGE_MODELS: Record<IconImageProvider, string> = {
  openai: "gpt-image-1",
  gemini: "imagen-3.0-generate-002",
};

/**
 * Map a connected chat model id to the image provider that should render the
 * icon. Only OpenAI and Google ship image-generation APIs here; every other
 * namespace prefers OpenAI as the workhorse default.
 */
export function preferredIconImageProvider(
  modelId: string | null | undefined,
): IconImageProvider {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return "openai";
  if (id.startsWith("openai/") || id.startsWith("gpt")) return "openai";
  if (id.startsWith("google/") || id.includes("gemini") || id.includes("imagen")) {
    return "gemini";
  }
  return "openai";
}

export type IconImageResolution =
  | { ok: true; provider: IconImageProvider; model: string; apiKey: string }
  | { ok: false; missingKey: string };

/**
 * Resolve the provider + key for a connected model. When the preferred
 * provider's key is missing but the other image provider's key resolves, use
 * it instead of failing — distinct icons beat provider purity. Only when no
 * image-capable key exists do we report the preferred provider's key as
 * missing so the hint tells the user the most natural key to set.
 */
export function resolveIconImageProvider(
  modelId: string | null | undefined,
  resolveKey: (vaultKey: string) => string | undefined,
): IconImageResolution {
  const preferred = preferredIconImageProvider(modelId);
  const order: IconImageProvider[] =
    preferred === "gemini" ? ["gemini", "openai"] : ["openai", "gemini"];
  for (const provider of order) {
    const apiKey = resolveKey(ICON_IMAGE_VAULT_KEYS[provider]);
    if (apiKey) {
      return { ok: true, provider, model: ICON_IMAGE_MODELS[provider], apiKey };
    }
  }
  return { ok: false, missingKey: ICON_IMAGE_VAULT_KEYS[preferred] };
}
