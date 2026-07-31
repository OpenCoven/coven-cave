import YAML from "yaml";

const ALLOWED_STRING_TYPES = new Set(["PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE"]);
const MAX_SEMANTIC_TRAVERSAL_VISITS = 4096;

export function readCanonicalYamlStringSetting(source, canonicalPathSegments, sourceLabel) {
  return locateCanonicalYamlStringSetting(source, canonicalPathSegments, sourceLabel).valueNode
    .value;
}

export function replaceCanonicalYamlStringSetting(
  source,
  canonicalPathSegments,
  nextValue,
  sourceLabel,
) {
  if (typeof nextValue !== "string") {
    throw new Error(`${sourceLabel} replacement value must be a string`);
  }

  const { valueNode } = locateCanonicalYamlStringSetting(
    source,
    canonicalPathSegments,
    sourceLabel,
  );
  const [start, end] = valueNode.range ?? [];

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(
      `${sourceLabel} could not locate the source range for ${formatPathSegments(canonicalPathSegments)}`,
    );
  }

  const replacement = serializeStringScalar(nextValue, valueNode);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function locateCanonicalYamlStringSetting(source, canonicalPathSegments, sourceLabel) {
  if (
    !Array.isArray(canonicalPathSegments) ||
    canonicalPathSegments.length === 0 ||
    canonicalPathSegments.some((segment) => typeof segment !== "string")
  ) {
    throw new Error(`${sourceLabel} canonical YAML path must contain string segments`);
  }

  const document = YAML.parseDocument(source, { prettyErrors: true });

  if (document.errors.length > 0) {
    throw new Error(
      `${sourceLabel} release validation could not parse YAML: ${document.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  const targetKey = canonicalPathSegments.at(-1);
  const traversalBudget = { visits: 0 };
  const occurrences = collectSettingOccurrences(
    document,
    document.contents,
    targetKey,
    sourceLabel,
    [],
    [],
    [],
    traversalBudget,
  );

  if (
    occurrences.length !== 1 ||
    !samePathSegments(occurrences[0].path, canonicalPathSegments)
  ) {
    const detail =
      occurrences.length === 0
        ? "was not found"
        : `was also found at ${occurrences
            .map((occurrence) => formatPathSegments(occurrence.path))
            .join(", ")}`;
    throw new Error(
      `${sourceLabel} must define ${targetKey} exactly once at ${formatPathSegments(canonicalPathSegments)}; ${detail}`,
    );
  }

  const { rawValueNode } = occurrences[0];

  if (rawValueNode instanceof YAML.Alias) {
    throw new Error(
      `${sourceLabel} must use a direct string scalar, not an alias, at ${formatPathSegments(canonicalPathSegments)}`,
    );
  }

  const valueNode = rawValueNode;

  if (!YAML.isScalar(valueNode) || typeof valueNode.value !== "string") {
    throw new Error(
      `${sourceLabel} must use a string scalar at ${formatPathSegments(canonicalPathSegments)}`,
    );
  }

  if (!ALLOWED_STRING_TYPES.has(valueNode.type)) {
    throw new Error(
      `${sourceLabel} must use a single-line plain or quoted string scalar at ${formatPathSegments(canonicalPathSegments)} (found ${valueNode.type})`,
    );
  }

  const [start, end] = valueNode.range ?? [];
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(
      `${sourceLabel} could not locate the source range for ${formatPathSegments(canonicalPathSegments)}`,
    );
  }

  if (/[\r\n]/.test(source.slice(start, end))) {
    throw new Error(
      `${sourceLabel} must use a direct single-line string scalar at ${formatPathSegments(canonicalPathSegments)}`,
    );
  }

  return { document, valueNode };
}

function collectSettingOccurrences(
  document,
  node,
  targetKey,
  sourceLabel,
  path = [],
  occurrences = [],
  recursionStack = [],
  traversalBudget,
) {
  if (occurrences.length >= 2) {
    return occurrences;
  }

  const resolvedNode = resolveSettingNode(
    document,
    node,
    sourceLabel,
    path,
    recursionStack,
    traversalBudget,
  );

  if (recursionStack.includes(resolvedNode)) {
    throw new Error(
      `${sourceLabel} release validation found cyclic YAML alias at ${formatPathSegments(path)}`,
    );
  }

  if (YAML.isMap(resolvedNode)) {
    const nextStack = [...recursionStack, resolvedNode];

    for (const pair of resolvedNode.items) {
      const keyNode = pair.key;
      if (!YAML.isScalar(keyNode) || typeof keyNode.value !== "string") {
        throw new Error(
          `${sourceLabel} release validation requires string mapping keys; found ${describeOpaqueMappingKey(keyNode)} at ${formatPathSegments(path)}`,
        );
      }

      const nextPath = [...path, keyNode.value];

      if (keyNode.value === targetKey) {
        occurrences.push({ path: nextPath, rawValueNode: pair.value });
        if (occurrences.length >= 2) {
          return occurrences;
        }
      }

      collectSettingOccurrences(
        document,
        pair.value,
        targetKey,
        sourceLabel,
        nextPath,
        occurrences,
        nextStack,
        traversalBudget,
      );

      if (occurrences.length >= 2) {
        return occurrences;
      }
    }
  } else if (YAML.isSeq(resolvedNode)) {
    const nextStack = [...recursionStack, resolvedNode];

    for (const [index, item] of resolvedNode.items.entries()) {
      const nextPath = [...path, String(index)];
      collectSettingOccurrences(
        document,
        item,
        targetKey,
        sourceLabel,
        nextPath,
        occurrences,
        nextStack,
        traversalBudget,
      );

      if (occurrences.length >= 2) {
        return occurrences;
      }
    }
  }

  return occurrences;
}

function resolveSettingNode(
  document,
  node,
  sourceLabel,
  path,
  recursionStack,
  traversalBudget,
) {
  let currentNode = node;
  const aliasStack = new Set();

  consumeTraversalBudget(traversalBudget, sourceLabel, path);

  while (currentNode instanceof YAML.Alias) {
    if (aliasStack.has(currentNode)) {
      throw new Error(
        `${sourceLabel} release validation found cyclic YAML alias *${currentNode.source ?? "?"} at ${formatPathSegments(path)}`,
      );
    }

    aliasStack.add(currentNode);

    const resolvedNode = currentNode.resolve(document);

    if (!resolvedNode) {
      throw new Error(
        `${sourceLabel} release validation could not resolve YAML alias *${currentNode.source ?? "?"} at ${formatPathSegments(path)}`,
      );
    }

    if (recursionStack.includes(resolvedNode)) {
      throw new Error(
        `${sourceLabel} release validation found cyclic YAML alias *${currentNode.source ?? "?"} at ${formatPathSegments(path)}`,
      );
    }

    consumeTraversalBudget(traversalBudget, sourceLabel, path);
    currentNode = resolvedNode;
  }

  return currentNode;
}

function consumeTraversalBudget(traversalBudget, sourceLabel, path) {
  traversalBudget.visits += 1;
  if (traversalBudget.visits > MAX_SEMANTIC_TRAVERSAL_VISITS) {
    throw new Error(
      `${sourceLabel} release validation exceeded the YAML alias/document traversal budget of ${MAX_SEMANTIC_TRAVERSAL_VISITS} visits at ${formatPathSegments(path)}; the document is too complex`,
    );
  }
}

function serializeStringScalar(value, valueNode) {
  const defaultStringType =
    valueNode.type === "QUOTE_DOUBLE" ||
    valueNode.type === "QUOTE_SINGLE" ||
    valueNode.type === "PLAIN"
      ? valueNode.type
      : undefined;

  return YAML.stringify(value, {
    defaultStringType,
    lineWidth: 0,
  }).trimEnd();
}

function samePathSegments(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function formatPathSegments(path) {
  return JSON.stringify(path);
}

function describeOpaqueMappingKey(keyNode) {
  if (keyNode?.constructor?.name === "Alias") {
    return "alias mapping key";
  }

  if (YAML.isSeq(keyNode)) {
    return "sequence mapping key";
  }

  if (YAML.isMap(keyNode)) {
    return "mapping mapping key";
  }

  return "non-string mapping key";
}
