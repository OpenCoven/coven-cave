#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The one place the file-count budget is written down. */
export const SIDECAR_RUNTIME_BUDGET_FILE = fileURLToPath(
  new URL("./sidecar-runtime-budget.json", import.meta.url),
);

/**
 * Read the budget from its single source, or refuse to run.
 *
 * Validation is not ceremony here. The gate compares a measured count against
 * this number, so a missing key or a malformed file yielding `undefined`/`NaN`
 * would make every comparison false and the gate would PASS silently — worse
 * than the six hand-synced copies this replaced, because nothing would ever go
 * red to reveal it. Fail loudly instead.
 */
function readSidecarFileCountBudget() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(SIDECAR_RUNTIME_BUDGET_FILE, "utf8"));
  } catch (cause) {
    throw new Error(
      `sidecar runtime budget is unreadable at ${SIDECAR_RUNTIME_BUDGET_FILE}: ${cause.message}`,
      { cause },
    );
  }
  const fileCount = parsed?.fileCount;
  if (!Number.isSafeInteger(fileCount) || fileCount <= 0) {
    throw new Error(
      `sidecar runtime budget "fileCount" must be a positive integer, received ${JSON.stringify(fileCount)} ` +
        `from ${SIDECAR_RUNTIME_BUDGET_FILE}`,
    );
  }
  return fileCount;
}

export const SIDECAR_RUNTIME_ROOTS = Object.freeze([
  ".agents/skills",
  "marketplace/catalog.json",
  "marketplace/exports",
  "marketplace/marketplace.json",
  "marketplace/plugins",
  "public",
  "workflows",
  "vault.yaml",
]);

export const SIDECAR_FORBIDDEN_ROOTS = Object.freeze([
  ".beads",
  ".claude",
  ".codex",
  "apps",
  "docs",
  "marketplace/craft-sources",
  "screenshots",
  "scripts",
  "src",
  "tests",
]);

export const SIDECAR_DYNAMIC_PACKAGES = Object.freeze([
  "@next/env",
  "@swc/helpers",
  "node-pty",
  "sharp",
  "ws",
]);

// Next's server config loader resolves these files dynamically at startup.
// NFT does not retain them in the sparse standalone dependency tree, so keep
// the small compiled webpack bootstrap explicitly in the sidecar closure.
export const SIDECAR_NEXT_RUNTIME_FILES = Object.freeze([
  "dist/compiled/webpack/webpack-lib.js",
  "dist/compiled/webpack/webpack.js",
  "dist/compiled/webpack/bundle5.js",
]);

export const SIDECAR_RUNTIME_BUDGETS = Object.freeze({
  // Headroom over the ~5.2k baseline: .agents/skills is a runtime root, so
  // each first-party skill shipped to familiars adds a file here (covenwiki
  // skills landed 2026-07-14). Raise deliberately, never reflexively.
  // 2026-07-15: +4 GitHub write routes (review/merge/rerun/dispatch,
  // cave-fpqx.9) traced the runtime to 5,258 — raised to 5,300.
  // 2026-07-15 (later): main reached 5,300 and the familiars/[id]/backdrop
  // route (cave-j0dz) tipped it to 5,301 — raised to 5,320.
  // 2026-07-15 (fleet): the Omnigent fleet surface (#3216) traced the runtime
  // to 5,331–5,337 across platforms — raised to 5,360.
  // 2026-07-15 (threads): Phase 4 Cave surfaces (#3223) — 8 authority-gate
  // read/decision routes (/api/weaves*, /api/threads/*, /api/proposals*),
  // /weaves + /proposals pages, and the traced fixtures/phase-4 staged-write
  // mirrors put the runtime at 5,417 — raised to 5,440.
  // 2026-07-15 (voice models): speech-model management adds 4 API route
  // handlers for readiness/download polling/removal, traced at 5,443 — raised
  // to 5,450 with narrow headroom.
  // 2026-07-15 (integrated main): the voice routes landed after the manual
  // export/restore routes, producing 5,452–5,458 files across CI platforms.
  // The onboarding readiness/update split and shared SWR cache then traced at
  // 5,459–5,463, so retain seven files of measured headroom.
  // 2026-07-16 (home payload): intentional lazy workspace boundaries add the
  // packaged chunks that cut `/` first-load JS by 48.9%. CI measured 5,486 on
  // macOS, 5,490 on Linux, and 5,492 on Windows — retain eight files of
  // cross-platform headroom without relaxing the expanded-byte ceiling.
  // 2026-07-17 (chat stream resume): GET /api/chat/stream (cave-h40l, one
  // route chunk) landed on a main already at the Windows brim — CI measured
  // 5,501 on Windows. Raised to 5,510: nine files of headroom, byte ceiling
  // untouched.
  // 2026-07-17 (#3264 root stylesheet split): the 868 KiB root CSS chunk is
  // now ~13 surface-scoped stylesheets loaded per route (root CSS −29%) —
  // more files by design, fewer bytes parsed everywhere. CI measured 5,512
  // on Windows. Raised to 5,522: ten files of headroom, byte ceiling
  // untouched.
  // 2026-07-18 (Charm's Loom): the bundled Marketplace craft adds five traced
  // files on Windows. CI measured 5,527; retain ten files of headroom without
  // relaxing the expanded-byte ceiling.
  // 2026-07-20 (chat stream health): the status route and shared transport
  // module add five traced files on Windows. CI measured 5,542; pin the exact
  // cross-platform maximum without relaxing the expanded-byte ceiling.
  // 2026-07-20 (collaborative Canvas): the guarded annotation/revision route
  // adds one traced file on Windows. CI measured 5,543.
  // 2026-07-21 (Canvas redesign): the full-surface canvas editor adds one
  // traced chunk on Windows. CI measured 5,544.
  // 2026-07-21 (Familiar redesign): the SurfaceRail + familiar-tab chunk adds
  // one traced file on Windows. CI measured 5,545; keep the exact maximum.
  // 2026-07-21 (Group redesign): the coven-tab chunk adds two traced files on
  // Windows. CI measured 5,547; keep the exact maximum.
  // 2026-07-21 (Sessions redesign): the chat-session-grouping chunk adds one
  // traced file on Windows. CI measured 5,548; keep the exact maximum.
  // 2026-07-21 (sessions-list cache invalidation): the shared
  // sessions-list-cache module adds one traced file on Windows atop the
  // Sessions redesign; keep the exact maximum.
  // 2026-07-21 (Task cockpit): the TaskWorkCockpit + workspace-rail-controller
  // chunks add five traced files on Windows (CI measured 5,552 against the
  // pre-Sessions 5,547 base). Keep the exact maximum on the current base.
  // 2026-07-21 (sidebar warm-up): the direct lazy loaders traced at 5,574 on
  // Ubuntu and 5,576 on Windows before the later Group, Sessions, and Task
  // cockpit chunks landed. Retain ten files of cross-platform headroom for the
  // combined tree without relaxing the expanded-byte ceiling.
  // 2026-07-21 (Tailscale hub sync): the two new API routes
  // (tailscale/devices, daemon/probe) plus their tailscale-devices /
  // daemon-probe libs add traced files; CI measured 5,608 on Windows and
  // 5,606 on Ubuntu. Keep the exact cross-platform maximum with the same
  // ten-file headroom convention.
  // 2026-07-22 (/image command): the images/generate route chunk adds eight
  // traced files (CI measured 5,602 Windows on the pre-Tailscale base and
  // 5,616 Windows on the combined tree). Pin the combined exact maximum
  // without relaxing the expanded-byte ceiling.
  // 2026-07-22 (mobile write access): the mobile-permissions route plus the
  // shared trusted-grant-mutation lib add traced files; CI measured 5,621 on
  // Ubuntu and 5,623 on Windows, then hermes (#3636) landed one more traced
  // file on Windows (5,624) — about seven traced files over the pre-branch
  // base.
  // 2026-07-22 (composer add menu): the unified "+" menu splits the composer
  // into composer-add-menu / composer-add-menu-data / submenu-position chunks;
  // CI traced 5,618–5,619 on Windows across runs. The merged tree lands
  // around 5,644 on Ubuntu after the OpenCode direct-run, model-inventory,
  // event-decoder, composer-add-menu, and subsequent alias/mobile fixes
  // land. Retain ten files of headroom over that measured maximum without
  // relaxing the byte ceiling.
  // 2026-07-23 (MCP doctor): the /api/mcp/health route traces the mcp-doctor
  // and endpoint-validators chunks; CI measured 5,655 on Ubuntu and 5,657 on
  // Windows. Retain ten files of headroom over the measured maximum without
  // relaxing the byte ceiling.
  // 2026-07-24 (Queue project readiness): the selected-project readiness
  // route and its server helpers trace four more files. Native Windows
  // packaging measured 5,671 files; retain the established ten-file buffer.
  // 2026-07-24 (research final artifacts): the mission files route
  // ([id]/files/[key]) traces two more chunks; the PR merge tree measured
  // 5,683 on Windows. Retain the ten-file buffer without relaxing the byte
  // ceiling.
  // 2026-07-24 (local Whisper STT): the local-origin transcription endpoint
  // and its sidecar runner trace at 5,694 on Linux and 5,696 on Windows.
  // Retain the established ten-file cross-platform buffer.
  // 2026-07-26 (scheduled backup sync): the /backup/sync (+/run) routes and
  // the backup-sync scheduler trace at 5,718 on Linux and 5,720 on Windows.
  // Retain the established ten-file cross-platform buffer.
  // 2026-07-27 (canonical Coven Memory): path-free list/overview/detail routes
  // and their browser readers/resources traced the packaged runtime at 5,769
  // on Linux and 5,772 on Windows. Retain the established ten-file buffer.
  // 2026-07-29 (typed chat follow-ups): the reusable Reply/Task/Action
  // components trace two additional Windows runtime files (5,784). Preserve
  // the established ten-file cross-platform headroom without relaxing bytes.
  // 2026-07-29 (daemon launch cleanup): Windows packaging of the owned
  // readiness-timeout path measured 5,789 files. Retain the established ten
  // files of cross-platform headroom without relaxing the byte ceiling.
  // 2026-07-29 (Node 24 LTS dependency refresh): the Windows runtime measured
  // 5,801 files. Retain the same ten-file headroom without relaxing the byte
  // ceiling.
  // 2026-07-29 (Chat Familiar settings): the nested Familiar settings
  // writers trace 5,804 files on Windows. Retain the established ten files
  // of cross-platform headroom without relaxing the byte ceiling.
  // 2026-08-01 (Memory document reader): the shared reader traces 5,817 files
  // on Windows. Retain the established ten-file cross-platform headroom.
  // 2026-08-01 (main integration tree): CI measures 5,828 files on Ubuntu
  // and 5,831 on Windows after maps, declarations, nested dependencies, and
  // non-runtime roots are excluded. Preserve the established ten-file
  // cross-platform headroom.
  // 2026-08-03 (src/app/api/x/ route handlers, #4235): CI measures 5,874 on
  // Ubuntu and 5,877 on Windows. Set from the HIGHER figure plus the same
  // ten-file headroom.
  //
  // This number was reverted to 5_841 once already, by a local merge of a
  // superseded branch citing the stale 5,831 line above (#4249). The routes
  // needing this headroom are still present, so it must not move DOWN while
  // they exist — and any bump belongs here, beside the measurement that
  // justifies it, or the next reader reverts it again.
  // 2026-08-03 (research infographic renderer, cave-ga0t5): the
  // /api/research/generations/infographic route plus the SVG/PNG renderer
  // chunk traced at 5,888 on Ubuntu and 5,891 on Windows. Set from the
  // HIGHER figure plus the same ten-file headroom.
  // +1 (2026-08-03, cave-xailn): POST /api/chat/rewrite backs the reader's
  // Rewrite control. One new route handler, one new file in the closure —
  // measured at 5,902 on Ubuntu CI. Nothing else in that change reaches the
  // sidecar: the shared one-shot runner it adds replaces code that was already
  // inside enrich-steps' route.
  // 2026-08-03 (live call transcript, cave-zr9dx): src/lib/voice/call-transcript.ts
  // joins the closure through the call overlay. On the tree carrying BOTH that
  // file and the rewrite route above, CI measured 5,902 on Ubuntu and 5,905 on
  // Windows — so 5,902 was the Ubuntu figure with no headroom at all, and the
  // Windows leg was still red at it. Set from the HIGHER figure plus the same
  // ten-file cross-platform headroom the entries above use.
  // 2026-08-04 (image carousel, #4315): src/components/image-carousel.tsx and the
  // chat-view wiring that renders it join the closure. CI measured 5,913 on Ubuntu
  // and 5,916 on Windows — the ten-file headroom above was fully consumed and the
  // Windows leg went one over while Ubuntu still passed, which is why only that
  // leg was red. Set from the HIGHER figure plus the same ten-file cross-platform
  // headroom every entry above uses.
  // 2026-08-04 (headroom rate, cave-k5n56): worth recording that the entry
  // above is a rate problem, not a one-feature one. main's Windows leg measured
  // 5,914 at ab27ef62d8 and 5,915 at 39eadf26eb — sitting exactly ON the budget,
  // reporting green with zero headroom — before #4315 added the single file that
  // crossed it. Growth is roughly a file per merge, diffuse across many PRs, and
  // Windows governs at a consistent +3 over Ubuntu (5914/5911, 5915/5912,
  // 5916/5913). So read a red here as the headroom running out rather than as the
  // last merge misbehaving, and check the previous runs' measured counts before
  // attributing it. Ten files is about ten merges at this rate, so this will
  // recur; the durable fix is to size the headroom to the growth rate or stop the
  // closure growing, not to keep adding ten.
  // 2026-08-06 (cave-oqawv): taking the advice directly above rather than adding
  // ten for the third time. CI measured 5,957 on Ubuntu and 5,959 on Windows,
  // which governs — that is +43 on the 5,916 the entry above was set from, over
  // roughly two days, so ~21 files/day. A ten-file headroom is therefore worth
  // about eleven hours, which is exactly why this gate went red again within a
  // day of being raised.
  //
  // Set from the governing Windows figure plus 150, which is about one week of
  // drift at the measured rate (main took 869 commits in the last 7 days at
  // ~0.3 closure files per commit). State the trade plainly: at this headroom
  // the gate no longer notices organic drift, and it is not meant to — what it
  // still catches is a single change dragging a whole subtree in, which is
  // hundreds of files at once and the failure worth having a gate for. If this
  // needs to detect drift again, the fix is to stop the closure growing, not a
  // smaller number here.
  //
  // 2026-08-06 (cave-0ia8h): the VALUE now lives in sidecar-runtime-budget.json
  // and is read from there. It used to be hand-copied into six places — this
  // file, sidecar-runtime-smoke.mjs, the Rust MAX_FILE_COUNT const, and three
  // test pins — so every raise was a six-file sync performed under a red CI,
  // and one of them was reverted independently once (#4249). The history above
  // is kept here because it is the reasoning; the number is data.
  //
  // Investigation for that bead also settled where the growth comes from: over
  // the two days that added 43 closure files, the first-party runtime roots
  // above grew by ONE file and no runtime dependency was added. The rest is
  // Next's traced output following new routes, at roughly two to four files
  // each. There is no subtree to prune — the closure grows because the app
  // does — which is why this is a tracked budget rather than a fixed one.
  fileCount: readSidecarFileCountBudget(),
  unpackedBytes: 200 * 1024 * 1024 - 1,
});

const PACKAGE_NAME_RE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const PLATFORM_OPTIONAL_PACKAGE_RE = /^(?:@img\/sharp-|@next\/swc-)/;

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * Containment against a set of allowed roots, tolerant of path aliases.
 *
 * `isInside` is lexical, so it only answers correctly when both sides are
 * spelled the same way. The roots here are built with `path.resolve`, which
 * normalizes but does NOT resolve symlinks, while a candidate that has been
 * through `realpath` is fully canonical. On macOS that difference is routine
 * rather than exotic — `/var` is a symlink to `/private/var` and `/tmp` to
 * `/private/tmp`, so every temp-dir path has two spellings — and comparing one
 * against the other rejected links that were plainly inside an allowed root.
 *
 * The lexical check runs first and answers almost every call. Only when it says
 * "outside" do we canonicalize the roots and ask again, so the extra syscalls
 * land on the path that was about to throw anyway. This narrows what is
 * rejected, never widens it: containment is still required, just measured
 * between two spellings of the same filesystem location.
 */
export async function isInsideAllowedRoots(roots, candidate) {
  if (roots.some((root) => isInside(root, candidate))) return true;
  // Canonicalize BOTH sides before the second opinion. Canonicalizing only one
  // of them just moves the mismatch: an aliased root against a canonical
  // candidate fails exactly as an aliased candidate against a canonical root
  // does. A path that cannot be resolved keeps its lexical spelling, which is
  // the best available answer for something that does not exist yet.
  const canonicalCandidate = await canonicalize(candidate);
  for (const root of roots) {
    if (isInside(await canonicalize(root), canonicalCandidate)) return true;
  }
  return false;
}

async function canonicalize(target) {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

function packageParts(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts[0] !== "node_modules") return null;

  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  let packageEnd = nodeModulesIndex + 2;
  if (parts[nodeModulesIndex + 1]?.startsWith("@")) packageEnd += 1;
  if (packageEnd > parts.length) return null;

  const packageName = parts.slice(nodeModulesIndex + 1, packageEnd).join("/");
  if (!packageName || packageName === ".pnpm") return null;
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new Error(`invalid package name in Next trace: ${packageName}`);
  }
  return {
    packageName,
    packageRoot: parts.slice(0, packageEnd).join(path.sep),
  };
}

function shouldSkipPackageEntry(relativePath, entryName, _isDirectory) {
  if (entryName === "node_modules") return true;
  if (entryName.endsWith(".map") || entryName.endsWith(".d.ts") || entryName.endsWith(".d.ts.map")) return true;

  const normalized = relativePath.split(path.sep).join("/");
  if (/^node-pty\/(?:deps|scripts|src|typings)(?:\/|$)/.test(normalized)) return true;
  if (/^node-pty\/lib\/.*\.test\.js$/.test(normalized)) return true;
  if (/^node-pty\/.*\.pdb$/i.test(normalized)) return true;
  return false;
}

async function copyResolvedEntry(source, destination, options, relativePath = "") {
  if (!(await isInsideAllowedRoots(options.allowedLinkRoots, source))) {
    throw new Error(`sidecar runtime input escapes its allowed roots: ${source}`);
  }
  const metadata = await lstat(source);
  let resolvedSource = source;
  let resolvedMetadata = metadata;

  if (metadata.isSymbolicLink()) {
    if (!options.followLinks) {
      throw new Error(`sidecar runtime input must not contain links: ${source}`);
    }
    resolvedSource = await realpath(source);
    if (!(await isInsideAllowedRoots(options.allowedLinkRoots, resolvedSource))) {
      throw new Error(`sidecar dependency link escapes its allowed roots: ${source} -> ${resolvedSource}`);
    }
    resolvedMetadata = await stat(resolvedSource);
  }

  if (resolvedMetadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(resolvedSource, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (options.filter?.(childRelative, entry.name, entry.isDirectory())) continue;
      await copyResolvedEntry(
        path.join(resolvedSource, entry.name),
        path.join(destination, entry.name),
        options,
        childRelative,
      );
    }
    return;
  }

  if (!resolvedMetadata.isFile()) {
    throw new Error(`sidecar runtime input contains an unsupported entry: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(resolvedSource, destination);
  await chmod(destination, resolvedMetadata.mode & 0o777);
}

async function walkFiles(root, predicate, skipDirectory = () => false) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectory(entryPath, entry.name)) pending.push(entryPath);
      } else if (predicate(entryPath, entry.name)) {
        found.push(entryPath);
      }
    }
  }
  return found;
}

export async function collectTracedDependencies(projectRoot) {
  const nextRoot = path.join(projectRoot, ".next");
  const traceFiles = await walkFiles(
    nextRoot,
    (_entryPath, name) => name.endsWith(".nft.json"),
    (entryPath, name) => name === "cache" || name === "standalone" || isInside(path.join(nextRoot, "standalone"), entryPath),
  );
  if (traceFiles.length === 0) {
    throw new Error(`Next build emitted no .nft.json traces under ${nextRoot}`);
  }

  const packageRoots = new Map();
  const resolvedPackageRoots = new Map();
  let resolvedNodeModulesRoot = null;
  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await readFile(traceFile, "utf8"));
    if (!Array.isArray(trace.files)) {
      throw new Error(`invalid Next trace file list: ${traceFile}`);
    }
    for (const tracedPath of trace.files) {
      if (typeof tracedPath !== "string") {
        throw new Error(`invalid Next trace entry in ${traceFile}`);
      }
      const source = path.resolve(path.dirname(traceFile), tracedPath);
      if (!isInside(projectRoot, source)) {
        throw new Error(`Next trace escapes the project root: ${traceFile} -> ${tracedPath}`);
      }
      const relativeSource = path.relative(projectRoot, source);
      const parts = packageParts(relativeSource);
      if (!parts) continue;

      const sourcePackageRoot = path.join(projectRoot, parts.packageRoot);
      let resolvedPackageRoot = resolvedPackageRoots.get(sourcePackageRoot);
      if (!resolvedPackageRoot) {
        resolvedPackageRoot = await realpath(sourcePackageRoot);
        resolvedPackageRoots.set(sourcePackageRoot, resolvedPackageRoot);
      }
      if (!resolvedNodeModulesRoot) {
        // realpath both sides: projectRoot may sit under a symlink (e.g. /var -> /private/var on macOS)
        resolvedNodeModulesRoot = await realpath(path.join(projectRoot, "node_modules"));
      }
      if (!isInside(resolvedNodeModulesRoot, resolvedPackageRoot)) {
        throw new Error(`traced dependency resolves outside node_modules: ${sourcePackageRoot} -> ${resolvedPackageRoot}`);
      }
      const previousRoot = packageRoots.get(parts.packageName);
      if (previousRoot && previousRoot !== resolvedPackageRoot) {
        throw new Error(
          `Next trace resolves multiple versions of ${parts.packageName}: ${previousRoot} and ${resolvedPackageRoot}`,
        );
      }
      packageRoots.set(parts.packageName, resolvedPackageRoot);
    }
  }

  return {
    traceFileCount: traceFiles.length,
    packageNames: [...packageRoots.keys()].sort(),
    packages: [...packageRoots.entries()]
      .map(([packageName, sourceRoot]) => ({ packageName, sourceRoot }))
      .sort((left, right) => left.packageName.localeCompare(right.packageName)),
  };
}

async function copyDynamicPackage(packageName, dependencyRoot, destination, allowedLinkRoots) {
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new Error(`invalid dynamic sidecar package name: ${packageName}`);
  }
  const destinationPackage = path.join(destination, "node_modules", ...packageName.split("/"));
  const source = path.join(dependencyRoot, ...packageName.split("/"));
  const packageJson = path.join(source, "package.json");
  try {
    await stat(packageJson);
  } catch (error) {
    try {
      await stat(path.join(destinationPackage, "package.json"));
      return;
    } catch (destinationError) {
      if (destinationError.code !== "ENOENT") throw destinationError;
    }
    throw new Error(`required dynamic sidecar package is missing: ${packageName} (${error.message})`);
  }
  await copyResolvedEntry(source, destinationPackage, {
    followLinks: true,
    allowedLinkRoots,
    filter: (relativePath, name, isDirectory) =>
      shouldSkipPackageEntry(path.join(packageName, relativePath), name, isDirectory),
  });
}

async function copyDynamicNativePackages(dependencyRoot, destination, allowedLinkRoots) {
  const scopeRoot = path.join(dependencyRoot, "@img");
  let entries;
  try {
    entries = await readdir(scopeRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.startsWith("sharp-")) continue;
    await copyDynamicPackage(`@img/${entry.name}`, dependencyRoot, destination, allowedLinkRoots);
  }
}

async function copyNextAliases(standaloneRoot, destination, allowedLinkRoots) {
  const aliasesRoot = path.join(standaloneRoot, ".next", "node_modules");
  let aliases;
  try {
    aliases = await readdir(aliasesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const alias of aliases.sort((left, right) => left.name.localeCompare(right.name))) {
    const aliasSource = path.join(aliasesRoot, alias.name);
    const resolvedAlias = await realpath(aliasSource);
    const packageJson = JSON.parse(await readFile(path.join(resolvedAlias, "package.json"), "utf8"));
    if (typeof packageJson.name !== "string" || !PACKAGE_NAME_RE.test(packageJson.name)) {
      throw new Error(`Next runtime alias has no package name: ${aliasSource}`);
    }
    const packageSource = path.join(destination, "node_modules", ...packageJson.name.split("/"));
    await copyResolvedEntry(packageSource, path.join(destination, ".next", "node_modules", alias.name), {
      followLinks: true,
      allowedLinkRoots: [...allowedLinkRoots, destination],
      filter: (relativePath, name, isDirectory) =>
        shouldSkipPackageEntry(path.join(packageJson.name, relativePath), name, isDirectory),
    });
  }
}

async function copyNextRuntimeFiles(projectRoot, standaloneRoot, dependencyRoot, destination) {
  const nextRoots = [
    path.join(standaloneRoot, "node_modules", "next"),
    path.join(dependencyRoot, "next"),
  ];
  // A required file can be beneath a symlinked `next` package directory, so
  // checking only the final directory entry is not enough to enforce the
  // package boundary. Resolve the package root and candidate before copying,
  // while still letting copyResolvedEntry apply its existing final-entry link
  // checks. A required entry may only resolve within its own `next` package;
  // allowing the broader project or node_modules roots could copy unrelated
  // dependency trees into the sidecar.
  const resolvedPackageRoots = await Promise.all(
    [standaloneRoot, path.join(projectRoot, "node_modules"), dependencyRoot].map((root) => realpath(root)),
  );

  for (const relativePath of SIDECAR_NEXT_RUNTIME_FILES) {
    let source = null;
    for (const root of nextRoots) {
      const candidate = path.join(root, relativePath);
      try {
        const resolvedNextRoot = await realpath(root);
        if (!(await isInsideAllowedRoots(resolvedPackageRoots, resolvedNextRoot))) {
          throw new Error(`sidecar dependency link escapes its allowed roots: ${root} -> ${resolvedNextRoot}`);
        }
        const nextPackage = JSON.parse(await readFile(path.join(resolvedNextRoot, "package.json"), "utf8"));
        if (nextPackage.name !== "next") {
          throw new Error(`sidecar Next package root is not the Next package: ${root} -> ${resolvedNextRoot}`);
        }
        const resolvedCandidate = await realpath(candidate);
        if (!isInside(resolvedNextRoot, resolvedCandidate)) {
          throw new Error(`sidecar dependency link escapes its allowed roots: ${candidate} -> ${resolvedCandidate}`);
        }
        const metadata = await stat(resolvedCandidate);
        if (!metadata.isFile()) {
          throw new Error(`required Next sidecar runtime file is not a regular file: ${relativePath}`);
        }
        source = { path: resolvedCandidate, root: resolvedNextRoot };
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!source) {
      throw new Error(`required Next sidecar runtime file is missing: ${relativePath}`);
    }
    await copyResolvedEntry(
      source.path,
      path.join(destination, "node_modules", "next", relativePath),
      { followLinks: true, allowedLinkRoots: [source.root] },
    );
  }
}

export async function assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination) {
  const roots = [projectRoot, standaloneRoot, dependencyRoot].map((root) => path.resolve(root));
  [projectRoot, standaloneRoot, dependencyRoot, destination] = [
    path.resolve(projectRoot),
    path.resolve(standaloneRoot),
    path.resolve(dependencyRoot),
    path.resolve(destination),
  ];
  if (isInside(projectRoot, destination) && !isInside(path.join(projectRoot, "src-tauri", "resources"), destination)) {
    throw new Error(`refusing to replace a sidecar destination outside src-tauri/resources: ${destination}`);
  }

  const traced = await collectTracedDependencies(projectRoot);
  for (const requiredPackage of ["next", "react", "react-dom"]) {
    if (!traced.packageNames.includes(requiredPackage)) {
      throw new Error(`Next trace is missing required server package: ${requiredPackage}`);
    }
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  await copyResolvedEntry(path.join(standaloneRoot, ".next"), path.join(destination, ".next"), {
    followLinks: false,
    allowedLinkRoots: roots,
    filter: (relativePath, name, isDirectory) => {
      if (relativePath.split(path.sep)[0] === "node_modules") return true;
      return name.endsWith(".map") || name.endsWith(".nft.json") || (isDirectory && name === "cache");
    },
  });
  await copyResolvedEntry(path.join(projectRoot, ".next", "static"), path.join(destination, ".next", "static"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });
  await copyResolvedEntry(path.join(standaloneRoot, "server.js"), path.join(destination, "server.js"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });
  await copyResolvedEntry(path.join(projectRoot, "server.mjs"), path.join(destination, "server.mjs"), {
    followLinks: false,
    allowedLinkRoots: roots,
  });

  const projectPackage = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  await writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify({ name: "coven-cave-sidecar", version: projectPackage.version, private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );

  for (const runtimeRoot of SIDECAR_RUNTIME_ROOTS) {
    await copyResolvedEntry(path.join(projectRoot, runtimeRoot), path.join(destination, runtimeRoot), {
      followLinks: false,
      allowedLinkRoots: roots,
    });
  }

  for (const { packageName, sourceRoot } of traced.packages) {
    const sparseSource = path.join(standaloneRoot, path.relative(projectRoot, sourceRoot));
    const stagedSource = path.join(dependencyRoot, ...packageName.split("/"));
    let source = sparseSource;
    try {
      if (!(await stat(sparseSource)).isDirectory()) {
        throw new Error("not a directory");
      }
    } catch {
      source = stagedSource;
      try {
        if (!(await stat(stagedSource)).isDirectory()) throw new Error("not a directory");
      } catch (error) {
        if (error.code === "ENOENT" && PLATFORM_OPTIONAL_PACKAGE_RE.test(packageName)) continue;
        throw new Error(
          `traced sidecar package is missing from the build output and locked production install: ${packageName} (${error.message})`,
        );
      }
    }
    await copyResolvedEntry(source, path.join(destination, "node_modules", ...packageName.split("/")), {
      followLinks: true,
      allowedLinkRoots: roots,
      filter: (relativePath, name, isDirectory) =>
        shouldSkipPackageEntry(path.join(packageName, relativePath), name, isDirectory),
    });
  }

  for (const packageName of SIDECAR_DYNAMIC_PACKAGES) {
    await copyDynamicPackage(packageName, dependencyRoot, destination, roots);
  }
  await copyNextRuntimeFiles(projectRoot, standaloneRoot, dependencyRoot, destination);
  await copyDynamicNativePackages(dependencyRoot, destination, roots);
  await copyNextAliases(standaloneRoot, destination, roots);

  return traced;
}

export async function sidecarRuntimeMetrics(root) {
  let fileCount = 0;
  let directoryCount = 0;
  let unpackedBytes = 0;
  const pending = [path.resolve(root)];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) throw new Error(`sidecar runtime must not contain links: ${entryPath}`);
      if (metadata.isDirectory()) {
        directoryCount += 1;
        pending.push(entryPath);
      } else if (metadata.isFile()) {
        fileCount += 1;
        unpackedBytes += metadata.size;
      } else {
        throw new Error(`sidecar runtime contains an unsupported entry: ${entryPath}`);
      }
    }
  }
  return { fileCount, directoryCount, unpackedBytes };
}

export async function verifySidecarRuntime(root) {
  root = path.resolve(root);
  const required = [
    ".next/BUILD_ID",
    ".next/required-server-files.json",
    "marketplace/catalog.json",
    "marketplace/marketplace.json",
    "node_modules/@next/env/package.json",
    "node_modules/@swc/helpers/package.json",
    "node_modules/next/package.json",
    "node_modules/node-pty/package.json",
    "node_modules/react/package.json",
    "node_modules/react-dom/package.json",
    "node_modules/sharp/package.json",
    "node_modules/ws/package.json",
    ...SIDECAR_NEXT_RUNTIME_FILES.map((relativePath) => path.join("node_modules/next", relativePath)),
    "package.json",
    "public/sandbox/react-runtime.js",
    "server.js",
    "server.mjs",
    "vault.yaml",
  ];
  for (const relativePath of required) {
    try {
      const metadata = await stat(path.join(root, relativePath));
      if (!metadata.isFile()) {
        throw new Error(`required sidecar runtime file is not a regular file: ${relativePath}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`required sidecar runtime file is missing: ${relativePath}`);
      }
      throw error;
    }
  }
  for (const forbiddenRoot of SIDECAR_FORBIDDEN_ROOTS) {
    try {
      await stat(path.join(root, forbiddenRoot));
      throw new Error(`development-only root leaked into sidecar runtime: ${forbiddenRoot}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const metrics = await sidecarRuntimeMetrics(root);
  for (const [metric, budget] of Object.entries(SIDECAR_RUNTIME_BUDGETS)) {
    if (metrics[metric] > budget) {
      throw new Error(`sidecar runtime ${metric} ${metrics[metric]} exceeds target ${budget}`);
    }
  }
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify") {
    const root = process.argv[3];
    if (!root) throw new Error("usage: sidecar-runtime-closure.mjs --verify <runtime-root>");
    const metrics = await verifySidecarRuntime(root);
    console.log(
      `==> sidecar runtime closure: ${metrics.fileCount} files, ${metrics.directoryCount} directories, ${metrics.unpackedBytes} bytes`,
    );
  } else {
    const [projectRoot, standaloneRoot, dependencyRoot, destination] = process.argv.slice(2);
    if (!projectRoot || !standaloneRoot || !dependencyRoot || !destination) {
      throw new Error(
        "usage: sidecar-runtime-closure.mjs <project-root> <standalone-root> <dependency-root> <destination>",
      );
    }
    const traced = await assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination);
    console.log(
      `==> assembled sidecar from ${traced.traceFileCount} Next traces and ${traced.packageNames.length} traced packages`,
    );
  }
}
