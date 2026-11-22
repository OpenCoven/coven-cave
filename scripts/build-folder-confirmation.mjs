import { spawnSync } from "node:child_process";
import { chmodSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Packaged macOS builds carry the helper; no runtime compiler or PATH lookup.
// Other platforms refuse folder confirmation until a native verifier exists.
if (process.platform === "darwin") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const target = path.join(root, "native", "confirm-project-folder");
  const staging = `${target}.${process.pid}`;
  // Tauri's default floor is macOS 10.13; ARM Macs start at macOS 11.
  // Never let a newer build host silently raise the helper's deployment floor.
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  const minimum = process.arch === "arm64" ? "11.0" : "10.13";
  try {
    const result = spawnSync("/usr/bin/xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macosx${minimum}`, "-o", staging,
      path.join(root, "native", "confirm-project-folder.swift")], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Could not build native folder authentication");
    chmodSync(staging, 0o755);
    renameSync(staging, target);
  } finally {
    rmSync(staging, { force: true });
  }
}
