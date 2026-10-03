import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Prove residue contains only the audited commit's tree, without following replacements. */
export function assertCommittedAutoMerge(file, expectedTree, io = fs) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedTree)) {
    throw new Error("AUTO_MERGE expected tree is not a full OID");
  }
  const expected = Buffer.from(`${expectedTree}\n`);
  const before = io.lstatSync(file, { bigint: true });
  const regular = (stat) => stat.isFile() && stat.size === BigInt(expected.length);
  const identity = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  if (!regular(before)) throw new Error("AUTO_MERGE is not a bounded regular tree file");
  const original = identity(before);
  const sameEntry = (stat) => regular(stat) && identity(stat) === original;
  const fd = io.openSync(file, fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    // One extra byte rejects growth without reading an unbounded recovery file.
    const content = Buffer.alloc(expected.length + 1);
    if (!sameEntry(io.fstatSync(fd, { bigint: true })) ||
        io.readSync(fd, content, 0, content.length, 0) !== expected.length ||
        !content.subarray(0, expected.length).equals(expected) ||
        !sameEntry(io.fstatSync(fd, { bigint: true })) ||
        !sameEntry(io.lstatSync(file, { bigint: true }))) {
      throw new Error("AUTO_MERGE differs from the committed tree or changed during inspection");
    }
    return original;
  } finally {
    io.closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("expected AUTO_MERGE path and audited tree OID");
    assertCommittedAutoMerge(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
