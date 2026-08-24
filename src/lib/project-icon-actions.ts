/**
 * Client-side orchestration for "Generate AI icon": ask the icon endpoint for
 * an image, then persist it through the project-image store so every surface
 * that renders a `ProjectAvatar` — the chat sidebar, the project picker, the
 * board — picks it up without any further wiring.
 *
 * Both collaborators are injected rather than imported. That keeps this file
 * free of the IndexedDB-backed store (which needs a browser) and free of a
 * live endpoint, so the behaviour below — which failures surface which message,
 * and what is refused before anything is written — is testable directly.
 */

import { normalizeProjectRoot } from "./cave-projects-types.ts";

/**
 * Raster formats a project icon may be stored as. `image/svg+xml` is
 * deliberately absent even though the underlying store accepts it: an SVG data
 * URL is active content, and nothing on this path has any reason to produce
 * one. The server canonicalises to WebP; this is the client half of the same
 * refusal, so a response that reached the browser through anything other than
 * the route we called still cannot install an SVG as a project icon.
 */
export const SAFE_ICON_MIMES = ["image/webp", "image/png", "image/jpeg"] as const;

export type SafeIconMime = (typeof SAFE_ICON_MIMES)[number];

export type GenerateIconResult =
  | { ok: true; dataUrl: string; mime: SafeIconMime }
  | { ok: false; message: string };

export type SaveProjectImage = (
  root: string,
  image: { dataUrl: string; mime: string },
) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type GenerateIconDeps = {
  /** Defaults to the ambient `fetch`; injected in tests. */
  fetchImpl?: typeof fetch;
  /** Normally `setProjectImage` from cave-project-images. */
  saveImage: SaveProjectImage;
};

export type GenerateIconInput = {
  name: string;
  root: string;
  /** Varies the composition on each regeneration; never the project's hue. */
  variant: number;
  /** The chat's effective model, so the route can pick an image provider. */
  model?: string | null;
};

const GENERIC_FAILURE = "Couldn’t generate an icon. Is the desktop reachable?";
const UNUSABLE_IMAGE = "The image provider returned something Cave can’t use as an icon.";

/** Message for a structured error body, falling back to a readable default. */
function messageForError(body: Record<string, unknown>): string {
  const error = typeof body.error === "string" ? body.error : "";
  const hint = typeof body.hint === "string" ? body.hint.trim() : "";
  if (error === "vault_key_unresolved") {
    const missingKey = typeof body.missingKey === "string" ? body.missingKey : "";
    return hint || (missingKey
      ? `Set ${missingKey} in Vault settings to generate project icons.`
      : GENERIC_FAILURE);
  }
  // Everything the untrusted-image gate can refuse reads the same way to a
  // user: the provider sent something unusable. The specific reason is the
  // server's diagnostic, not a user-facing distinction.
  if (
    error === "unsupported_image_format" ||
    error === "undecodable_image" ||
    error === "image_too_large" ||
    error === "provider_empty_image"
  ) {
    return UNUSABLE_IMAGE;
  }
  if (error === "provider_generation_failed" || error === "provider_unreachable") {
    const providerMessage =
      typeof body.providerMessage === "string" ? body.providerMessage.trim() : "";
    return providerMessage
      ? `The image provider refused: ${providerMessage}`
      : "The image provider couldn’t generate an icon.";
  }
  return hint || GENERIC_FAILURE;
}

function isSafeIconMime(value: unknown): value is SafeIconMime {
  return typeof value === "string" && (SAFE_ICON_MIMES as readonly string[]).includes(value);
}

/**
 * Generate an icon for one project and persist it.
 *
 * Resolves `{ ok: false, message }` for every failure — a network error, a
 * refusal from the endpoint, an image the client will not store, or a storage
 * write that did not land. Nothing is persisted unless the response carries a
 * data URL whose declared mime is a safe raster type AND whose payload
 * actually begins with that mime, so a mismatched pair is refused rather than
 * stored on the strength of its label.
 */
export async function generateProjectIcon(
  input: GenerateIconInput,
  deps: GenerateIconDeps,
): Promise<GenerateIconResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const name = input.name.trim();
  const root = input.root.trim();
  if (!name || !root) return { ok: false, message: "This project needs a name and a folder first." };

  let response: Response;
  try {
    response = await doFetch("/api/projects/icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        root,
        variant: input.variant,
        ...(input.model ? { model: input.model } : {}),
      }),
    });
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (!response.ok || body.ok !== true) return { ok: false, message: messageForError(body) };

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const mime = body.mime;
  if (!dataUrl || !isSafeIconMime(mime)) return { ok: false, message: UNUSABLE_IMAGE };
  // The label and the payload must agree — an `image/webp` label on a
  // `data:image/svg+xml` payload is exactly the mismatch worth refusing.
  if (!dataUrl.startsWith(`data:${mime};base64,`)) return { ok: false, message: UNUSABLE_IMAGE };

  const saved = await deps.saveImage(normalizeProjectRoot(root), { dataUrl, mime });
  if (!saved.ok) return { ok: false, message: saved.reason };

  return { ok: true, dataUrl, mime };
}
