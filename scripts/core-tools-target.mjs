import { readFileSync } from "node:fs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const CORE_TOOLS_LOCK = deepFreeze(
  JSON.parse(readFileSync(new URL("./core-tools-lock.json", import.meta.url), "utf8")),
);

const TARGETS = {
  "darwin/arm64": {
    target: "darwin-aarch64",
    cli: {
      kind: "package",
      packageName: "@opencoven/cli-macos",
      binary: "bin/coven",
    },
    codeArchive: "coven-code-macos-aarch64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "darwin/x64": {
    target: "darwin-x86_64",
    cli: {
      kind: "source",
      repository: CORE_TOOLS_LOCK.coven.intelSource.repository,
      tag: CORE_TOOLS_LOCK.coven.intelSource.tag,
      tagObject: CORE_TOOLS_LOCK.coven.intelSource.tagObject,
      commit: CORE_TOOLS_LOCK.coven.intelSource.commit,
      binary: "target/release/coven",
    },
    codeArchive: "coven-code-macos-x86_64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "linux/x64": {
    target: "linux-x86_64",
    cli: {
      kind: "package",
      packageName: "@opencoven/cli-linux-x64",
      binary: "bin/coven",
    },
    codeArchive: "coven-code-linux-x86_64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "win32/x64": {
    target: "windows-x86_64",
    cli: {
      kind: "package",
      packageName: "@opencoven/cli-windows",
      binary: "bin/coven.exe",
    },
    codeArchive: "coven-code-windows-x86_64.zip",
    outputNames: { coven: "coven.exe", covenCode: "coven-code.exe" },
  },
};

export function resolveCoreToolsTarget({ platform, arch }) {
  const target = TARGETS[`${platform}/${arch}`];
  return target
    ? {
        supported: true,
        target: target.target,
        cli: { ...target.cli },
        codeArchive: target.codeArchive,
        outputNames: { ...target.outputNames },
      }
    : { supported: false, platform, arch };
}
