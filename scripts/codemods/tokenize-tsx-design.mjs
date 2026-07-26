import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import {
  formatClassCandidate,
  isRenderColorUtility,
  rawPxTextUtility,
  transformClassCandidates,
} from "../design-system/class-candidates.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const componentsRoot = realpathSync(path.join(repoRoot, "src", "components"));

export const TEXT_SIZE_TOKENS = new Map([
  ["9px", "--text-2xs"],
  ["9.5px", "--text-2xs"],
  ["10px", "--text-2xs"],
  ["10.5px", "--text-xs"],
  ["11px", "--text-xs"],
  ["11.5px", "--text-sm"],
  ["12px", "--text-sm"],
  ["12.5px", "--text-base"],
  ["13px", "--text-base"],
  ["14px", "--text-md"],
  ["15px", "--text-md"],
  ["16px", "--text-lg"],
  ["18px", "--text-xl"],
  ["20px", "--text-xl"],
  ["28px", "--text-display"],
]);

export const SPACE_TOKENS = new Map([
  ["4px", "--space-1"],
  ["8px", "--space-2"],
  ["12px", "--space-3"],
  ["16px", "--space-4"],
  ["20px", "--space-5"],
  ["24px", "--space-6"],
  ["32px", "--space-8"],
  ["40px", "--space-10"],
]);

export const RADIUS_TOKENS = new Map([
  ["8px", "--radius-control"],
  ["12px", "--radius-card"],
  ["16px", "--radius-panel"],
  ["999px", "--radius-pill"],
]);

const SPACING_STYLE_PROPS = new Set([
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingBlock",
  "paddingInline",
  "paddingBlockStart",
  "paddingBlockEnd",
  "paddingInlineStart",
  "paddingInlineEnd",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginBlock",
  "marginInline",
  "marginBlockStart",
  "marginBlockEnd",
  "marginInlineStart",
  "marginInlineEnd",
  "gap",
  "rowGap",
  "columnGap",
  "width",
  "minWidth",
  "maxWidth",
  "height",
  "minHeight",
  "maxHeight",
]);

const UNITLESS_STYLE_PROPS = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "fillOpacity",
  "floodOpacity",
  "flex",
  "flexGrow",
  "flexNegative",
  "flexOrder",
  "flexPositive",
  "flexShrink",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnSpan",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowSpan",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
  "MozAnimationIterationCount",
  "MozBoxFlex",
  "MozBoxFlexGroup",
  "MozLineClamp",
  "msAnimationIterationCount",
  "msFlex",
  "msZoom",
  "msFlexGrow",
  "msFlexNegative",
  "msFlexOrder",
  "msFlexPositive",
  "msFlexShrink",
  "msGridColumn",
  "msGridColumnSpan",
  "msGridRow",
  "msGridRowSpan",
  "WebkitAnimationIterationCount",
  "WebkitBoxFlex",
  "WebKitBoxFlexGroup",
  "WebkitBoxOrdinalGroup",
  "WebkitColumnCount",
  "WebkitColumns",
  "WebkitFlex",
  "WebkitFlexGrow",
  "WebkitFlexPositive",
  "WebkitFlexShrink",
  "WebkitLineClamp",
]);

const SHORTHAND_STYLE_PROPS = new Set([
  "animation",
  "background",
  "border",
  "borderBlock",
  "borderInline",
  "borderColor",
  "borderStyle",
  "borderWidth",
  "columns",
  "flex",
  "font",
  "grid",
  "inset",
  "listStyle",
  "margin",
  "outline",
  "overflow",
  "padding",
  "textDecoration",
  "transition",
]);

const TOKENIZABLE_SPACING_CLASS_RE =
  /^(min-w|max-w|min-h|max-h|space-[xy]|gap(?:-[xy])?|[pm][trblxy]?|w|h)-\[([0-9]+(?:\.[0-9]+)?)px\]$/;
const TOKENIZABLE_RADIUS_CLASS_RE = /^rounded-\[([0-9]+(?:\.[0-9]+)?)px\]$/;
const LEGACY_COLOR_REPLACEMENTS = [
  [
    /var\(--ok-soft,\s*rgba\([^)]*\)\)/gi,
    "color-mix(in_oklch,var(--color-success)_15%,transparent)",
  ],
  [
    /var\(--warn-soft,\s*rgba\([^)]*\)\)/gi,
    "color-mix(in_oklch,var(--color-warning)_15%,transparent)",
  ],
  [
    /var\(--danger-soft,\s*rgba\([^)]*\)\)/gi,
    "color-mix(in_oklch,var(--color-danger)_15%,transparent)",
  ],
  [/var\(--ok,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-success)"],
  [/var\(--warn,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-warning)"],
  [/var\(--danger,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-danger)"],
  [/var\(--accent-danger,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-danger)"],
  [/var\(--text-danger,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-danger)"],
  [/var\(--text-warning,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-warning)"],
  [/var\(--color-danger,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-danger)"],
  [/var\(--color-success,\s*#[0-9a-f]{3,8}\)/gi, "var(--color-success)"],
  [/var\(--border-strong,\s*#[0-9a-f]{3,8}\)/gi, "var(--border-strong)"],
  [/var\(--border,\s*#[0-9a-f]{3,8}\)/gi, "var(--border-hairline)"],
  [/#e5e7eb\b/gi, "var(--code-foreground)"],
  [/,#000\)/gi, ",var(--color-mix-dark))"],
];

function canonicalPx(raw) {
  return `${Number.parseFloat(raw)}px`;
}

function transformLegacyColors(source) {
  return LEGACY_COLOR_REPLACEMENTS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    source,
  );
}

function transformClassCandidate(candidate, parts) {
  const { utility } = parts;
  let transformed = utility;
  const text = rawPxTextUtility(utility);
  if (text) {
    const token = TEXT_SIZE_TOKENS.get(canonicalPx(text.px));
    if (token) transformed = `text-[length:var(${token})]${text.modifier}`;
  } else {
    const spacing = TOKENIZABLE_SPACING_CLASS_RE.exec(utility);
    if (spacing) {
      const token = SPACE_TOKENS.get(canonicalPx(spacing[2]));
      if (token) transformed = `${spacing[1]}-[var(${token})]`;
    } else {
      const radius = TOKENIZABLE_RADIUS_CLASS_RE.exec(utility);
      if (radius) {
        const token = RADIUS_TOKENS.get(canonicalPx(radius[1]));
        if (token) transformed = `rounded-[var(${token})]`;
      }
    }
  }

  if (isRenderColorUtility(transformed) && !/url\(/i.test(transformed)) {
    transformed = transformLegacyColors(transformed);
  }

  return formatClassCandidate(parts, transformed);
}

function transformClassValue(value) {
  return transformClassCandidates(value, transformClassCandidate);
}

function unwrapTsExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function collectClassStringNodes(node, output) {
  const current = unwrapTsExpression(node);
  if (!current) return;
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    output.push(current);
    return;
  }
  if (ts.isTemplateExpression(current)) {
    output.push(current.head);
    for (const span of current.templateSpans) {
      collectClassStringNodes(span.expression, output);
      output.push(span.literal);
    }
    return;
  }
  if (ts.isConditionalExpression(current)) {
    collectClassStringNodes(current.whenTrue, output);
    collectClassStringNodes(current.whenFalse, output);
    return;
  }
  if (ts.isCommaListExpression(current)) {
    collectClassStringNodes(current.elements.at(-1), output);
    return;
  }
  if (ts.isBinaryExpression(current)) {
    if (current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      collectClassStringNodes(current.right, output);
    } else if (current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collectClassStringNodes(current.left, output);
      collectClassStringNodes(current.right, output);
    } else if (
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      collectClassStringNodes(current.left, output);
      collectClassStringNodes(current.right, output);
    }
    return;
  }
  if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
    const expression = current.expression;
    const calleeName = ts.isIdentifier(expression)
      ? expression.text
      : ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : "";
    if (new Set(["cn", "clsx", "cx", "classNames", "twMerge", "cva"]).has(calleeName)) {
      for (const argument of current.arguments ?? []) collectClassStringNodes(argument, output);
    } else if (
      ts.isPropertyAccessExpression(expression) &&
      (calleeName === "filter" || calleeName === "join")
    ) {
      collectClassStringNodes(expression.expression, output);
    }
    return;
  }
  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements) collectClassStringNodes(element, output);
    return;
  }
  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (ts.isStringLiteral(property.name)) output.push(property.name);
      collectClassStringNodes(property.initializer, output);
    }
  }
}

function stringContentRange(node, sourceFile) {
  const start = node.getStart(sourceFile);
  if (node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle) {
    return { start: start + 1, end: node.end - 2 };
  }
  return { start: start + 1, end: node.end - 1 };
}

function transformDesignStrings(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits = [];

  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === "className" &&
      node.initializer
    ) {
      const strings = [];
      if (ts.isStringLiteral(node.initializer)) strings.push(node.initializer);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        collectClassStringNodes(node.initializer.expression, strings);
      }
      for (const string of strings) {
        const { start, end } = stringContentRange(string, sourceFile);
        const raw = source.slice(start, end);
        const transformed = transformClassValue(raw);
        if (transformed !== raw) edits.push({ start, end, text: transformed });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edits.length > 0 ? applyEdits(source, edits) : source;
}

function simplePropertyName(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (!ts.isComputedPropertyName(name)) return null;

  let expression = name.expression;
  while (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : null;
}

function staticStyleValue(initializer, property) {
  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer.text;
  }

  let sign = "";
  let numeric = initializer;
  if (ts.isPrefixUnaryExpression(initializer)) {
    if (
      initializer.operator !== ts.SyntaxKind.MinusToken &&
      initializer.operator !== ts.SyntaxKind.PlusToken
    ) {
      return null;
    }
    sign = initializer.operator === ts.SyntaxKind.MinusToken ? "-" : "";
    numeric = initializer.operand;
  }
  if (!ts.isNumericLiteral(numeric)) return null;

  const value = `${sign}${numeric.text}`;
  if (Number(value) === 0 || property.startsWith("--") || UNITLESS_STYLE_PROPS.has(property)) {
    return value;
  }
  return `${value}px`;
}

function replaceBarePx(value, table) {
  return value
    .split(/(\s+)/)
    .map((part) => {
      const match = /^([0-9]+(?:\.[0-9]+)?)px$/.exec(part);
      if (!match) return part;
      const token = table.get(canonicalPx(match[1]));
      return token ? `var(${token})` : part;
    })
    .join("");
}

function normalizeStyleValue(property, value) {
  if (property === "fontSize") {
    const match = /^([0-9]+(?:\.[0-9]+)?)px$/.exec(value);
    const token = match ? TEXT_SIZE_TOKENS.get(canonicalPx(match[1])) : null;
    return token ? `var(${token})` : value;
  }
  if (SPACING_STYLE_PROPS.has(property)) return replaceBarePx(value, SPACE_TOKENS);
  if (property === "borderRadius") return replaceBarePx(value, RADIUS_TOKENS);
  return value;
}

function cssPropertyName(property) {
  if (property.startsWith("--")) return property;
  const normalized = property.replace(/^WebKit/, "Webkit");
  const kebab = normalized.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (kebab.startsWith("webkit-")) return `-${kebab}`;
  if (kebab.startsWith("moz-")) return `-${kebab}`;
  if (kebab.startsWith("ms-")) return `-${kebab}`;
  return kebab;
}

function encodeArbitraryValue(value) {
  if (/["\]\n\r]/.test(value)) return null;
  return value.replace(/\\/g, "\\\\").replace(/_/g, "\\_").replace(/\s+/g, "_");
}

function staticStyleClasses(object, sourceFile) {
  if (object.properties.length === 0) return null;

  const entries = [];
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) return null;
    const property = simplePropertyName(member.name, sourceFile);
    if (!property) return null;
    const rawValue = staticStyleValue(member.initializer, property);
    if (rawValue === null) return null;
    entries.push({ property, rawValue });
  }

  if (
    entries.some(
      ({ property }) =>
        SHORTHAND_STYLE_PROPS.has(property) &&
        entries.some(
          ({ property: other }) => other !== property && other.startsWith(property),
        ),
    )
  ) {
    return null;
  }

  const classes = [];
  for (const { property, rawValue } of entries) {
    const value = encodeArbitraryValue(normalizeStyleValue(property, rawValue));
    if (value === null) return null;
    classes.push(`[${cssPropertyName(property)}:${value}]!`);
  }
  return classes.join(" ");
}

function removeAttributeRange(source, start, end) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  if (source.slice(lineStart, start).trim() === "") {
    const lineEnd = source.indexOf("\n", end);
    const afterAttribute = source.slice(end, lineEnd === -1 ? source.length : lineEnd);
    if (afterAttribute.trim() === "") {
      return { start: lineStart, end: lineEnd === -1 ? end : lineEnd + 1 };
    }
    if (/^\/?>$/.test(afterAttribute.trim())) {
      return { start: Math.max(0, lineStart - 1), end };
    }
    return { start, end };
  }

  let removeStart = start;
  while (removeStart > 0 && /[ \t]/.test(source[removeStart - 1])) removeStart -= 1;
  return { start: removeStart, end };
}

function applyEdits(source, edits) {
  return edits
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce(
      (result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

function convertStaticStyleObjects(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits = [];

  function visit(node) {
    if (
      !ts.isJsxAttribute(node) ||
      node.name.text !== "style" ||
      !node.initializer ||
      !ts.isJsxExpression(node.initializer) ||
      !node.initializer.expression ||
      !ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      ts.forEachChild(node, visit);
      return;
    }

    const classes = staticStyleClasses(node.initializer.expression, sourceFile);
    if (!classes || node.parent.properties.some((attribute) => ts.isJsxSpreadAttribute(attribute))) {
      ts.forEachChild(node, visit);
      return;
    }

    const className = node.parent.properties.find(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "className",
    );
    if (!className || !ts.isJsxAttribute(className)) {
      edits.push({
        start: node.getStart(sourceFile),
        end: node.end,
        text: `className="${classes}"`,
      });
      ts.forEachChild(node, visit);
      return;
    }

    const removal = removeAttributeRange(source, node.getStart(sourceFile), node.end);
    edits.push({ ...removal, text: "" });

    const initializer = className.initializer;
    if (initializer && ts.isStringLiteral(initializer)) {
      const literal = source.slice(initializer.getStart(sourceFile), initializer.end);
      const quote = literal[0];
      const raw = literal.slice(1, -1);
      const combined = `${raw}${raw.trim() ? " " : ""}${classes}`;
      const alternate = quote === "'" ? '"' : "'";
      const quoted =
        !combined.includes(quote)
          ? `${quote}${combined}${quote}`
          : !combined.includes(alternate)
            ? `${alternate}${combined}${alternate}`
            : `{${JSON.stringify(combined)}}`;
      edits.push({
        start: initializer.getStart(sourceFile),
        end: initializer.end,
        text: quoted,
      });
    } else if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
      const expression = initializer.expression.getText(sourceFile);
      edits.push({
        start: initializer.getStart(sourceFile),
        end: initializer.end,
        text: `{[(${expression}), ${JSON.stringify(classes)}].filter(Boolean).join(" ")}`,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edits.length > 0 ? applyEdits(source, edits) : source;
}

export function tokenizeTsxDesign(source, fileName = "component.tsx") {
  return transformDesignStrings(convertStaticStyleObjects(source, fileName), fileName);
}

export function tsxFilesInScope() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        files.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(repoRoot, "src", "components"));
  return files.sort();
}

export function resolveTsxTarget(requestedPath) {
  const resolved = path.resolve(repoRoot, requestedPath);
  if (path.extname(resolved).toLowerCase() !== ".tsx") {
    throw new Error(`TSX codemod targets must end in .tsx: ${requestedPath}`);
  }
  const realTarget = realpathSync(resolved);
  const relative = path.relative(componentsRoot, realTarget);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`TSX codemod target must stay inside src/components: ${requestedPath}`);
  }
  return realTarget;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const requestedFiles = args.filter((arg) => arg !== "--check");
  const targets = requestedFiles.length > 0 ? requestedFiles : tsxFilesInScope();
  let changed = 0;

  for (const relativePath of targets) {
    const fullPath = resolveTsxTarget(relativePath);
    const before = readFileSync(fullPath, "utf8");
    const after = tokenizeTsxDesign(before, relativePath);
    if (after === before) continue;
    changed += 1;
    if (check) console.error(`[tokenize-tsx-design] drift: ${relativePath}`);
    else {
      writeFileSync(fullPath, after);
      console.log(`[tokenize-tsx-design] rewrote ${relativePath}`);
    }
  }

  if (check && changed > 0) {
    console.error(
      `[tokenize-tsx-design] ${changed} file(s) carry mechanical design drift — run: node scripts/codemods/tokenize-tsx-design.mjs`,
    );
    process.exit(1);
  }
  console.log(
    `[tokenize-tsx-design] ${check ? "checked" : "done"} — ${changed} file(s) ${check ? "with drift" : "rewritten"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
