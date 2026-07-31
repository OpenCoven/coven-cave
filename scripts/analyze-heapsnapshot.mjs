// Streaming analyzer for multi-GB V8 .heapsnapshot files (cave-r13x).
//
// The heap monitor (server-heap-monitor, PR #3311) writes snapshots to
// <caveHome>/diagnostics/ at >=95% heap; in the wild they land at 5+ GB —
// beyond Chrome DevTools and far beyond JSON.parse's string limit. This
// streams the file once: parse the snapshot meta from the head, aggregate
// the nodes array by (type, name), skim to the trailing strings array and
// resolve only the names the report needs. True retained sizes need a
// dominator pass (out of budget at this scale); in practice the self-size
// ranking + instance counts + largest-single-nodes identify the growth
// class — the first two wild captures (issue #3803) were diagnosed to the
// Next dev server's HMR-generation + React dev debug accumulation from
// exactly this output.
//
//   usage: node scripts/analyze-heapsnapshot.mjs <path.heapsnapshot>
//
// Read-only over the snapshot; ~2-4 min per 5 GB; O(distinct names) memory.
import { createReadStream, statSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/analyze-heapsnapshot.mjs <snapshot>");
  process.exit(1);
}
const size = statSync(file).size;
console.log(`file: ${file} (${(size / 1e9).toFixed(2)} GB)`);

// ── Phase 0: meta from the head ──────────────────────────────────────────────
const head = await new Promise((resolve, reject) => {
  const chunks = [];
  let got = 0;
  const s = createReadStream(file, { start: 0, end: 512 * 1024 });
  s.on("data", (c) => {
    chunks.push(c);
    got += c.length;
  });
  s.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  s.on("error", reject);
});
const metaStart = head.indexOf('"meta":');
const nodesKey = head.indexOf('"nodes":[');
if (metaStart === -1 || nodesKey === -1) {
  console.error("unrecognized snapshot head");
  process.exit(1);
}
const nodeFields = JSON.parse(head.match(/"node_fields":(\[[^\]]*\])/)[1]);
const nodeTypes = JSON.parse(head.match(/"node_types":\[(\[[^\]]*\])/)[1]);
const F = nodeFields.length;
const I = Object.fromEntries(nodeFields.map((f, i) => [f, i]));
const countsMatch = head.match(/"node_count":(\d+),"edge_count":(\d+)/);
const nodeCount = Number(countsMatch?.[1] ?? 0);
console.log(`node_fields: ${nodeFields.join(",")} · node_count: ${nodeCount.toLocaleString()} · edge_count: ${Number(countsMatch?.[2] ?? 0).toLocaleString()}`);

// ── Phase 1: stream the nodes array, aggregate ───────────────────────────────
// Aggregates keyed by `${type}:${nameIdx}`; also track top single nodes.
const agg = new Map(); // key -> {count, self}
const topNodes = []; // {type, nameIdx, self} — keep worst 25
const TYPE_TOTALS = new Map();
let totalSelf = 0;

const nodesOffset = nodesKey + '"nodes":['.length;
await new Promise((resolve, reject) => {
  const s = createReadStream(file, { start: nodesOffset, highWaterMark: 8 * 1024 * 1024 });
  let field = 0;
  let cur = 0;
  let inNum = false;
  let tuple = new Array(F);
  let done = false;
  s.on("data", (buf) => {
    if (done) return;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 48 && b <= 57) {
        cur = cur * 10 + (b - 48);
        inNum = true;
      } else {
        if (inNum) {
          tuple[field++] = cur;
          cur = 0;
          inNum = false;
          if (field === F) {
            field = 0;
            const type = tuple[I.type];
            const nameIdx = tuple[I.name];
            const self = tuple[I.self_size];
            totalSelf += self;
            TYPE_TOTALS.set(type, (TYPE_TOTALS.get(type) ?? 0) + self);
            const key = type * 0x40000000 + nameIdx; // numeric key, cheap
            const cell = agg.get(key);
            if (cell) {
              cell.count++;
              cell.self += self;
            } else {
              agg.set(key, { type, nameIdx, count: 1, self });
            }
            if (self > 1024 * 1024) {
              topNodes.push({ type, nameIdx, self });
              if (topNodes.length > 400) {
                topNodes.sort((a, b) => b.self - a.self);
                topNodes.length = 25;
              }
            }
          }
        }
        if (b === 93) {
          // "]" — end of nodes array
          done = true;
          s.destroy();
          resolve();
          return;
        }
      }
    }
  });
  s.on("close", () => resolve());
  s.on("error", reject);
});
topNodes.sort((a, b) => b.self - a.self);
topNodes.length = Math.min(topNodes.length, 25);
console.log(`streamed ${[...agg.values()].reduce((n, c) => n + c.count, 0).toLocaleString()} nodes · total self ${(totalSelf / 1e9).toFixed(2)} GB · distinct (type,name) ${agg.size.toLocaleString()}`);

// ── Phase 2: find the strings array and resolve wanted names ─────────────────
const wanted = new Set();
const cells = [...agg.values()].sort((a, b) => b.self - a.self);
for (const c of cells.slice(0, 60)) wanted.add(c.nameIdx);
const byCount = [...agg.values()].sort((a, b) => b.count - a.count);
for (const c of byCount.slice(0, 30)) wanted.add(c.nameIdx);
for (const n of topNodes) wanted.add(n.nameIdx);

// Locate `"strings":[` — scan from 60% of the file forward in big chunks.
const tokenBuf = Buffer.from('"strings":[');
const stringsPos = await new Promise((resolve, reject) => {
  const start = Math.floor(size * 0.5);
  const s = createReadStream(file, { start, highWaterMark: 32 * 1024 * 1024 });
  let carry = Buffer.alloc(0);
  let offset = start;
  s.on("data", (buf) => {
    const hay = Buffer.concat([carry, buf]);
    const idx = hay.indexOf(tokenBuf);
    if (idx !== -1) {
      s.destroy();
      resolve(offset - carry.length + idx + tokenBuf.length);
      return;
    }
    carry = hay.subarray(Math.max(0, hay.length - tokenBuf.length));
    offset += buf.length;
  });
  s.on("close", () => resolve(-1));
  s.on("error", reject);
});
if (stringsPos === -1) {
  console.error("strings array not found");
  process.exit(1);
}

const names = new Map();
await new Promise((resolve, reject) => {
  const s = createReadStream(file, { start: stringsPos, highWaterMark: 8 * 1024 * 1024 });
  let idx = 0;
  let inStr = false;
  let esc = false;
  let cap = [];
  let capturing = false;
  s.on("data", (buf) => {
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (!inStr) {
        if (b === 34) {
          inStr = true;
          capturing = wanted.has(idx);
          cap = [];
        } else if (b === 93) {
          s.destroy();
          resolve();
          return;
        }
        continue;
      }
      if (esc) {
        if (capturing && cap.length < 120) cap.push(b);
        esc = false;
        continue;
      }
      if (b === 92) {
        esc = true;
        continue;
      }
      if (b === 34) {
        inStr = false;
        if (capturing) names.set(idx, Buffer.from(cap).toString("utf8"));
        idx++;
        if (names.size >= wanted.size) {
          s.destroy();
          resolve();
          return;
        }
        continue;
      }
      if (capturing && cap.length < 120) cap.push(b);
    }
  });
  s.on("close", () => resolve());
  s.on("error", reject);
});

// ── Report ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${(n / 1e3).toFixed(0)}KB`);
console.log("\n== self size by node TYPE ==");
for (const [t, s] of [...TYPE_TOTALS.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${(nodeTypes[t] ?? t).padEnd(18)} ${fmt(s)}`);
}
console.log("\n== top (type,name) by total self size ==");
for (const c of cells.slice(0, 40)) {
  console.log(`${fmt(c.self).padStart(9)}  ×${String(c.count).padStart(9)}  ${(nodeTypes[c.type] ?? c.type).padEnd(14)} ${names.get(c.nameIdx) ?? `#${c.nameIdx}`}`);
}
console.log("\n== top instance counts ==");
for (const c of byCount.slice(0, 15)) {
  console.log(`×${String(c.count).padStart(10)}  ${fmt(c.self).padStart(9)}  ${(nodeTypes[c.type] ?? c.type).padEnd(14)} ${names.get(c.nameIdx) ?? `#${c.nameIdx}`}`);
}
console.log("\n== largest single nodes ==");
for (const n of topNodes.slice(0, 20)) {
  console.log(`${fmt(n.self).padStart(9)}  ${(nodeTypes[n.type] ?? n.type).padEnd(14)} ${names.get(n.nameIdx) ?? `#${n.nameIdx}`}`);
}
