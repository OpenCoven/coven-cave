import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative);
}

async function snapshotIdentity(files) {
  return Promise.all(files.map(async (file) => [file, await readFile(file)]));
}

async function assertIdentityUnchanged(snapshot) {
  for (const [file, expected] of snapshot) {
    const actual = await readFile(file);
    if (!actual.equals(expected)) {
      throw new Error(`recovery identity file changed while injecting staged tools: ${file}`);
    }
  }
}

async function treeDigest(root) {
  const entries = [];

  async function visit(directory, relative = "") {
    const details = await lstat(directory);
    if (details.isSymbolicLink()) {
      throw new Error(`recovery tools tree must not contain symlinks: ${directory}`);
    }
    if (!details.isDirectory()) {
      throw new Error(`recovery tools root must be a directory: ${directory}`);
    }

    const children = await readdir(directory, {
      withFileTypes: true,
    });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = path.join(directory, child.name);
      const childRelative = path.join(relative, child.name);
      const childDetails = await lstat(childPath);
      if (childDetails.isSymbolicLink()) {
        throw new Error(`recovery tools tree must not contain symlinks: ${childPath}`);
      }
      if (childDetails.isDirectory()) {
        entries.push({ path: childRelative, type: "directory", mode: childDetails.mode & 0o777 });
        await visit(childPath, childRelative);
      } else if (childDetails.isFile()) {
        entries.push({
          path: childRelative,
          type: "file",
          mode: childDetails.mode & 0o777,
          sha256: hash(await readFile(childPath)),
        });
      } else {
        throw new Error(`recovery tools tree contains an unsupported entry: ${childPath}`);
      }
    }
  }

  await visit(root);
  return entries;
}

export async function injectStagedCoreTools({ source, dest, preserve = [] }) {
  const sourceRoot = path.resolve(source);
  const destRoot = path.resolve(dest);
  const identities = preserve.map((file) => path.resolve(file));

  if (sourceRoot === destRoot || isDescendant(sourceRoot, destRoot) || isDescendant(destRoot, sourceRoot)) {
    throw new Error("recovery tools source and destination must be disjoint");
  }
  for (const identity of identities) {
    if (identity === destRoot || isDescendant(destRoot, identity)) {
      throw new Error(`recovery identity file must not be inside the tools destination: ${identity}`);
    }
  }

  const [sourceTree, identitySnapshot] = await Promise.all([
    treeDigest(sourceRoot),
    snapshotIdentity(identities),
  ]);
  const parent = path.dirname(destRoot);
  await mkdir(parent, { recursive: true });
  const stageRoot = await mkdtemp(path.join(parent, `${path.basename(destRoot)}.recovery-stage-`));
  const stagedTools = path.join(stageRoot, "tools");
  const backupRoot = `${destRoot}.recovery-backup-${process.pid}`;
  let backedUp = false;

  try {
    await cp(sourceRoot, stagedTools, { recursive: true, verbatimSymlinks: true });
    const stagedTree = await treeDigest(stagedTools);
    if (JSON.stringify(stagedTree) !== JSON.stringify(sourceTree)) {
      throw new Error("recovery tools copy does not match the verified staged source");
    }

    try {
      await rename(destRoot, backupRoot);
      backedUp = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(stagedTools, destRoot);
    await assertIdentityUnchanged(identitySnapshot);
    await rm(backupRoot, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
  } catch (error) {
    try {
      if (backedUp) {
        await rm(destRoot, { recursive: true, force: true });
        await rename(backupRoot, destRoot);
      }
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

function parseArgs(args) {
  const parsed = { preserve: [] };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`${option} requires a value`);
    if (option === "--source") parsed.source = value;
    else if (option === "--dest") parsed.dest = value;
    else if (option === "--preserve") parsed.preserve.push(value);
    else throw new Error(`unknown option: ${option}`);
  }
  if (!parsed.source || !parsed.dest || parsed.preserve.length === 0) {
    throw new Error("usage: recovery-core-tools.mjs --source <tools> --dest <tools> --preserve <identity-file> [...]");
  }
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  injectStagedCoreTools(parsed).catch((error) => {
    process.stderr.write(`recovery-core-tools: ${error.message}\n`);
    process.exitCode = 1;
  });
}
