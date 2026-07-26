import type { RuntimeModelOption } from "./runtime-models.ts";

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

function labelForModel(id: string): string {
  const [provider, model] = id.split("/", 2);
  const name = model
    .split(/[-_]/)
    .filter(Boolean)
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
    if (!MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: labelForModel(id) });
  }
  return models;
}
