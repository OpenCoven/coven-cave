import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CraftSpecification, PluginKind } from "../marketplace-catalog.ts";
import { createKeyedTransactionLock, type KeyedTransactionLock } from "./keyed-transaction-lock.ts";

const execFileAsync = promisify(execFile);

export const CODEX_MARKETPLACE_NAME = "opencoven-first-party";
export const CRAFT_RUNTIME = "codex";

const CRAFT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER = 256 * 1024;
const DIAGNOSTIC_LIMIT = 2_048;
const DIAGNOSTIC_LABEL_LIMIT = 160;
const AFFECTED_ROLE_LIMIT = 20;
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export type CraftComponentDefinition = {
  id: string;
  displayName: string;
  version: string;
  kind: PluginKind;
  requiredConfig: string[];
};

export type CraftDefinition = {
  id: string;
  displayName: string;
  description: string;
  version: string;
  craft: CraftSpecification;
  components: Record<string, CraftComponentDefinition>;
};

export type CraftInstallationRecord = {
  id: string;
  version: string;
  source: string;
  installedAt: string;
  runtime: string;
  verifiedAt: string;
  craftVersion: string;
};

export type CraftInstallationWrite = Omit<CraftInstallationRecord, "installedAt">;

export type CraftInstallStore = {
  get(id: string): Promise<CraftInstallationRecord | undefined>;
  record(record: CraftInstallationWrite): Promise<CraftInstallationRecord>;
  remove(id: string): Promise<void>;
};

export type CraftCatalog = {
  get(id: string): Promise<CraftDefinition | null>;
};

export type CraftCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBuffer: number;
};

export type CraftCommandResult = { stdout: string; stderr: string };

export type CraftCommandRunner = (
  command: string,
  args: string[],
  options: CraftCommandOptions,
) => Promise<CraftCommandResult>;

export type CraftPlanComponent = CraftComponentDefinition & {
  required: boolean;
  requiresConfiguration: boolean;
};

export type CraftInstallPlan = {
  id: string;
  displayName: string;
  description: string;
  version: string;
  installTarget: string;
  commands: {
    marketplaceCheck: string[];
    install: string[];
    verify: string[];
    uninstall: string[];
  };
  components: {
    required: CraftPlanComponent[];
    optionalEnhancements: CraftPlanComponent[];
  };
  bundled: { skills: string[]; prompts: string[]; workflows: string[] };
  requiredCapabilities: string[];
  recommendedRoles: string[];
  provenance: CraftSpecification["provenance"] & {
    resources: CraftSpecification["bundled"]["skills"];
  };
  runtime: {
    id: typeof CRAFT_RUNTIME;
    marketplace: typeof CODEX_MARKETPLACE_NAME;
    scope: "user";
    disclosure: string;
  };
};

export type CraftRollbackDiagnostic = {
  attempted: true;
  succeeded: boolean;
  message?: string;
};

export type CraftTransactionDiagnostic = {
  step: string;
  message: string;
  stdout?: string;
  stderr?: string;
  rollback?: CraftRollbackDiagnostic;
  affectedRoles?: Array<{ id: string; name: string; familiar: string }>;
  affectedRoleCount?: number;
  affectedRolesTruncated?: boolean;
};

export type CraftTransactionErrorCode =
  | "unknown_craft"
  | "invalid_craft"
  | "marketplace_not_configured"
  | "marketplace_check_failed"
  | "unsupported_runtime"
  | "cli_missing"
  | "timeout"
  | "malformed_json"
  | "install_failed"
  | "verification_failed"
  | "uninstall_failed"
  | "persistence_failed"
  | "craft_equipped";

export class CraftTransactionError extends Error {
  readonly code: CraftTransactionErrorCode;
  readonly diagnostic: CraftTransactionDiagnostic;

  constructor(
    code: CraftTransactionErrorCode,
    message: string,
    diagnostic: CraftTransactionDiagnostic,
  ) {
    super(message);
    this.name = "CraftTransactionError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export type CraftInstallResult = {
  ok: true;
  installed: true;
  alreadyInstalled: boolean;
  installedAt: string;
  verifiedAt: string;
  runtime: typeof CRAFT_RUNTIME;
  craftVersion: string;
  plan: CraftInstallPlan;
};

export type CraftUninstallResult = {
  ok: true;
  installed: false;
  alreadyRemoved: boolean;
  runtime: typeof CRAFT_RUNTIME;
  craftVersion: string;
};

export type CraftInstallService = {
  plan(id: string): Promise<CraftInstallPlan>;
  install(id: string): Promise<CraftInstallResult>;
  uninstall(id: string): Promise<CraftUninstallResult>;
};

export type CraftInstallServiceOptions = {
  runner: CraftCommandRunner;
  catalog: CraftCatalog;
  store: CraftInstallStore;
  now?: () => string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  beforeUninstall?: (definition: CraftDefinition) => Promise<void>;
  withTransaction?: KeyedTransactionLock;
};

type CommandStep =
  | "marketplace-check"
  | "preflight"
  | "install"
  | "verification"
  | "rollback"
  | "rollback-verification"
  | "uninstall"
  | "uninstall-verification";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactedOutput(
  value: unknown,
  env: NodeJS.ProcessEnv,
  limit = DIAGNOSTIC_LIMIT,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  let output = value
    .replace(ANSI_RE, "")
    .replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]+|gh[opsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, "[REDACTED]")
    .replace(/(\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|_PAT)\s*=\s*)[^\s,;]+/g, "$1[REDACTED]")
    .replace(/(["']?(?:token|api[_-]?key|secret|password|pat)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1[REDACTED]");

  for (const home of new Set([env.HOME, env.USERPROFILE, env.CODEX_HOME].filter(Boolean))) {
    output = output.replace(new RegExp(escapeRegExp(home as string), "g"), "~");
  }
  output = output
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~");

  if (output.length > limit) {
    return `${output.slice(0, Math.max(0, limit - 1))}…`;
  }
  return output;
}

export function craftAffectedRoleDiagnostic(
  roles: ReadonlyArray<{ id: string; name: string; familiar: string }>,
  env: NodeJS.ProcessEnv = process.env,
): {
  affectedRoles: Array<{ id: string; name: string; familiar: string }>;
  affectedRoleCount: number;
  affectedRolesTruncated: boolean;
} {
  const clean = (value: string) => redactedOutput(
    value.replace(/[\u0000-\u001f\u007f]+/g, " "),
    env,
    DIAGNOSTIC_LABEL_LIMIT,
  ) ?? "";
  return {
    affectedRoles: roles.slice(0, AFFECTED_ROLE_LIMIT).map((role) => ({
      id: clean(role.id),
      name: clean(role.name),
      familiar: clean(role.familiar),
    })),
    affectedRoleCount: roles.length,
    affectedRolesTruncated: roles.length > AFFECTED_ROLE_LIMIT,
  };
}

function diagnosticFromFailure(
  step: CommandStep,
  message: string,
  error: unknown,
  env: NodeJS.ProcessEnv,
): CraftTransactionDiagnostic {
  const failure = error as { stdout?: unknown; stderr?: unknown };
  return {
    step,
    message,
    ...(redactedOutput(failure?.stdout, env) ? { stdout: redactedOutput(failure.stdout, env) } : {}),
    ...(redactedOutput(failure?.stderr, env) ? { stderr: redactedOutput(failure.stderr, env) } : {}),
  };
}

function commandFailureCode(step: CommandStep, error: unknown): CraftTransactionErrorCode {
  const code = (error as NodeJS.ErrnoException & { killed?: boolean })?.code;
  if (code === "ENOENT") return "cli_missing";
  if (code === "ETIMEDOUT" || code === "ERR_CHILD_PROCESS_TIMEOUT" || (error as { killed?: boolean })?.killed) {
    return "timeout";
  }
  const failure = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const output = [failure.message, failure.stdout, failure.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (/unrecognized subcommand|unknown (?:subcommand|command)|unexpected argument[^\n]*--json/i.test(output)) {
    return "unsupported_runtime";
  }
  if (step === "marketplace-check" || step === "preflight") return "marketplace_check_failed";
  if (step === "verification" || step === "uninstall-verification" || step === "rollback-verification") {
    return "verification_failed";
  }
  if (step === "uninstall" || step === "rollback") {
    return "uninstall_failed";
  }
  return "install_failed";
}

function publicFailureMessage(code: CraftTransactionErrorCode): string {
  switch (code) {
    // Name the fix, not just the failure: a Claude-only user hitting this had
    // no path forward from "unavailable" (cave-nkte).
    case "cli_missing": return "Crafts install through the Codex CLI, which isn't installed on this machine. Install it with `npm i -g @openai/codex`, then retry.";
    case "timeout": return "The Codex plugin command timed out.";
    case "unsupported_runtime": return "This Codex CLI does not support verified Craft installation.";
    case "marketplace_check_failed": return "Cave could not inspect configured Codex marketplaces.";
    case "verification_failed": return "Codex did not report the expected Craft installation state.";
    case "uninstall_failed": return "Codex could not remove this Craft.";
    case "persistence_failed": return "Cave could not persist the verified Craft state.";
    case "craft_equipped": return "Detach this Craft from every Role before removing it.";
    default: return "Codex could not install this Craft.";
  }
}

function commandError(step: CommandStep, error: unknown, env: NodeJS.ProcessEnv): CraftTransactionError {
  if (error instanceof CraftTransactionError) return error;
  const code = commandFailureCode(step, error);
  const message = publicFailureMessage(code);
  return new CraftTransactionError(code, message, diagnosticFromFailure(step, message, error, env));
}

function parsedJson(
  step: CommandStep,
  result: CraftCommandResult,
  env: NodeJS.ProcessEnv,
): unknown {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    const message = "Codex returned malformed JSON.";
    throw new CraftTransactionError("malformed_json", message, {
      step,
      message,
      ...(redactedOutput(result.stdout, env) ? { stdout: redactedOutput(result.stdout, env) } : {}),
      ...(redactedOutput(result.stderr, env) ? { stderr: redactedOutput(result.stderr, env) } : {}),
    });
  }
}

function marketplaceIsConfigured(value: unknown): boolean {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { marketplaces?: unknown }).marketplaces)
      ? (value as { marketplaces: unknown[] }).marketplaces
      : [];
  return candidates.some((entry) => {
    if (typeof entry === "string") return entry === CODEX_MARKETPLACE_NAME;
    if (!entry || typeof entry !== "object") return false;
    const item = entry as { name?: unknown; id?: unknown; marketplace?: unknown };
    return [item.name, item.id, item.marketplace].includes(CODEX_MARKETPLACE_NAME);
  });
}

function pluginItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as { plugins?: unknown; data?: unknown };
  if (Array.isArray(record.plugins)) return record.plugins;
  if (record.data && typeof record.data === "object" && Array.isArray((record.data as { plugins?: unknown }).plugins)) {
    return (record.data as { plugins: unknown[] }).plugins;
  }
  return [];
}

function pluginMatches(
  value: unknown,
  definition: CraftDefinition,
  requireCurrentVersion: boolean,
): boolean {
  const target = `${definition.id}@${CODEX_MARKETPLACE_NAME}`;
  return pluginItems(value).some((entry) => {
    if (typeof entry === "string") return !requireCurrentVersion && entry === target;
    if (!entry || typeof entry !== "object") return false;
    const item = entry as {
      id?: unknown;
      name?: unknown;
      target?: unknown;
      marketplace?: unknown;
      marketplaceName?: unknown;
      version?: unknown;
    };
    const identities = [item.id, item.name, item.target];
    const marketplace = item.marketplace ?? item.marketplaceName;
    if (typeof marketplace === "string" && marketplace !== CODEX_MARKETPLACE_NAME) return false;
    const identityMatchesTarget = identities.some((identity) => identity === target);
    const identityMatchesName = identities.some((identity) => identity === definition.id);
    if (!identityMatchesTarget && !(identityMatchesName && marketplace === CODEX_MARKETPLACE_NAME)) {
      return false;
    }
    if (requireCurrentVersion && item.version !== definition.version) {
      return false;
    }
    return true;
  });
}

function pluginIsPresent(value: unknown, definition: CraftDefinition): boolean {
  return pluginMatches(value, definition, false);
}

function pluginIsVerified(value: unknown, definition: CraftDefinition): boolean {
  return pluginMatches(value, definition, true);
}

function componentPlan(
  definition: CraftDefinition,
  ids: string[],
  required: boolean,
): CraftPlanComponent[] {
  return ids.map((id) => {
    const component = definition.components[id];
    if (!component) {
      throw new CraftTransactionError("invalid_craft", "The Craft references a missing component.", {
        step: "plan",
        message: `Missing component: ${id}`,
      });
    }
    return {
      ...component,
      required,
      requiresConfiguration: component.requiredConfig.length > 0,
    };
  });
}

function planFor(definition: CraftDefinition): CraftInstallPlan {
  const target = `${definition.id}@${CODEX_MARKETPLACE_NAME}`;
  return {
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
    version: definition.version,
    installTarget: target,
    commands: {
      marketplaceCheck: ["codex", "plugin", "marketplace", "list", "--json"],
      install: ["codex", "plugin", "add", target, "--json"],
      verify: ["codex", "plugin", "list", "--json"],
      uninstall: ["codex", "plugin", "remove", target, "--json"],
    },
    components: {
      required: componentPlan(definition, definition.craft.components.required, true),
      optionalEnhancements: componentPlan(definition, definition.craft.components.optional, false),
    },
    bundled: {
      skills: definition.craft.bundled.skills.map((resource) => resource.id),
      prompts: definition.craft.bundled.prompts.map((resource) => resource.id),
      workflows: definition.craft.bundled.workflows.map((resource) => resource.id),
    },
    requiredCapabilities: [...definition.craft.requiredCapabilities],
    recommendedRoles: [...definition.craft.recommendedRoles],
    provenance: {
      ...definition.craft.provenance,
      resources: definition.craft.bundled.skills.map((resource) => ({
        ...resource,
        modifications: [...resource.modifications],
      })),
    },
    runtime: {
      id: CRAFT_RUNTIME,
      marketplace: CODEX_MARKETPLACE_NAME,
      scope: "user",
      disclosure: "Codex installs plugins at user scope. Equipping a Craft changes Cave routing and presentation; it is not a security sandbox.",
    },
  };
}

export const defaultCraftCommandRunner: CraftCommandRunner = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    encoding: "utf8",
    windowsHide: true,
  });
  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
};

export function craftTransactionStatus(code: CraftTransactionErrorCode): number {
  if (code === "unknown_craft") return 404;
  if (code === "invalid_craft") return 400;
  if (code === "marketplace_not_configured") return 409;
  if (code === "unsupported_runtime") return 409;
  if (code === "craft_equipped") return 409;
  if (code === "cli_missing") return 503;
  if (code === "timeout") return 504;
  if (code === "persistence_failed") return 500;
  return 502;
}

export function createCraftInstallService(options: CraftInstallServiceOptions): CraftInstallService {
  const env = { ...(options.env ?? process.env) };
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? COMMAND_MAX_BUFFER;
  const now = options.now ?? (() => new Date().toISOString());
  const withCraftLock = options.withTransaction ?? createKeyedTransactionLock();

  async function definitionFor(id: string): Promise<CraftDefinition> {
    if (!CRAFT_ID_RE.test(id)) {
      throw new CraftTransactionError("unknown_craft", "Craft not found.", {
        step: "catalog",
        message: "Craft not found.",
      });
    }
    const definition = await options.catalog.get(id);
    if (!definition || definition.id !== id) {
      throw new CraftTransactionError("unknown_craft", "Craft not found.", {
        step: "catalog",
        message: "Craft not found.",
      });
    }
    if (!CRAFT_ID_RE.test(definition.id) || definition.craft.schemaVersion !== "opencoven.craft.v1") {
      throw new CraftTransactionError("invalid_craft", "Craft metadata is invalid.", {
        step: "catalog",
        message: "Craft metadata is invalid.",
      });
    }
    return definition;
  }

  async function runJson(step: CommandStep, args: string[]): Promise<unknown> {
    let result: CraftCommandResult;
    try {
      result = await options.runner("codex", args, { cwd, env, timeoutMs, maxBuffer });
    } catch (error) {
      throw commandError(step, error, env);
    }
    return parsedJson(step, result, env);
  }

  async function confirmMarketplace(): Promise<void> {
    const data = await runJson("marketplace-check", ["plugin", "marketplace", "list", "--json"]);
    if (!marketplaceIsConfigured(data)) {
      const message = `Configure the ${CODEX_MARKETPLACE_NAME} Codex marketplace before installing Crafts.`;
      throw new CraftTransactionError("marketplace_not_configured", message, {
        step: "marketplace-check",
        message,
      });
    }
  }

  async function recordVerified(definition: CraftDefinition): Promise<CraftInstallationRecord> {
    const verifiedAt = now();
    try {
      return await options.store.record({
        id: definition.id,
        version: definition.version,
        source: "catalog",
        runtime: CRAFT_RUNTIME,
        verifiedAt,
        craftVersion: definition.version,
      });
    } catch (error) {
      const message = publicFailureMessage("persistence_failed");
      throw new CraftTransactionError("persistence_failed", message, {
        step: "persist",
        message,
      });
    }
  }

  async function removePersisted(id: string): Promise<void> {
    try {
      await options.store.remove(id);
    } catch {
      const message = publicFailureMessage("persistence_failed");
      throw new CraftTransactionError("persistence_failed", message, {
        step: "persist",
        message,
      });
    }
  }

  async function rollback(definition: CraftDefinition): Promise<CraftRollbackDiagnostic> {
    try {
      await runJson("rollback", ["plugin", "remove", `${definition.id}@${CODEX_MARKETPLACE_NAME}`, "--json"]);
      const after = await runJson("rollback-verification", ["plugin", "list", "--json"]);
      if (pluginIsPresent(after, definition)) {
        return {
          attempted: true,
          succeeded: false,
          message: "Codex still reports the Craft as installed after rollback.",
        };
      }
      return { attempted: true, succeeded: true };
    } catch (error) {
      const failure = error instanceof CraftTransactionError ? error : commandError("rollback", error, env);
      return {
        attempted: true,
        succeeded: false,
        message: failure.diagnostic.stderr ?? failure.message,
      };
    }
  }

  async function installLocked(definition: CraftDefinition): Promise<CraftInstallResult> {
    const plan = planFor(definition);
    await confirmMarketplace();
    const before = await runJson("preflight", ["plugin", "list", "--json"]);
    const priorInstallPresent = pluginIsPresent(before, definition);
    if (pluginIsVerified(before, definition)) {
      const saved = await recordVerified(definition);
      return {
        ok: true,
        installed: true,
        alreadyInstalled: true,
        installedAt: saved.installedAt,
        verifiedAt: saved.verifiedAt,
        runtime: CRAFT_RUNTIME,
        craftVersion: definition.version,
        plan,
      };
    }

    try {
      await runJson("install", ["plugin", "add", plan.installTarget, "--json"]);
      const after = await runJson("verification", ["plugin", "list", "--json"]);
      if (!pluginIsVerified(after, definition)) {
        const message = publicFailureMessage("verification_failed");
        throw new CraftTransactionError("verification_failed", message, {
          step: "verification",
          message,
        });
      }
      const saved = await recordVerified(definition);
      return {
        ok: true,
        installed: true,
        alreadyInstalled: false,
        installedAt: saved.installedAt,
        verifiedAt: saved.verifiedAt,
        runtime: CRAFT_RUNTIME,
        craftVersion: definition.version,
        plan,
      };
    } catch (error) {
      const failure = error instanceof CraftTransactionError
        ? error
        : commandError("install", error, env);
      if (priorInstallPresent) throw failure;
      if (failure.code === "persistence_failed") {
        await options.store.remove(definition.id).catch(() => {});
      }
      const rollbackResult = await rollback(definition);
      throw new CraftTransactionError(failure.code, failure.message, {
        ...failure.diagnostic,
        rollback: rollbackResult,
      });
    }
  }

  async function uninstallLocked(definition: CraftDefinition): Promise<CraftUninstallResult> {
    await options.beforeUninstall?.(definition);
    await confirmMarketplace();
    const before = await runJson("preflight", ["plugin", "list", "--json"]);
    if (!pluginIsPresent(before, definition)) {
      await removePersisted(definition.id);
      return {
        ok: true,
        installed: false,
        alreadyRemoved: true,
        runtime: CRAFT_RUNTIME,
        craftVersion: definition.version,
      };
    }

    await runJson("uninstall", [
      "plugin",
      "remove",
      `${definition.id}@${CODEX_MARKETPLACE_NAME}`,
      "--json",
    ]);
    const after = await runJson("uninstall-verification", ["plugin", "list", "--json"]);
    if (pluginIsPresent(after, definition)) {
      const message = "Codex still reports this Craft as installed.";
      throw new CraftTransactionError("verification_failed", message, {
        step: "uninstall-verification",
        message,
      });
    }
    await removePersisted(definition.id);
    return {
      ok: true,
      installed: false,
      alreadyRemoved: false,
      runtime: CRAFT_RUNTIME,
      craftVersion: definition.version,
    };
  }

  return {
    async plan(id) {
      return planFor(await definitionFor(id));
    },
    async install(id) {
      const definition = await definitionFor(id);
      return withCraftLock(id, () => installLocked(definition));
    },
    async uninstall(id) {
      const definition = await definitionFor(id);
      return withCraftLock(id, () => uninstallLocked(definition));
    },
  };
}
