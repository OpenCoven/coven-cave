import path from "node:path";

export const LIVE_SOURCE_ROOTS = Object.freeze([
  {
    directory: "src/components",
    extensions: [".tsx"],
    exclude: [],
  },
  {
    directory: "src/app",
    extensions: [".tsx"],
    exclude: ["src/app/mockup"],
  },
  {
    directory: "apps/ios/CovenCave/CovenCave",
    extensions: [".swift"],
    exclude: [],
  },
  {
    directory: "src-tauri/src",
    extensions: [".rs"],
    exclude: [],
  },
]);

export const TSX_COPY_PROP_NAMES = Object.freeze([
  "aria-label",
  "cancelLabel",
  "confirmLabel",
  "description",
  "headline",
  "label",
  "placeholder",
  "subtitle",
  "title",
]);

function quotedLiterals(line) {
  const values = [];
  for (const expression of [
    /"((?:\\.|[^"\\])*)"/g,
    /'((?:\\.|[^'\\])*)'/g,
    /`((?:\\.|[^`\\])*)`/g,
  ]) {
    for (const match of line.matchAll(expression)) values.push(match[1]);
  }
  return values;
}

function capturedLiterals(line, expression) {
  return [...line.matchAll(expression)].map((match) => match[1]);
}

function swiftUiLiterals(line) {
  return capturedLiterals(
    line,
    /\b(?:Text|Button|Label|TextField|SecureField|ContentUnavailableView|navigationTitle|alert|confirmationDialog|accessibilityLabel)\s*\(\s*"((?:\\.|[^"\\])*)"/g,
  );
}

function swiftSourceLiterals(line) {
  if (/^\s*\/\//.test(line)) return [];
  const withoutDiagnostics = line.replace(
    /\b(?:print|debugPrint|NSLog|os_log|logger(?:\.\w+)+)\s*\([^)]*\)/g,
    "",
  );
  return quotedLiterals(withoutDiagnostics);
}

function rustUiLiterals(line) {
  const direct = capturedLiterals(
    line,
    /(?:\.title|set_title)\s*\(\s*"((?:\\.|[^"\\])*)"/g,
  );
  const scripts = quotedLiterals(line).filter((value) =>
    /^display (?:alert|dialog)\b/.test(value),
  );
  return [...direct, ...scripts];
}

function hasAsciiEllipsis({ extension, line }) {
  if (!line.includes("...")) return false;
  if (extension === ".swift") {
    return [...swiftUiLiterals(line), ...swiftSourceLiterals(line)].some(
      (value) => value.includes("..."),
    );
  }
  if (extension === ".rs") {
    return rustUiLiterals(line).some((value) => value.includes("..."));
  }
  return false;
}

function isGenericSubmit({ extension, line }) {
  if (extension === ".swift") {
    return capturedLiterals(
      line,
      /\bButton\s*\(\s*"((?:\\.|[^"\\])*)"/g,
    ).some((value) => value.trim() === "Submit");
  }
  return false;
}

function isNativeSelect({ extension, line }) {
  return false;
}

export const ACTIVE_RULES = Object.freeze([
  {
    id: "components/no-native-select",
    matches: isNativeSelect,
  },
  {
    id: "copy/no-ascii-ellipsis",
    matches: hasAsciiEllipsis,
  },
  {
    id: "copy/no-generic-submit",
    matches: isGenericSubmit,
  },
]);

export const FUTURE_RULE_IDS = Object.freeze([
  "copy/tasks-terminology",
  "fields/no-placeholder-only-label",
  "states/no-convincing-empty-on-error",
]);

export const SEMANTIC_EXCEPTIONS = Object.freeze([
  {
    rule: "components/no-native-select",
    path: "src/components/role-surfaces/chart-room-parts.tsx",
    excerpt:
      '<select className="focus-ring" value={value} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} >',
    reason:
      "Chart Room intentionally overlays a native select beneath its painted compact label so platform picker and keyboard semantics remain intact.",
  },
]);

export function isExcludedSource(relativePath, sourceRoot) {
  const normalized = relativePath.split(path.sep).join("/");
  if (/\.(?:test|spec|stories)\.[^.]+$/.test(normalized)) return true;
  return sourceRoot.exclude.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}
