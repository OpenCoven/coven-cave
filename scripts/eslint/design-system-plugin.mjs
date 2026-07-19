import {
  firstRawPxTextCandidate,
  firstRenderHexColor,
  stripUrlPayloads,
} from "../design-system/class-candidates.mjs";

const HEX_COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i;
const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "classNames", "twMerge", "cva"]);
const RENDER_STYLE_ATTRIBUTES = new Set([
  "className",
  "style",
  "color",
  "fill",
  "stroke",
  "stopColor",
  "floodColor",
  "background",
  "bgColor",
  "borderColor",
]);

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    [
      "ChainExpression",
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
    ].includes(current.type)
  ) {
    current = current.expression;
  }
  return current;
}

function constInitializer(identifier, sourceCode, seen) {
  if (!identifier || identifier.type !== "Identifier") return null;
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      if (seen.has(variable)) return null;
      const definition = variable.defs.find(
        (candidate) =>
          candidate.type === "Variable" &&
          candidate.parent?.kind === "const" &&
          candidate.node?.id?.type === "Identifier" &&
          candidate.node?.init,
      );
      if (!definition) return null;
      seen.add(variable);
      return definition.node.init;
    }
    scope = scope.upper;
  }
  return null;
}

function resolveExpression(node, sourceCode, seen) {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type === "Identifier") {
    const initializer = constInitializer(unwrapped, sourceCode, seen);
    return initializer ? resolveExpression(initializer, sourceCode, seen) : unwrapped;
  }
  if (unwrapped?.type === "MemberExpression") {
    const selected = selectedMemberValue(unwrapped, sourceCode, seen);
    return selected ? resolveExpression(selected, sourceCode, seen) : unwrapped;
  }
  return unwrapped;
}

function isStaticStyleValue(node, sourceCode, seen) {
  const resolved = resolveExpression(node, sourceCode, seen);
  if (!resolved) return false;
  if (resolved.type === "Literal") {
    return (
      typeof resolved.value === "string" ||
      typeof resolved.value === "number" ||
      typeof resolved.value === "boolean" ||
      resolved.value === null
    );
  }
  if (resolved.type === "TemplateLiteral") {
    return resolved.expressions.every((expression) =>
      isStaticStyleValue(expression, sourceCode, seen),
    );
  }
  return (
    resolved.type === "UnaryExpression" &&
    (resolved.operator === "+" || resolved.operator === "-") &&
    resolved.argument.type === "Literal" &&
    typeof resolved.argument.value === "number"
  );
}

function resolveObjectExpression(node, sourceCode, seen) {
  const resolved = resolveExpression(node, sourceCode, seen);
  return resolved?.type === "ObjectExpression" ? resolved : null;
}

function isFullyStaticStyleObject(node, sourceCode) {
  const object = resolveObjectExpression(node, sourceCode, new Set());
  return (
    object &&
    object.properties.length > 0 &&
    object.properties.every(
      (property) =>
        property.type === "Property" &&
        property.kind === "init" &&
        !property.method &&
        isStaticStyleValue(property.value, sourceCode, new Set()),
    )
  );
}

function jsxAttributeName(attribute) {
  return attribute.name.type === "JSXIdentifier" ? attribute.name.name : null;
}

function attributeExpression(attribute) {
  if (!attribute.value) return null;
  if (attribute.value.type === "JSXExpressionContainer") return attribute.value.expression;
  return attribute.value;
}

function stringMatch(value, inspect) {
  if (typeof value !== "string") return null;
  return inspect(value);
}

function staticMemberKey(member, sourceCode, seen) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  const property = resolveExpression(member.property, sourceCode, seen);
  if (property?.type !== "Literal") return null;
  return typeof property.value === "string" || typeof property.value === "number"
    ? String(property.value)
    : null;
}

function selectedMemberValue(member, sourceCode, seen) {
  const key = staticMemberKey(member, sourceCode, seen);
  if (key === null) return null;
  const object = resolveExpression(member.object, sourceCode, seen);
  if (object?.type === "ArrayExpression" && /^\d+$/.test(key)) {
    return object.elements[Number(key)] ?? null;
  }
  if (object?.type !== "ObjectExpression") return null;
  for (const property of object.properties) {
    if (property.type !== "Property") continue;
    const propertyKey =
      property.key.type === "Identifier" && !property.computed
        ? property.key.name
        : property.key.type === "Literal"
          ? String(property.key.value)
          : null;
    if (propertyKey === key) return property.value;
  }
  return null;
}

function callName(call) {
  if (call.callee.type === "Identifier") return call.callee.name;
  if (call.callee.type === "MemberExpression" && call.callee.property.type === "Identifier") {
    return call.callee.property.name;
  }
  return "";
}

function firstStringFinding(
  node,
  inspect,
  sourceCode,
  mode,
  seen = new Set(),
) {
  const resolved = resolveExpression(node, sourceCode, seen);
  if (!resolved) return null;

  if (resolved.type === "Literal") return stringMatch(resolved.value, inspect);
  if (resolved.type === "TemplateElement") return stringMatch(resolved.value.raw, inspect);
  if (resolved.type === "TemplateLiteral") {
    for (const quasi of resolved.quasis) {
      const match = stringMatch(quasi.value.raw, inspect);
      if (match) return match;
    }
    for (const expression of resolved.expressions) {
      const match = firstStringFinding(
        expression,
        inspect,
        sourceCode,
        mode,
        new Set(seen),
      );
      if (match) return match;
    }
    return null;
  }

  const children = [];
  switch (resolved.type) {
    case "ArrayExpression":
      children.push(...resolved.elements.filter(Boolean));
      break;
    case "ObjectExpression":
      for (const property of resolved.properties) {
        if (property.type === "Property" && mode === "className") {
          if (property.key.type === "Literal") {
            const match = stringMatch(property.key.value, inspect);
            if (match) return match;
          }
        } else if (property.type === "Property") children.push(property.value);
        else if (property.type === "SpreadElement") children.push(property.argument);
      }
      break;
    case "ConditionalExpression":
      children.push(resolved.consequent, resolved.alternate);
      break;
    case "SequenceExpression":
      if (resolved.expressions.length > 0) children.push(resolved.expressions.at(-1));
      break;
    case "LogicalExpression":
      children.push(resolved.left, resolved.right);
      break;
    case "BinaryExpression":
      if (resolved.operator === "+") children.push(resolved.left, resolved.right);
      break;
    case "CallExpression":
    case "NewExpression":
      if (mode !== "className" || CLASS_HELPERS.has(callName(resolved))) {
        children.push(...resolved.arguments.filter((argument) => argument.type !== "SpreadElement"));
      } else if (
        resolved.callee.type === "MemberExpression" &&
        ["filter", "join"].includes(callName(resolved))
      ) {
        children.push(resolved.callee.object);
      }
      break;
    case "MemberExpression":
      {
        const selected = selectedMemberValue(resolved, sourceCode, seen);
        if (selected) children.push(selected);
      }
      break;
    case "TaggedTemplateExpression":
      children.push(resolved.quasi);
      break;
    case "UnaryExpression":
      children.push(resolved.argument);
      break;
    default:
      return null;
  }

  for (const child of children) {
    const match = firstStringFinding(child, inspect, sourceCode, mode, new Set(seen));
    if (match) return match;
  }
  return null;
}

const noRawPxText = {
  meta: {
    type: "problem",
    docs: {
      description: "Require the Cave type scale instead of raw pixel Tailwind text utilities.",
    },
    schema: [],
    messages: {
      rawText:
        "Use the Cave type scale instead of '{{value}}'; run `pnpm codemod:design`.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      JSXAttribute(node) {
        if (jsxAttributeName(node) !== "className") return;
        const match = firstStringFinding(
          attributeExpression(node),
          firstRawPxTextCandidate,
          sourceCode,
          "className",
        );
        if (match) context.report({ node, messageId: "rawText", data: { value: match } });
      },
    };
  },
};

const noStaticInlineStyle = {
  meta: {
    type: "problem",
    docs: {
      description: "Reserve JSX style objects for values derived at runtime.",
    },
    schema: [],
    messages: {
      staticStyle:
        "Static JSX styles belong in utility classes; keep `style={{}}` only for runtime-derived values.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      JSXAttribute(node) {
        if (
          jsxAttributeName(node) !== "style" ||
          !isFullyStaticStyleObject(attributeExpression(node), sourceCode)
        ) {
          return;
        }
        context.report({ node, messageId: "staticStyle" });
      },
    };
  },
};

const noRenderHexColor = {
  meta: {
    type: "problem",
    docs: {
      description: "Require semantic color tokens in JSX render styling.",
    },
    schema: [],
    messages: {
      hexColor: "Use a semantic color token instead of render color '{{value}}'.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      JSXAttribute(node) {
        const name = jsxAttributeName(node);
        if (!name || !RENDER_STYLE_ATTRIBUTES.has(name)) return;
        const inspect =
          name === "className"
            ? firstRenderHexColor
            : (value) => {
                if (typeof value !== "string") return null;
                const match = HEX_COLOR_RE.exec(stripUrlPayloads(value));
                return match?.[0] ?? null;
              };
        const match = firstStringFinding(
          attributeExpression(node),
          inspect,
          sourceCode,
          name === "className" ? "className" : "style",
        );
        if (match) {
          context.report({ node, messageId: "hexColor", data: { value: match } });
        }
      },
    };
  },
};

export const rules = {
  "no-raw-px-text": noRawPxText,
  "no-static-inline-style": noStaticInlineStyle,
  "no-render-hex-color": noRenderHexColor,
};

export default { rules };
