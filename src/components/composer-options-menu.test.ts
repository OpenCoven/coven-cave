import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  assert.ok(existsSync(path), `${relativePath} should exist`);
  return readFileSync(path, "utf8");
};

const source = read("./composer-options-menu.tsx");
const hosts = read("./composer-host-chip.tsx");
const popover = read("./ui/popover.tsx");

assert.match(source, /export function useComposerResponseHosts\(hostValue: string\)/);
assert.match(
  source,
  /load: \(force\?: boolean\) => Promise<boolean>/,
  "the response-host controller preserves the host loader's success result",
);
assert.match(
  source,
  /const \{ hostOptions, load, removeHost \} = useComposerResponseHosts\(hostValue\);/,
);
assert.match(
  source,
  /export function ComposerResponseSections\(\{[\s\S]*?hostValue,[\s\S]*?hostOptions,[\s\S]*?onHostPick,[\s\S]*?onRemoveHost,/,
);
assert.match(source, /onRemoveHost=\{\(host\) => void removeHost\(host\)\}/);
assert.match(
  source,
  /const hostRefreshPending = useRef\(false\);[\s\S]*?const hostsLoaded = useRef\(false\);[\s\S]*?useEffect\(\(\) => \{[\s\S]*?if \(!open\) return;[\s\S]*?const force = hostRefreshPending\.current;[\s\S]*?if \(hostsLoaded\.current && !force\) return;[\s\S]*?hostRefreshPending\.current = false;[\s\S]*?if \(force\) hostsLoaded\.current = false;[\s\S]*?void load\(force\)\.then\(\(loaded\) => \{[\s\S]*?if \(!cancelled && loaded\) hostsLoaded\.current = true;/,
  "the options menu caches only successful host loads and retries failures on the next open",
);
assert.match(
  source,
  /onConnected=\{\(host\) => \{[\s\S]*?onHostPick\(host\);[\s\S]*?hostRefreshPending\.current = true;[\s\S]*?\}\}/,
);
assert.doesNotMatch(source, /hostRefreshKey/);
assert.doesNotMatch(
  source,
  /hostsLoaded\.current = true;\s*\n\s*void load/,
  "the options menu must not mark hosts loaded before the request succeeds",
);

assert.match(
  hosts,
  /load: \(force\?: boolean\) => Promise<boolean>/,
  "useComposerHosts reports whether either host response was valid",
);
assert.match(
  hosts,
  /let loaded = false;[\s\S]*?quick\?\.ok && Array\.isArray\(quick\.hosts\)[\s\S]*?loaded = true;[\s\S]*?probed\?\.ok && Array\.isArray\(probed\.hosts\)[\s\S]*?loaded = true;[\s\S]*?return loaded;/,
  "quick or probed valid host lists make load succeed; two failures return false",
);
assert.match(
  hosts,
  /const inFlight = useRef<Promise<boolean> \| null>\(null\);/,
  "useComposerHosts keeps the active request promise so normal callers can await it",
);
assert.match(
  hosts,
  /const queuedForcedLoad = useRef<Promise<boolean> \| null>\(null\);/,
  "useComposerHosts deduplicates forced refreshes queued behind one active request",
);
assert.match(
  hosts,
  /if \(!force\) return active;/,
  "a normal load during an active request reuses that request's success result",
);
assert.match(
  hosts,
  /if \(queuedForcedLoad\.current\) return queuedForcedLoad\.current;/,
  "multiple forced loads during the same active request share one queued refresh",
);
assert.match(
  hosts,
  /active\.then\(startQueuedLoad, startQueuedLoad\)/,
  "a forced load waits for the active request to settle before starting fresh",
);
assert.doesNotMatch(
  hosts,
  /return load\(/,
  "the serialized loader must not use recursive load calls",
);

assert.match(
  source,
  /usePopoverInitialFocus\(open, "\.composer-options__panel"\);/,
  "opening the options panel moves focus into its portaled content",
);
assert.match(
  popover,
  /export function usePopoverInitialFocus\([\s\S]*?requestAnimationFrame[\s\S]*?button:not\(:disabled\)[\s\S]*?\.focus\(\)[\s\S]*?cancelAnimationFrame/,
  "the shared popover focus helper waits for portal mount, focuses an enabled control, and cancels stale work",
);

console.log("composer-options-menu.test.ts: ok");
