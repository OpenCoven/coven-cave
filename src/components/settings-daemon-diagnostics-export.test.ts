// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #6298 slice 4: the daemon control sheet exports the bounded, redacted
// diagnostics bundle. Source pins keep the control bound to the shared
// contract in daemon-diagnostics-export.ts rather than to an ad-hoc fetch.
const daemon = readFileSync(new URL("./settings-daemon.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/settings-daemon.css", import.meta.url), "utf8");

assert.match(
  daemon,
  /import \{[\s\S]*?daemonDiagnosticsExportFilename,[\s\S]*?parseDaemonDiagnosticsBundle,[\s\S]*?serializeDaemonDiagnosticsBundle,[\s\S]*?\} from "@\/lib\/daemon-diagnostics-export"/,
  "the control uses the shared export contract",
);
assert.match(
  daemon,
  /fetch\("\/api\/daemon\/diagnostics", \{ cache: "no-store"/,
  "the export reads the live bundle, never a cached one",
);
assert.match(
  daemon,
  /const parsed = parseDaemonDiagnosticsBundle\(await res\.json\(\)\);[\s\S]*?if \(!parsed\.ok\) throw new Error/,
  "a response that is not the redacted bundle is refused before it can be saved under the diagnostics name",
);
assert.match(
  daemon,
  /new Blob\(\[serializeDaemonDiagnosticsBundle\(parsed\.bundle\)\], \{ type: "application\/json" \}\)/,
  "the saved file is the serialized bundle",
);
assert.match(
  daemon,
  /link\.download = daemonDiagnosticsExportFilename\(parsed\.generatedAt\);/,
  "the filename carries the bundle's own generation instant",
);
assert.match(
  daemon,
  /requestAnimationFrame\(\(\) => URL\.revokeObjectURL\(url\)\);/,
  "the object URL outlives the click so Safari does not cancel the download",
);
assert.match(
  daemon,
  /copyText\(serializeDaemonDiagnosticsBundle\(parsed\.bundle\)\)/,
  "copying places the same serialized bundle on the clipboard for webviews without a download sink",
);
assert.match(daemon, />\s*Export diagnostics\s*</, "the status card offers the export");
assert.match(daemon, /aria-label="Copy diagnostics"/, "the status card offers a copy fallback");
assert.match(
  daemon,
  /\{exportError \? <p className="settings-daemon-inline-error" role="alert">\{exportError\}<\/p> : null\}/,
  "an export failure is announced inline like the other daemon actions",
);
assert.match(
  daemon,
  /no credentials, paths, command output, or conversation content/,
  "the control states the bundle's privacy rule where the person decides to send it",
);
assert.match(daemon, /className="settings-daemon-diagnostics"/, "the export lives in its own status-card row");
assert.match(css, /\.settings-daemon-diagnostics \{/, "the diagnostics row has its own styles in the daemon sheet");

console.log("settings-daemon-diagnostics-export.test.ts: ok");
