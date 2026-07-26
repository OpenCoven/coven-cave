import { NextResponse } from "next/server";

import { resolveSecret } from "@/lib/vault";
import { readJsonBody } from "@/lib/server/api-security";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import {
  resolveImageGeneration,
  type FamiliarImageGenSettings,
  type ImageGenProvider,
} from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_IMAGES_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** DALL·E 3's documented prompt ceiling — the strictest of the providers. */
const MAX_PROMPT_CHARS = 4000;

type ProviderImage = { b64: string; mime: string };
type ProviderResult =
  | { ok: true; image: ProviderImage }
  | {
      ok: false;
      error: "provider_unreachable" | "provider_generation_failed" | "provider_empty_image";
      providerMessage?: string;
    };

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string | undefined,
): Promise<ProviderResult> {
  // gpt-image-* returns b64 natively and supports output_format; DALL·E needs
  // an explicit response_format and only ships fixed sizes/qualities.
  const isGptImage = model.toLowerCase().startsWith("gpt-image");
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    ...(size ? { size } : {}),
    ...(quality ? { quality } : {}),
    ...(isGptImage ? { output_format: "webp" } : { response_format: "b64_json" }),
  };

  let res: Response;
  try {
    res = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "provider_unreachable", providerMessage: msg };
  }

  if (!res.ok) {
    let providerMessage = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) providerMessage = err.error.message;
    } catch {
      /* non-JSON error body — status line is enough */
    }
    return { ok: false, error: "provider_generation_failed", providerMessage };
  }

  let b64: string | undefined;
  try {
    const payload = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    b64 = payload.data?.[0]?.b64_json;
  } catch {
    /* fall through to the empty-image error */
  }
  if (!b64) return { ok: false, error: "provider_empty_image" };
  return { ok: true, image: { b64, mime: isGptImage ? "image/webp" : "image/png" } };
}

async function generateWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
): Promise<ProviderResult> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_IMAGES_URL_BASE}/${model}:predict`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        // Imagen sizes are aspect ratios ("1:1", "16:9", …).
        parameters: { sampleCount: 1, aspectRatio: /^\d+:\d+$/.test(size) ? size : "1:1" },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "provider_unreachable", providerMessage: msg };
  }

  if (!res.ok) {
    let providerMessage = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) providerMessage = err.error.message;
    } catch {
      /* non-JSON error body — status line is enough */
    }
    return { ok: false, error: "provider_generation_failed", providerMessage };
  }

  let b64: string | undefined;
  let mime = "image/png";
  try {
    const payload = (await res.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    b64 = payload.predictions?.[0]?.bytesBase64Encoded;
    if (payload.predictions?.[0]?.mimeType) mime = payload.predictions[0].mimeType;
  } catch {
    /* fall through to the empty-image error */
  }
  if (!b64) return { ok: false, error: "provider_empty_image" };
  return { ok: true, image: { b64, mime } };
}

/**
 * POST /api/images/generate — generate one image for the `/image` chat command.
 *
 * Body: { prompt: string; familiarId?: string; model?: string; size?: string;
 *         quality?: string }
 * Provider/model/size/quality resolve through the familiar's Brain-tab image
 * settings (imageProvider/imageModel/imageSize/imageQuality on its
 * cave-config binding), with request fields as one-shot overrides and the
 * connected chat model steering the provider when nothing is pinned
 * (see src/lib/image-generation.ts). Returns
 * { ok: true, dataUrl, mime, provider, model, size, quality? } — the client
 * renders it inline and persists it as a turn attachment.
 */
export async function POST(req: Request) {
  const parsed = await readJsonBody<{
    prompt?: string;
    familiarId?: string;
    model?: string;
    size?: string;
    quality?: string;
  }>(req, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "missing_prompt", hint: "Describe the image to generate." },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { ok: false, error: "prompt_too_long", hint: `Keep the prompt under ${MAX_PROMPT_CHARS} characters.` },
      { status: 400 },
    );
  }

  const familiarId = typeof body.familiarId === "string" ? body.familiarId.trim() : "";
  let settings: FamiliarImageGenSettings | null = null;
  let connectedModel = "";
  try {
    const config = await loadConfig();
    if (familiarId && Object.hasOwn(config.familiars ?? {}, familiarId)) {
      const binding = bindingFor(config, familiarId);
      settings = {
        imageProvider: binding.imageProvider,
        imageModel: binding.imageModel,
        imageSize: binding.imageSize,
        imageQuality: binding.imageQuality,
      };
      connectedModel = binding.model || config.defaults.model;
    } else {
      connectedModel = config.defaults.model;
    }
  } catch {
    /* config unreadable — provider resolution falls back to available keys */
  }

  const resolved = resolveImageGeneration(settings, connectedModel, resolveSecret, {
    model: typeof body.model === "string" ? body.model : undefined,
    size: typeof body.size === "string" ? body.size : undefined,
    quality: typeof body.quality === "string" ? body.quality : undefined,
  });

  if (!resolved.ok) {
    if (resolved.reason === "disabled") {
      return NextResponse.json(
        {
          ok: false,
          error: "image_generation_disabled",
          hint: "Image generation is turned off for this familiar — enable it in Familiar Studio → Brain.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "vault_key_unresolved",
        missingKey: resolved.missingKey,
        hint: `Set ${resolved.missingKey} in Vault settings to generate images.`,
      },
      { status: 400 },
    );
  }

  const generators: Record<ImageGenProvider, () => Promise<ProviderResult>> = {
    openai: () =>
      generateWithOpenAI(resolved.apiKey, resolved.model, prompt, resolved.size, resolved.quality),
    gemini: () => generateWithGemini(resolved.apiKey, resolved.model, prompt, resolved.size),
  };

  const result = await generators[resolved.provider]();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, providerMessage: result.providerMessage },
      { status: 502 },
    );
  }

  const { b64, mime } = result.image;
  return NextResponse.json({
    ok: true,
    dataUrl: `data:${mime};base64,${b64}`,
    mime,
    provider: resolved.provider,
    model: resolved.model,
    size: resolved.size,
    ...(resolved.quality ? { quality: resolved.quality } : {}),
  });
}
