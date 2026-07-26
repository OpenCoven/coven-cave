export type OpenCovenSubmissionType = "runtime" | "harness";
export type OpenCovenValidationStatus = "pass" | "warning" | "fail" | "review-required";

export type OpenCovenValidationIssue = {
  code: string;
  status: Exclude<OpenCovenValidationStatus, "pass">;
  message: string;
  path?: string;
};

export type OpenCovenRuntimeContract = {
  id: string;
  invocation: string;
  protocols: string[];
  capabilities: string[];
  config?: {
    env?: string[];
    [key: string]: unknown;
  };
  healthCheck: {
    command?: string;
    path?: string;
    [key: string]: unknown;
  };
  sandbox: {
    network: string;
    filesystem: string;
    [key: string]: unknown;
  };
};

export type OpenCovenHarnessContract = {
  id: string;
  requiresCapabilities: string[];
  configSchema: Record<string, unknown>;
  lifecycleHooks: Record<string, string>;
  executionMode: string;
  outputContract: string;
};

export type OpenCovenSubmissionManifest = {
  name: string;
  version: string;
  description: string;
  type: OpenCovenSubmissionType;
  capabilities: string[];
  requiredServices: string[];
  permissions: Record<string, unknown>;
  entrypoints: Record<string, string>;
  runtime?: OpenCovenRuntimeContract;
  harness?: OpenCovenHarnessContract;
  artifacts?: string[];
  examples?: Array<{ name: string; path: string }>;
  tests?: Array<{ name: string; path: string }>;
  docs?: string[];
};

export type OpenCovenSubmissionPackage = {
  manifest: unknown;
  artifacts: string[];
  files?: Record<string, OpenCovenPackageFileEntry>;
};

export type OpenCovenPackageFileEntry =
  | string
  | {
      content?: string;
      size?: number;
      sha256?: string;
    };

export type OpenCovenValidationContext = {
  runtimes?: OpenCovenSubmissionManifest[];
};

export type OpenCovenValidationResult = {
  status: OpenCovenValidationStatus;
  issues: OpenCovenValidationIssue[];
};

export type OpenCovenCatalogEntry = {
  id: string;
  type: OpenCovenSubmissionType;
  submissionId: string;
  name: string;
  description: string;
  versions: string[];
  version: string;
  latestCompatibleVersion: string;
  capabilities: string[];
  compatibility: string[];
  requiredServices: string[];
  validationStatus: OpenCovenValidationStatus;
  examples: Array<{ name: string; path: string }>;
  docs: string[];
  enabled: boolean;
  compatibleRuntimeIds?: string[];
  invocationAdapter?: string;
};

export type OpenCovenExecutionRoute =
  | {
    status: "ready";
    harnessId: string;
    runtimeId: string;
    invocationAdapter: string;
    platformServices: string[];
    harnessServices: string[];
    requiredCapabilities: string[];
    runtimeVersion: string;
    harnessVersion: string;
    }
  | {
      status: "disabled" | "not-found";
      reason: string;
      harnessId?: string;
      runtimeId?: string;
    };

export type OpenCovenExecutionPlan =
  | {
      status: "ready";
      executionService: "opencoven.execution.v1";
      route: Extract<OpenCovenExecutionRoute, { status: "ready" }>;
      dispatch: {
        adapter: string;
        harnessId: string;
        runtimeId: string;
        platformServices: string[];
        harnessServices: string[];
        requiredCapabilities: string[];
        input: unknown;
      };
    }
  | {
      status: "disabled" | "not-found";
      reason: string;
      route: Extract<OpenCovenExecutionRoute, { status: "disabled" | "not-found" }>;
    };

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const REVIEW_NETWORK_POLICIES = new Set(["host", "unrestricted", "public"]);
const REVIEW_FILESYSTEM_POLICIES = new Set(["host", "unrestricted", "root"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const clean = value.map(stringValue);
  if (clean.some((item) => item === null)) return null;
  return clean as string[];
}

function namedPathArray(value: unknown): Array<{ name: string; path: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const result: Array<{ name: string; path: string }> = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const name = stringValue(item.name);
    const path = stringValue(item.path);
    if (!name || !path) return undefined;
    result.push({ name, path });
  }
  return result;
}

function stringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const clean = stringValue(raw);
    if (!clean) return null;
    result[key] = clean;
  }
  return result;
}

function fileEntryContent(entry: OpenCovenPackageFileEntry | undefined): string | null {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.content === "string") return entry.content;
  return null;
}

function hasFileEntry(files: Record<string, OpenCovenPackageFileEntry> | undefined, path: string): boolean {
  if (!files) return true;
  const entry = files[path];
  if (entry === undefined) return false;
  if (typeof entry === "string") return true;
  return (
    typeof entry.content === "string" ||
    typeof entry.size === "number" ||
    typeof entry.sha256 === "string"
  );
}

function validateJsonExample(
  files: Record<string, OpenCovenPackageFileEntry> | undefined,
  path: string,
): boolean {
  const content = fileEntryContent(files?.[path]);
  if (content == null) return true;
  if (!path.toLowerCase().endsWith(".json")) return true;
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return bv[i] - av[i];
  }
  return b.localeCompare(a);
}

function issue(
  code: string,
  status: Exclude<OpenCovenValidationStatus, "pass">,
  message: string,
  path?: string,
): OpenCovenValidationIssue {
  return { code, status, message, path };
}

function resultFromIssues(issues: OpenCovenValidationIssue[]): OpenCovenValidationResult {
  if (issues.some((item) => item.status === "fail")) return { status: "fail", issues };
  if (issues.some((item) => item.status === "review-required")) return { status: "review-required", issues };
  if (issues.some((item) => item.status === "warning")) return { status: "warning", issues };
  return { status: "pass", issues: [] };
}

export function coerceSubmissionManifest(raw: unknown): OpenCovenSubmissionManifest | null {
  if (!isRecord(raw)) return null;
  const type = raw.type === "runtime" || raw.type === "harness" ? raw.type : null;
  const name = stringValue(raw.name);
  const version = stringValue(raw.version);
  const description = stringValue(raw.description);
  const capabilities = stringArray(raw.capabilities);
  const requiredServices = stringArray(raw.requiredServices);
  const permissions = isRecord(raw.permissions) ? raw.permissions : null;
  const entrypoints = stringMap(raw.entrypoints);
  if (!type || !name || !version || !description || !capabilities || !requiredServices || !permissions || !entrypoints) {
    return null;
  }
  const artifacts = stringArray(raw.artifacts ?? []) ?? [];
  const examples = namedPathArray(raw.examples);
  const tests = namedPathArray(raw.tests);
  const docs = stringArray(raw.docs ?? []) ?? [];

  return {
    name,
    version,
    description,
    type,
    capabilities,
    requiredServices,
    permissions,
    entrypoints,
    runtime: isRecord(raw.runtime) ? coerceRuntimeContract(raw.runtime) ?? undefined : undefined,
    harness: isRecord(raw.harness) ? coerceHarnessContract(raw.harness) ?? undefined : undefined,
    artifacts,
    examples,
    tests,
    docs,
  };
}

function coerceRuntimeContract(raw: Record<string, unknown>): OpenCovenRuntimeContract | null {
  const id = stringValue(raw.id);
  const invocation = stringValue(raw.invocation);
  const protocols = stringArray(raw.protocols);
  const capabilities = stringArray(raw.capabilities);
  const healthCheck = isRecord(raw.healthCheck) ? raw.healthCheck : null;
  const sandbox = isRecord(raw.sandbox) ? raw.sandbox : null;
  const network = sandbox ? stringValue(sandbox.network) : null;
  const filesystem = sandbox ? stringValue(sandbox.filesystem) : null;
  if (!id || !invocation || !protocols || !capabilities || !healthCheck || !sandbox || !network || !filesystem) {
    return null;
  }
  return {
    id,
    invocation,
    protocols,
    capabilities,
    config: isRecord(raw.config) ? raw.config : undefined,
    healthCheck,
    sandbox: { ...sandbox, network, filesystem },
  };
}

function coerceHarnessContract(raw: Record<string, unknown>): OpenCovenHarnessContract | null {
  const id = stringValue(raw.id);
  const requiresCapabilities = stringArray(raw.requiresCapabilities);
  const configSchema = isRecord(raw.configSchema) ? raw.configSchema : null;
  const lifecycleHooks = stringMap(raw.lifecycleHooks);
  const executionMode = stringValue(raw.executionMode);
  const outputContract = stringValue(raw.outputContract);
  if (!id || !requiresCapabilities || !configSchema || !lifecycleHooks || !executionMode || !outputContract) {
    return null;
  }
  return { id, requiresCapabilities, configSchema, lifecycleHooks, executionMode, outputContract };
}

export function validateSubmissionPackage(
  pkg: OpenCovenSubmissionPackage,
  context: OpenCovenValidationContext = {},
): OpenCovenValidationResult {
  const issues: OpenCovenValidationIssue[] = [];
  const manifest = coerceSubmissionManifest(pkg.manifest);
  if (!manifest) {
    return {
      status: "fail",
      issues: [issue("manifest.schema", "fail", "OpenCoven submission manifest must include the shared required fields.")],
    };
  }

  if (!SEMVER_RE.test(manifest.version)) {
    issues.push(issue("manifest.version", "fail", "Manifest version must be a semantic version.", "version"));
  }
  const declaredArtifacts = manifest.artifacts ?? [];
  if (declaredArtifacts.length === 0) {
    issues.push(issue("package.artifacts.empty", "fail", "Submission packages must declare at least one artifact.", "artifacts"));
  }
  for (const artifact of declaredArtifacts) {
    if (!pkg.artifacts.includes(artifact)) {
      issues.push(issue("package.artifact.missing", "fail", `Missing declared artifact: ${artifact}`, "artifacts"));
    }
    if (!hasFileEntry(pkg.files, artifact)) {
      issues.push(issue("package.file.missing", "fail", `Missing package file entry: ${artifact}`, "files"));
    }
  }
  for (const example of manifest.examples ?? []) {
    if (!pkg.artifacts.includes(example.path)) {
      issues.push(issue("package.examples.missing", "fail", `Missing declared example: ${example.path}`, "examples"));
    }
    if (!hasFileEntry(pkg.files, example.path)) {
      issues.push(issue("package.file.missing", "fail", `Missing package file entry: ${example.path}`, "files"));
    }
    if (!validateJsonExample(pkg.files, example.path)) {
      issues.push(issue("package.examples.invalid", "fail", `Example is not valid JSON: ${example.path}`, "examples"));
    }
  }
  for (const test of manifest.tests ?? []) {
    if (!pkg.artifacts.includes(test.path)) {
      issues.push(issue("package.examples.missing", "fail", `Missing declared test fixture: ${test.path}`, "tests"));
    }
    if (!hasFileEntry(pkg.files, test.path)) {
      issues.push(issue("package.file.missing", "fail", `Missing package file entry: ${test.path}`, "files"));
    }
    if (!validateJsonExample(pkg.files, test.path)) {
      issues.push(issue("package.examples.invalid", "fail", `Test fixture is not valid JSON: ${test.path}`, "tests"));
    }
  }

  if (manifest.type === "runtime") {
    if (!manifest.runtime) {
      issues.push(issue("runtime.contract.missing", "fail", "Runtime submissions must include a runtime contract.", "runtime"));
    } else {
      if (!manifest.entrypoints.invoke) {
        issues.push(issue("runtime.entrypoint.invoke", "fail", "Runtime submissions must declare an invoke entrypoint.", "entrypoints.invoke"));
      }
      const missingCaps = manifest.runtime.capabilities.filter((capability) => !manifest.capabilities.includes(capability));
      if (missingCaps.length > 0) {
        issues.push(
          issue(
            "runtime.capabilities.shared",
            "fail",
            `Runtime capabilities must also be present in shared capabilities: ${missingCaps.join(", ")}`,
            "capabilities",
          ),
        );
      }
      if (
        REVIEW_NETWORK_POLICIES.has(manifest.runtime.sandbox.network) ||
        REVIEW_FILESYSTEM_POLICIES.has(manifest.runtime.sandbox.filesystem)
      ) {
        issues.push(
          issue(
            "runtime.policy.review",
            "review-required",
            "Runtime sandbox or policy declarations require OpenCoven review before catalog publication.",
            "runtime.sandbox",
          ),
        );
      }
    }
  }

  if (manifest.type === "harness") {
    if (!manifest.harness) {
      issues.push(issue("harness.contract.missing", "fail", "Harness submissions must include a harness contract.", "harness"));
    } else {
      if (!manifest.entrypoints.run) {
        issues.push(issue("harness.entrypoint.run", "fail", "Harness submissions must declare a run entrypoint.", "entrypoints.run"));
      }
      const runtimes = (context.runtimes ?? []).filter((runtime) => runtime.type === "runtime" && runtime.runtime);
      if (runtimes.length > 0 && compatibleRuntimesForHarness(manifest, runtimes).length === 0) {
        issues.push(
          issue(
            "harness.runtime.incompatible",
            "fail",
            "No available OpenCoven runtime provides every capability required by this harness.",
            "harness.requiresCapabilities",
          ),
        );
      }
    }
  }

  return resultFromIssues(issues);
}

function submissionId(manifest: OpenCovenSubmissionManifest): string {
  if (manifest.type === "runtime") return manifest.runtime?.id ?? manifest.name;
  return manifest.harness?.id ?? manifest.name;
}

function hasCapabilities(runtime: OpenCovenSubmissionManifest, required: string[]): boolean {
  const runtimeCaps = new Set(runtime.runtime?.capabilities ?? runtime.capabilities);
  return required.every((capability) => runtimeCaps.has(capability));
}

function compatibleRuntimesForHarness(
  harness: OpenCovenSubmissionManifest,
  runtimes: OpenCovenSubmissionManifest[],
): OpenCovenSubmissionManifest[] {
  const required = harness.harness?.requiresCapabilities ?? [];
  return runtimes.filter((runtime) => runtime.runtime && hasCapabilities(runtime, required));
}

function manifestValidationStatus(manifest: OpenCovenSubmissionManifest): OpenCovenValidationStatus {
  return validateSubmissionPackage({
    manifest,
    artifacts: ["manifest.json", ...(manifest.artifacts ?? []), ...((manifest.examples ?? []).map((item) => item.path)), ...((manifest.tests ?? []).map((item) => item.path))],
  }).status;
}

function latestPublishable(manifests: OpenCovenSubmissionManifest[]): OpenCovenSubmissionManifest {
  const sorted = [...manifests].sort((a, b) => compareVersionsDesc(a.version, b.version));
  return sorted.find((manifest) => manifestValidationStatus(manifest) === "pass") ?? sorted[0]!;
}

export function catalogEntriesFromSubmissions(
  submissions: OpenCovenSubmissionManifest[],
): OpenCovenCatalogEntry[] {
  const validManifests = submissions.map(coerceSubmissionManifest).filter((item): item is OpenCovenSubmissionManifest => item !== null);
  const runtimes = validManifests.filter((manifest) => manifest.type === "runtime" && manifest.runtime);
  const grouped = new Map<string, OpenCovenSubmissionManifest[]>();
  for (const manifest of validManifests) {
    const id = `${manifest.type}:${submissionId(manifest)}`;
    grouped.set(id, [...(grouped.get(id) ?? []), manifest]);
  }

  return [...grouped.entries()]
    .map(([id, versions]) => {
      const selected = latestPublishable(versions);
      const selectedId = submissionId(selected);
      const validationStatus = manifestValidationStatus(selected);
      const allVersions = versions.map((manifest) => manifest.version).sort(compareVersionsDesc);
      const base = {
        id,
        type: selected.type,
        submissionId: selectedId,
        name: selected.name,
        description: selected.description,
        versions: allVersions,
        version: selected.version,
        latestCompatibleVersion: selected.version,
        capabilities: selected.type === "runtime" ? selected.runtime?.capabilities ?? selected.capabilities : selected.capabilities,
        compatibility: selected.type === "harness" ? selected.harness?.requiresCapabilities ?? [] : selected.runtime?.protocols ?? [],
        requiredServices: selected.requiredServices,
        validationStatus,
        examples: [...(selected.examples ?? []), ...(selected.tests ?? [])],
        docs: selected.docs ?? [],
      };

      if (selected.type === "runtime") {
        return {
          ...base,
          enabled: validationStatus === "pass",
          invocationAdapter: selected.runtime?.invocation,
        };
      }

      const compatible = compatibleRuntimesForHarness(selected, runtimes).filter(
        (runtime) => manifestValidationStatus(runtime) === "pass",
      );
      return {
        ...base,
        enabled: validationStatus === "pass" && compatible.length > 0,
        compatibleRuntimeIds: compatible.map((runtime) => runtime.runtime!.id),
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

export function resolveExecutionRoute({
  harnessId,
  runtimeId,
  catalog,
}: {
  harnessId: string;
  runtimeId?: string;
  catalog: OpenCovenCatalogEntry[];
}): OpenCovenExecutionRoute {
  const harness = catalog.find((entry) => entry.type === "harness" && entry.submissionId === harnessId);
  if (!harness) return { status: "not-found", harnessId, reason: `Unknown OpenCoven harness: ${harnessId}` };
  if (!harness.enabled) {
    return { status: "disabled", harnessId, reason: "Harness is disabled because no compatible runtime is available." };
  }

  const selectedRuntimeId = runtimeId ?? harness.compatibleRuntimeIds?.[0];
  if (!selectedRuntimeId) {
    return { status: "disabled", harnessId, reason: "Harness is disabled because no compatible runtime is available." };
  }
  if (!harness.compatibleRuntimeIds?.includes(selectedRuntimeId)) {
    return {
      status: "disabled",
      harnessId,
      runtimeId: selectedRuntimeId,
      reason: `Runtime ${selectedRuntimeId} is not compatible with harness ${harnessId}.`,
    };
  }
  const runtime = catalog.find((entry) => entry.type === "runtime" && entry.submissionId === selectedRuntimeId);
  if (!runtime) {
    return { status: "not-found", harnessId, runtimeId: selectedRuntimeId, reason: `Unknown OpenCoven runtime: ${selectedRuntimeId}` };
  }
  if (!runtime.enabled || runtime.validationStatus !== "pass") {
    return {
      status: "disabled",
      harnessId,
      runtimeId: selectedRuntimeId,
      reason: `Runtime ${selectedRuntimeId} is not publishable.`,
    };
  }

  return {
    status: "ready",
    harnessId,
    runtimeId: selectedRuntimeId,
    invocationAdapter: runtime.invocationAdapter ?? "unknown",
    platformServices: runtime.requiredServices,
    harnessServices: harness.requiredServices,
    requiredCapabilities: harness.compatibility,
    runtimeVersion: runtime.latestCompatibleVersion,
    harnessVersion: harness.latestCompatibleVersion,
  };
}

export function buildExecutionPlan({
  harnessId,
  runtimeId,
  catalog,
  input = null,
}: {
  harnessId: string;
  runtimeId?: string;
  catalog: OpenCovenCatalogEntry[];
  input?: unknown;
}): OpenCovenExecutionPlan {
  const route = resolveExecutionRoute({ harnessId, runtimeId, catalog });
  if (route.status !== "ready") {
    return {
      status: route.status,
      reason: route.reason,
      route,
    };
  }

  return {
    status: "ready",
    executionService: "opencoven.execution.v1",
    route,
    dispatch: {
      adapter: route.invocationAdapter,
      harnessId: route.harnessId,
      runtimeId: route.runtimeId,
      platformServices: route.platformServices,
      harnessServices: route.harnessServices,
      requiredCapabilities: route.requiredCapabilities,
      input,
    },
  };
}
