// Helpers for the `/model` slash command — resolving a typed model argument to
// a concrete id, and the inline autocomplete options shown while typing it.
// Pure + client-safe (only depends on the runtime-models catalog); the model-id
// shape is validated inline so this never pulls server code into the bundle.

import { catalogForRuntime, type RuntimeModelOption } from "@/lib/runtime-models";

// Composer text while in the argument position of /model (or /m): the user has
// typed "/model " (with a space) and is now typing the model id/name. Group 1 is
// the partial argument (possibly empty right after the space).
const MODEL_ARG_RE = /^\/(?:model|m)\s+(.*)$/i;

// Cave model ids follow `provider/model` with a conservative charset (mirrors
// cleanModelId in chat-model-state.ts, inlined to keep this client-safe).
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

function modelsFor(harness: string | null | undefined): RuntimeModelOption[] {
  return catalogForRuntime(harness ?? "claude")?.models ?? [];
}

/** Model options for the inline autocomplete when the composer is in
 *  `/model <partial>` arg position. Returns null when the text isn't a /model
 *  argument, so callers fall back to the normal command menu. */
export function modelSlashOptions(
  text: string,
  harness: string | null | undefined,
): RuntimeModelOption[] | null {
  const m = text.trimStart().match(MODEL_ARG_RE);
  if (!m) return null;
  const partial = m[1].trim().toLowerCase();
  const models = modelsFor(harness);
  if (!partial) return models;
  return models.filter(
    (mm) => mm.id.toLowerCase().includes(partial) || mm.label.toLowerCase().includes(partial),
  );
}

/** Resolve a typed /model argument to a concrete model id: exact catalog match
 *  (id or label) first, then a substring match, else a valid custom id. Returns
 *  null for an empty or malformed argument. */
export function resolveModelArg(
  arg: string,
  harness: string | null | undefined,
): string | null {
  const a = arg.trim();
  if (!a) return null;
  const models = modelsFor(harness);
  const lower = a.toLowerCase();
  const exact = models.find(
    (m) => m.id.toLowerCase() === lower || m.label.toLowerCase() === lower,
  );
  if (exact) return exact.id;
  const partial = models.find(
    (m) => m.id.toLowerCase().includes(lower) || m.label.toLowerCase().includes(lower),
  );
  if (partial) return partial.id;
  return MODEL_ID_RE.test(a) ? a : null;
}

/** One-line-per-model list for the `/model` (no-arg) system message. */
export function formatModelList(
  harness: string | null | undefined,
  current: string | null | undefined,
): string {
  const models = modelsFor(harness);
  const head = current ? `Current model: ${current}` : "No model set yet.";
  if (models.length === 0) {
    return `${head}\nThis runtime has no model menu — type \`/model <id>\` to set one.`;
  }
  const lines = models.map((m) => `  ${m.id === current ? "●" : "○"} ${m.label} — \`${m.id}\``);
  return `${head}\nAvailable models (type \`/model <id>\` or pick from the menu):\n${lines.join("\n")}`;
}
