// @ts-nocheck
// Guard: every child process Cave launches must carry `windowsHide: true`.
//
// Why this is a build gate rather than a style preference. The Tauri shell
// starts the Node sidecar with CREATE_NO_WINDOW (see
// `src-tauri/src/sidecar_startup.rs`), so the server process running our route
// handlers has **no console attached**. Under Win32, `CreateProcess` on a
// console-subsystem child from a console-less parent *allocates a new console*
// — a real, visible conhost window — unless the child is given
// CREATE_NO_WINDOW as well. Node spells that flag `windowsHide: true`.
//
// So on Windows a plain `spawn("git", …)` pops a black terminal window over the
// app. The Research Desk made it impossible to miss: one mission iteration runs
// seven `familiar` steps and every one of them opened a window (cave-7jb).
//
// The option is a no-op off Windows, so there is no platform branch to get
// wrong — it belongs on every call, unconditionally.
//
// ⚠️ What it does NOT fix: a child launched through `shell: true`, or a
// `.cmd`/`.bat` npm shim executed by `cmd.exe`. That window belongs to the
// shell, not to the child. Resolve shims to a direct executable first with
// `covenLaunchCommandForBinary()` (`src/lib/coven-bin.ts`).
//
// This mirrors the Rust-side assertion in `src-tauri/release-runtime.test.mjs`,
// which pins `creation_flags(0x08000000)` on the sidecar launcher itself.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SRC_ROOT, "..");

const CHILD_PROCESS_EXPORTS = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
]);

/**
 * Call sites that forward an options object they do not own, so the flag is
 * asserted at the object's definition instead. Keep this list short and give
 * every entry a reason: an unexplained waiver is how the gate rots.
 */
const FORWARDS_CALLER_OPTIONS = new Map([
  [
    "lib/opencoven-tools-resolve.ts:30",
    "default NpmPrefixExecFile impl; the type requires windowsHide: true from callers",
  ],
  [
    "lib/server/research-video-renderer.ts:186",
    "default SpawnProcess impl; the type requires windowsHide: true from callers",
  ],
]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function referencesChildProcessModule(raw: string): boolean {
  return /(?:from\s+|import\s*\()\s*["']node:child_process["']/.test(raw);
}

type ChildProcessCall = { start: number; text: string; hasWindowsHide: boolean };

/**
 * Find child-process calls by symbol provenance rather than callee spelling.
 * This follows imported functions through injected/defaulted aliases such as
 * `spawnImpl = spawn`, wrapper variables, promisify(), and Reflect.apply().
 */
function childProcessCalls(raw: string, fileName = "fixture.ts"): ChildProcessCall[] {
  const absoluteFileName = path.resolve(fileName);
  const source = ts.createSourceFile(
    absoluteFileName,
    raw,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x")
      ? ts.ScriptKind.TSX
      : fileName.endsWith(".mjs") || fileName.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  // The checker binds every identifier to its lexical declaration even when
  // imports themselves are not resolved. That distinction is load-bearing:
  // an inner unsafe `opts` or `spawn` must never inherit safety/provenance from
  // an unrelated outer declaration with the same text.
  const defaultHost = ts.createCompilerHost({ noResolve: true, noLib: true });
  const canonical = (candidate: string) => path.resolve(candidate);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (candidate) => canonical(candidate) === absoluteFileName
      || defaultHost.fileExists(candidate),
    readFile: (candidate) => canonical(candidate) === absoluteFileName
      ? raw
      : defaultHost.readFile(candidate),
    getSourceFile: (candidate, languageVersion) => canonical(candidate) === absoluteFileName
      ? source
      : defaultHost.getSourceFile(candidate, languageVersion),
  };
  const program = ts.createProgram(
    [absoluteFileName],
    {
      noResolve: true,
      noLib: true,
      allowJs: true,
      checkJs: false,
      target: ts.ScriptTarget.Latest,
    },
    host,
  );
  const checker = program.getTypeChecker();
  const boundSource = program.getSourceFile(absoluteFileName) ?? source;
  const launchers = new Set<ts.Symbol>();
  const launcherNamespaces = new Set<ts.Symbol>();
  const initializers = new Map<ts.Symbol, ts.Expression>();

  const symbolAt = (identifier: ts.Identifier): ts.Symbol | undefined =>
    checker.getSymbolAtLocation(identifier);

  for (const statement of boundSource.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "node:child_process") continue;
    const bindings = statement.importClause?.namedBindings;
    const defaultSymbol = statement.importClause?.name
      ? symbolAt(statement.importClause.name)
      : undefined;
    if (defaultSymbol) launcherNamespaces.add(defaultSymbol);
    if (bindings && ts.isNamespaceImport(bindings)) {
      const symbol = symbolAt(bindings.name);
      if (symbol) launcherNamespaces.add(symbol);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        const symbol = symbolAt(specifier.name);
        if (CHILD_PROCESS_EXPORTS.has(imported) && symbol) launchers.add(symbol);
      }
    }
  }

  const collectInitializers = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = symbolAt(node.name);
      if (symbol) initializers.set(symbol, node.initializer);
    }
    node.forEachChild(collectInitializers);
  };
  boundSource.forEachChild(collectInitializers);

  const unwrapAlias = (expression: ts.Expression): ts.Expression => {
    if (ts.isParenthesizedExpression(expression)
      || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression)
      || ts.isSatisfiesExpression(expression)) {
      return unwrapAlias(expression.expression);
    }
    return expression;
  };

  const aliasesNamespace = (expression: ts.Expression | undefined): boolean => {
    if (!expression) return false;
    const unwrapped = unwrapAlias(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = symbolAt(unwrapped);
      return !!symbol && launcherNamespaces.has(symbol);
    }
    if (ts.isBinaryExpression(unwrapped)
      && (unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return aliasesNamespace(unwrapped.left) || aliasesNamespace(unwrapped.right);
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return aliasesNamespace(unwrapped.whenTrue) || aliasesNamespace(unwrapped.whenFalse);
    }
    return false;
  };

  const namespaceExport = (expression: ts.Expression): string | null => {
    const unwrapped = unwrapAlias(expression);
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const owner = unwrapAlias(unwrapped.expression);
      const ownerSymbol = ts.isIdentifier(owner) ? symbolAt(owner) : undefined;
      return ownerSymbol && launcherNamespaces.has(ownerSymbol) ? unwrapped.name.text : null;
    }
    if (ts.isElementAccessExpression(unwrapped) && ts.isStringLiteral(unwrapped.argumentExpression)) {
      const owner = unwrapAlias(unwrapped.expression);
      const ownerSymbol = ts.isIdentifier(owner) ? symbolAt(owner) : undefined;
      return ownerSymbol && launcherNamespaces.has(ownerSymbol)
        ? unwrapped.argumentExpression.text
        : null;
    }
    return null;
  };

  const calleeReferencesLauncher = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapAlias(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = symbolAt(unwrapped);
      return !!symbol && launchers.has(symbol);
    }
    const exported = namespaceExport(unwrapped);
    if (exported) return CHILD_PROCESS_EXPORTS.has(exported);
    if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
      const name = ts.isPropertyAccessExpression(unwrapped)
        ? unwrapped.name
        : unwrapped.argumentExpression;
      const symbol = name && ts.isIdentifier(name) ? symbolAt(name) : undefined;
      return !!symbol && launchers.has(symbol);
    }
    if (ts.isBinaryExpression(unwrapped)
      && (unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return calleeReferencesLauncher(unwrapped.left) || calleeReferencesLauncher(unwrapped.right);
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return calleeReferencesLauncher(unwrapped.whenTrue)
        || calleeReferencesLauncher(unwrapped.whenFalse);
    }
    return false;
  };

  const isLauncherCall = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapAlias(expression);
    if (!ts.isCallExpression(unwrapped)) return false;
    if (calleeReferencesLauncher(unwrapped.expression)) return true;
    return ts.isPropertyAccessExpression(unwrapped.expression)
      && ts.isIdentifier(unwrapped.expression.expression)
      && unwrapped.expression.expression.text === "Reflect"
      && unwrapped.expression.name.text === "apply"
      && !!unwrapped.arguments[0]
      && calleeReferencesLauncher(unwrapped.arguments[0]);
  };

  const aliasesLauncher = (expression: ts.Expression | undefined): boolean => {
    if (!expression) return false;
    const unwrapped = unwrapAlias(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = symbolAt(unwrapped);
      return !!symbol && launchers.has(symbol);
    }
    if (ts.isBinaryExpression(unwrapped)
      && (unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return aliasesLauncher(unwrapped.left) || aliasesLauncher(unwrapped.right);
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return aliasesLauncher(unwrapped.whenTrue) || aliasesLauncher(unwrapped.whenFalse);
    }
    if (ts.isCallExpression(unwrapped)
      && ts.isIdentifier(unwrapped.expression)
      && unwrapped.expression.text === "promisify") {
      return aliasesLauncher(unwrapped.arguments[0]);
    }
    if (ts.isArrowFunction(unwrapped)) {
      return ts.isBlock(unwrapped.body)
        ? unwrapped.body.statements.length === 1
          && ts.isReturnStatement(unwrapped.body.statements[0])
          && !!unwrapped.body.statements[0].expression
          && isLauncherCall(unwrapped.body.statements[0].expression)
        : isLauncherCall(unwrapped.body);
    }
    return false;
  };

  const typeReferencesLauncher = (
    type: ts.TypeNode | undefined,
    resolving = new Set<ts.Symbol>(),
  ): boolean => {
    if (!type) return false;
    if (ts.isTypeQueryNode(type)) {
      const tail = ts.isIdentifier(type.exprName) ? type.exprName : type.exprName.right;
      const symbol = symbolAt(tail);
      if (symbol && launchers.has(symbol)) return true;
      if (ts.isQualifiedName(type.exprName)) {
        const owner = type.exprName.left;
        if (ts.isIdentifier(owner)) {
          const ownerSymbol = symbolAt(owner);
          if (
            ownerSymbol
            && launcherNamespaces.has(ownerSymbol)
            && CHILD_PROCESS_EXPORTS.has(type.exprName.right.text)
          ) return true;
        }
      }
    }
    if (ts.isImportTypeNode(type)
      && ts.isLiteralTypeNode(type.argument)
      && ts.isStringLiteral(type.argument.literal)
      && type.argument.literal.text === "node:child_process"
      && type.qualifier
      && CHILD_PROCESS_EXPORTS.has(
        ts.isIdentifier(type.qualifier) ? type.qualifier.text : type.qualifier.right.text,
      )) return true;
    if (ts.isTypeReferenceNode(type)) {
      const tail = ts.isIdentifier(type.typeName) ? type.typeName : type.typeName.right;
      const symbol = symbolAt(tail);
      if (symbol && !resolving.has(symbol)) {
        const next = new Set(resolving);
        next.add(symbol);
        if (symbol.declarations?.some((declaration) =>
          ts.isTypeAliasDeclaration(declaration)
          && typeReferencesLauncher(declaration.type, next))) return true;
      }
    }
    let found = false;
    type.forEachChild((child) => {
      if (!found && ts.isTypeNode(child) && typeReferencesLauncher(child, resolving)) found = true;
    });
    return found;
  };

  // Alias discovery is a small fixed point because wrappers can be chained.
  let changed = true;
  while (changed) {
    changed = false;
    const visitAliases = (node: ts.Node) => {
      if ((ts.isVariableDeclaration(node)
          || ts.isParameter(node)
          || ts.isBindingElement(node)
          || ts.isPropertySignature(node)
          || ts.isPropertyDeclaration(node))
        && ts.isIdentifier(node.name)) {
        const symbol = symbolAt(node.name);
        const initializer = "initializer" in node ? node.initializer : undefined;
        if (
          symbol
          && !launchers.has(symbol)
          && (aliasesLauncher(initializer) || typeReferencesLauncher(node.type))
        ) {
          launchers.add(symbol);
          changed = true;
        }
        if (symbol && !launcherNamespaces.has(symbol) && aliasesNamespace(initializer)) {
          launcherNamespaces.add(symbol);
          changed = true;
        }
      }
      node.forEachChild(visitAliases);
    };
    boundSource.forEachChild(visitAliases);
  }

  type WindowsHideValue = "true" | "false" | "absent" | "unknown";
  const windowsHideValue = (
    expression: ts.Expression,
    resolving = new Set<ts.Symbol>(),
  ): WindowsHideValue => {
    const unwrapped = unwrapAlias(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = symbolAt(unwrapped);
      if (!symbol || resolving.has(symbol)) return "unknown";
      const initializer = initializers.get(symbol);
      if (!initializer) return "unknown";
      const next = new Set(resolving);
      next.add(symbol);
      return windowsHideValue(initializer, next);
    }
    if (!ts.isObjectLiteralExpression(unwrapped)) return "unknown";
    let value: WindowsHideValue = "absent";
    for (const property of unwrapped.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = windowsHideValue(property.expression, resolving);
        // An unresolved trailing spread could overwrite an earlier safe flag,
        // so ambiguity fails closed instead of assuming the property is absent.
        if (spread === "unknown") value = "unknown";
        else if (spread !== "absent") value = spread;
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
      if (name !== "windowsHide") continue;
      if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) value = "true";
      else if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) value = "false";
      else return "unknown";
    }
    return value;
  };

  const calls: ChildProcessCall[] = [];
  const visitCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const direct = calleeReferencesLauncher(node.expression);
      const reflected = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "Reflect"
        && node.expression.name.text === "apply"
        && !!node.arguments[0]
        && calleeReferencesLauncher(node.arguments[0]);
      if (direct || reflected) {
        const effectiveArguments = reflected
          ? ts.isArrayLiteralExpression(node.arguments[2])
            ? node.arguments[2].elements.filter(
              (element): element is ts.Expression => !ts.isOmittedExpression(element),
            )
            : null
          : [...node.arguments];
        calls.push({
          start: node.getStart(source),
          text: node.getText(boundSource),
          // argv arrays and prompt strings cannot satisfy this: only a real
          // top-level object argument (or a statically resolved named/spread
          // object) with the boolean literal true is accepted.
          // Reflect's second argument is `thisArg`, never spawn options. If
          // its argv is not a literal array, fail closed instead of letting a
          // `{ windowsHide: true }` thisArg satisfy the guard accidentally.
          hasWindowsHide: effectiveArguments?.slice(1).some((argument) =>
            windowsHideValue(argument) === "true") ?? false,
        });
      }
    }
    node.forEachChild(visitCalls);
  };
  boundSource.forEachChild(visitCalls);
  return calls;
}

const productionFiles = [
  ...sourceFiles(SRC_ROOT).map((file) => ({
    file,
    relative: path.relative(SRC_ROOT, file).replace(/\\/g, "/"),
  })),
  { file: path.join(REPO_ROOT, "server.ts"), relative: "server.ts" },
  { file: path.join(REPO_ROOT, "server.mjs"), relative: "server.mjs" },
];
const offenders: string[] = [];
const unusedWaivers = new Set(FORWARDS_CALLER_OPTIONS.keys());

for (const { file, relative } of productionFiles) {
  const raw = readFileSync(file, "utf8");
  // Only files that actually import child_process launch anything. Without
  // this, unrelated local helpers named `spawn` (the canvas particle emitter in
  // `scry-glitch.tsx`, for one) would be flagged forever.
  if (!referencesChildProcessModule(raw)) continue;

  for (const match of childProcessCalls(raw, file)) {
    const call = match.text;
    const line = raw.slice(0, match.start).split("\n").length;
    const site = `${relative}:${line}`;

    if (match.hasWindowsHide) continue;

    if (FORWARDS_CALLER_OPTIONS.has(site)) {
      unusedWaivers.delete(site);
      continue;
    }
    offenders.push(`${site}  ${call.slice(0, 70).replace(/\s+/g, " ")}`);
  }
}

assert.deepEqual(
  offenders,
  [],
  `child process launched without windowsHide: true — on Windows each of these opens a console window over the app (see the header of this file):\n  ${offenders.join("\n  ")}`,
);

assert.deepEqual(
  Array.from(unusedWaivers),
  [],
  "FORWARDS_CALLER_OPTIONS lists call sites that no longer exist or no longer need a waiver — delete them",
);

// The scanner must actually be looking at something; an empty sweep (a moved
// source root, a broken regex) would pass the assertions above vacuously.
assert.ok(
  productionFiles.some(({ file }) =>
    referencesChildProcessModule(readFileSync(file, "utf8")),
  ),
  "no child_process importers found in production sources — the guard is scanning the wrong tree",
);

const injectedAliasFixture = [
  'import { spawn } from "node:child_process";',
  "function launch(spawnImpl: typeof spawn) {",
  '  return spawnImpl("codex", [], { stdio: "ignore" });',
  "}",
].join("\n");
assert.equal(
  childProcessCalls(injectedAliasFixture).length,
  1,
  "the guard must follow injected aliases instead of recognizing only identifiers literally named spawn",
);

const reflectedAliasFixture = [
  'import { spawn as childSpawn } from "node:child_process";',
  "const spawnImpl = childSpawn;",
  'Reflect.apply(spawnImpl, undefined, ["codex", [], { windowsHide: true }]);',
].join("\n");
const reflectedCalls = childProcessCalls(reflectedAliasFixture);
assert.equal(reflectedCalls.length, 1, "the guard must inspect Reflect.apply launch aliases");
assert.equal(
  reflectedCalls[0].hasWindowsHide,
  true,
  "a reflected alias with windowsHide: true satisfies the guard",
);

const dynamicReflectedArgsFixture = [
  'import { spawn } from "node:child_process";',
  'const args = ["codex", [], { windowsHide: true }];',
  'Reflect.apply(spawn, { windowsHide: true }, args);',
].join("\n");
assert.equal(
  childProcessCalls(dynamicReflectedArgsFixture)[0]?.hasWindowsHide,
  false,
  "a dynamic Reflect argv fails closed and its thisArg cannot impersonate spawn options",
);

const resolvedSpreadFixture = [
  'import { spawn } from "node:child_process";',
  "const spawnImpl = spawn;",
  "const hidden = { windowsHide: true };",
  'spawnImpl("codex", [], { ...hidden, stdio: "ignore" });',
].join("\n");
assert.equal(
  childProcessCalls(resolvedSpreadFixture)[0].hasWindowsHide,
  true,
  "a statically resolved options spread preserves its literal true contract",
);

for (const bait of [
  'spawnImpl("codex", [], { env: { NOTE: "windowsHide: true" } });',
  'spawnImpl("codex", [], { /* windowsHide: true */ stdio: "ignore" });',
  'spawnImpl("codex", [], { windowsHide: false });',
  'spawnImpl("codex", [], { windowsHide: true, ...unknownOptions });',
  'spawnImpl("codex", [], { windowsHide: true, windowsHide: false });',
]) {
  const fixture = [
    'import { spawn } from "node:child_process";',
    "const spawnImpl = spawn; const unknownOptions = getOptions();",
    bait,
  ].join("\n");
  assert.equal(
    childProcessCalls(fixture)[0].hasWindowsHide,
    false,
    "string, comment, and false-value bait cannot satisfy the AST-semantic guard",
  );
}

const unsafeShadowedOptionsFixture = [
  'import { spawn } from "node:child_process";',
  "const opts = { windowsHide: true };",
  "function launch() {",
  '  const opts = { stdio: "ignore" };',
  '  return spawn("codex", [], opts);',
  "}",
].join("\n");
assert.equal(
  childProcessCalls(unsafeShadowedOptionsFixture)[0].hasWindowsHide,
  false,
  "an outer safe options object cannot mask an unsafe shadowed binding",
);

const safeShadowedOptionsFixture = [
  'import { spawn } from "node:child_process";',
  'const opts = { stdio: "ignore" };',
  "function launch() {",
  "  const opts = { windowsHide: true };",
  '  return spawn("codex", [], opts);',
  "}",
].join("\n");
assert.equal(
  childProcessCalls(safeShadowedOptionsFixture)[0].hasWindowsHide,
  true,
  "the lexical options binding at the call site can satisfy the guard",
);

const shadowedLauncherFixture = [
  'import { spawn } from "node:child_process";',
  "function unrelated(spawn: (name: string) => void) {",
  '  spawn("canvas-particle");',
  "}",
  'spawn("codex", [], { windowsHide: true });',
].join("\n");
assert.equal(
  childProcessCalls(shadowedLauncherFixture).length,
  1,
  "an unrelated shadowed function named spawn is not a child-process launcher",
);

for (const [label, callee] of [
  ["nullish fallback", "(dependencies.spawnImpl ?? spawn)"],
  ["boolean fallback", "(dependencies.spawnImpl || spawn)"],
  ["conditional selection", "(dependencies.useInjected ? dependencies.spawnImpl : spawn)"],
] as const) {
  const unsafe = [
    'import { spawn } from "node:child_process";',
    "function launch(dependencies: { spawnImpl?: typeof spawn; useInjected?: boolean }) {",
    `  return ${callee}("codex", [], { stdio: "ignore" });`,
    "}",
  ].join("\n");
  const safe = unsafe.replace(
    '{ stdio: "ignore" }',
    '{ stdio: "ignore", windowsHide: true }',
  );
  assert.equal(childProcessCalls(unsafe)[0]?.hasWindowsHide, false, `${label} is audited when unsafe`);
  assert.equal(childProcessCalls(safe)[0]?.hasWindowsHide, true, `${label} accepts the explicit safe option`);
}

const namespaceFixture = [
  'import * as childProcess from "node:child_process";',
  'childProcess.spawn("codex", [], { windowsHide: true });',
  'childProcess["execFile"]("codex", [], { stdio: "ignore" });',
].join("\n");
assert.deepEqual(
  childProcessCalls(namespaceFixture).map((call) => call.hasWindowsHide),
  [true, false],
  "namespace imports retain per-call windowsHide enforcement",
);

const defaultNamespaceFixture = [
  'import childProcess from "node:child_process";',
  "const processLauncher = childProcess;",
  'processLauncher.spawn("codex", [], { windowsHide: true });',
].join("\n");
assert.equal(
  childProcessCalls(defaultNamespaceFixture)[0]?.hasWindowsHide,
  true,
  "default/namespace aliases are audited rather than treated as unrelated objects",
);

const typeAliasFixture = [
  'import { spawn } from "node:child_process";',
  "type SpawnFunction = typeof spawn;",
  "function launch(spawnImpl: SpawnFunction) {",
  '  return spawnImpl("codex", [], { stdio: "ignore" });',
  "}",
].join("\n");
assert.equal(
  childProcessCalls(typeAliasFixture)[0]?.hasWindowsHide,
  false,
  "a launcher passed through a type alias remains audited",
);

const importTypeAliasFixture = [
  'type SpawnFunction = typeof import("node:child_process").spawn;',
  "function launch(spawnImpl: SpawnFunction) {",
  '  return spawnImpl("codex", [], { windowsHide: true });',
  "}",
].join("\n");
assert.equal(
  childProcessCalls(importTypeAliasFixture)[0]?.hasWindowsHide,
  true,
  "an import-type launcher alias is audited without a value import",
);

const grokModelsPath = path.join(SRC_ROOT, "lib", "server", "grok-models.ts");
const grokModelsSource = readFileSync(grokModelsPath, "utf8");
const currentGrokCall = childProcessCalls(grokModelsSource, grokModelsPath)
  .find((call) => call.text.includes("dependencies.spawnImpl ?? spawn"));
assert.equal(
  currentGrokCall?.hasWindowsHide,
  true,
  "the current inline Grok dependency fallback is recognized and safe",
);
const unsafeGrokSource = grokModelsSource.replace(/\s*windowsHide: true,/, "");
const unsafeGrokCall = childProcessCalls(unsafeGrokSource, grokModelsPath)
  .find((call) => call.text.includes("dependencies.spawnImpl ?? spawn"));
assert.equal(
  unsafeGrokCall?.hasWindowsHide,
  false,
  "removing windowsHide from the current inline Grok fallback is caught",
);

const rootServerPath = path.join(REPO_ROOT, "server.ts");
const rootServerSource = readFileSync(rootServerPath, "utf8");
const currentTailnetCall = childProcessCalls(rootServerSource, rootServerPath)
  .find((call) => call.text.includes('"status", "--json"'));
assert.equal(
  currentTailnetCall?.hasWindowsHide,
  true,
  "the packaged root server's Tailscale refresh is included in the guard",
);
const unsafeRootServer = rootServerSource.replace(/, windowsHide: true(?= \})/, "");
const unsafeTailnetCall = childProcessCalls(unsafeRootServer, rootServerPath)
  .find((call) => call.text.includes('"status", "--json"'));
assert.equal(
  unsafeTailnetCall?.hasWindowsHide,
  false,
  "removing windowsHide from the packaged root server is caught",
);

const packagedServerPath = path.join(REPO_ROOT, "server.mjs");
const packagedServerSource = readFileSync(packagedServerPath, "utf8");
const currentPackagedTailnetCall = childProcessCalls(packagedServerSource, packagedServerPath)
  .find((call) => call.text.includes('"status", "--json"'));
assert.equal(
  currentPackagedTailnetCall?.hasWindowsHide,
  true,
  "the tracked packaged server artifact is semantically audited for the hidden Tailscale subprocess option",
);
const unsafePackagedServer = packagedServerSource.replace(/, windowsHide: true(?= \})/, "");
const unsafePackagedTailnetCall = childProcessCalls(unsafePackagedServer, packagedServerPath)
  .find((call) => call.text.includes('"status", "--json"'));
assert.equal(
  unsafePackagedTailnetCall?.hasWindowsHide,
  false,
  "removing windowsHide from the executable server artifact is caught semantically",
);
