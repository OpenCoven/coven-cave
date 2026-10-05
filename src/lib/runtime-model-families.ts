import type { RuntimeModelOption } from "./runtime-models.ts";

/** Compare releases only within a recognized provider/model family. Custom
 * deployments and distinct variants keep their exact identities. Discovery,
 * not this presentation policy, remains the authority for model support. */
type FamilyRelease = { family: string; version: number[]; snapshot: number; preview: boolean; alias: boolean; fastMode: boolean };

function familyVersion(id: string): FamilyRelease | null {
  const slash = id.lastIndexOf("/");
  const provider = id.slice(0, slash + 1);
  const name = id.slice(slash + 1).toLowerCase();
  const claude = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+(?:[-.]\d+)*)(.*)$/.exec(name);
  const legacyClaude = /^claude-(\d+(?:[-.]\d+)*)-(opus|sonnet|haiku)(.*)$/.exec(name);
  if (claude || legacyClaude) {
    const version = (claude?.[2] ?? legacyClaude![1]!).split(/[-.]/).map(Number);
    // A dated snapshot is not another minor-version component: 5-20260101
    // must not outrank 5-1 simply because its date is a large number.
    const snapshot = version.length > 1 && version.at(-1)! >= 10_000_000 ? version.pop()! : 0;
    const family = `${provider}claude-${claude?.[1] ?? legacyClaude![2]}`;
    const parsed = release(family, version, claude?.[3] ?? legacyClaude![3]!, snapshot);
    // Copilot exposes Claude fast mode as a model ID. It is still the same
    // Claude family, so an older fast release must not survive a newer one.
    if (parsed.family === `${family}-fast`) {
      parsed.family = family;
      parsed.fastMode = true;
    }
    return parsed;
  }
  const model = /^(gpt|gemini|grok|hermes)-(\d+(?:\.\d+)*)(.*)$/.exec(name);
  return model ? release(`${provider}${model[1]}`, model[2]!.split(".").map(Number), model[3]!) : null;
}

function release(family: string, version: number[], suffix: string, snapshot = 0): FamilyRelease {
  const date = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{2}-\d{2}|\d{4})$/.exec(suffix);
  if (date) {
    snapshot = Number(date[1]!.replaceAll("-", ""));
    suffix = suffix.slice(0, date.index);
  }
  const preview = /-(preview|exp)$/.test(suffix);
  const alias = /-latest$/.test(suffix);
  suffix = suffix.replace(/-(latest|preview|exp)$/, "");
  return { family: `${family}${suffix}`, version, snapshot, preview, alias, fastMode: false };
}

function newer(left: FamilyRelease, right: FamilyRelease): boolean {
  for (let index = 0; index < Math.max(left.version.length, right.version.length); index++) {
    const delta = (left.version[index] ?? 0) - (right.version[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  if (left.preview !== right.preview) return !left.preview;
  if (left.snapshot !== right.snapshot) return left.snapshot > right.snapshot;
  if (left.alias !== right.alias) return !left.alias;
  if (left.fastMode !== right.fastMode) return !left.fastMode;
  return false;
}

export function newestRuntimeModelFamilies(models: readonly RuntimeModelOption[]): RuntimeModelOption[] {
  const latest = new Map<string, { id: string; release: FamilyRelease }>();
  for (const model of models) {
    const parsed = familyVersion(model.configuredModelId ?? model.id);
    if (!parsed) continue;
    const previous = latest.get(parsed.family);
    if (!previous || newer(parsed, previous.release)) latest.set(parsed.family, { id: model.id, release: parsed });
  }
  return models.filter((model) => {
    const parsed = familyVersion(model.configuredModelId ?? model.id);
    return !parsed || latest.get(parsed.family)?.id === model.id;
  });
}
