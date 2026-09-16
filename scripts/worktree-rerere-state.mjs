import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Validate one opened entry without following replacement symlinks or blocking on FIFOs. */
export function assertEmptyRegularRerere(file, io = fs) {
  const before = io.lstatSync(file);
  const empty = (stat) => stat.isFile() && stat.size === 0;
  if (!empty(before)) throw new Error("MERGE_RR is not an empty regular file");
  const fd = io.openSync(file, fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = io.fstatSync(fd);
    const sameEntry = (stat) => empty(stat) && stat.dev === before.dev && stat.ino === before.ino;
    if (!sameEntry(opened) || io.readSync(fd, Buffer.alloc(1), 0, 1, 0) !== 0 ||
        !sameEntry(io.fstatSync(fd)) || !sameEntry(io.lstatSync(file))) {
      throw new Error("MERGE_RR changed during inspection");
    }
  } finally {
    io.closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("expected one MERGE_RR path");
    assertEmptyRegularRerere(process.argv[2]);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
