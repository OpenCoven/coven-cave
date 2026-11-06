import ts from "typescript";

export type NetworkCall = { transport: "fetch" | "upstream" | "node-http"; argument: string; internal: boolean };

/** Source-level inventory, independent of whether a URL's host is inline. */
export function networkCalls(source: string, file = "source.ts"): NetworkCall[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fetches = new Set(["fetch", "fetchImpl", "fetchFn", "fetcher"]);
  const upstreams = new Set(["upstreamFetch"]);
  const nodeFunctions = new Set<string>();
  const nodeNamespaces = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (/^(node:)?https?$/.test(specifier)) {
      if (statement.importClause?.name) nodeNamespaces.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) nodeNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (["get", "request"].includes((element.propertyName ?? element.name).text)) nodeFunctions.add(element.name.text);
        }
      }
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported === "upstreamFetch" && /upstream-fetch/.test(specifier)) upstreams.add(element.name.text);
        if (imported === "fetch" && ["undici", "node-fetch"].includes(specifier)) fetches.add(element.name.text);
      }
    }
    if (specifier === "node-fetch" && statement.importClause?.name) fetches.add(statement.importClause.name.text);
  }
  const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const kind = (expression: ts.Expression): NetworkCall["transport"] | null => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      if (upstreams.has(node.text)) return "upstream";
      if (nodeFunctions.has(node.text)) return "node-http";
      if (fetches.has(node.text)) return "fetch";
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (["globalThis", "window", "self"].includes(node.expression.text) && node.name.text === "fetch") return "fetch";
      if (nodeNamespaces.has(node.expression.text) && ["get", "request"].includes(node.name.text)) return "node-http";
    }
    return null;
  };
  // Follow simple aliases so renaming an imported transport cannot hide a caller.
  let changed = true;
  while (changed) {
    changed = false;
    const aliases = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const transport = kind(node.initializer);
        const names = transport === "upstream" ? upstreams : transport === "node-http" ? nodeFunctions : fetches;
        if (transport && !names.has(node.name.text)) { names.add(node.name.text); changed = true; }
      }
      ts.forEachChild(node, aliases);
    };
    aliases(ast);
  }
  const result: NetworkCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const transport = kind(node.expression);
      if (transport) {
        const argument = node.arguments[transport === "upstream" ? 1 : 0];
        const internal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) || ts.isTemplateExpression(argument))
          ? /^\/(?!\/)/.test(ts.isTemplateExpression(argument) ? argument.head.text : argument.text)
          : false;
        result.push({ transport, argument: argument?.getText(ast).replace(/\s+/g, " ") ?? "<missing>", internal });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}
