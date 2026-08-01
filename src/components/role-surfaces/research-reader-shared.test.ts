import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./research-reader.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import \{[\s\S]*?DocumentReader[\s\S]*?\} from "@\/components\/document-reader"/,
  "Research Reader must compose the shared document core",
);
assert.match(
  source,
  /<DocumentReader[\s\S]*?document=\{doc\}/,
  "the source-aware findings model must flow through DocumentReader",
);
assert.match(
  source,
  /renderBlock=\{renderBlock\}/,
  "Research-specific block and citation rendering stays in its adapter",
);
assert.match(
  source,
  /navigation=\{expanded && tocOn \? "rail" : "none"\}/,
  "Research keeps its existing expanded-only contents behavior",
);
assert.match(source, /<aside className="rr-col rr-rail"/);
assert.match(source, /onRefClick/);
assert.match(source, /onPublish/);

console.log("research-reader-shared: all assertions passed");
