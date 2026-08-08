#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { readCanonicalYamlStringSetting } from "./release-yaml-settings.mjs";

export const RELEASE_SOURCE_PATHS = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "apps/ios/CovenCave/project.yml",
];

const stableVersion = (value) => /^\d+\.\d+\.\d+$/.test(value);

function tomlPackageVersionValues(source) {
  let section = null;
  const values = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "package") continue;
    const match = /^version\s*=\s*"([^"]+)"(?:\s*#.*)?$/.exec(line);
    if (match) values.push(match[1]);
  }
  return values;
}

function canonicalJsonVersionValues(source, sourceLabel, structuralErrors) {
  try {
    JSON.parse(source);
    const document = YAML.parseDocument(source, { prettyErrors: true });
    if (document.errors.length > 0) {
      throw new Error(
        `JSON must not contain duplicate keys (${document.errors.map((error) => error.message).join("; ")})`,
      );
    }
    if (!YAML.isMap(document.contents)) {
      throw new Error("JSON root must be an object with one version field");
    }
    const matches = document.contents.items.filter(
      (pair) => YAML.isScalar(pair.key) && pair.key.value === "version",
    );
    if (matches.length !== 1 || !YAML.isScalar(matches[0]?.value) || typeof matches[0].value.value !== "string") {
      throw new Error("expected exactly one root string version field");
    }
    return [matches[0].value.value];
  } catch (error) {
    structuralErrors.push(`${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function canonicalIosSetting(source, key, structuralErrors) {
  try {
    return [
      readCanonicalYamlStringSetting(
        source,
        ["settings", "base", key],
        "apps/ios/CovenCave/project.yml",
      ),
    ];
  } catch (error) {
    structuralErrors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
}

export function inspectReleaseSourceFiles(files) {
  const cargoToml = files["src-tauri/Cargo.toml"];
  const cargoLock = files["src-tauri/Cargo.lock"];
  const iosProject = files["apps/ios/CovenCave/project.yml"];
  const structuralErrors = [];
  const iosMarketing = canonicalIosSetting(
    iosProject,
    "MARKETING_VERSION",
    structuralErrors,
  );
  const iosBuild = canonicalIosSetting(
    iosProject,
    "CURRENT_PROJECT_VERSION",
    structuralErrors,
  );

  return {
    structuralErrors,
    versions: [
      {
        path: "package.json",
        values: canonicalJsonVersionValues(files["package.json"], "package.json", structuralErrors),
      },
      {
        path: "src-tauri/tauri.conf.json",
        values: canonicalJsonVersionValues(
          files["src-tauri/tauri.conf.json"],
          "src-tauri/tauri.conf.json",
          structuralErrors,
        ),
      },
      {
        path: "src-tauri/Cargo.toml",
        values: tomlPackageVersionValues(cargoToml),
      },
      {
        path: "src-tauri/Cargo.lock",
        values: [
          ...cargoLock.matchAll(
            /(?:^|\n)\[\[package\]\]\r?\nname = "app"\r?\nversion = "([^"]+)"(?:\r?\n|$)/g,
          ),
        ].map((match) => match[1]),
      },
      {
        path: "apps/ios/CovenCave/project.yml",
        values: iosMarketing,
      },
    ],
    iosBuildVersions: iosBuild,
    changelog: files["CHANGELOG.md"],
  };
}

export function releaseSourceErrors({
  expectedVersion,
  files,
  requireFinalChangelog = false,
}) {
  const errors = [];
  if (!stableVersion(expectedVersion)) {
    errors.push(
      `release version "${expectedVersion}" is not stable X.Y.Z; prereleases are not published by this workflow`,
    );
    return errors;
  }

  const snapshot = inspectReleaseSourceFiles(files);
  errors.push(...snapshot.structuralErrors);
  for (const observation of snapshot.versions) {
    if (
      observation.values.length !== 1 ||
      typeof observation.values[0] !== "string"
    ) {
      errors.push(
        `${observation.path}: expected exactly one release version, found ${JSON.stringify(observation.values)}`,
      );
    } else if (observation.values[0] !== expectedVersion) {
      errors.push(
        `${observation.path}: expected ${expectedVersion}, found ${observation.values[0]}`,
      );
    }
  }

  if (
    snapshot.iosBuildVersions.length !== 1 ||
    !/^\d{10}$/.test(snapshot.iosBuildVersions[0] ?? "")
  ) {
    errors.push(
      `apps/ios/CovenCave/project.yml: expected one 10-digit CURRENT_PROJECT_VERSION, found ${JSON.stringify(snapshot.iosBuildVersions)}`,
    );
  }

  if (requireFinalChangelog) {
    const heading = `## [${expectedVersion}]`;
    const starts = [...snapshot.changelog.matchAll(/^## \[([^\]]+)\](?:\s+-\s+.*)?$/gm)]
      .filter((match) => match[1] === expectedVersion)
      .map((match) => match.index);
    if (starts.length !== 1) {
      errors.push(
        `CHANGELOG.md: expected exactly one "${heading}" section, found ${starts.length}`,
      );
    } else {
      const start = starts[0];
      const rest = snapshot.changelog.slice(start + heading.length);
      const nextHeading = rest.search(/^## /m);
      const section =
        nextHeading === -1
          ? snapshot.changelog.slice(start)
          : snapshot.changelog.slice(start, start + heading.length + nextHeading);
      if (section.includes("_One-line teaser — edit before merge._")) {
        errors.push(`CHANGELOG.md: ${heading} still contains the generated teaser placeholder`);
      }
    }
  }

  return errors;
}

export function readReleaseSourceFiles(root) {
  return Object.fromEntries(
    [...RELEASE_SOURCE_PATHS, "CHANGELOG.md"].map((relativePath) => [
      relativePath,
      readFileSync(path.join(root, relativePath), "utf8"),
    ]),
  );
}

function main() {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let expectedVersion;
  let requireFinalChangelog = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-final-changelog") {
      requireFinalChangelog = true;
      continue;
    }
    if (arg === "--root" || arg === "--version") {
      const supplied = argv[index + 1];
      if (!supplied || supplied.startsWith("-")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--root") root = path.resolve(supplied);
      else expectedVersion = supplied;
      index += 1;
      continue;
    }
    throw new Error(`unknown option "${arg}"`);
  }

  if (!expectedVersion) throw new Error("--version is required");
  const errors = releaseSourceErrors({
    expectedVersion,
    files: readReleaseSourceFiles(root),
    requireFinalChangelog,
  });
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(
    `Verified release source ${expectedVersion} across five manifests${requireFinalChangelog ? " and the finalized changelog" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
