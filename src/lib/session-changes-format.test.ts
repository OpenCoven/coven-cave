/**
 * The rail's line for a checkpoint restore (#5756): it says what came back,
 * and names the files it left alone because they changed after the checkpoint.
 */

import assert from "node:assert/strict";
import { checkpointRestoreMessage } from "./session-changes-format.ts";

assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", { restored: ["a.txt"], unchanged: ["b.txt"], kept: [] }),
  "Restored 1 file from checkpoint Oct 3, 01:02. The state before restoring is saved as a new checkpoint.",
);
assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", { restored: ["a.txt", "c.txt"], kept: ["b.txt"] }),
  "Restored 2 files from checkpoint Oct 3, 01:02. Kept b.txt as it is: changed after the checkpoint. The state before restoring is saved as a new checkpoint.",
);
assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", { restored: [], kept: ["a", "b", "c", "d", "e"] }),
  "Nothing restored from checkpoint Oct 3, 01:02. Kept a, b, c and 2 more as they are: changed after the checkpoint.",
);
assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", { restored: [], unchanged: ["a.txt"], kept: [] }),
  "Nothing to restore: the files already match checkpoint Oct 3, 01:02.",
);
assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", {}),
  "Nothing to restore: the files already match checkpoint Oct 3, 01:02.",
  "an older server's reply without the lists still reads sensibly",
);

assert.equal(
  checkpointRestoreMessage("Oct 3, 01:02", { restored: "2026-10-03T01-02-00-000Z.patch" } as never),
  "Nothing to restore: the files already match checkpoint Oct 3, 01:02.",
  "the old reply named the checkpoint in `restored`; it isn't a file list",
);

console.log("session-changes-format: ok");
