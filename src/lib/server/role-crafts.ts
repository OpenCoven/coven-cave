import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../cave-config.ts";
import type { InstalledMap } from "../marketplace-catalog.ts";
import {
  composeRoleEffective,
  type EquippedCraftComposition,
  type RoleDirectComposition,
  type RoleEffectiveComposition,
} from "../role-craft-composition.ts";
import { parseRoleListField, setRoleListField } from "../role-manifest.ts";
import { discoverRoleFiles, parseRoleFrontmatter, type RoleFile } from "../role-source.ts";
import { loadCraftDefinition } from "./craft-catalog.ts";
import type { CraftDefinition } from "./craft-install.ts";
import {
  createKeyedTransactionLock,
  withCraftTransaction,
  withRoleManifestTransaction,
  type KeyedTransactionLock,
} from "./keyed-transaction-lock.ts";

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

export type RoleCraftServiceErrorCode =
  | "unsafe_id"
  | "role_not_found"
  | "craft_not_found"
  | "craft_not_installed"
  | "craft_update_required";

export class RoleCraftServiceError extends Error {
  readonly code: RoleCraftServiceErrorCode;

  constructor(code: RoleCraftServiceErrorCode, message: string) {
    super(message);
    this.name = "RoleCraftServiceError";
    this.code = code;
  }
}

export type RoleCraftState = {
  id: string;
  displayName?: string;
  version?: string;
  status: "ready" | "missing" | "not-installed" | "update-required";
};

export type RoleCraftResolution = {
  craftStates: RoleCraftState[];
  effective: RoleEffectiveComposition;
};

export type RoleCraftAttachment = {
  id: string;
  name: string;
  familiar: string;
};

export type RoleCraftServiceOptions = {
  listRoleFiles(): Promise<RoleFile[]>;
  readRole(path: string): Promise<string>;
  writeRole(path: string, text: string): Promise<void>;
  loadCraft(id: string): Promise<CraftDefinition | null>;
  installedCrafts(): Promise<InstalledMap>;
  withCraftTransaction?: KeyedTransactionLock;
  withRoleTransaction?: KeyedTransactionLock;
};

function installedState(
  definition: CraftDefinition,
  installed: InstalledMap,
): RoleCraftState["status"] {
  const record = installed[definition.id];
  if (
    !record
    || record.runtime !== "codex"
    || typeof record.verifiedAt !== "string"
    || typeof record.craftVersion !== "string"
  ) {
    return "not-installed";
  }
  return record.craftVersion === definition.version ? "ready" : "update-required";
}

function compositionFor(definition: CraftDefinition): EquippedCraftComposition {
  return {
    id: definition.id,
    displayName: definition.displayName,
    components: Object.fromEntries(
      Object.entries(definition.components).map(([id, component]) => [id, { kind: component.kind }]),
    ),
    craft: {
      components: definition.craft.components,
      bundled: {
        skills: definition.craft.bundled.skills.map((resource) => resource.id),
        prompts: definition.craft.bundled.prompts.map((resource) => resource.id),
        workflows: definition.craft.bundled.workflows.map((resource) => resource.id),
      },
      requiredCapabilities: definition.craft.requiredCapabilities,
    },
  };
}

function ensureSafe(...ids: string[]): void {
  if (ids.some((id) => !SAFE_ID_RE.test(id))) {
    throw new RoleCraftServiceError("unsafe_id", "unsafe role, familiar, or Craft id");
  }
}

export function roleCraftServiceStatus(code: RoleCraftServiceErrorCode): number {
  if (code === "role_not_found" || code === "craft_not_found") return 404;
  if (code === "craft_not_installed" || code === "craft_update_required") return 409;
  return 400;
}

export function createRoleCraftService(options: RoleCraftServiceOptions) {
  const craftTransaction = options.withCraftTransaction ?? createKeyedTransactionLock();
  const roleTransaction = options.withRoleTransaction ?? createKeyedTransactionLock();

  async function resolve(
    direct: RoleDirectComposition,
    craftIds: readonly string[],
    installedOverride?: InstalledMap,
  ): Promise<RoleCraftResolution> {
    const installed = installedOverride ?? await options.installedCrafts();
    const craftStates: RoleCraftState[] = [];
    const equipped: EquippedCraftComposition[] = [];

    for (const id of craftIds) {
      const definition = await options.loadCraft(id);
      if (!definition) {
        craftStates.push({ id, status: "missing" });
        continue;
      }
      const status = installedState(definition, installed);
      craftStates.push({
        id,
        displayName: definition.displayName,
        version: definition.version,
        status,
      });
      if (status === "ready") equipped.push(compositionFor(definition));
    }

    return { craftStates, effective: composeRoleEffective(direct, equipped) };
  }

  async function attach(input: {
    roleId: string;
    familiar: string;
    craftId: string;
    attach: boolean;
  }): Promise<{ crafts: string[] }> {
    ensureSafe(input.roleId, input.familiar, input.craftId);
    return craftTransaction(input.craftId, () => roleTransaction(
      `${input.familiar}:${input.roleId}`,
      async () => {
        const role = (await options.listRoleFiles()).find(
          (entry) => entry.id === input.roleId && entry.familiar === input.familiar,
        );
        if (!role) {
          throw new RoleCraftServiceError(
            "role_not_found",
            `role ${input.familiar}:${input.roleId} not found`,
          );
        }

        if (input.attach) {
          const definition = await options.loadCraft(input.craftId);
          if (!definition) {
            throw new RoleCraftServiceError("craft_not_found", `Craft ${input.craftId} not found`);
          }
          const state = installedState(definition, await options.installedCrafts());
          if (state === "not-installed") {
            throw new RoleCraftServiceError("craft_not_installed", "Install and verify this Craft before equipping it.");
          }
          if (state === "update-required") {
            throw new RoleCraftServiceError("craft_update_required", "Update and verify this Craft before equipping it.");
          }
        }

        const text = await options.readRole(role.path);
        const current = parseRoleListField(text, "crafts");
        const next = input.attach
          ? current.includes(input.craftId) ? current : [...current, input.craftId]
          : current.filter((id) => id !== input.craftId);
        const updated = setRoleListField(text, "crafts", next);
        if (updated !== text) await options.writeRole(role.path, updated);
        return { crafts: next };
      }
    ));
  }

  async function attachments(craftId: string): Promise<RoleCraftAttachment[]> {
    ensureSafe(craftId);
    const affected: RoleCraftAttachment[] = [];
    for (const role of await options.listRoleFiles()) {
      const text = await options.readRole(role.path);
      if (!parseRoleListField(text, "crafts").includes(craftId)) continue;
      affected.push({
        id: role.id,
        name: parseRoleFrontmatter(text).name ?? role.id,
        familiar: role.familiar,
      });
    }
    return affected.sort(
      (a, b) => a.familiar.localeCompare(b.familiar) || a.name.localeCompare(b.name),
    );
  }

  return { resolve, attach, attachments };
}

export const roleCraftService = createRoleCraftService({
  listRoleFiles: discoverRoleFiles,
  readRole: (rolePath) => readFile(rolePath, "utf8"),
  writeRole: (rolePath, text) => writeFile(rolePath, text, "utf8"),
  loadCraft: (id) => loadCraftDefinition(id),
  installedCrafts: async () => (await loadConfig()).marketplace.installed,
  withCraftTransaction,
  withRoleTransaction: withRoleManifestTransaction,
});
