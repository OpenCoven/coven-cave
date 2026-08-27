import { homedir } from "node:os";
import path from "node:path";
import {
  bindingFor,
  loadConfig,
  type FamiliarBinding,
} from "../cave-config.ts";

export type HermesMemorySource =
  | { ok: true; familiarId: string; hermesHome: string }
  | {
      ok: false;
      error:
        | "unknown-familiar"
        | "not-hermes"
        | "remote-unavailable"
        | "invalid-profile";
    };

export function hermesMemorySourceForBinding(
  familiarId: string,
  binding: FamiliarBinding,
  homeDir = homedir(),
): HermesMemorySource {
  if (binding.harness.toLowerCase() !== "hermes") {
    return { ok: false, error: "not-hermes" };
  }
  if (binding.runtime?.kind === "ssh") {
    return { ok: false, error: "remote-unavailable" };
  }
  if (binding.hasInvalidHermesProfileBinding) {
    return { ok: false, error: "invalid-profile" };
  }
  return {
    ok: true,
    familiarId,
    hermesHome:
      binding.hermesProfile?.homePath ?? path.join(homeDir, ".hermes"),
  };
}

export async function resolveHermesMemorySource(
  familiarId: string,
): Promise<HermesMemorySource> {
  const config = await loadConfig();
  if (!Object.hasOwn(config.familiars, familiarId)) {
    return { ok: false, error: "unknown-familiar" };
  }
  return hermesMemorySourceForBinding(
    familiarId,
    bindingFor(config, familiarId),
  );
}
