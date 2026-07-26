// Single source of truth for the per-(platform, arch, libc) native package
// targets the sidecar bundle KEEPS and the foreign-arch prune DROPS.
//
// Why this is a standalone pure module: the same `platform/arch/libc →
// @img/sharp-<target> + @next/swc-<target> + node-pty prebuild` mapping is
// needed in two places that can't share bash:
//
//   1. scripts/sidecar-bundle.sh — `prune_foreign_native_packages()` consumes
//      this via `eval "$(node scripts/sidecar-target.mjs --sh <p> <a> <libc>)"`
//      so the release prune never drifts from the test's idea of "the target".
//   2. The cross-environment conformance suite (#1990) — imports
//      `resolveSidecarTarget()` and asserts it per-OS, so a Windows / macOS /
//      Linux runner verifies the real mapping rather than a simulated one.
//
// Keep this in lockstep with the values prune_foreign_native_packages relied on
// before the extraction:
//   darwin:  next @next/swc-darwin-<arch>          sharp @img/sharp-darwin-<arch>      + libvips, keep fsevents
//   linux:   next @next/swc-linux-<arch>-<libc>    sharp @img/sharp-(linux|linuxmusl)-<arch> + libvips
//   win32:   next @next/swc-win32-<arch>-msvc      sharp @img/sharp-win32-<arch>       (libvips bundled inside sharp)

/**
 * @param {{ platform: string, arch: string, libc?: string }} host
 *   `libc` is only meaningful on linux and must be "gnu" or "musl" (the same
 *   token @next/swc uses); it is ignored on darwin / win32.
 * @returns {{
 *   supported: boolean,
 *   platform: string,
 *   arch: string,
 *   libc: string,
 *   target?: string,
 *   nextPkg?: string,
 *   sharpPkg?: string,
 *   sharpVipsPkg?: string,
 *   nodePtyPrebuild?: string,
 *   keepFsevents?: boolean,
 * }}
 */
export function resolveSidecarTarget({ platform, arch, libc = "" }) {
  switch (platform) {
    case "darwin":
      return {
        supported: true,
        platform,
        arch,
        libc: "",
        target: `darwin-${arch}`,
        nextPkg: `@next/swc-darwin-${arch}`,
        sharpPkg: `@img/sharp-darwin-${arch}`,
        sharpVipsPkg: `@img/sharp-libvips-darwin-${arch}`,
        nodePtyPrebuild: `darwin-${arch}`,
        keepFsevents: true,
      };
    case "linux": {
      const isMusl = libc === "musl";
      return {
        supported: true,
        platform,
        arch,
        libc,
        target: `linux-${arch}`,
        nextPkg: `@next/swc-linux-${arch}-${libc}`,
        sharpPkg: isMusl ? `@img/sharp-linuxmusl-${arch}` : `@img/sharp-linux-${arch}`,
        sharpVipsPkg: isMusl
          ? `@img/sharp-libvips-linuxmusl-${arch}`
          : `@img/sharp-libvips-linux-${arch}`,
        nodePtyPrebuild: `linux-${arch}`,
        keepFsevents: false,
      };
    }
    case "win32":
      return {
        supported: true,
        platform,
        arch,
        libc: "",
        target: `win32-${arch}`,
        nextPkg: `@next/swc-win32-${arch}-msvc`,
        sharpPkg: `@img/sharp-win32-${arch}`,
        // sharp ships libvips compiled into the win32 package, so there is no
        // separate @img/sharp-libvips-win32-* to keep.
        sharpVipsPkg: "",
        nodePtyPrebuild: `win32-${arch}`,
        keepFsevents: false,
      };
    default:
      return { supported: false, platform, arch, libc };
  }
}

// Emit single-quoted shell assignments so scripts/sidecar-bundle.sh can
// `eval "$(node scripts/sidecar-target.mjs --sh <platform> <arch> <libc>)"`.
// All values are fixed package-name literals (no user input), and single
// quotes keep the `@`, `/`, `-` characters inert.
function toShell(t) {
  if (!t.supported) {
    return "SIDECAR_SUPPORTED=0\n";
  }
  const lines = [
    "SIDECAR_SUPPORTED=1",
    `target='${t.target}'`,
    `next_pkg='${t.nextPkg}'`,
    `sharp_pkg='${t.sharpPkg}'`,
    `sharp_vips_pkg='${t.sharpVipsPkg}'`,
    `node_pty_prebuild='${t.nodePtyPrebuild}'`,
  ];
  return lines.join("\n") + "\n";
}

// CLI: `node scripts/sidecar-target.mjs --sh <platform> <arch> [libc]`
//      `node scripts/sidecar-target.mjs --json <platform> <arch> [libc]`
// Defaults to the running host when platform/arch are omitted.
function main(argv) {
  let format = "--json";
  const rest = [];
  for (const a of argv) {
    if (a === "--sh" || a === "--json") format = a;
    else rest.push(a);
  }
  const platform = rest[0] || process.platform;
  const arch = rest[1] || process.arch;
  let libc = rest[2] || "";
  if (platform === "linux" && !libc) {
    // Match the bash probe: glibc runtime present → gnu, else musl.
    const report = process.report?.getReport?.();
    libc = report?.header?.glibcVersionRuntime ? "gnu" : "musl";
  }
  const resolved = resolveSidecarTarget({ platform, arch, libc });
  if (format === "--sh") process.stdout.write(toShell(resolved));
  else process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
