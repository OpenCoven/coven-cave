import type { RuntimeModelOption } from "./runtime-models.ts";

const MAX_MODEL_ID_LENGTH = 512;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL_PATH_SEGMENT_RE = /^~?[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

function validModelId(id: string): boolean {
  if (!id || id.length > MAX_MODEL_ID_LENGTH) return false;
  const [provider, ...modelPath] = id.split("/");
  return (
    PROVIDER_ID_RE.test(provider ?? "") &&
    modelPath.length > 0 &&
    modelPath.every((segment) => MODEL_PATH_SEGMENT_RE.test(segment))
  );
}

function labelForModel(id: string): string {
  const [provider, ...modelPath] = id.split("/");
  const name = modelPath
    .flatMap((segment) => segment.split(/[-_]/))
    .filter(Boolean)
    .map((part) => part.replace(/^~/, ""))
    .map((part) => (/^gpt\d*$/i.test(part) ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1)))
    .join(" ");
  return `${provider}: ${name || id}`;
}

/** Parse the newline-delimited, authenticated inventory from `opencode models`. */
export function parseOpenCodeModels(output: string): RuntimeModelOption[] {
  const seen = new Set<string>();
  const models: RuntimeModelOption[] = [];
  for (const line of output.split(/\r?\n/)) {
    const id = line.trim();
    if (!validModelId(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: labelForModel(id) });
  }
  return models;
}
