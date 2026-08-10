import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  ACTIVE_RULES,
  LIVE_SOURCE_ROOTS,
  SEMANTIC_EXCEPTIONS,
  TSX_COPY_PROP_NAMES,
  isExcludedSource,
} from "./ui-consistency-policy.mjs";

const ACTIVE_RULE_IDS = new Set(ACTIVE_RULES.map((rule) => rule.id));
const TSX_COPY_PROPS = new Set(TSX_COPY_PROP_NAMES);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeExcerpt(line) {
  return line.trim().replace(/\s+/g, " ");
}

export function findingKey(finding) {
  return [finding.rule, finding.path, finding.excerpt].join("\u0000");
}

function compareByKey(a, b) {
  return findingKey(a).localeCompare(findingKey(b));
}

function uniqueSortedFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) byKey.set(findingKey(finding), finding);
  return [...byKey.values()].sort(compareByKey);
}

function jsxTagNameText(tagName, sourceFile) {
  return tagName.getText(sourceFile);
}

function renderedStringLiterals(expression) {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    return [
      [
        expression.head.text,
        ...expression.templateSpans.map((span) => span.literal.text),
      ].join(""),
      ...expression.templateSpans.flatMap((span) =>
        renderedStringLiterals(span.expression),
      ),
    ];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...renderedStringLiterals(expression.whenTrue),
      ...renderedStringLiterals(expression.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [
      ...renderedStringLiterals(expression.left),
      ...renderedStringLiterals(expression.right),
    ];
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return renderedStringLiterals(expression.right);
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...renderedStringLiterals(expression.left),
      ...renderedStringLiterals(expression.right),
    ];
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return renderedStringLiterals(expression.expression);
  }
  return [];
}

function tsxStringValues(initializer) {
  if (!initializer) return [];
  if (ts.isStringLiteral(initializer)) return [initializer.text];
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return renderedStringLiterals(initializer.expression);
  }
  return [];
}

function scanTsxSource(sourcePath, source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  const addFinding = (rule, node) => {
    findings.push({
      rule,
      path: toPosix(sourcePath),
      excerpt: normalizeExcerpt(
        source.slice(node.getStart(sourceFile), node.getEnd()),
      ),
    });
  };
  const inspectCopy = (values, node) => {
    if (values.some((value) => value.includes("..."))) {
      addFinding("copy/no-ascii-ellipsis", node);
    }
    if (values.some((value) => value.trim() === "Submit")) {
      addFinding("copy/no-generic-submit", node);
    }
  };

  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTagNameText(node.tagName, sourceFile) === "select"
    ) {
      addFinding("components/no-native-select", node);
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (TSX_COPY_PROPS.has(name)) {
        inspectCopy(tsxStringValues(node.initializer), node);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile).replace(/^["']|["']$/g, "");
      if (TSX_COPY_PROPS.has(name)) {
        inspectCopy(renderedStringLiterals(node.initializer), node);
      }
    } else if (ts.isJsxText(node)) {
      inspectCopy([node.text], node);
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression
    ) {
      inspectCopy(renderedStringLiterals(node.expression), node);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return uniqueSortedFindings(findings);
}

export function scanSource({ path: sourcePath, source }) {
  const extension = path.extname(sourcePath);
  if (extension === ".tsx") return scanTsxSource(sourcePath, source);
  const findings = [];
  for (const line of source.split(/\r?\n/)) {
    for (const rule of ACTIVE_RULES) {
      if (!rule.matches({ extension, line })) continue;
      findings.push({
        rule: rule.id,
        path: toPosix(sourcePath),
        excerpt: normalizeExcerpt(line),
      });
    }
  }
  return uniqueSortedFindings(findings);
}

function walk(directory, files = []) {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "target" ||
      entry.name === "gen" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

export function scanRepository(repoRoot) {
  const findings = [];
  for (const sourceRoot of LIVE_SOURCE_ROOTS) {
    const absoluteRoot = path.join(repoRoot, sourceRoot.directory);
    if (!statSync(absoluteRoot).isDirectory()) {
      throw new Error(
        `UI consistency source root is not a directory: ${sourceRoot.directory}`,
      );
    }
    for (const absolutePath of walk(absoluteRoot, [])) {
      const relativePath = toPosix(path.relative(repoRoot, absolutePath));
      if (isExcludedSource(relativePath, sourceRoot)) continue;
      if (!sourceRoot.extensions.includes(path.extname(relativePath))) continue;
      findings.push(
        ...scanSource({
          path: relativePath,
          source: readFileSync(absolutePath, "utf8"),
        }),
      );
    }
  }
  return uniqueSortedFindings(findings);
}

function duplicateKeys(findings) {
  const seen = new Set();
  const duplicates = new Set();
  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function isFinding(value) {
  return (
    value &&
    typeof value === "object" &&
    ACTIVE_RULE_IDS.has(value.rule) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    value.path === toPosix(value.path) &&
    typeof value.excerpt === "string" &&
    value.excerpt.length > 0 &&
    value.excerpt === normalizeExcerpt(value.excerpt)
  );
}

function isSorted(findings) {
  return findings.every(
    (finding, index) =>
      index === 0 || compareByKey(findings[index - 1], finding) <= 0,
  );
}

export function compareFindings(findings, baselineFindings, exceptions) {
  const invalidBaselineFindings = baselineFindings.filter(
    (finding) => !isFinding(finding),
  );
  const validBaselineFindings = baselineFindings.filter(isFinding);
  const invalidExceptions = exceptions.filter(
    (exception) => !isFinding(exception) || !exception.reason?.trim(),
  );
  const validExceptions = exceptions.filter(
    (exception) => isFinding(exception) && exception.reason?.trim(),
  );
  const liveKeys = new Set(findings.map(findingKey));
  const exceptionKeys = new Set(validExceptions.map(findingKey));
  const activeFindings = findings.filter(
    (finding) => !exceptionKeys.has(findingKey(finding)),
  );
  const activeKeys = new Set(activeFindings.map(findingKey));
  const baselineKeys = new Set(validBaselineFindings.map(findingKey));
  const newFindings = activeFindings.filter(
    (finding) => !baselineKeys.has(findingKey(finding)),
  );
  const resolvedBaseline = validBaselineFindings.filter(
    (finding) => !activeKeys.has(findingKey(finding)),
  );
  const staleExceptions = validExceptions.filter(
    (exception) => !liveKeys.has(findingKey(exception)),
  );
  const duplicateBaselineKeys = duplicateKeys(validBaselineFindings);
  const duplicateExceptionKeys = duplicateKeys(validExceptions);
  const outOfOrderBaseline = isSorted(validBaselineFindings) ? [] : validBaselineFindings;

  return {
    ok:
      newFindings.length === 0 &&
      resolvedBaseline.length === 0 &&
      staleExceptions.length === 0 &&
      invalidExceptions.length === 0 &&
      invalidBaselineFindings.length === 0 &&
      duplicateBaselineKeys.length === 0 &&
      duplicateExceptionKeys.length === 0 &&
      outOfOrderBaseline.length === 0,
    activeFindings,
    newFindings,
    resolvedBaseline,
    staleExceptions,
    invalidExceptions,
    invalidBaselineFindings,
    duplicateBaselineKeys,
    duplicateExceptionKeys,
    outOfOrderBaseline,
  };
}

export function readBaseline(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (
    parsed.version !== 1 ||
    typeof parsed.sourceRevision !== "string" ||
    !/^[0-9a-f]{7,40}$/.test(parsed.sourceRevision) ||
    !parsed.inventory ||
    typeof parsed.inventory !== "object" ||
    Array.isArray(parsed.inventory) ||
    !Array.isArray(parsed.findings)
  ) {
    throw new Error(
      "UI consistency baseline must have version 1, a Git sourceRevision, an inventory object, and a findings array.",
    );
  }
  return parsed;
}

function printFindings(title, findings) {
  if (!findings.length) return;
  console.error(`\n${title}:`);
  for (const finding of findings) {
    console.error(`  ${finding.rule} · ${finding.path} · ${finding.excerpt}`);
  }
}

function runCli() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const baseline = readBaseline(
    path.join(repoRoot, "scripts/ui-consistency-baseline.json"),
  );
  const findings = scanRepository(repoRoot);
  const result = compareFindings(
    findings,
    baseline.findings,
    SEMANTIC_EXCEPTIONS,
  );

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          sourceRevision: baseline.sourceRevision,
          inventory: baseline.inventory,
          findings,
          exceptions: SEMANTIC_EXCEPTIONS,
          result,
        },
        null,
        2,
      ),
    );
  } else if (result.ok) {
    console.log(
      `✓ UI consistency baseline matches ${result.activeFindings.length} finding(s); ` +
        `${SEMANTIC_EXCEPTIONS.length} semantic exception(s)`,
    );
  } else {
    printFindings("New findings", result.newFindings);
    printFindings(
      "Resolved baseline entries that must be removed",
      result.resolvedBaseline,
    );
    printFindings("Stale semantic exceptions", result.staleExceptions);
    printFindings(
      "Semantic exceptions without valid reasons",
      result.invalidExceptions,
    );
    printFindings("Invalid baseline findings", result.invalidBaselineFindings);
    if (result.duplicateBaselineKeys.length) {
      console.error("\nDuplicate baseline keys:");
      for (const key of result.duplicateBaselineKeys) console.error(`  ${key}`);
    }
    if (result.duplicateExceptionKeys.length) {
      console.error("\nDuplicate semantic exception keys:");
      for (const key of result.duplicateExceptionKeys) console.error(`  ${key}`);
    }
    if (result.outOfOrderBaseline.length) {
      console.error("\nBaseline findings must be sorted by rule, path, and excerpt.");
    }
    process.exitCode = 1;
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) runCli();
