"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";

type SubmissionType = "runtime" | "harness";
type ValidationStatus = "pass" | "warning" | "fail" | "review-required";

type ValidationIssue = {
  code: string;
  status: Exclude<ValidationStatus, "pass">;
  message: string;
  path?: string;
};

type CatalogEntry = {
  id: string;
  type: SubmissionType;
  submissionId: string;
  name: string;
  version: string;
  latestCompatibleVersion: string;
  capabilities: string[];
  compatibility: string[];
  examples?: Array<{ name: string; path: string }>;
  docs?: string[];
  validationStatus: ValidationStatus;
  enabled: boolean;
  compatibleRuntimeIds?: string[];
};

type ExecutionRoute =
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
    }
  | null;

type ExecutionPlan =
  | {
      status: "ready";
      executionService: "opencoven.execution.v1";
      route: Exclude<ExecutionRoute, null> & { status: "ready" };
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
      route: Exclude<ExecutionRoute, null> & { status: "disabled" | "not-found" };
    }
  | null;

type SubmissionResponse = {
  ok: boolean;
  error?: string;
  validation?: {
    status: ValidationStatus;
    issues: ValidationIssue[];
  };
  catalog?: CatalogEntry[];
  route?: ExecutionRoute;
  published?: boolean;
};

type ExecutionResponse = {
  ok: boolean;
  error?: string;
  executionService?: "opencoven.execution.v1" | null;
  plan?: ExecutionPlan;
};

const STATUS_LABEL: Record<ValidationStatus, string> = {
  pass: "pass",
  warning: "warning",
  fail: "fail",
  "review-required": "review-required",
};

const SAMPLE_PACKAGE = {
  manifest: {
    name: "Example Runtime",
    version: "0.1.0",
    description: "Replace this with the runtime or harness description.",
    type: "runtime",
    capabilities: ["shell.exec"],
    requiredServices: ["coven-daemon"],
    permissions: { env: [], config: [], filesystem: ["read"] },
    entrypoints: { invoke: "bin/runtime", health: "bin/runtime health" },
    runtime: {
      id: "example-runtime",
      invocation: "stdio",
      protocols: ["opencoven.runtime.v1"],
      capabilities: ["shell.exec"],
      config: { env: [] },
      healthCheck: { command: "bin/runtime health" },
      sandbox: { network: "restricted", filesystem: "workspace" },
    },
    artifacts: ["bin/runtime"],
  },
  artifacts: ["manifest.json", "bin/runtime"],
  files: {
    "bin/runtime": {
      size: 128,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  },
};

function statusClass(status: ValidationStatus): string {
  if (status === "pass") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "warning") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "review-required") return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
}

function safeJson(text: string): { value: unknown | null; error: string | null } {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

function joinedList(items: string[] | undefined, empty = "None"): string {
  return items && items.length > 0 ? items.join(", ") : empty;
}

function entryRouteReadiness(entry: CatalogEntry): string {
  if (entry.type === "runtime") return entry.enabled ? "Runtime available" : "Runtime not publishable";
  if (entry.enabled) {
    const runtimes = joinedList(entry.compatibleRuntimeIds, "compatible runtime");
    return `Ready via ${runtimes}`;
  }
  return "Disabled until a compatible runtime is available";
}

export function OpenCovenSubmissionPanel() {
  const [submissionType, setSubmissionType] = useState<SubmissionType>("runtime");
  const [packageText, setPackageText] = useState(() => JSON.stringify(SAMPLE_PACKAGE, null, 2));
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [route, setRoute] = useState<ExecutionRoute>(null);
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlan>(null);
  const [busy, setBusy] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState("");
  const parsed = useMemo(() => safeJson(packageText), [packageText]);
  const manifestType =
    parsed.value && typeof parsed.value === "object" && "manifest" in parsed.value
      ? (parsed.value as { manifest?: { type?: unknown } }).manifest?.type
      : null;
  const typeMismatch = typeof manifestType === "string" && manifestType !== submissionType;
  const harnessEntries = useMemo(() => catalog.filter((entry) => entry.type === "harness"), [catalog]);
  const runtimeEntries = useMemo(() => catalog.filter((entry) => entry.type === "runtime"), [catalog]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/opencoven/submissions", { cache: "no-store" });
        const json = (await res.json()) as SubmissionResponse;
        if (cancelled) return;
        setCatalog(json.catalog ?? []);
        setRoute(json.route ?? null);
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (harnessEntries.length === 0) {
      if (selectedHarnessId) setSelectedHarnessId("");
      return;
    }
    if (!selectedHarnessId || !harnessEntries.some((entry) => entry.submissionId === selectedHarnessId)) {
      setSelectedHarnessId(harnessEntries[0]?.submissionId ?? "");
    }
  }, [harnessEntries, selectedHarnessId]);

  useEffect(() => {
    if (selectedRuntimeId && !runtimeEntries.some((entry) => entry.submissionId === selectedRuntimeId)) {
      setSelectedRuntimeId("");
    }
  }, [runtimeEntries, selectedRuntimeId]);

  async function readUpload(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPackageText(await file.text());
    setResult(null);
  }

  async function submitPackage(publish: boolean) {
    if (parsed.error || !parsed.value) {
      setResult({ ok: false, error: parsed.error ?? "Invalid package JSON" });
      return;
    }
    if (typeMismatch) {
      setResult({ ok: false, error: `Selected ${submissionType}, but manifest declares ${String(manifestType)}.` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/opencoven/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ package: parsed.value, publish }),
      });
      const json = (await res.json()) as SubmissionResponse;
      setResult(json);
      setCatalog(json.catalog ?? []);
      setRoute(json.route ?? null);
      setExecutionPlan(null);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Submission failed" });
    } finally {
      setBusy(false);
    }
  }

  async function resolveSelectedRoute() {
    if (!selectedHarnessId) return;
    setRouteBusy(true);
    try {
      const params = new URLSearchParams({ harness: selectedHarnessId });
      if (selectedRuntimeId) params.set("runtime", selectedRuntimeId);
      const res = await fetch(`/api/opencoven/submissions?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as SubmissionResponse;
      setCatalog(json.catalog ?? []);
      setRoute(json.route ?? null);
      setExecutionPlan(null);
    } catch (err) {
      setRoute({
        status: "disabled",
        reason: err instanceof Error ? err.message : "Unable to resolve execution route",
        harnessId: selectedHarnessId,
        runtimeId: selectedRuntimeId || undefined,
      });
    } finally {
      setRouteBusy(false);
    }
  }

  async function buildSelectedExecutionPlan() {
    if (!selectedHarnessId) return;
    setRouteBusy(true);
    try {
      const res = await fetch("/api/opencoven/executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          harnessId: selectedHarnessId,
          runtimeId: selectedRuntimeId || undefined,
          input: {},
        }),
      });
      const json = (await res.json()) as ExecutionResponse;
      setExecutionPlan(json.plan ?? null);
      setRoute(json.plan?.route ?? null);
    } catch (err) {
      const routeFailure = {
        status: "disabled" as const,
        reason: err instanceof Error ? err.message : "Unable to build execution plan",
        harnessId: selectedHarnessId,
        runtimeId: selectedRuntimeId || undefined,
      };
      setExecutionPlan({
        status: "disabled",
        reason: routeFailure.reason,
        route: routeFailure,
      });
      setRoute(routeFailure);
    } finally {
      setRouteBusy(false);
    }
  }

  return (
    <section className="mb-5 rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="ph:archive" width={14} className="text-muted-foreground" />
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">OpenCoven submissions</h3>
          </div>
          <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
            Submit once to OpenCoven, validate against OpenCoven contracts, publish into the
            OpenCoven catalog, then route through OpenCoven execution services.
          </p>
        </div>
        <div className="flex shrink-0 rounded-md border border-border bg-background p-1" aria-label="Submission type">
          {(["runtime", "harness"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSubmissionType(type)}
              className={`focus-ring rounded px-2.5 py-1 text-[12px] capitalize ${submissionType === type ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {type === "runtime" ? "Runtime" : "Harness"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-border bg-background px-3 py-2 text-[12px] text-muted-foreground hover:border-[var(--border-strong)]">
            <span className="min-w-0 truncate">
              {fileName ?? "One package: manifest + artifacts + optional examples/tests as JSON"}
            </span>
            <span className="shrink-0 text-foreground">Choose file</span>
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => void readUpload(event.target.files?.[0])}
            />
          </label>
          <textarea
            value={packageText}
            onChange={(event) => {
              setPackageText(event.target.value);
              setResult(null);
            }}
            spellCheck={false}
            aria-label="Submission package JSON"
            className="mt-2 min-h-[220px] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {parsed.error ? <p className="mt-1 text-[11px] text-red-600">{parsed.error}</p> : null}
          {typeMismatch ? (
            <p className="mt-1 text-[11px] text-amber-600">
              Selected {submissionType}, but the manifest declares {String(manifestType)}.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              leadingIcon="ph:check-circle"
              disabled={busy}
              onClick={() => void submitPackage(false)}
            >
              Validate
            </Button>
            <Button
              leadingIcon="ph:archive"
              disabled={busy}
              onClick={() => void submitPackage(true)}
            >
              Publish to OpenCoven catalog
            </Button>
          </div>
        </div>

        <aside className="min-w-0 rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">Validation</h4>
            {result?.validation ? (
              <span className={`rounded border px-1.5 py-px text-[10px] ${statusClass(result.validation.status)}`}>
                {STATUS_LABEL[result.validation.status]}
              </span>
            ) : null}
          </div>
          {result?.error ? <p className="mt-2 text-[12px] text-red-600">{result.error}</p> : null}
          {result?.validation ? (
            result.validation.issues.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {result.validation.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.path ?? ""}`} className="rounded border border-border bg-card px-2 py-1.5 text-[11px]">
                    <span className="font-medium text-foreground">{issue.code}</span>
                    <span className="ml-2 text-muted-foreground">{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">No validation issues.</p>
            )
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Results appear as pass, warning, fail, or review-required.
            </p>
          )}
          {result?.published ? (
            <p className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
              Published into the OpenCoven catalog.
            </p>
          ) : null}

          <CatalogDiscovery catalog={catalog} />

          <div className="mt-4">
            <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">Execution routing</h4>
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Harness</span>
                <select
                  value={selectedHarnessId}
                  onChange={(event) => setSelectedHarnessId(event.target.value)}
                  className="min-h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  {harnessEntries.length === 0 ? <option value="">No harnesses</option> : null}
                  {harnessEntries.map((entry) => (
                    <option key={entry.id} value={entry.submissionId}>
                      {entry.name} v{entry.latestCompatibleVersion}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Runtime</span>
                <select
                  value={selectedRuntimeId}
                  onChange={(event) => setSelectedRuntimeId(event.target.value)}
                  className="min-h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Latest compatible</option>
                  {runtimeEntries.map((entry) => (
                    <option key={entry.id} value={entry.submissionId}>
                      {entry.name} v{entry.latestCompatibleVersion}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  leadingIcon="ph:git-branch-bold"
                  disabled={routeBusy || !selectedHarnessId}
                  onClick={() => void resolveSelectedRoute()}
                >
                  Resolve route
                </Button>
                <Button
                  leadingIcon="ph:play"
                  disabled={routeBusy || !selectedHarnessId}
                  onClick={() => void buildSelectedExecutionPlan()}
                >
                  Build execution plan
                </Button>
              </div>
            </div>
            {route?.status === "ready" ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {route.harnessId} resolves to {route.runtimeId} through {route.invocationAdapter}.
              </p>
            ) : route ? (
              <p className="mt-2 text-[12px] text-muted-foreground">{route.reason}</p>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Harnesses stay disabled until a compatible runtime is available.
              </p>
            )}
            {executionPlan?.status === "ready" ? (
              <p className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                Execution plan ready for {executionPlan.executionService}: {executionPlan.dispatch.harnessId} -&gt;{" "}
                {executionPlan.dispatch.runtimeId} via {executionPlan.dispatch.adapter}.
              </p>
            ) : executionPlan ? (
              <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {executionPlan.reason}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CatalogDiscovery({ catalog }: { catalog: CatalogEntry[] }) {
  return (
    <div className="mt-4">
      <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">Catalog discovery</h4>
      {catalog.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">No catalog entries yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {catalog.map((entry) => (
            <article key={entry.id} className="rounded border border-border bg-card px-2 py-2 text-[11px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h5 className="truncate text-[12px] font-medium text-foreground">{entry.name}</h5>
                  <p className="mt-0.5 text-muted-foreground">
                    {entry.type} · v{entry.latestCompatibleVersion}
                  </p>
                </div>
                <span className={`shrink-0 rounded border px-1.5 py-px text-[10px] ${statusClass(entry.validationStatus)}`}>
                  {entry.validationStatus}
                </span>
              </div>

              <dl className="mt-2 grid gap-1.5 text-muted-foreground">
                <div>
                  <dt className="font-medium text-foreground">Capabilities</dt>
                  <dd>{joinedList(entry.capabilities)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Compatibility</dt>
                  <dd>{joinedList(entry.compatibility)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Version</dt>
                  <dd>{entry.latestCompatibleVersion}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Validation status</dt>
                  <dd>{entry.validationStatus}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Examples / docs</dt>
                  <dd>
                    {joinedList([
                      ...((entry.examples ?? []).map((example) => example.path)),
                      ...(entry.docs ?? []),
                    ])}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Route readiness</dt>
                  <dd>{entryRouteReadiness(entry)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
