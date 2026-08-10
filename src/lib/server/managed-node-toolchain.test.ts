import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { MANAGED_NODE_VERSION, nodeArchiveFor } from "../onboarding-prerequisites.ts";
import { safeArchiveDestination, extractSafeTarGz, extractSafeZip } from "./managed-node-archive.ts";
import {
  classifyManagedNodeInstallError,
  installManagedNodeToolchain,
  managedNodePaths,
  managedNodeRoot,
  managedNodeSpawnEnv,
  probeManagedNodeToolchain,
} from "./managed-node-toolchain.ts";

const execFileAsync = promisify(execFile);

type TarEntry = { name: string; body?: string; mode?: number; type?: "0" | "1" | "2" | "5"; linkName?: string };

function tarArchive(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const data = Buffer.from(entry.body ?? "");
    header.write(entry.name, 0, "utf8");
    header.write((entry.mode ?? 0o644).toString(8).padStart(7, "0") + "\0", 100, "ascii");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header[156] = (entry.type ?? "0").charCodeAt(0);
    if (entry.linkName) header.write(entry.linkName, 157, "utf8");
    header.write("ustar\0", 257, "ascii");
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    blocks.push(header, data, padding);
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

function tarFile(name: string, body: string): Buffer {
  return tarArchive([{ name, body }]);
}

function storedZip(name: string, body: string): Buffer {
  const filename = Buffer.from(name);
  const data = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(0, 14); // test data has no CRC requirement in this parser
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}

test("safe archive paths cannot escape the owned extraction root", () => {
  const root = path.join(tmpdir(), "coven-managed-node-test");
  assert.throws(() => safeArchiveDestination(root, "../outside"), /escapes/);
  assert.throws(() => safeArchiveDestination(root, "/absolute"), /absolute/);
  assert.throws(() => safeArchiveDestination(root, "C:\\outside"), /absolute/);
  assert.equal(safeArchiveDestination(root, "node-v22/bin/node"), path.join(root, "node-v22", "bin", "node"));
});

test("safe tar extraction accepts ordinary files and rejects traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-tar-"));
  try {
    await extractSafeTarGz(gzipSync(tarFile("node-v22/bin/node", "node")), root);
    assert.equal(await readFile(path.join(root, "node-v22", "bin", "node"), "utf8"), "node");
    await assert.rejects(extractSafeTarGz(gzipSync(tarFile("../outside", "no")), root), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe tar extraction supports Node-style internal links and executable files", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-layout-"));
  try {
    const archive = tarArchive([
      { name: "node-v24/bin/node", body: "#!/bin/sh\nprintf 'managed-node-ok\\n'\n", mode: 0o755 },
      { name: "node-v24/lib/node_modules/corepack/dist/corepack.js", body: "corepack" },
      { name: "node-v24/lib/node_modules/npm/bin/npm-cli.js", body: "npm" },
      { name: "node-v24/lib/node_modules/npm/bin/npx-cli.js", body: "npx" },
      { name: "node-v24/bin/corepack", type: "2", linkName: "../lib/node_modules/corepack/dist/corepack.js", mode: 0o777 },
      { name: "node-v24/bin/npm", type: "2", linkName: "../lib/node_modules/npm/bin/npm-cli.js", mode: 0o777 },
      { name: "node-v24/bin/npx", type: "2", linkName: "../lib/node_modules/npm/bin/npx-cli.js", mode: 0o777 },
    ]);
    await extractSafeTarGz(gzipSync(archive), root);

    const runtime = path.join(root, "node-v24", "bin", "node");
    await access(runtime, constants.X_OK);
    assert.equal((await execFileAsync(runtime)).stdout, "managed-node-ok\n");
    const npm = path.join(root, "node-v24", "bin", "npm");
    assert.ok((await lstat(npm)).isSymbolicLink());
    assert.equal(await readlink(npm), "../lib/node_modules/npm/bin/npm-cli.js");
    assert.equal(await readFile(npm, "utf8"), "npm");
    assert.equal(await readFile(path.join(root, "node-v24", "bin", "npx"), "utf8"), "npx");
    assert.equal(await readFile(path.join(root, "node-v24", "bin", "corepack"), "utf8"), "corepack");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe tar extraction rejects escaping links and unsupported hard links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-links-"));
  try {
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "2", linkName: "../../../outside" },
      ])), root),
      /link target escapes/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "1", linkName: "node-v24/bin/node" },
      ])), root),
      /unsupported entry type/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/bin/npm", type: "2", linkName: "/tmp/outside" },
      ])), root),
      /link target is absolute/,
    );
    await assert.rejects(
      extractSafeTarGz(gzipSync(tarArchive([
        { name: "node-v24/lib", type: "2", linkName: "internal" },
        { name: "node-v24/lib/package.js", body: "package" },
      ])), root),
      /could not create symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe zip extraction checks central and local entry boundaries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coven-managed-node-zip-"));
  try {
    await extractSafeZip(storedZip("node-v22/npm.txt", "npm"), root);
    assert.equal(await readFile(path.join(root, "node-v22", "npm.txt"), "utf8"), "npm");
    await assert.rejects(extractSafeZip(storedZip("../outside", "no"), root), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed Node paths are user-scoped and never point at a system installation", () => {
  const paths = managedNodePaths("win32", "x64", { LOCALAPPDATA: "C:\\Users\\Sage\\AppData\\Local" } as unknown as NodeJS.ProcessEnv, "C:\\Users\\Sage");
  assert.ok(paths);
  assert.match(paths.root, /OpenCoven[\\/]CovenCave[\\/]toolchains/);
  assert.match(paths.node, /node\.exe$/);
  const env = managedNodeSpawnEnv({ PATH: "C:\\Windows\\System32" } as unknown as NodeJS.ProcessEnv, paths);
  assert.ok(env);
  assert.equal(env.NPM_CONFIG_PREFIX, paths.npmPrefix);
  assert.match(env.PATH ?? "", /CovenCave/);
  assert.equal(managedNodeRoot("linux", { XDG_DATA_HOME: "/home/sage/.local/share" } as unknown as NodeJS.ProcessEnv, "/home/sage"), "/home/sage/.local/share/opencoven/coven-cave/toolchains");
});

test("managed Node probe distinguishes an absent toolchain from an unusable one", async () => {
  const missing = await probeManagedNodeToolchain({ platform: "linux", architecture: "x64", home: path.join(tmpdir(), "missing-coven-node") });
  assert.equal(missing.status, "missing");
});

test("managed Node probe gives npm a cold-start budget without slowing the Node check", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-probe-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  const calls: Array<{ args: readonly string[]; timeout: number | undefined }> = [];
  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args, options) => {
        calls.push({ args, timeout: options?.timeout });
        return {
          stdout: args[0] === "--version" ? `v${MANAGED_NODE_VERSION}\n` : "11.0.0\n",
          stderr: "",
        };
      },
    });

    assert.equal(probe.status, "ready");
    assert.deepEqual(calls.map(({ args, timeout }) => ({ args, timeout })), [
      { args: ["--version"], timeout: 1_500 },
      { args: [paths.npmCli, "--version"], timeout: 15_000 },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node probe labels npm timeouts with an actionable deadline", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-timeout-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args) => {
        if (args[0] === "--version") return { stdout: `v${MANAGED_NODE_VERSION}\n`, stderr: "" };
        throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
      },
    });

    assert.equal(probe.status, "unusable");
    assert.match(probe.detail, /Managed npm probe timed out after 15000ms/);
    assert.match(probe.detail, /Retry setup/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node probe preserves non-timeout errors", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-error-"));
  const env = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const paths = managedNodePaths("linux", "x64", env, home);
  assert.ok(paths);
  await mkdir(path.dirname(paths.node), { recursive: true });
  await mkdir(path.dirname(paths.npmCli), { recursive: true });
  await writeFile(paths.node, "");
  await writeFile(paths.npmCli, "");

  try {
    const probe = await probeManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env,
      home,
      exec: async (_command, args) => {
        if (args[0] === "--version") return { stdout: `v${MANAGED_NODE_VERSION}\n`, stderr: "" };
        throw new Error("npm package metadata is corrupt");
      },
    });

    assert.deepEqual(probe, {
      status: "unusable",
      detail: "npm package metadata is corrupt",
      paths,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

function approvedResponse(body = "managed-node-test-archive"): Response {
  const artifact = nodeArchiveFor("linux", "x64");
  assert.ok(artifact);
  const response = new Response(body, {
    status: 200,
    headers: { "content-length": String(Buffer.byteLength(body)) },
  });
  Object.defineProperty(response, "url", { value: artifact.url });
  return response;
}

const TEST_ENV = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;

test("managed Node installer distinguishes an already-ready toolchain", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-ready-"));
  const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
  assert.ok(paths);
  try {
    const result = await installManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env: TEST_ENV,
      home,
      dependencies: {
        probe: async () => ({
          status: "ready",
          version: MANAGED_NODE_VERSION,
          paths,
        }),
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.outcome, "already_ready");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node installer honors cancellation before any installation work", async (t) => {
  await t.test("an initially aborted signal", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-aborted-"));
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    assert.ok(paths);
    let probed = false;
    const controller = new AbortController();
    controller.abort();
    try {
      const result = await installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        signal: controller.signal,
        dependencies: {
          probe: async () => {
            probed = true;
            return { status: "missing", paths };
          },
        },
      });
      assert.equal(result.ok, false);
      assert.equal(probed, false, "an aborted job does not even probe the managed binaries");
      await assert.rejects(access(paths.stagingRoot));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  await t.test("cancellation during the bounded readiness probe", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-probe-cancel-"));
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    assert.ok(paths);
    let fetched = false;
    const controller = new AbortController();
    let resolveProbe!: () => void;
    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const probeReleased = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    try {
      const pending = installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        signal: controller.signal,
        fetch: async () => {
          fetched = true;
          return approvedResponse();
        },
        dependencies: {
          probe: async () => {
            markProbeStarted();
            await probeReleased;
            return { status: "missing", paths };
          },
        },
      });
      await probeStarted;
      controller.abort();
      resolveProbe();
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(fetched, false, "cancellation after the probe fences download and extraction");
      await assert.rejects(access(paths.stagingRoot));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

test("managed Node installer fences cancellation between staged runtime commit operations", async (t) => {
  const candidateArtifact = nodeArchiveFor("linux", "x64");
  if (!candidateArtifact) throw new Error("expected approved Linux x64 Node artifact");
  const artifact: NonNullable<ReturnType<typeof nodeArchiveFor>> = candidateArtifact;

  async function runCancellationAtRemoval(
    removal: "temporary" | "installed",
  ): Promise<string[]> {
    const home = await mkdtemp(path.join(tmpdir(), `coven-node-commit-${removal}-`));
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    assert.ok(paths);
    const controller = new AbortController();
    const renames: string[] = [];
    let releaseRemoval!: () => void;
    let removalStarted!: () => void;
    const removalPending = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    const removalStartedPromise = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    let probes = 0;
    try {
      const pending = installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        signal: controller.signal,
        fetch: async () => approvedResponse(),
        dependencies: {
          digest: () => artifact.sha256,
          extractArchive: async (_format, _archive, destination) => {
            await mkdir(path.join(destination, `node-v${MANAGED_NODE_VERSION}-linux-x64`), { recursive: true });
          },
          probe: async () => {
            probes += 1;
            return probes === 1
              ? { status: "missing", paths }
              : { status: "ready", version: MANAGED_NODE_VERSION, paths };
          },
          remove: async (target, options) => {
            const targetPath = String(target);
            const shouldPause = removal === "temporary"
              ? targetPath.includes(".tmp-")
              : targetPath === paths.installDir;
            if (shouldPause) {
              removalStarted();
              await removalPending;
            }
            await rm(target, options);
          },
          rename: async (source, destination) => {
            renames.push(`${source}->${destination}`);
            await rename(source, destination);
          },
        },
      });
      await removalStartedPromise;
      controller.abort();
      releaseRemoval();
      const result = await pending;
      assert.equal(result.ok, false);
      return renames;
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  await t.test("before staging rename", async () => {
    assert.deepEqual(await runCancellationAtRemoval("temporary"), []);
  });
  await t.test("before final replacement rename", async () => {
    const renames = await runCancellationAtRemoval("installed");
    assert.equal(renames.length, 1, "only the already-completed staging move may run");
  });

  await t.test("after runtime-directory inspection and before parent creation", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-node-runtime-inspection-cancel-"));
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    assert.ok(paths);
    const controller = new AbortController();
    let releaseInspection!: () => void;
    let inspectionStarted!: () => void;
    const inspectionPending = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    const inspectionStartedPromise = new Promise<void>((resolve) => {
      inspectionStarted = resolve;
    });
    try {
      const pending = installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        signal: controller.signal,
        fetch: async () => approvedResponse(),
        dependencies: {
          digest: () => artifact.sha256,
          extractArchive: async (_format, _archive, destination) => {
            await mkdir(path.join(destination, `node-v${MANAGED_NODE_VERSION}-linux-x64`), { recursive: true });
          },
          runtimeDirectory: async (extracted) => {
            inspectionStarted();
            await inspectionPending;
            return path.join(extracted, `node-v${MANAGED_NODE_VERSION}-linux-x64`);
          },
          probe: async () => ({ status: "missing", paths }),
        },
      });
      await inspectionStartedPromise;
      controller.abort();
      releaseInspection();
      const result = await pending;
      assert.equal(result.ok, false);
      await assert.rejects(access(path.dirname(paths.installDir)));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

test("managed Node installer reports a successful reviewed installation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-managed-node-install-"));
  const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
  const artifact = nodeArchiveFor("linux", "x64");
  assert.ok(paths);
  assert.ok(artifact);
  let probes = 0;
  try {
    const result = await installManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env: TEST_ENV,
      home,
      fetch: async () => approvedResponse(),
      dependencies: {
        digest: () => artifact.sha256,
        extractArchive: async (_format, _archive, destination) => {
          const runtime = path.join(destination, `node-v${MANAGED_NODE_VERSION}-linux-x64`);
          await mkdir(runtime, { recursive: true });
          await writeFile(path.join(runtime, "reviewed-runtime"), "ready");
        },
        probe: async () => {
          probes += 1;
          return probes === 1
            ? { status: "missing", paths }
            : { status: "ready", version: MANAGED_NODE_VERSION, paths };
        },
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.outcome, "installed");
    assert.equal(await readFile(path.join(paths.installDir, "reviewed-runtime"), "utf8"), "ready");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node installer classifies download, integrity, archive, and verification failures", async (t) => {
  await t.test("download", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-node-download-"));
    try {
      const result = await installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        fetch: async () => {
          throw new Error("network download failed");
        },
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "download_failed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  await t.test("integrity", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-node-integrity-"));
    try {
      const result = await installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        fetch: async () => approvedResponse("wrong digest"),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "integrity_check_failed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  await t.test("archive", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-node-archive-"));
    const artifact = nodeArchiveFor("linux", "x64");
    assert.ok(artifact);
    try {
      const result = await installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        fetch: async () => approvedResponse(),
        dependencies: {
          digest: () => artifact.sha256,
          extractArchive: async () => {
            throw new Error("archive extraction rejected an entry type");
          },
        },
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "archive_failed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  await t.test("verification", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "coven-node-verification-"));
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    const artifact = nodeArchiveFor("linux", "x64");
    assert.ok(paths);
    assert.ok(artifact);
    let probes = 0;
    try {
      const result = await installManagedNodeToolchain({
        platform: "linux",
        architecture: "x64",
        env: TEST_ENV,
        home,
        fetch: async () => approvedResponse(),
        dependencies: {
          digest: () => artifact.sha256,
          extractArchive: async (_format, _archive, destination) => {
            await mkdir(
              path.join(
                destination,
                `node-v${MANAGED_NODE_VERSION}-linux-x64`,
              ),
              { recursive: true },
            );
          },
          probe: async () => {
            probes += 1;
            return probes === 1
              ? { status: "missing", paths }
              : { status: "unusable", detail: "npm did not start", paths };
          },
        },
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure, "verification_failed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

test("managed Node download deadline covers a stalled response body", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-node-body-timeout-"));
  const artifact = nodeArchiveFor("linux", "x64");
  assert.ok(artifact);
  let bodyCancelled = false;
  try {
    const result = await installManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env: TEST_ENV,
      home,
      fetch: async () => {
        const response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial archive"));
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 200 },
        );
        Object.defineProperty(response, "url", { value: artifact.url });
        return response;
      },
      dependencies: { downloadTimeoutMs: 10 },
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "install_timeout");
    assert.equal(bodyCancelled, true, "the pending body reader is cancelled");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node filesystem failures probe the exact active write directory", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-node-write-target-"));
  const artifact = nodeArchiveFor("linux", "x64");
  assert.ok(artifact);
  let probedDirectory = "";
  try {
    const result = await installManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env: TEST_ENV,
      home,
      fetch: async () => approvedResponse(),
      dependencies: {
        digest: () => artifact.sha256,
        extractArchive: async () => {
          throw Object.assign(new Error("filesystem denied extraction"), {
            code: "EACCES",
          });
        },
        writeProbe: async (directory) => {
          probedDirectory = directory;
          return { exists: true, writeProbe: "failed" };
        },
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure, "application_data_not_writable");
      assert.deepEqual(result.applicationData, {
        exists: true,
        writeProbe: "failed",
      });
    }
    assert.equal(path.basename(probedDirectory), "extracted");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed Node failure classification keeps known categories stable", () => {
  assert.equal(classifyManagedNodeInstallError(new Error("fetch failed")), "download_failed");
  assert.equal(classifyManagedNodeInstallError(new Error("checksum mismatch")), "integrity_check_failed");
  assert.equal(classifyManagedNodeInstallError(new Error("extract archive failed")), "archive_failed");
  assert.equal(classifyManagedNodeInstallError(new Error("request timed out")), "install_timeout");
  assert.equal(classifyManagedNodeInstallError(Object.assign(new Error("rename failed"), { code: "EACCES" })), "filesystem_failed");
  assert.equal(classifyManagedNodeInstallError(new Error("opaque EWHAT")), "unknown_failure");
});

test("unsupported managed Node platforms fail before any download", async () => {
  let fetched = false;
  const result = await installManagedNodeToolchain({
    platform: "freebsd",
    architecture: "x64",
    fetch: async () => {
      fetched = true;
      return approvedResponse();
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "unsupported_platform");
  assert.equal(fetched, false);
});
