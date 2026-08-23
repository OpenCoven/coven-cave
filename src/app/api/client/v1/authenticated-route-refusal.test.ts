/**
 * Every path in CLIENT_V1_AUTHENTICATED_PATHS must REFUSE an uncredentialed
 * request — proved by running the request, not by reading the route's source.
 *
 * Why this exists (cave-cm2i0, assessed out of cave-4o416 / #4848).
 * ----------------------------------------------------------------
 * src/app/api/api-contracts.test.ts already asserts that every client-v1 route
 * NAMES `requireScope`, matched against a comment- and string-stripped view of
 * the route's own source. That catches a route which forgets the call. It
 * cannot catch a route which makes the call and then ignores the answer:
 * mutating familiars/route.ts to `if (!auth.ok && false) return
 * chargeClientV1AuthFailure(...)` failed three tests in that route's own
 * behavioural suite while api-contracts.test.ts still passed all 301 contracts.
 *
 * So the load-bearing defence was the per-route behavioural suite — and nothing
 * required a future authenticated route to have one. All five current routes
 * carry those assertions only because their authors chose to write them.
 *
 * Why this file is not a second static check.
 * -------------------------------------------
 * The obvious cheap fix — grep each route's `route.test.ts` for a 401 — would
 * reproduce the exact defect it is meant to catch: a gate satisfied by writing
 * the right words rather than by the behaviour holding. This repo has been bitten
 * by that shape more than once (a conformance harness comparing key sets and
 * never values; route contracts regexing route source while the route was
 * broken). Everything below therefore EXECUTES the handler and asserts on the
 * Response it returns. There is no assertion here that any string appears
 * anywhere.
 *
 * The required set is derived from CLIENT_V1_AUTHENTICATED_PATHS itself, so
 * adding a path to that list without a handler that refuses breaks the build —
 * the coverage cannot drift away from the list it is supposed to cover.
 *
 * Two layers, because they answer different questions.
 * ---------------------------------------------------
 * Layer 1 drives the module's exported HTTP methods — literally what Next.js
 * serves — with a controlled ClientV1Runtime installed as the process singleton
 * that `getClientV1Runtime()` returns. Only refusals that never reach a data
 * source are probed there, so this layer touches no filesystem and no daemon.
 *
 * Layer 2 drives the route's injectable handler factory with tripwire
 * dependencies. That is the seam read-sources.ts documents ("a test hands the
 * handler a plain object and never touches the filesystem or the daemon at
 * all"), and it buys three things Layer 1 cannot have hermetically: the
 * scope-denial probe, a positive control proving the route is not vacuously
 * refusing everything, and the assertion that NO injected dependency is
 * consulted before the credential is settled.
 */

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { CLIENT_V1_SCOPES, type ClientV1Scope } from "@/lib/server/client-v1/contract.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { CLIENT_V1_AUTHENTICATED_PATHS, LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, "src", "app", "api");
const clientV1Root = path.join(apiRoot, "client", "v1");

/** The stand-in for a dynamic segment. Any value works: every probe is refused
 *  before the route resolves its params. */
const PROBE_SEGMENT = "probe-segment";

/** The loopback stamp the controlled runtime accepts. */
const STAMP = "authenticated-route-refusal-loopback-secret";

/** HTTP verbs Next.js will export from a route module. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/**
 * The refusal codes this surface answers. Both are credential decisions:
 * `unauthorized` means no credential was established, `scope_denied` means a
 * real credential asked for a grant it does not hold.
 */
const REFUSAL_CODES = new Set(["unauthorized", "scope_denied"]);

/** Pointer the failure messages hand a future author. */
const REFERENCE_ROUTE = "src/app/api/client/v1/familiars/route.ts";

/** The paragraph every refusal failure ends with — the *why*, not just the what. */
const WHY = [
  "CLIENT_V1_AUTHENTICATED_PATHS (src/proxy-helpers.ts) DEMOTES this path: proxy() skips",
  "the mobile-access gate and returns before the sidecar-token block, so the route's own",
  "credential check is the ONLY one left on the request. Refuse with",
  "`if (!auth.ok) return chargeClientV1AuthFailure(clientV1, auth, stamp!);` after",
  `requireScope, exactly as ${REFERENCE_ROUTE} does.`,
].join(" ");

type RouteModule = Record<string, unknown>;
type Handler = (request: Request, context: unknown) => unknown;

function walkRouteFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkRouteFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

function routeFromFile(file: string): string {
  return "/" + path.relative(apiRoot, path.dirname(file)).split(path.sep).join("/");
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[");
}

function isCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[...") || segment.startsWith("[[...");
}

/**
 * Concrete request paths a Next route file serves.
 *
 * Mirrors clientV1ProbePaths in api-contracts.test.ts rather than importing it:
 * that module is a top-level assertion script with no exports, so importing it
 * would run all 301 contracts as a side effect of this suite.
 */
function probePathsFor(route: string): string[] {
  let paths: string[][] = [[]];
  for (const segment of route.slice(1).split("/")) {
    const widths = !isDynamicSegment(segment)
      ? [[segment]]
      : isCatchAllSegment(segment)
        ? [[PROBE_SEGMENT], [PROBE_SEGMENT, PROBE_SEGMENT]]
        : [[PROBE_SEGMENT]];
    paths = paths.flatMap((prefix) => widths.map((width) => [...prefix, ...width]));
  }
  return paths.map((parts) => `/api/${parts.join("/")}`);
}

/**
 * The `params` a Next handler receives for one probe path.
 *
 * Supplied so a handler that resolves its params still runs; every probe is
 * refused before the id is read, so the value never reaches anything.
 */
function paramsFor(route: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const segment of route.slice(1).split("/")) {
    if (!isDynamicSegment(segment)) continue;
    const name = segment.replace(/^\[+\.*|\.*\]+$/g, "");
    params[name] = isCatchAllSegment(segment) ? [PROBE_SEGMENT] : PROBE_SEGMENT;
  }
  return params;
}

const clientV1RouteFiles = walkRouteFiles(clientV1Root).map((file) => ({
  file,
  route: routeFromFile(file),
  probes: probePathsFor(routeFromFile(file)),
}));

/** Route files whose served paths this pre-authorized pattern matches. */
function routesMatching(pattern: RegExp): { file: string; route: string; probe: string }[] {
  const matches: { file: string; route: string; probe: string }[] = [];
  for (const candidate of clientV1RouteFiles) {
    const probe = candidate.probes.find((value) => pattern.test(value));
    if (probe) matches.push({ file: candidate.file, route: candidate.route, probe });
  }
  return matches;
}

/**
 * An injected dependency that records every consultation and refuses to serve.
 *
 * A Proxy rather than a fixed object so it covers whatever a future route's
 * dependency interface turns out to be. `then` is deliberately absent: a Proxy
 * that answered it with a function would be mistaken for a thenable by any
 * `await`, and the handler would hang instead of failing.
 */
function tripwire(label: string): { touched: string[]; value: unknown } {
  const touched: string[] = [];
  const passthrough = new Set(["then", "catch", "finally", "constructor", "toJSON", "inspect"]);
  const value = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol" || passthrough.has(property)) return undefined;
        return (..._args: unknown[]) => {
          touched.push(property);
          throw new Error(`tripwire: ${label}.${property} was consulted`);
        };
      },
    },
  );
  return { touched, value };
}

function stampedRequest(probe: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3020${probe}`, {
    headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers },
  });
}

function unstampedRequest(probe: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3020${probe}`, { headers });
}

type Outcome =
  | { kind: "response"; status: number; code: string | null; description: string }
  | { kind: "threw"; description: string }
  | { kind: "not-a-response"; description: string };

async function drive(handler: Handler, request: Request, context: unknown): Promise<Outcome> {
  let result: unknown;
  try {
    result = await handler(request, context);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { kind: "threw", description: `it THREW ${JSON.stringify(reason)}` };
  }
  if (!(result instanceof Response)) {
    return {
      kind: "not-a-response",
      description: `it returned ${typeof result} rather than a Response`,
    };
  }
  let code: string | null = null;
  try {
    const body = (await result.clone().json()) as { error?: { code?: unknown } };
    if (typeof body?.error?.code === "string") code = body.error.code;
  } catch {
    code = null;
  }
  return {
    kind: "response",
    status: result.status,
    code,
    description: `it answered ${result.status} with error code ${code === null ? "(none)" : JSON.stringify(code)}`,
  };
}

function assertRefused(outcome: Outcome, label: string, probe: string, situation: string): void {
  assert.ok(
    outcome.kind === "response"
      && (outcome.status === 401 || outcome.status === 403)
      && outcome.code !== null
      && REFUSAL_CODES.has(outcome.code),
    `${probe} (${label}) must refuse ${situation}, but ${outcome.description}.\n${WHY}`,
  );
}

/** Every dependency consultation recorded so far, in order. */
function consultations(deps: { touched: string[] }[]): string[] {
  return deps.flatMap((dep) => dep.touched);
}

/**
 * Nothing may be read before the credential is settled.
 *
 * Compared against `before` rather than against emptiness, because the
 * credential that DOES hold the required scope is supposed to get through and
 * trip a tripwire on its way — one probe's legitimate consultation must not
 * fail the next probe.
 *
 * Called BEFORE the refusal assertion on the same probe, and deliberately so: a
 * dependency reached this early usually makes the handler throw, and "it THREW"
 * is a true but useless answer next to "it consulted listConversations while
 * refusing".
 */
function assertNothingConsulted(
  deps: { touched: string[] }[],
  before: string[],
  label: string,
  probe: string,
  situation: string,
): void {
  const consulted = consultations(deps).slice(before.length);
  assert.deepEqual(
    consulted,
    [],
    `${probe} (${label}) consulted ${consulted.join(", ")} while handling ${situation}.`
      + ` Settle the credential first: an injected dependency reached before requireScope is a`
      + ` side effect an unauthenticated caller can drive, and a timing signal it can read.`,
  );
}

/** The three refusals that are safe to prove against real dependencies: none of
 *  them can reach a data source on a route that refuses. */
async function assertUncredentialedRequestsAreRefused(
  handler: Handler,
  label: string,
  probe: string,
  context: unknown,
  fullyScopedBearer: string,
  deps: { touched: string[] }[] = [],
): Promise<void> {
  const probes: [string, Request][] = [
    ["a request carrying no Authorization header at all", stampedRequest(probe)],
    [
      "a bearer this Cave never issued",
      stampedRequest(probe, { authorization: "Bearer not-a-credential-this-cave-issued" }),
    ],
    [
      "a valid bearer presented without the listener's loopback stamp (a percent-encoded"
        + " path segment escaped the proxy's client-v1 classification once already, #4854,"
        + " so the route may not assume that branch ran)",
      unstampedRequest(probe, { authorization: `Bearer ${fullyScopedBearer}` }),
    ],
  ];
  for (const [situation, request] of probes) {
    const before = consultations(deps);
    const outcome = await drive(handler, request, context);
    assertNothingConsulted(deps, before, label, probe, situation);
    assertRefused(outcome, label, probe, situation);
  }
}

function httpMethodHandlers(module: RouteModule, probe: string, file: string): [string, Handler][] {
  const exported = HTTP_METHODS
    .filter((method) => typeof module[method] === "function")
    .map((method) => [method, module[method] as Handler] as [string, Handler]);
  assert.ok(
    exported.length > 0,
    `${probe} is pre-authorized by CLIENT_V1_AUTHENTICATED_PATHS but ${path.relative(repoRoot, file)}`
      + ` exports no HTTP method, so nothing serves it. Export the method the path is listed for,`
      + ` or drop the entry from CLIENT_V1_AUTHENTICATED_PATHS.`,
  );
  return exported;
}

/**
 * The route's injectable handler factory.
 *
 * Required, not optional. Without it a route's credential path cannot be driven
 * with a controlled runtime, which is to say it cannot be behaviourally tested
 * at all — and being untestable is the state this whole file exists to make
 * impossible. All five current routes already export one.
 */
function handlerFactories(module: RouteModule, probe: string, file: string): [string, Function][] {
  const factories = Object.entries(module)
    .filter(([name, value]) => typeof value === "function" && /^create[A-Za-z0-9]*Handlers?$/.test(name))
    .map(([name, value]) => [name, value as Function] as [string, Function]);
  assert.ok(
    factories.length > 0,
    `${probe} is pre-authorized by CLIENT_V1_AUTHENTICATED_PATHS but`
      + ` ${path.relative(repoRoot, file)} exports no injectable handler factory, so its credential`
      + ` check cannot be exercised with a controlled runtime.\nExport one named`
      + ` create…Handler(s) that takes the ClientV1Runtime first and every data dependency after`
      + ` it, and have the HTTP export call it —`
      + ` see createClientV1FamiliarsGetHandler in ${REFERENCE_ROUTE}.`,
  );
  return factories;
}

/**
 * The parameter list a factory declares, as source text.
 *
 * `Function.prototype.toString` returns the definition verbatim. Under Node's
 * type stripper the annotations are blanked to whitespace rather than removed,
 * so a default value's `=` and a rest parameter's `...` both survive while a
 * type's punctuation does not.
 */
function parameterSource(factory: Function): string {
  const source = Function.prototype.toString.call(factory);
  const open = source.indexOf("(");
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

/**
 * Refuse a factory whose `length` cannot be trusted as a dependency count.
 *
 * `builtHandlers` derives the number of tripwires to install from
 * `factory.length`, and `Function.length` counts only the parameters BEFORE the
 * first one with a default value or a rest parameter. So a route that gave its
 * data dependency a default —
 * `(clientV1: ClientV1Runtime, sources: ClientV1ReadSources = clientV1ReadSources())`
 * — reports `length === 1`, gets ZERO tripwires, and every
 * `assertNothingConsulted` in this file then passes trivially against an empty
 * array. The route would also be handed its REAL production sources instead of
 * the instrumented ones, so the whole second layer silently stops testing
 * anything.
 *
 * Measured: applying exactly that default to
 * `createClientV1ConversationsGetHandler` left this file green.
 *
 * This is the "seeded mechanism that degrades to a no-op" shape, so it fails
 * closed and names the remedy rather than being detected by whatever downstream
 * assertion happens to notice.
 */
function assertTrustworthyArity(factory: Function, name: string, probe: string): void {
  const parameters = parameterSource(factory);
  assert.equal(
    /[^=!<>]=[^=>]/.test(parameters) || parameters.includes("..."),
    false,
    `${probe}: ${name} declares a default or rest parameter, so Function.length undercounts its`
      + ` dependencies and this file would install no tripwires for them — every`
      + ` "nothing was consulted before the credential settled" assertion below would then pass`
      + ` against an empty list, and the factory would be handed its real production sources.`
      + `\nDeclare every dependency as a plain required parameter and let the HTTP export supply`
      + ` the production binding, as createClientV1FamiliarsGetHandler does in ${REFERENCE_ROUTE}.`
      + `\nDeclared parameters: ${parameters.replace(/\s+/g, " ").trim()}`,
  );
}

function builtHandlers(
  factory: Function,
  name: string,
  runtime: ClientV1Runtime,
  probe: string,
): { handlers: [string, Handler][]; deps: { touched: string[] }[] } {
  assertTrustworthyArity(factory, name, probe);
  const deps = Array.from({ length: Math.max(0, factory.length - 1) }, (_unused, index) =>
    tripwire(`${name}#dep${index + 1}`),
  );
  const built = factory(runtime, ...deps.map((dep) => dep.value)) as unknown;
  if (typeof built === "function") {
    return { handlers: [[name, built as Handler]], deps };
  }
  assert.ok(
    built !== null && typeof built === "object",
    `${probe}: ${name}(runtime, …) returned ${typeof built}; a handler factory must return a`
      + ` request handler, or an object of them keyed by HTTP method.`,
  );
  const handlers = Object.entries(built as Record<string, unknown>)
    .filter(([, value]) => typeof value === "function")
    .map(([key, value]) => [`${name}.${key}`, value as Handler] as [string, Handler]);
  assert.ok(
    handlers.length > 0,
    `${probe}: ${name}(runtime, …) returned an object with no request handler on it.`,
  );
  return { handlers, deps };
}

async function withScratchRuntime<T>(
  body: (runtime: ClientV1Runtime) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(repoRoot, ".scratch-client-v1-refusal-"));
  try {
    return await body(createClientV1Runtime({ credentialRoot: root, loopbackSecret: STAMP }));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function issueBearer(
  runtime: ClientV1Runtime,
  installationId: string,
  scopes: ClientV1Scope[],
): Promise<string> {
  const issued = await runtime.credentialStore.issue({
    appName: "OpenCoven Chat",
    installationId,
    scopes,
  });
  return issued.bearer;
}

/**
 * The process singleton `getClientV1Runtime()` hands the exported HTTP methods.
 *
 * Swapped rather than stubbed: the module publishes exactly this global, and
 * replacing it is the only way to drive the SHIPPED export — the function Next
 * calls — instead of a re-derivation of it. Restored afterwards so a suite that
 * runs alongside this one is unaffected.
 */
const runtimeGlobal = globalThis as typeof globalThis & {
  __covenCaveClientV1Runtime?: ClientV1Runtime;
};

// One test per pre-authorized pattern, generated from the list itself. A path
// added to CLIENT_V1_AUTHENTICATED_PATHS grows a test here whether or not
// anyone writes one.
for (const pattern of CLIENT_V1_AUTHENTICATED_PATHS) {
  test(`${pattern.source} refuses every request without a scoped credential`, async () => {
    const matches = routesMatching(pattern);
    // A listed path with no handler is a FAILURE here, not a skip, and it is
    // deliberately a different message from the missing-refusal one. Skipping
    // would be the precise hole this file exists to close: the entry removes
    // the sidecar-token gate the moment it lands, so the day a handler appears
    // it inherits an exemption nothing ever tested. api-contracts.test.ts
    // asserts the same thing statically; the overlap is intentional, because a
    // gate that silently passes on a path it could not resolve is worse than no
    // gate.
    assert.ok(
      matches.length > 0,
      `${pattern} pre-authorizes client-v1 ingress but no src/app/api/client/v1 route.ts serves`
        + ` any path it matches. A listed path is exempt from the sidecar token from the moment`
        + ` it is listed, so the first handler to land there would inherit that exemption`
        + ` untested. Add the route, or remove the entry from CLIENT_V1_AUTHENTICATED_PATHS.`,
    );

    for (const { file, route, probe } of matches) {
      const module = (await import(pathToFileURL(file).href)) as RouteModule;
      const context = { params: Promise.resolve(paramsFor(route)) };

      await withScratchRuntime(async (runtime) => {
        const fullyScoped = await issueBearer(runtime, "refusal-gate-all", [...CLIENT_V1_SCOPES]);

        // ---- Layer 1: the exported HTTP methods, i.e. what Next.js serves.
        // Only refusals are probed here, so the route's real data sources are
        // never reached and this stays free of the filesystem and the daemon.
        const previous = runtimeGlobal.__covenCaveClientV1Runtime;
        runtimeGlobal.__covenCaveClientV1Runtime = runtime;
        try {
          for (const [method, handler] of httpMethodHandlers(module, probe, file)) {
            await assertUncredentialedRequestsAreRefused(
              handler,
              `exported ${method}`,
              probe,
              context,
              fullyScoped,
            );
          }
        } finally {
          if (previous === undefined) delete runtimeGlobal.__covenCaveClientV1Runtime;
          else runtimeGlobal.__covenCaveClientV1Runtime = previous;
        }

        // ---- Layer 2: the injectable factory, with tripwire dependencies.
        for (const [name, factory] of handlerFactories(module, probe, file)) {
          const { handlers, deps } = builtHandlers(factory, name, runtime, probe);
          for (const [label, handler] of handlers) {
            // On these routes a data source is a live daemon request or a
            // transcript read, so the tripwires are passed in: a read that
            // happens before the credential is settled is both a side effect an
            // unauthenticated caller can trigger and a timing signal.
            await assertUncredentialedRequestsAreRefused(
              handler,
              label,
              probe,
              context,
              fullyScoped,
              deps,
            );

            // Scope enforcement, derived rather than named. At least one
            // single-scope credential must come back scope_denied — a response
            // only a route that ran requireScope AND acted on the answer can
            // produce. A route that ignores the result cannot reach it, and
            // neither can one that refuses everything with a flat 401.
            const denials: string[] = [];
            for (const scope of CLIENT_V1_SCOPES) {
              const bearer = await issueBearer(runtime, `refusal-gate-${scope}`, [scope]);
              const before = consultations(deps);
              const outcome = await drive(
                handler,
                stampedRequest(probe, { authorization: `Bearer ${bearer}` }),
                context,
              );
              // A refused credential must not have read anything either — a
              // scope denial that already touched the store leaked the work it
              // then declined to hand over. Only checked when the answer WAS a
              // refusal: the credential holding the required scope is supposed
              // to get through, and tripping a tripwire is how it proves it.
              if (outcome.kind === "response" && REFUSAL_CODES.has(outcome.code ?? "")) {
                assertNothingConsulted(
                  deps,
                  before,
                  label,
                  probe,
                  `a bearer scoped only for ${scope}`,
                );
              }
              if (outcome.kind === "response" && outcome.status === 403 && outcome.code === "scope_denied") {
                denials.push(scope);
              }
            }
            assert.ok(
              denials.length > 0,
              `${probe} (${label}) answered no credential with 403 scope_denied, so nothing here`
                + ` proves it checks the SCOPE rather than merely the existence of a credential.`
                + ` Pass the scope this route needs to`
                + ` clientV1.authenticator.requireScope({ bearer, scope }) and return`
                + ` chargeClientV1AuthFailure(clientV1, auth, stamp!) when !auth.ok.\n${WHY}`,
            );

            // Positive control: without it every assertion above is satisfied
            // by a route that refuses unconditionally, which would be a gate
            // that fires on nothing real. A fully scoped credential must get
            // PAST the credential check. It then trips a tripwire dependency
            // and the route answers 500 — that is expected and fine; the only
            // thing asserted is that the answer is not a refusal.
            const accepted = await drive(
              handler,
              stampedRequest(probe, { authorization: `Bearer ${fullyScoped}` }),
              context,
            );
            assert.ok(
              accepted.kind !== "response"
                || !(accepted.code !== null && REFUSAL_CODES.has(accepted.code)),
              `${probe} (${label}) refused a credential holding every scope this contract`
                + ` publishes (${accepted.description}). The refusals above therefore prove`
                + ` nothing — a route that refuses every request passes them all. Accept a`
                + ` credential that holds the scope this route requires.`,
            );
          }
        }
      });
    }
  });
}
