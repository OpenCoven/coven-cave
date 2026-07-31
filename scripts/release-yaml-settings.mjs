#!/usr/bin/env node
import { parseDocument, stringify as stringifyYaml } from "yaml";

const SETTINGS = {
  "yaml-marketing-version": {
    sourcePath: "apps/ios/CovenCave/project.yml",
    canonicalPath: ["settings", "base", "MARKETING_VERSION"],
  },
};

const ALLOWED_STRING_TYPES = new Set(["PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE"]);

function canonicalPathLabel(path) {
  return path.join(".");
}

export function locateCanonicalYamlStringSetting(doc, canonicalPath, sourcePath) {
  const node = doc.getIn(canonicalPath, true);
  if (!node || typeof node.value !== "string") {
    throw new Error(`${sourcePath}: missing canonical YAML string setting at ${canonicalPathLabel(canonicalPath)}`);
  }
  if (!ALLOWED_STRING_TYPES.has(node.type)) {
    throw new Error(
      `${sourcePath}: ${canonicalPathLabel(canonicalPath)} must be a single-line plain or quoted scalar (found ${node.type})`,
    );
  }
  return node;
}

export function serializeStringScalar(value, stringType) {
  if (!ALLOWED_STRING_TYPES.has(stringType)) {
    throw new Error(`unsupported YAML string type: ${stringType}`);
  }
  return stringifyYaml(value, { defaultStringType: stringType }).trimEnd();
}

export function applyReplacement(settingName, source, replacementValue, sourcePath = SETTINGS[settingName]?.sourcePath) {
  const setting = SETTINGS[settingName];
  if (!setting) throw new Error(`unknown YAML release setting: "${settingName}"`);
  const doc = parseDocument(source, { keepSourceTokens: true });
  const effectiveSourcePath = sourcePath ?? setting.sourcePath;
  const node = locateCanonicalYamlStringSetting(doc, setting.canonicalPath, effectiveSourcePath);
  serializeStringScalar(replacementValue, node.type);
  node.value = replacementValue;
  return String(doc);
}
