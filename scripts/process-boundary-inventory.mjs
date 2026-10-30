// Discovery is deliberately separate from contract verification (#6303).
// Foreign sources and third-party imports are obligations, never an implicit pass.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The standalone sidecar source is at the root, outside the three source trees.
// Its generated server.mjs is not an additional authoritative source boundary.
const ROOTS = ["src", "scripts", "src-tauri", "server.ts"];
const JS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const INERT = new Set([".css", ".md", ".json", ".jsonl", ".toml", ".lock", ".txt", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".icns", ".rgba", ".woff", ".woff2", ".sha256", ".gitkeep"]);
const CAPABILITIES = new Set(["child_process", "net", "tls", "http", "https", "http2", "dgram", "cluster", "worker_threads", "node-pty", "ws", "@tauri-apps/plugin-shell", "electron"]);
const AMBIENT = new Set(["WebSocket", "Worker", "SharedWorker", "eval", "Function"]);
const LOADER = "@module-loader";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalizeModule = (value) => value.replace(/^node:/, "");

function moduleCapability(value) {
  const name = normalizeModule(value);
  return CAPABILITIES.has(name) ? name : null;
}

function isExternal(value) {
  return !value.startsWith(".") && !value.startsWith("/") && !value.startsWith("@/");
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

function javascriptRows(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const rows = [];
  const aliases = new Map();
  const add = (node, kind, capability) => {
    const start = node.getStart(ast);
    const point = ast.getLineAndCharacterOfPosition(start);
    rows.push({ file, line: point.line + 1, column: point.character + 1, kind, capability });
  };
  const bind = (name, caps) => {
    if (!caps.size) return false;
    const known = aliases.get(name) ?? new Set();
    let changed = false;
    for (const cap of caps) {
      if (!known.has(cap)) { known.add(cap); changed = true; }
    }
    aliases.set(name, known);
    return changed;
  };
  const property = (base, name) => new Set([...base].flatMap((cap) => cap === "@process" ? (name === "getBuiltinModule" ? [LOADER] : []) : [`${cap}.${name}`]));
  const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : null;
  function resolve(node) {
    if (!node) return new Set();
    if (ts.isIdentifier(node)) return new Set([...(aliases.get(node.text) ?? []), ...(node.text === "require" ? [LOADER] : []), ...(node.text === "process" ? ["@process"] : []), ...(AMBIENT.has(node.text) ? [`ambient.${node.text}`] : [])]);
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return resolve(node.expression);
    if (ts.isPropertyAccessExpression(node)) {
      if (["bind", "call", "apply"].includes(node.name.text)) return resolve(node.expression);
      return property(resolve(node.expression), node.name.text);
    }
    if (ts.isElementAccessExpression(node)) return property(resolve(node.expression), literal(node.argumentExpression) ?? "*");
    if (ts.isConditionalExpression(node)) return new Set([...resolve(node.whenTrue), ...resolve(node.whenFalse)]);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || resolve(node.expression).has(LOADER)) {
        const name = literal(node.arguments?.[0]);
        const cap = name && moduleCapability(name);
        return cap ? new Set([cap]) : new Set();
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "bind") return resolve(node.expression.expression);
      const called = resolve(node.expression);
      if (called.has("module.createRequire")) return new Set([LOADER]);
      if (called.has("util.promisify")) return resolve(node.arguments?.[0]);
      const handles = [...called].filter((cap) => /^(?:net|tls|http|https|http2|dgram)\.(?:createServer|createSocket|connect|createConnection|Server|Socket)$/.test(cap));
      if (handles.length) return new Set(handles.map((cap) => `${cap}()`));
      if (node.expression.getText(ast) === "process.getBuiltinModule") {
        const cap = literal(node.arguments?.[0]);
        return cap && moduleCapability(cap) ? new Set([normalizeModule(cap)]) : new Set();
      }
    }
    return new Set();
  }
  const bindPattern = (name, caps) => {
    if (ts.isIdentifier(name)) return bind(name.text, caps);
    let changed = false;
    if (ts.isObjectBindingPattern(name)) {
      for (const part of name.elements) {
        const key = part.dotDotDotToken ? "*" : (part.propertyName ?? part.name).getText(ast).replace(/^['"]|['"]$/g, "");
        changed = bindPattern(part.name, property(caps, key)) || changed;
      }
    }
    if (ts.isObjectLiteralExpression(name)) {
      for (const part of name.properties) {
        if (ts.isPropertyAssignment(part)) changed = bindPattern(part.initializer, property(caps, part.name.getText(ast).replace(/^['"]|['"]$/g, ""))) || changed;
        else if (ts.isShorthandPropertyAssignment(part)) changed = bindPattern(part.name, property(caps, part.name.text)) || changed;
        else if (ts.isSpreadAssignment(part)) changed = bindPattern(part.expression, caps) || changed;
      }
    }
    return changed;
  };
  visit(ast, (node) => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const name = literal(node.moduleReference.expression);
      if (name) {
        const cap = moduleCapability(name);
        add(node, !isExternal(name) ? "source-review" : cap ? "capability-import" : "module-review", !isExternal(name) ? `local-module-delegation:${name}` : cap ?? name);
        if (cap) bind(node.name.text, new Set([cap]));
      } else add(node, "dynamic-load", "unresolved-module");
    }
    if (ts.isImportDeclaration(node)) {
      const name = literal(node.moduleSpecifier);
      const cap = name && moduleCapability(name);
      if (name && isExternal(name)) add(node, cap ? "capability-import" : "module-review", cap ?? name);
      else if (name) add(node, "source-review", `local-module-delegation:${name}`);
      const clause = node.importClause;
      const bindingCap = cap ?? (["module", "util"].includes(normalizeModule(name ?? "")) ? normalizeModule(name) : null);
      if (!bindingCap || !clause) return;
      if (clause.name) bind(clause.name.text, new Set([bindingCap]));
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bind(clause.namedBindings.name.text, new Set([bindingCap]));
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) bind(spec.name.text, new Set([`${bindingCap}.${(spec.propertyName ?? spec.name).text}`]));
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const name = literal(node.moduleSpecifier);
      if (name && isExternal(name)) add(node, "module-review", moduleCapability(name) ?? name);
      else if (name) add(node, "source-review", `local-module-delegation:${name}`);
    }
  });
  // A conservative union by name over-approximates shadowed bindings. It never
  // treats a same-named local declaration as evidence that a capability vanished.
  for (let round = 0; round < 32; round++) {
    let changed = false;
    visit(ast, (node) => {
      if (ts.isVariableDeclaration(node)) changed = bindPattern(node.name, resolve(node.initializer)) || changed;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) changed = bindPattern(node.left, resolve(node.right)) || changed;
    });
    if (!changed) break;
    if (round === 31) add(ast, "source-review", "alias-analysis-limit");
  }
  for (const diagnostic of ast.parseDiagnostics) {
    const location = { getStart: () => diagnostic.start ?? 0 };
    add(location, "source-review", `parse-error:${diagnostic.code}`);
  }
  visit(ast, (node) => {
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
      const stored = new Set();
      visit(node, (part) => { for (const cap of resolve(part)) stored.add(cap); });
      if (stored.size) add(node, "source-review", `capability-storage:${[...stored].sort().join(" | ")}`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && !ts.isIdentifier(node.left)) {
      const stored = resolve(node.right);
      if (stored.size) add(node, "source-review", `capability-storage-assignment:${[...stored].sort().join(" | ")}`);
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        const escaped = resolve(spec.propertyName ?? spec.name);
        if (escaped.size) add(spec, "escape", [...escaped].sort().join(" | "));
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const caps = resolve(expression);
      if (caps.size) add(node, "call", [...caps].sort().join(" | "));
      const loader = expression.kind === ts.SyntaxKind.ImportKeyword || resolve(expression).has(LOADER) || expression.getText(ast) === "process.getBuiltinModule";
      if (loader) {
        const name = literal(node.arguments?.[0]);
        if (!name) add(node, "dynamic-load", "unresolved-module");
        else if (isExternal(name)) add(node, moduleCapability(name) ? "capability-import" : "module-review", moduleCapability(name) ?? name);
        else add(node, "source-review", `local-module-delegation:${name}`);
      }
      for (const argument of node.arguments ?? []) {
        const escaped = resolve(argument);
        if (escaped.size) add(argument, "escape", [...escaped].sort().join(" | "));
      }
    }
    if (ts.isReturnStatement(node) && node.expression) {
      const escaped = resolve(node.expression);
      if (escaped.size) add(node, "escape", [...escaped].sort().join(" | "));
    }
  });
  // An unsupported/global-only form must not make a whole source unit vanish
  // from drift checks. This is an unresolved obligation, not a safe-file label.
  if (!rows.length) add(ast, "source-review", "javascript-no-classified-capabilities");
  return rows;
}

/** Read source only; never import/execute inventoried files or traverse symlinks. */
export function discoverBoundaries(root) {
  const rows = [];
  const python = [];
  const rust = [];
  const scan = (relative) => {
    const absolute = path.join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      rows.push({ file: relative, line: 1, column: 1, kind: "symlink-review", capability: "unfollowed-link", sourceHash: sha(readlinkSync(absolute)) });
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        // These are generated dependencies/build products, never source roots.
        if (["node_modules", ".git", "__pycache__"].includes(name) || ["src-tauri/target", "scripts/process-boundary-rust/target"].includes(`${relative}/${name}`)) continue;
        scan(`${relative}/${name}`);
      }
      return;
    }
    if (!stat.isFile()) {
      rows.push({ file: relative, line: 1, column: 1, kind: "source-review", capability: "non-regular-source", sourceHash: "unread" });
      return;
    }
    const extension = path.extname(relative);
    if (INERT.has(extension)) return;
    const bytes = readFileSync(absolute);
    const sourceHash = sha(bytes);
    if (extension === ".py") {
      python.push({ file: relative, source: bytes.toString("utf8"), sourceHash });
    } else if (extension === ".rs") {
      rust.push({ file: relative, source: bytes.toString("utf8"), sourceHash });
    } else if (JS.has(extension)) {
      for (const row of javascriptRows(relative, bytes.toString("utf8"))) rows.push({ ...row, sourceHash });
    } else {
      rows.push({ file: relative, line: 1, column: 1, kind: "source-review", capability: `whole-file:${extension || "extensionless"}`, sourceHash });
    }
  };
  for (const name of ROOTS) {
    try { scan(name); } catch (error) {
      if (error.code === "ENOENT" && !relativeExists(root, name)) continue;
      throw error;
    }
  }
  if (python.length) {
    try {
      const input = JSON.stringify(python.map(({ file, source }) => ({ file, source })));
      if (Buffer.byteLength(input) > 8 * 1024 * 1024) throw new Error("Python source input exceeds parser budget");
      // The only executed code is our parser, with isolated stdlib imports.
      // Target source is JSON input to ast.parse, never imported or evaluated.
      const env = Object.fromEntries(["PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      const output = execFileSync(process.platform === "win32" ? "python" : "python3", ["-I", fileURLToPath(new URL("./process-boundary-python.py", import.meta.url))], {
        input, encoding: "utf8", env, shell: false, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      });
      const hashes = new Map(python.map(({ file, sourceHash }) => [file, sourceHash]));
      for (const row of JSON.parse(output)) {
        if (!hashes.has(row.file)) throw new Error("Python parser returned an unknown file");
        rows.push({ ...row, sourceHash: hashes.get(row.file) });
      }
    } catch {
      for (const { file, sourceHash } of python) rows.push({ file, line: 1, column: 1, kind: "source-review", capability: "python-parser-unavailable-or-failed", sourceHash });
    }
  }
  if (rust.length) {
    try {
      const input = JSON.stringify(rust.map(({ file, source }) => ({ file, source })));
      if (Buffer.byteLength(input) > 8 * 1024 * 1024) throw new Error("Rust source input exceeds parser budget");
      const helperRoot = new URL("./process-boundary-rust/", import.meta.url);
      const identity = {
        parserSource: readFileSync(new URL("src/main.rs", helperRoot), "utf8"),
        parserManifest: readFileSync(new URL("Cargo.toml", helperRoot), "utf8"),
        parserLock: readFileSync(new URL("Cargo.lock", helperRoot), "utf8"),
      };
      // Build this fixed parser explicitly before discovery. Never compile or
      // execute target Rust, and never launch Cargo from an inventory request.
      const executable = fileURLToPath(new URL(`target/debug/cave-process-boundary-rust${process.platform === "win32" ? ".exe" : ""}`, helperRoot));
      const env = Object.fromEntries(["PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      const output = execFileSync(executable, [], {
        input, encoding: "utf8", env, shell: false, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      });
      rows.push(...validateRustParserReply(JSON.parse(output), rust, identity));
    } catch {
      for (const { file, sourceHash } of rust) rows.push({ file, line: 1, column: 1, kind: "source-review", capability: "rust-parser-unavailable-or-stale", sourceHash });
    }
  }
  rows.sort((a, b) => a.file.localeCompare(b.file, "en") || a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind, "en") || a.capability.localeCompare(b.capability, "en"));
  const seen = new Map();
  return rows.map((row) => {
    const base = `${row.file}:${row.line}:${row.column}:${row.kind}`;
    const index = (seen.get(base) ?? 0) + 1;
    seen.set(base, index);
    return { id: `${base}:${index}`, ...row };
  });
}

/** A stale or partial native discovery result must never erase a source unit. */
export function validateRustParserReply(reply, inputs, identity) {
  if (reply?.schemaVersion !== 1 || !Array.isArray(reply.rows)) throw new Error("Invalid Rust parser reply schema");
  for (const key of ["parserSource", "parserManifest", "parserLock"]) {
    if (reply[key] !== identity[key]) throw new Error("Rust parser executable is stale");
  }
  const hashes = new Map(inputs.map(({ file, sourceHash }) => [file, sourceHash]));
  const seen = new Set();
  const rows = reply.rows.map((row) => {
    if (!hashes.has(row.file)) throw new Error("Rust parser returned an unknown source unit");
    if (!Number.isSafeInteger(row.line) || row.line < 1 || !Number.isSafeInteger(row.column) || row.column < 1 || !["call", "escape", "source-review"].includes(row.kind) || typeof row.capability !== "string") throw new Error("Invalid Rust parser boundary record");
    seen.add(row.file);
    return { ...row, sourceHash: hashes.get(row.file) };
  });
  if (seen.size !== hashes.size) throw new Error("Rust parser reply is missing source units");
  return rows;
}

function relativeExists(root, name) {
  try { lstatSync(path.join(root, name)); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Registration drift is not a statement that any registered contract is proven. */
export function compareInventory(discovered, recorded) {
  const current = new Map(discovered.map((row) => [row.id, row]));
  const prior = new Map(recorded.map((row) => [row.id, row]));
  return {
    missing: discovered.filter((row) => !prior.has(row.id)),
    changed: discovered.filter((row) => prior.has(row.id) && ["file", "kind", "capability", "sourceHash"].some((key) => row[key] !== prior.get(row.id)[key])),
    removed: recorded.filter((row) => !current.has(row.id)),
  };
}

export const CONTRACT_DIMENSIONS = ["environment", "arguments", "deadline", "output", "cancellation", "descendants", "permissions", "paths"];

/** Validate review records, not the truth of their behavioral/runtime evidence. */
export function auditContracts(discovered, recorded) {
  const invalid = [];
  const unverified = [];
  const ids = new Set();
  for (const row of recorded) {
    if (ids.has(row.id)) invalid.push(`${row.id}: duplicate contract ID`);
    ids.add(row.id);
    const contract = row.contract;
    if (!contract || !["unverified", "verified"].includes(contract.status)) {
      invalid.push(`${row.id}: missing contract status`);
      continue;
    }
    if (contract.status === "unverified") {
      if (!contract.reason?.trim()) invalid.push(`${row.id}: missing review blocker`);
      unverified.push(row.id);
      continue;
    }
    const problems = [];
    if (!contract.owner?.trim()) problems.push("review owner");
    if (!contract.reviewedSourceHash || contract.reviewedSourceHash !== row.sourceHash) problems.push("reviewed source hash");
    if (["source-review", "symlink-review", "dynamic-load"].includes(row.kind)) problems.push("unresolved discovery obligation");
    for (const dimension of CONTRACT_DIMENSIONS) {
      const proof = contract.dimensions?.[dimension];
      if (!proof || !["verified", "not-applicable"].includes(proof.status) || !proof.reason?.trim()) {
        problems.push(dimension);
        continue;
      }
      if (proof.status === "verified" && (!proof.test?.trim() || !proof.command?.trim() || !proof.platform?.trim() || !/^[a-f0-9]{64}$/.test(proof.receiptSha256 ?? ""))) problems.push(`${dimension} evidence binding`);
    }
    if (problems.length) invalid.push(`${row.id}: missing ${problems.join(", ")}`);
  }
  return { drift: compareInventory(discovered, recorded), invalid, unverified };
}

const REVIEW_REASONS = {
  call: "Review all eight dimensions against exact behavioral/platform receipts.",
  "module-review": "Inspect dependency delegation; the imported module is not assumed safe.",
  "capability-import": "Reconcile this capability with every consumer, re-export and wrapper.",
  "source-review": "Replace unsupported syntax or whole-file obligations with proven individual discovery.",
  escape: "Resolve indirect consumers; a reference is not execution proof.",
  "dynamic-load": "Resolve or bound this module lookup before claiming discovery completeness.",
  "symlink-review": "Resolve authorized source ownership without following external links.",
};

/** Factor repeated source hashes/review blockers, keeping the denominator lossless. */
export function packInventory(rows) {
  const files = {};
  const contracts = {};
  for (const row of rows) {
    const file = files[row.file] ??= { sourceHash: row.sourceHash, entries: [] };
    file.entries.push([row.line, row.column, row.kind, row.capability, Number(row.id.split(":").at(-1))]);
    if (row.contract) contracts[row.id] = row.contract;
  }
  return { schemaVersion: 2, status: "incomplete-contract-review", files, contracts };
}

export function unpackInventory(document) {
  if (document.schemaVersion !== 2 || !document.files || typeof document.files !== "object" || Array.isArray(document.files) || !document.contracts || typeof document.contracts !== "object") throw new Error("Unsupported boundary inventory schema");
  const rows = [];
  for (const [file, data] of Object.entries(document.files)) {
    if (!Array.isArray(data.entries) || !/^[a-f0-9]{64}$/.test(data.sourceHash ?? "")) throw new Error(`Invalid inventory file ${file}`);
    for (const entry of data.entries) {
      const [line, column, kind, capability, ordinal] = entry;
      if (entry.length !== 5 || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1 || !Number.isSafeInteger(ordinal) || ordinal < 1 || !(kind in REVIEW_REASONS) || typeof capability !== "string") throw new Error(`Invalid inventory entry in ${file}`);
      const id = `${file}:${line}:${column}:${kind}:${ordinal}`;
      rows.push({ id, file, line, column, kind, capability, sourceHash: data.sourceHash,
        contract: document.contracts[id] ?? { status: "unverified", reason: REVIEW_REASONS[kind] },
      });
    }
  }
  const known = new Set(rows.map((row) => row.id));
  for (const id of Object.keys(document.contracts)) if (!known.has(id)) throw new Error(`Orphaned contract ${id}`);
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rows = discoverBoundaries(root);
  const [mode, manifest] = process.argv.slice(2);
  if (!mode) {
    process.stdout.write(`${JSON.stringify(packInventory(rows), null, 2)}\n`);
  } else if (["--check", "--require-proof"].includes(mode) && manifest) {
    const document = JSON.parse(readFileSync(path.resolve(root, manifest), "utf8"));
    const audit = auditContracts(rows, unpackInventory(document));
    const drift = Object.values(audit.drift).some((entries) => entries.length > 0);
    process.stdout.write(`${JSON.stringify({ discovered: rows.length, invalid: audit.invalid, unverified: audit.unverified.length, drift: Object.fromEntries(Object.entries(audit.drift).map(([key, entries]) => [key, entries.map((row) => row.id)])), proof: "record-validation-only; behavioral evidence must be reviewed separately" }, null, 2)}\n`);
    if (drift || audit.invalid.length || (mode === "--require-proof" && audit.unverified.length)) process.exitCode = 1;
  } else {
    process.stderr.write("Usage: node scripts/process-boundary-inventory.mjs [--check|--require-proof <manifest.json>]\n");
    process.exitCode = 2;
  }
}
