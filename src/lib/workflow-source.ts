import { chmod, copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { covenHome } from "./coven-paths.ts";
import type {
  WorkflowDryRunPlan,
  WorkflowHttpCall,
  WorkflowListResponse,
  WorkflowStepSummary,
  WorkflowSummary,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "./workflows.ts";
import { listRoleWorkflowIds } from "./role-source.ts";

type WorkflowStorageScope = "public" | "personal";
type ManifestFile = { source: string; raw: unknown; storage: WorkflowStorageScope };
type FoundWorkflow = WorkflowSummary & { storage: WorkflowStorageScope };

/**
 * Local workflow source for the Cave Workflow Studio.
 *
 * The daemon does not (yet) implement `/api/v1/workflows*`, so the proxy routes
 * fall back to this module: workflow manifests authored as YAML on disk are
 * scanned, validated, and dry-run planned entirely in-process. When the daemon
 * grows a real workflow engine, the routes prefer it and this becomes the
 * offline/unimplemented fallback only.
 *
 * Manifest directory resolution (first hit wins):
 *   1. `COVEN_WORKFLOWS_DIR` env var (absolute path)
 *   2. bundle mode (`COVEN_CAVE_BUNDLE=1`): `<covenHome>/cave/workflows` (writable)
 *   3. `<cwd>/workflows`
 *
 * In packaged desktop builds the process runs with its cwd inside the
 * read-only, code-signed `.app` bundle. Saving public workflows there (manifest
 * `.yaml` + canvas-layout `.cave.json` sidecars) would mutate the bundle and
 * break its signature seal — which makes Gatekeeper reject the app and stops
 * the in-place auto-updater. So in bundle mode public workflows live in a
 * writable per-user directory, seeded once from the bundle's shipped templates
 * (see {@link seedPublicWorkflowsIfNeeded}).
 */
export function workflowsDir(): string {
  const override = process.env.COVEN_WORKFLOWS_DIR?.trim();
  if (override) return override;
  if (isBundle()) return path.join(covenHome(), "cave", "workflows");
  return path.join(process.cwd(), "workflows");
}

/** Read-only public workflow templates shipped inside the app bundle. In
 *  bundle mode the sidecar's cwd is the bundle's server dir, so its `workflows/`
 *  seeds live alongside. Used only to seed the writable dir on first run. */
function bundledSeedWorkflowsDir(): string {
  return path.join(process.cwd(), "workflows");
}

function isBundle(): boolean {
  return process.env.COVEN_CAVE_BUNDLE === "1";
}

let publicSeedChecked = false;

/**
 * First-run seed for bundle mode: the writable public dir starts empty, so copy
 * the bundle's shipped templates (manifests + their `.cave.json` layout
 * sidecars) into it once. Existence of the writable dir is the "already seeded"
 * marker, so user deletions are respected and we never re-copy on every read.
 * No-op outside bundle mode or when `COVEN_WORKFLOWS_DIR` is set (dev/tests).
 */
async function seedPublicWorkflowsIfNeeded(): Promise<void> {
  if (!isBundle()) return;
  if (process.env.COVEN_WORKFLOWS_DIR?.trim()) return;
  if (publicSeedChecked) return;
  publicSeedChecked = true;

  const dest = workflowsDir();
  try {
    await stat(dest);
    return; // already present → seeded (or intentionally emptied) — leave it
  } catch {
    // not present → seed below
  }

  const seedDir = bundledSeedWorkflowsDir();
  let names: string[];
  try {
    names = await readdir(seedDir);
  } catch {
    return; // no bundled seeds (e.g. seedDir === dest) → nothing to copy
  }
  if (path.resolve(seedDir) === path.resolve(dest)) return;

  await mkdir(dest, { recursive: true });
  for (const name of names) {
    if (!/\.(ya?ml|cave\.json)$/i.test(name)) continue;
    try {
      await copyFile(path.join(seedDir, name), path.join(dest, name));
    } catch {
      // Best-effort: a failed copy just means that one template is unavailable.
    }
  }
}

export function personalWorkflowsDir(): string {
  const override = process.env.COVEN_PERSONAL_WORKFLOWS_DIR?.trim();
  if (override) return override;
  return path.join(covenHome(), "workflows", "personal");
}

const KNOWN_PATTERNS = new Set([
  "fan-out-and-synthesize",
  "classify-and-act",
  "adversarial-verification",
  "generate-and-filter",
  "tournament",
  "loop-until-done",
  "sequential",
  "custom",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === "string");
  return out.length > 0 ? out : undefined;
}

function asHttpCalls(value: unknown): WorkflowHttpCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WorkflowHttpCall[] = [];
  for (const [index, raw] of value.entries()) {
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const url = asString(obj.url);
    if (!url) continue; // a call without a URL is meaningless — drop it
    out.push({
      id: asString(obj.id) ?? `call-${index + 1}`,
      name: asString(obj.name),
      method: asString(obj.method),
      url,
      note: asString(obj.note),
    });
  }
  return out.length > 0 ? out : undefined;
}

function coerceStep(raw: unknown, index: number): WorkflowStepSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: asString(obj.id) ?? `step-${index + 1}`,
    kind: asString(obj.kind) ?? "agent",
    name: asString(obj.name),
    uses: asString(obj.uses),
    summary: asString(obj.summary),
    requires: asStringArray(obj.requires),
    permissions: asStringArray(obj.permissions),
    on_error: asString(obj.on_error),
  };
}

/**
 * Turn an arbitrary parsed manifest into a `WorkflowSummary`. Tolerant by
 * design — missing/invalid fields are surfaced by {@link validateManifest},
 * not by throwing here, so the studio can still render an invalid workflow.
 */
export function coerceManifest(
  raw: unknown,
  source?: string,
  storage?: WorkflowStorageScope,
): WorkflowSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const limits = (obj.limits && typeof obj.limits === "object" ? obj.limits : undefined) as
    | Record<string, unknown>
    | undefined;
  const visibility = (obj.visibility && typeof obj.visibility === "object" ? obj.visibility : undefined) as
    | Record<string, unknown>
    | undefined;

  const summary: WorkflowSummary = {
    id: asString(obj.id) ?? source ?? "untitled-workflow",
    version: asString(obj.version) ?? "0.0.0",
    name: asString(obj.name),
    summary: asString(obj.summary),
    familiar: asString(obj.familiar),
    pattern: asString(obj.pattern),
    steps: rawSteps.map((step, index) => coerceStep(step, index)),
    tags: asStringArray(obj.tags),
    permissions: asStringArray(obj.permissions),
    skills: asStringArray(obj.skills),
    mcp: asStringArray(obj.mcp),
    http: asHttpCalls(obj.http),
    path: source,
    storage,
  };

  if (limits) {
    summary.limits = {
      max_agents: typeof limits.max_agents === "number" ? limits.max_agents : undefined,
      timeout_s: typeof limits.timeout_s === "number" ? limits.timeout_s : undefined,
      cost_ceiling_usd: typeof limits.cost_ceiling_usd === "number" ? limits.cost_ceiling_usd : undefined,
    };
  }
  if (visibility) {
    summary.visibility = {
      public: typeof visibility.public === "boolean" ? visibility.public : undefined,
      personal: typeof visibility.personal === "boolean" ? visibility.personal : undefined,
      coven_code: typeof visibility.coven_code === "boolean" ? visibility.coven_code : undefined,
      coven_cave: typeof visibility.coven_cave === "boolean" ? visibility.coven_cave : undefined,
    };
  }

  const validation = validateManifest(raw, source);
  summary.validation_state = validation.ok
    ? validation.issues.length > 0
      ? "warning"
      : "valid"
    : "invalid";
  return summary;
}

function issue(
  tier: WorkflowValidationIssue["tier"],
  code: string,
  message: string,
  extra?: { path?: string; suggestion?: string },
): WorkflowValidationIssue {
  return { tier, code, message, path: extra?.path, suggestion: extra?.suggestion };
}

/**
 * Three-tier manifest validation:
 *   - schema:   required top-level/step fields and types
 *   - semantic: duplicate step ids, dependency references, unknown patterns
 *   - preflight: limit sanity
 *
 * `ok` is false when any schema or semantic *error* is present; warning-only
 * tiers (unknown pattern, soft limits) keep `ok` true but populate `issues`.
 */
export function validateManifest(raw: unknown, source?: string): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  let hardError = false;

  if (!raw || typeof raw !== "object") {
    issues.push(issue("schema", "not_an_object", "Workflow manifest must be a YAML mapping."));
    return { ok: false, schemaVersion: null, workflowId: source ?? null, issues };
  }
  const obj = raw as Record<string, unknown>;

  if (!asString(obj.id)) {
    hardError = true;
    issues.push(issue("schema", "missing_id", "Workflow `id` is required.", { path: "id" }));
  }
  if (!asString(obj.version)) {
    hardError = true;
    issues.push(issue("schema", "missing_version", "Workflow `version` is required.", { path: "version" }));
  }

  const steps = Array.isArray(obj.steps) ? obj.steps : null;
  if (!steps || steps.length === 0) {
    hardError = true;
    issues.push(issue("schema", "no_steps", "Workflow must declare at least one step.", { path: "steps" }));
  }

  const seen = new Set<string>();
  const stepIds = new Set<string>();
  if (steps) {
    for (const [index, step] of steps.entries()) {
      const s = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
      const id = asString(s.id);
      if (!id) {
        hardError = true;
        issues.push(issue("schema", "step_missing_id", `Step ${index + 1} is missing an \`id\`.`, { path: `steps[${index}].id` }));
        continue;
      }
      if (seen.has(id)) {
        hardError = true;
        issues.push(issue("semantic", "duplicate_step_id", `Duplicate step id \`${id}\`.`, { path: `steps[${index}].id` }));
      }
      seen.add(id);
      stepIds.add(id);
      if (!asString(s.kind)) {
        issues.push(issue("schema", "step_missing_kind", `Step \`${id}\` is missing a \`kind\`.`, {
          path: `steps[${index}].kind`,
          suggestion: "One of: agent, skill, tool, human-gate, workflow.",
        }));
      }
    }
    // Dependency references must point at declared steps.
    for (const [index, step] of steps.entries()) {
      const s = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
      const requires = asStringArray(s.requires) ?? [];
      for (const dep of requires) {
        if (!stepIds.has(dep)) {
          hardError = true;
          issues.push(issue("semantic", "unknown_dependency", `Step \`${asString(s.id) ?? index}\` requires unknown step \`${dep}\`.`, {
            path: `steps[${index}].requires`,
          }));
        }
      }
    }

    // I/O contract: a workflow can't run without a defined input, and can't
    // finish without producing an output artifact. Both are hard errors.
    const kinds = steps.map((step) =>
      asString((step && typeof step === "object" ? (step as Record<string, unknown>) : {}).kind),
    );
    if (!kinds.includes("input")) {
      hardError = true;
      issues.push(issue("semantic", "missing_input", "Workflow must declare an input node — it can't run without a defined input.", {
        path: "steps",
        suggestion: "Add a step with kind: input describing the required input.",
      }));
    }
    if (!kinds.includes("output")) {
      hardError = true;
      issues.push(issue("semantic", "missing_output", "Workflow must declare an output node — it can't finish without producing an artifact.", {
        path: "steps",
        suggestion: "Add a step with kind: output describing the produced artifact.",
      }));
    }
    // Nudge (non-blocking): input/output nodes should describe their contract.
    for (const [index, step] of steps.entries()) {
      const s = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
      const kind = asString(s.kind);
      if (kind === "input" && !asString(s.summary)) {
        issues.push(issue("preflight", "input_undocumented", `Describe what input \`${asString(s.id) ?? index}\` requires.`, {
          path: `steps[${index}].summary`,
        }));
      }
      if (kind === "output" && !asString(s.summary)) {
        issues.push(issue("preflight", "output_undocumented", `Describe the artifact \`${asString(s.id) ?? index}\` produces.`, {
          path: `steps[${index}].summary`,
        }));
      }
    }
  }

  const pattern = asString(obj.pattern);
  if (pattern && !KNOWN_PATTERNS.has(pattern)) {
    issues.push(issue("semantic", "unknown_pattern", `Unrecognized pattern \`${pattern}\`.`, {
      path: "pattern",
      suggestion: `Known patterns: ${[...KNOWN_PATTERNS].join(", ")}.`,
    }));
  }

  const limits = (obj.limits && typeof obj.limits === "object" ? obj.limits : undefined) as
    | Record<string, unknown>
    | undefined;
  if (limits && typeof limits.max_agents === "number" && limits.max_agents <= 0) {
    issues.push(issue("preflight", "nonpositive_max_agents", "`limits.max_agents` should be greater than zero.", {
      path: "limits.max_agents",
    }));
  }

  return {
    ok: !hardError,
    schemaVersion: asString(obj.version) ?? null,
    workflowId: asString(obj.id) ?? source ?? null,
    issues,
  };
}

/**
 * Produce a dry-run plan from a coerced workflow. A step is `blocked` when its
 * `requires` references a step not present in the workflow; everything else is
 * `ready`. Estimates roll up the declared limits plus derived capability,
 * human-gate, and external-account requirements.
 */
export function planDryRun(workflow: WorkflowSummary): WorkflowDryRunPlan {
  const steps = workflow.steps ?? [];
  const ids = new Set(steps.map((step) => step.id));

  const planSteps = steps.map((step) => {
    const blockers: WorkflowValidationIssue[] = [];
    for (const dep of step.requires ?? []) {
      if (!ids.has(dep)) {
        blockers.push(issue("semantic", "unknown_dependency", `Requires unknown step \`${dep}\`.`));
      }
    }
    return {
      id: step.id,
      kind: step.kind,
      uses: step.uses,
      status: blockers.length > 0 ? ("blocked" as const) : ("ready" as const),
      blockers: blockers.length > 0 ? blockers : undefined,
    };
  });

  const humanGates = steps.filter((step) => step.kind === "human-gate").map((step) => step.id);
  const requiredCapabilities = [
    ...new Set(steps.flatMap((step) => step.permissions ?? []).concat(workflow.permissions ?? [])),
  ];

  // I/O gate: no run is "ready" without an input node and an output node.
  const structuralBlockers: WorkflowValidationIssue[] = [];
  if (!steps.some((step) => step.kind === "input")) {
    structuralBlockers.push(issue("semantic", "missing_input", "Add an input node — a workflow can't run without a defined input."));
  }
  if (!steps.some((step) => step.kind === "output")) {
    structuralBlockers.push(issue("semantic", "missing_output", "Add an output node — a workflow can't finish without producing an artifact."));
  }

  return {
    ok: planSteps.every((step) => step.status === "ready") && structuralBlockers.length === 0,
    workflowId: workflow.id,
    version: workflow.version,
    steps: planSteps,
    estimates: {
      maxAgents: workflow.limits?.max_agents,
      timeoutS: workflow.limits?.timeout_s,
      costCeilingUsd: workflow.limits?.cost_ceiling_usd,
      requiredCapabilities: requiredCapabilities.length > 0 ? requiredCapabilities : undefined,
      humanGates: humanGates.length > 0 ? humanGates : undefined,
    },
    issues: [...structuralBlockers, ...planSteps.flatMap((step) => step.blockers ?? [])],
  };
}

async function readManifestFilesInDir(dir: string, storage: WorkflowStorageScope): Promise<ManifestFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const out: ManifestFile[] = [];
  for (const name of files) {
    const full = path.join(dir, name);
    try {
      const text = await readFile(full, "utf8");
      out.push({ source: name.replace(/\.ya?ml$/i, ""), raw: parseYaml(text), storage });
    } catch {
      // Unreadable/malformed file → surface as an invalid stub so it isn't silently dropped.
      out.push({ source: name.replace(/\.ya?ml$/i, ""), raw: null, storage });
    }
  }
  return out;
}

async function readManifestFiles(): Promise<ManifestFile[]> {
  await seedPublicWorkflowsIfNeeded();
  return [
    ...(await readManifestFilesInDir(workflowsDir(), "public")),
    ...(await readManifestFilesInDir(personalWorkflowsDir(), "personal")),
  ];
}

/** Scan the manifest directory and return the workflow list response shape. */
export async function loadLocalWorkflowList(): Promise<WorkflowListResponse> {
  const manifests = await readManifestFiles();
  const workflows: WorkflowSummary[] = [];
  const known = new Set<string>();
  for (const { source, raw, storage } of manifests) {
    const workflow = coerceManifest(raw, source, storage);
    if (known.has(workflow.id)) continue;
    workflows.push(workflow);
    known.add(workflow.id);
  }
  for (const id of await listRoleWorkflowIds()) {
    if (known.has(id)) continue;
    workflows.push({
      id,
      version: "0.0.0",
      name: id,
      summary: "Declared by a role, but no workflow manifest exists yet.",
      steps: [],
      tags: ["role-declared"],
      validation_state: "unknown",
    });
    known.add(id);
  }
  workflows.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, workflows };
}

async function findLocalWorkflow(body: {
  id?: string;
  path?: string;
}): Promise<FoundWorkflow | null> {
  const manifests = await readManifestFiles();
  for (const { source, raw, storage } of manifests) {
    const summary = coerceManifest(raw, source, storage) as FoundWorkflow;
    if (body.id && summary.id === body.id) return summary;
    if (body.path && (summary.path === body.path || source === body.path)) return summary;
  }
  return null;
}

/** Validate a workflow referenced by `id`/`path`, or inline `content`. */
export async function validateLocalWorkflow(body: {
  id?: string;
  path?: string;
  content?: string;
  manifest?: unknown;
}): Promise<WorkflowValidationResult> {
  if (typeof body.content === "string") {
    try {
      return validateManifest(parseYaml(body.content));
    } catch (err) {
      return {
        ok: false,
        issues: [issue("schema", "parse_error", err instanceof Error ? err.message : "YAML parse failed")],
      };
    }
  }
  if (body.manifest !== undefined) {
    return validateManifest(body.manifest);
  }
  const found = await findLocalWorkflow(body);
  if (!found) {
    return {
      ok: false,
      issues: [issue("schema", "not_found", `No local workflow matched ${body.id ?? body.path ?? "request"}.`)],
    };
  }
  return validateManifest(toManifest(found), found.path);
}

/** Dry-run a workflow referenced by `id`/`path`. */
export async function dryRunLocalWorkflow(body: {
  id?: string;
  path?: string;
}): Promise<WorkflowDryRunPlan> {
  const found = await findLocalWorkflow(body);
  if (!found) {
    return {
      ok: false,
      issues: [issue("schema", "not_found", `No local workflow matched ${body.id ?? body.path ?? "request"}.`)],
    };
  }
  return planDryRun(found);
}

/** Dry-run an inline manifest (studio drafts) without touching disk. */
export function dryRunLocalWorkflowManifest(manifest: unknown): WorkflowDryRunPlan {
  return planDryRun(coerceManifest(manifest));
}

/**
 * Manifest filename for a workflow id. Returns null for anything that is not
 * a plain slug so saves can never escape {@link workflowsDir}.
 */
export function workflowFileName(id: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(id)) return null;
  return `${id}.yaml`;
}

function manifestObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function visibilityObject(raw: unknown): Record<string, unknown> {
  const visibility = manifestObject(raw).visibility;
  return visibility && typeof visibility === "object" ? (visibility as Record<string, unknown>) : {};
}

function workflowStorageForManifest(raw: unknown): WorkflowStorageScope {
  return visibilityObject(raw).public === true ? "public" : "personal";
}

function workflowDirForStorage(storage: WorkflowStorageScope): string {
  return storage === "public" ? workflowsDir() : personalWorkflowsDir();
}

async function ensureWorkflowDir(storage: WorkflowStorageScope): Promise<string> {
  if (storage === "public") await seedPublicWorkflowsIfNeeded();
  const dir = workflowDirForStorage(storage);
  await mkdir(dir, { recursive: true, mode: storage === "personal" ? 0o700 : undefined });
  if (storage === "personal") {
    await chmod(dir, 0o700);
  }
  return dir;
}

async function removeStoredWorkflowFiles(storage: WorkflowStorageScope, source: string): Promise<void> {
  const dir = workflowDirForStorage(storage);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const files = entries.filter((name) => {
    if (name === layoutFileName(source)) return true;
    return /\.ya?ml$/i.test(name) && name.replace(/\.ya?ml$/i, "") === source;
  });
  for (const file of files) {
    try {
      await unlink(path.join(dir, file));
    } catch {
      // Best-effort cleanup of the stale copy; the new manifest has already saved.
    }
  }
}

// Writes are serialized through a promise chain (same pattern as cave-inbox)
// so concurrent saves cannot interleave partial file states.
let workflowWriteChain: Promise<unknown> = Promise.resolve();
function withWorkflowWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = workflowWriteChain.then(fn, fn);
  workflowWriteChain = next.catch(() => undefined);
  return next;
}

/**
 * Persist a manifest as `<id>.yaml` under {@link workflowsDir}. The manifest
 * is validated and the verdict returned alongside; invalid-but-parseable
 * manifests still save (the studio renders their health), but unsafe ids and
 * unserializable payloads never touch disk.
 */
export async function saveLocalWorkflow(body: {
  manifest: unknown;
}): Promise<{ ok: boolean; workflow?: WorkflowSummary; validation?: WorkflowValidationResult; error?: string }> {
  const summary = coerceManifest(body.manifest);
  const file = workflowFileName(summary.id);
  if (!file) {
    return { ok: false, error: `Workflow id \`${summary.id}\` is not a safe filename slug.` };
  }
  const validation = validateManifest(body.manifest);
  let text: string;
  try {
    text = stringifyYaml(body.manifest, { lineWidth: 0 });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "YAML serialization failed", validation };
  }
  const storage = workflowStorageForManifest(body.manifest);
  try {
    await withWorkflowWriteLock(async () => {
      const dir = await ensureWorkflowDir(storage);
      const root = path.resolve(dir);
      const filePath = path.resolve(root, file);
      const rel = path.relative(root, filePath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("resolved workflow path escapes workflow storage directory");
      }
      await writeFile(filePath, text, { encoding: "utf8", mode: storage === "personal" ? 0o600 : undefined });
      if (storage === "personal") {
        await chmod(filePath, 0o600);
      }
      await removeStoredWorkflowFiles(storage === "public" ? "personal" : "public", summary.id);
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "workflow write failed", validation };
  }
  const source = file.replace(/\.ya?ml$/i, "");
  return { ok: true, workflow: coerceManifest(body.manifest, source, storage), validation };
}

/** Remove a workflow manifest by id or source path. */
export async function deleteLocalWorkflow(body: {
  id?: string;
  path?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const found = await findLocalWorkflow(body);
  if (!found?.path) {
    return { ok: false, error: `No local workflow matched ${body.id ?? body.path ?? "request"}.` };
  }
  if (!workflowFileName(found.path)) {
    return { ok: false, error: `Refusing to delete unsafe path \`${found.path}\`.` };
  }
  try {
    const dir = workflowDirForStorage(found.storage);
    // Resolve the on-disk name from the directory listing (.yaml or .yml).
    const entries = await readdir(dir);
    const file = entries.find(
      (name) => /\.ya?ml$/i.test(name) && name.replace(/\.ya?ml$/i, "") === found.path,
    );
    if (!file) {
      return { ok: false, error: `Manifest file for \`${found.path}\` not found.` };
    }
    await withWorkflowWriteLock(() => unlink(path.join(dir, file)));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "workflow delete failed" };
  }
  return { ok: true };
}

export type WorkflowLayout = Record<string, { x: number; y: number }>;

/**
 * Cave-only canvas layout sidecar (`<id>.cave.json` beside the manifest).
 * Node positions are display preference, never workflow semantics — the
 * canonical manifest stays byte-identical when nodes are dragged.
 */
function layoutFileName(id: string): string | null {
  const file = workflowFileName(id);
  return file ? file.replace(/\.yaml$/, ".cave.json") : null;
}

async function storageForWorkflowId(id: string): Promise<WorkflowStorageScope> {
  const found = await findLocalWorkflow({ id });
  return found?.storage ?? "personal";
}

/** Absolute path for a layout sidecar, constrained to its workflow storage dir. */
function resolveLayoutFilePath(rootDir: string, file: string): string | null {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, file);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

async function layoutFilePath(id: string): Promise<string | null> {
  const file = layoutFileName(id);
  if (!file) return null;
  return resolveLayoutFilePath(workflowDirForStorage(await storageForWorkflowId(id)), file);
}

/** Saved node positions for a workflow, or null when none exist. */
export async function loadWorkflowLayout(id: string): Promise<WorkflowLayout | null> {
  const filePath = await layoutFilePath(id);
  if (!filePath) return null;
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as { positions?: WorkflowLayout };
    if (!parsed.positions || typeof parsed.positions !== "object") return null;
    const positions: WorkflowLayout = {};
    for (const [stepId, pos] of Object.entries(parsed.positions)) {
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        positions[stepId] = { x: pos.x, y: pos.y };
      }
    }
    return Object.keys(positions).length > 0 ? positions : null;
  } catch {
    return null;
  }
}

/** Persist node positions to the workflow's cave sidecar. */
export async function saveWorkflowLayout(
  id: string,
  positions: WorkflowLayout,
): Promise<{ ok: boolean; error?: string }> {
  const file = layoutFileName(id);
  if (!file) {
    return { ok: false, error: `Workflow id \`${id}\` is not a safe filename slug.` };
  }
  try {
    await withWorkflowWriteLock(async () => {
      const storage = await storageForWorkflowId(id);
      const dir = await ensureWorkflowDir(storage);
      const filePath = resolveLayoutFilePath(dir, file);
      if (!filePath) {
        throw new Error("resolved layout path escapes workflow storage directory");
      }
      await writeFile(
        filePath,
        JSON.stringify({ version: 1, positions }, null, 2),
        { encoding: "utf8", mode: storage === "personal" ? 0o600 : undefined },
      );
      if (storage === "personal") {
        await chmod(filePath, 0o600);
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "layout write failed" };
  }
  return { ok: true };
}

/** Round-trip a coerced summary back to a manifest-shaped object for re-validation. */
function toManifest(workflow: WorkflowSummary): Record<string, unknown> {
  return {
    id: workflow.id,
    version: workflow.version,
    name: workflow.name,
    summary: workflow.summary,
    familiar: workflow.familiar,
    pattern: workflow.pattern,
    steps: workflow.steps,
    tags: workflow.tags,
    limits: workflow.limits,
    permissions: workflow.permissions,
    visibility: workflow.visibility,
  };
}
