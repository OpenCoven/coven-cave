import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  CLIENT_V1_HPKE_AUTHORITY_MODES,
  CLIENT_V1_HPKE_FRESHNESS,
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  CLIENT_V1_HPKE_SUITE,
  type ClientV1AuthorityMode,
  type ClientV1HpkeAuthority,
  type ClientV1OperationBinding,
  type ClientV1OperationCredential,
} from "./authority-contract.ts";

const authorityContractSource = readFileSync(
  new URL("./authority-contract.ts", import.meta.url),
  "utf8",
);

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  return (
    clause.name === undefined
    && clause.namedBindings !== undefined
    && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((specifier) => specifier.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) {
    return true;
  }
  return (
    node.exportClause !== undefined
    && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0
    && node.exportClause.elements.every((specifier) => specifier.isTypeOnly)
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
  );
}

function pureNumericExpression(node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node)) {
    return true;
  }
  if (
    ts.isParenthesizedExpression(node)
    || (ts.isAsExpression(node) && ts.isConstTypeReference(node.type))
  ) {
    return pureNumericExpression(node.expression);
  }
  if (
    ts.isPrefixUnaryExpression(node)
    && (
      node.operator === ts.SyntaxKind.PlusToken
      || node.operator === ts.SyntaxKind.MinusToken
    )
  ) {
    return pureNumericExpression(node.operand);
  }
  return (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
    && pureNumericExpression(node.left)
    && pureNumericExpression(node.right)
  );
}

function pureInitializerViolation(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return pureInitializerViolation(node.expression, sourceFile);
  }
  if (ts.isAsExpression(node)) {
    if (!ts.isConstTypeReference(node.type)) {
      return `only 'as const' assertions are approved: ${node.getText(sourceFile)}`;
    }
    return pureInitializerViolation(node.expression, sourceFile);
  }
  if (
    ts.isStringLiteralLike(node)
    || ts.isNumericLiteral(node)
    || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return undefined;
  }
  if (pureNumericExpression(node)) {
    return undefined;
  }
  if (
    ts.isCallExpression(node)
    && node.questionDotToken === undefined
    && node.typeArguments === undefined
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.questionDotToken === undefined
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "Object"
    && node.expression.name.text === "freeze"
    && node.arguments.length === 1
  ) {
    const argument = node.arguments[0];
    if (
      argument !== undefined
      && ts.isAsExpression(argument)
      && ts.isConstTypeReference(argument.type)
      && (
        ts.isObjectLiteralExpression(argument.expression)
        || ts.isArrayLiteralExpression(argument.expression)
      )
    ) {
      const aggregate = argument.expression;
      const expressions = ts.isObjectLiteralExpression(aggregate)
        ? aggregate.properties.map((property) => {
            if (
              !ts.isPropertyAssignment(property)
              || ts.isComputedPropertyName(property.name)
            ) {
              return `frozen objects may contain only static property assignments: ${property.getText(sourceFile)}`;
            }
            return pureInitializerViolation(property.initializer, sourceFile);
          })
        : aggregate.elements.map((element) => {
            if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
              return `frozen arrays may contain only static elements: ${element.getText(sourceFile)}`;
            }
            return pureInitializerViolation(element, sourceFile);
          });
      return expressions.find((violation) => violation !== undefined);
    }
  }
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
    return `exported aggregates must use the approved Object.freeze(... as const) construction: ${node.getText(sourceFile)}`;
  }
  return `unapproved runtime expression: ${node.getText(sourceFile)}`;
}

function authorityPurityViolations(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "authority-contract-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!isTypeOnlyImport(statement)) {
        violations.push(`runtime import: ${statement.getText(sourceFile)}`);
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly) {
        violations.push(`runtime import-equals: ${statement.getText(sourceFile)}`);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (!isTypeOnlyExport(statement)) {
        violations.push(`runtime export declaration: ${statement.getText(sourceFile)}`);
      }
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
      || ts.isEmptyStatement(statement)
    ) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0
        || statement.declarationList.declarations.length === 0
      ) {
        violations.push(`only const declarations are approved: ${statement.getText(sourceFile)}`);
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          violations.push(`destructuring declarations are not approved: ${declaration.getText(sourceFile)}`);
          continue;
        }
        if (declaration.name.text === "Object") {
          violations.push("the approved Object.freeze global must not be shadowed");
          continue;
        }
        if (declaration.initializer === undefined) {
          violations.push(`runtime const declarations require a pure initializer: ${declaration.getText(sourceFile)}`);
          continue;
        }
        const violation = pureInitializerViolation(
          declaration.initializer,
          sourceFile,
        );
        if (violation !== undefined) {
          violations.push(violation);
        }
      }
      continue;
    }
    violations.push(`unapproved top-level statement: ${statement.getText(sourceFile)}`);
  }
  return violations;
}

function assertPureAuthorityContract(source: string): void {
  assert.deepEqual(
    authorityPurityViolations(source),
    [],
    "pure authority contract may use only type-only imports/exports; runtime imports and export-from declarations are forbidden; exported initializers must be static literals or approved Object.freeze(... as const) constructions",
  );
}

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type ClientV1AuthorityModeIsExact = Assert<
  Equal<ClientV1AuthorityMode, "off" | "advertise" | "enforce">
>;
export type ClientV1OperationCredentialIsExact = Assert<
  Equal<ClientV1OperationCredential, "none" | "pairing-secret" | "bearer" | "admin">
>;
export type ClientV1OperationBindingIsExact = Assert<
  Equal<ClientV1OperationBinding, "none" | "hpke-bound-v1">
>;
export type ClientV1HpkeAuthorityIsExact = Assert<
  Equal<
    ClientV1HpkeAuthority,
    {
      mechanism: "hpke-bound-v1";
      mode: "advertise" | "enforce";
      keyId: string;
      publicKey: string;
      suite: {
        kemId: 32;
        kdfId: 1;
        aeadId: 2;
      };
    }
  >
>;

test("pins the Client v1 HPKE authority mechanism and modes", () => {
  assert.equal(CLIENT_V1_HPKE_MECHANISM, "hpke-bound-v1");
  assert.deepEqual(CLIENT_V1_HPKE_AUTHORITY_MODES, [
    "off",
    "advertise",
    "enforce",
  ]);
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_AUTHORITY_MODES), true);
});

test("pins the RFC 9180 suite identifiers", () => {
  assert.deepEqual(CLIENT_V1_HPKE_SUITE, {
    kem: "DHKEM(X25519, HKDF-SHA256)",
    kemId: 32,
    kdf: "HKDF-SHA256",
    kdfId: 1,
    aead: "AES-256-GCM",
    aeadId: 2,
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_SUITE), true);
});

test("pins the exact bound-authority request headers and response media type", () => {
  assert.deepEqual(CLIENT_V1_HPKE_HEADERS, {
    mechanism: "x-coven-client-v1-authority",
    keyId: "x-coven-client-v1-authority-key-id",
    instanceId: "x-coven-client-v1-authority-instance",
    runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
    requestNonce: "x-coven-client-v1-authority-request-nonce",
    issuedAt: "x-coven-client-v1-authority-issued-at",
    enc: "x-coven-client-v1-authority-enc",
    ciphertext: "x-coven-client-v1-authority-ciphertext",
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_HEADERS), true);
  assert.equal(
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    "application/vnd.opencoven.client-v1.hpke-bound-v1+json",
  );
});

test("pins the authority wire limits and replay freshness bounds", () => {
  assert.deepEqual(CLIENT_V1_HPKE_LIMITS, {
    rawKeyBytes: 32,
    encodedKeyCharacters: 43,
    requestPlaintextBytes: 1024,
    requestCiphertextBytes: 2048,
    requestBodyBytes: 65536,
    responsePlaintextBytes: 8 * 1024 * 1024,
    responseCiphertextBytes: (8 * 1024 * 1024) + 16,
    responseEnvelopeBytes: 11_185_056,
    canonicalRouteBytes: 2048,
    instanceIdBytes: 256,
  });
  assert.deepEqual(CLIENT_V1_HPKE_FRESHNESS, {
    maximumAgeMs: 60_000,
    maximumFutureSkewMs: 10_000,
    replayTtlMs: 120_000,
    replayCapacity: 4_096,
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_LIMITS), true);
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_FRESHNESS), true);
});

test("keeps the authority contract pure, edge-safe, and public-key-only", () => {
  assertPureAuthorityContract(authorityContractSource);
  assert.doesNotMatch(authorityContractSource, /@hpke/u);
  assert.doesNotMatch(authorityContractSource, /node:/u);
  assert.doesNotMatch(authorityContractSource, /\bBuffer\b/u);
  assert.doesNotMatch(authorityContractSource, /\bCryptoKey(?:Pair)?\b/u);
  assert.doesNotMatch(
    authorityContractSource,
    /\b(?:privateKey|private_key|secretKey|secret_key|senderKey|sender_key)\b/u,
  );
  assert.doesNotMatch(
    authorityContractSource,
    /\b(?:process|globalThis|console|fetch|setTimeout|setInterval|Date|performance)\b/u,
  );

});

test("permits type-only module edges and approved static exports", () => {
  assert.doesNotThrow(() => {
    assertPureAuthorityContract(`
      import type { RuntimeShape } from "./runtime.ts";
      import { type RuntimeMetadata } from "./metadata.ts";
      export type { RuntimeShape };
      export { type RemoteShape } from "./remote.ts";
      export type * from "./types.ts";
      export type AuthorityShape = RuntimeShape;
      const example = "import './runtime.ts'";
      export const mode = "off" as const;
      export const modes = Object.freeze(["off", "enforce"] as const);
      export const settings = Object.freeze({
        mode: "off",
        maximumBytes: 8 * 1024 * 1024,
      } as const);
      export interface AuthorityMetadata extends RuntimeMetadata {}
    `);
  });
});

test("rejects runtime module edges", () => {
  const mutations = [
    "import './runtime.ts';",
    "import {x} from './runtime.ts';",
    "export {x} from './runtime.ts';",
    "export * from './runtime.ts';",
    "void import('./runtime.ts');",
    "import runtime = require('./runtime.ts');",
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertPureAuthorityContract(mutation),
      /runtime imports and export-from declarations are forbidden/u,
      mutation,
    );
  }
});

test("rejects runtime exported initializers and mutable aggregates", () => {
  const mutations = [
    'export const settings = (() => ({ mode: "off" }))();',
    'export const settings = (function buildSettings() { return { mode: "off" }; })();',
    "export const settings = makeSettings();",
    "export const settings = new Map();",
    'export const settings = await Promise.resolve("off");',
    'export const settings = (function* settingsGenerator() { yield "off"; })();',
    'export const settings = true ? "off" : "enforce";',
    "export const settings = process.env.AUTHORITY_MODE;",
    'export const settings = () => "off";',
    'export const settings = { mode: "off" };',
    'export const settings = ["off", "enforce"] as const;',
    'export const settings = Object.freeze({ mode: "off" });',
    'export const settings = Object.freeze({ nested: { mode: "off" } } as const);',
    'export const settings = freeze({ mode: "off" } as const);',
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertPureAuthorityContract(mutation),
      /pure authority contract/u,
      mutation,
    );
  }
});
