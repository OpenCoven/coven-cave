import { NextResponse } from "next/server";

import { resolveSecret } from "@/lib/vault";
import { readJsonBody } from "@/lib/server/api-security";
import { loadConfig } from "@/lib/cave-config";
import { buildProjectIconPrompt } from "@/lib/project-icon-prompt";
import {
  resolveIconImageProvider,
  type IconImageProvider,
} from "@/lib/project-icon-image-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_IMAGES_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// ProjectAvatar renders at 16–28px — low quality webp keeps payloads far
// under the 2MB avatar-store cap while staying crisp at tile size.
const OPENAI_IMAGE_OPTIONS = { size: "1024x1024", quality: "low", output_format: "webp" } as const;

type ProviderImage = { b64: string; mime: string };
type ProviderResult =
  | { ok: true; image: ProviderImage }
  | { ok: false; error: "provider_unreachable" | "provider_generation_failed" | "provider_empty_image"; providerMessage?: string };

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<ProviderResult> {
  let res: Response;
  try {
    res = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, n: 1, ...OPENAI_IMAGE_OPTIONS }),
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
  return { ok: true, image: { b64, mime: "image/webp" } };
}

async function generateWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
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
        parameters: { sampleCount: 1, aspectRatio: "1:1" },
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

const GENERATORS: Record<
  IconImageProvider,
  (apiKey: string, model: string, prompt: string) => Promise<ProviderResult>
> = {
  openai: generateWithOpenAI,
  gemini: generateWithGemini,
};

/**
 * POST /api/projects/icon — generate a distinct AI icon for a project.
 *
 * Body: { name: string; root: string; variant?: number; model?: string }
 * The image provider follows the connected model of the selected runtime:
 * `model` in the body (a chat's effective model) wins, else the configured
 * default model. OpenAI-namespaced models render through gpt-image-1,
 * Gemini-namespaced models through Imagen; providers without an image API
 * fall back to whichever image-capable vault key resolves.
 * Returns { ok: true, dataUrl, mime, provider } on success; the client
 * persists the image through the existing project-image store so it renders
 * everywhere chats show a ProjectAvatar.
 */
export async function POST(req: Request) {
  const parsed = await readJsonBody<{
    name?: string;
    root?: string;
    variant?: number;
    model?: string;
  }>(req, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const root = typeof body.root === "string" ? body.root.trim() : "";
  if (!name || !root) {
    return NextResponse.json(
      { ok: false, error: "missing_fields", hint: "name and root are required" },
      { status: 400 },
    );
  }

  let connectedModel = typeof body.model === "string" ? body.model.trim() : "";
  if (!connectedModel) {
    try {
      const config = await loadConfig();
      connectedModel = config.defaults.model;
    } catch {
      /* config unreadable — provider resolution falls back to available keys */
    }
  }

  const resolved = resolveIconImageProvider(connectedModel, resolveSecret);
  if (!resolved.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "vault_key_unresolved",
        missingKey: resolved.missingKey,
        hint: `Set ${resolved.missingKey} in Vault settings to generate project icons.`,
      },
      { status: 400 },
    );
  }

  const prompt = buildProjectIconPrompt({
    name,
    root,
    variant: typeof body.variant === "number" ? body.variant : Date.now(),
  });

  const result = await GENERATORS[resolved.provider](resolved.apiKey, resolved.model, prompt);
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
  });
}
