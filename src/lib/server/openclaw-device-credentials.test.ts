// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createOpenClawDeviceCredentialStore,
  openClawDeviceCredentialStoreStatus,
  openClawPublicKeyRawBase64UrlFromPem,
  signOpenClawDevicePayload,
} from "./openclaw-device-credentials.ts";

const SERVICE = "coven-cave.openclaw-gateway";

/**
 * In-memory stand-in for the macOS keychain, speaking the exact `security`
 * invocations the store issues. Every test in this file is hermetic: the real
 * `/usr/bin/security` binary and keychain are never touched.
 */
function fakeKeychain() {
  const items = new Map();
  const invocations = [];
  const runSecurity = (args, input) => {
    invocations.push({ args, input });
    if (args[0] === "find-generic-password") {
      assert.deepEqual(args, ["find-generic-password", "-s", SERVICE, "-a", args[4], "-w"]);
      const secret = items.get(args[4]);
      if (secret === undefined) return { status: 44, stdout: "" };
      return { status: 0, stdout: `${secret}\n` };
    }
    if (args[0] === "delete-generic-password") {
      assert.deepEqual(args, ["delete-generic-password", "-s", SERVICE, "-a", args[4]]);
      if (!items.has(args[4])) return { status: 44, stdout: "" };
      items.delete(args[4]);
      return { status: 0, stdout: "" };
    }
    // Writes must arrive in `-i` stdin command mode only: a secret on argv
    // would be visible to every process on the machine.
    assert.deepEqual(args, ["-i"], "keychain writes must use the security tool's stdin command mode");
    const match = /^add-generic-password( -U)? -s "([^"]+)" -a "([^"]+)" -w "([^"]+)"\n$/.exec(input);
    assert.ok(match, `unparseable security -i command: ${JSON.stringify(input)}`);
    const [, update, service, account, secret] = match;
    assert.equal(service, SERVICE);
    if (!update && items.has(account)) return { status: 45, stdout: "" };
    items.set(account, secret);
    return { status: 0, stdout: "" };
  };
  return { items, invocations, runSecurity };
}

function darwinStore(keychain, overrides = {}) {
  return createOpenClawDeviceCredentialStore({
    platform: "darwin",
    securityBinaryExists: () => true,
    runSecurity: keychain.runSecurity,
    ...overrides,
  });
}

// --- availability ----------------------------------------------------------

assert.deepEqual(
  openClawDeviceCredentialStoreStatus({ platform: "linux" }),
  {
    available: false,
    reason:
      "OpenClaw Gateway dispatch requires the macOS Keychain credential store; linux has no supported OS credential store",
  },
  "non-macOS platforms fail closed",
);
assert.deepEqual(
  openClawDeviceCredentialStoreStatus({ platform: "win32" }).available,
  false,
  "windows fails closed",
);
assert.deepEqual(
  openClawDeviceCredentialStoreStatus({ platform: "darwin", securityBinaryExists: () => false }),
  { available: false, reason: "The macOS security tool is unavailable for the OpenClaw credential store" },
  "macOS without the security tool fails closed",
);
assert.deepEqual(
  openClawDeviceCredentialStoreStatus({
    platform: "darwin",
    securityBinaryExists: () => true,
    runSecurity: () => assert.fail("a status probe must not touch the keychain"),
  }),
  { available: true },
  "the status probe is a platform/tool check only",
);
assert.throws(
  () => createOpenClawDeviceCredentialStore({ platform: "linux" }).loadOrCreateDeviceIdentity(),
  /no supported OS credential store/,
  "identity resolution on an unsupported platform throws instead of inventing an unpaired identity",
);

// --- device identity lifecycle ---------------------------------------------

const keychain = fakeKeychain();
const store = darwinStore(keychain);
const identity = store.loadOrCreateDeviceIdentity();
assert.match(identity.deviceId, /^[0-9a-f]{64}$/, "deviceId is the sha256 fingerprint of the raw public key");
// Functional PEM validation (stronger than shape-matching the markers): the
// stored material must parse as an Ed25519 pair.
assert.equal(crypto.createPublicKey(identity.publicKeyPem).asymmetricKeyType, "ed25519");
assert.equal(crypto.createPrivateKey(identity.privateKeyPem).asymmetricKeyType, "ed25519");
assert.equal(
  identity.deviceId,
  crypto
    .createHash("sha256")
    .update(Buffer.from(openClawPublicKeyRawBase64UrlFromPem(identity.publicKeyPem), "base64url"))
    .digest("hex"),
  "deviceId matches the reference fingerprint derivation (sha256 of the raw Ed25519 public key)",
);

const again = darwinStore(keychain).loadOrCreateDeviceIdentity();
assert.deepEqual(again, identity, "a second resolution returns the persisted identity, never a fresh keypair");

for (const invocation of keychain.invocations) {
  const printable = invocation.args.join(" ");
  assert.ok(
    !printable.includes(identity.privateKeyPem) && !printable.includes("PRIVATE KEY"),
    "no invocation may carry key material on argv",
  );
}

// --- crypto contract ---------------------------------------------------------

const raw = Buffer.from(openClawPublicKeyRawBase64UrlFromPem(identity.publicKeyPem), "base64url");
assert.equal(raw.length, 32, "the Gateway contract sends the raw 32-byte Ed25519 public key");
const signature = signOpenClawDevicePayload(identity.privateKeyPem, "challenge-payload");
assert.ok(
  crypto.verify(
    null,
    Buffer.from("challenge-payload", "utf8"),
    crypto.createPublicKey(identity.publicKeyPem),
    Buffer.from(signature, "base64url"),
  ),
  "signatures verify against the stored public key (base64url raw Ed25519)",
);
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
assert.throws(
  () => signOpenClawDevicePayload(rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "x"),
  /not an Ed25519 key/,
  "non-Ed25519 key material is rejected instead of producing an unverifiable signature",
);
assert.throws(
  () => openClawPublicKeyRawBase64UrlFromPem(rsa.publicKey.export({ type: "spki", format: "pem" }).toString()),
  /not an Ed25519 key/,
);

// --- identity creation race ---------------------------------------------------

const raceWinner = fakeKeychain();
const winnerIdentity = darwinStore(raceWinner).loadOrCreateDeviceIdentity();
let raceReads = 0;
const racingStore = createOpenClawDeviceCredentialStore({
  platform: "darwin",
  securityBinaryExists: () => true,
  runSecurity: (args, input) => {
    if (args[0] === "find-generic-password") {
      raceReads += 1;
      // First read misses; by the time this process writes, another Cave
      // process has already persisted the paired identity.
      if (raceReads === 1) return { status: 44, stdout: "" };
      return raceWinner.runSecurity(args, input);
    }
    if (args[0] === "-i") return { status: 45, stdout: "" };
    return raceWinner.runSecurity(args, input);
  },
});
assert.deepEqual(
  racingStore.loadOrCreateDeviceIdentity(),
  winnerIdentity,
  "losing the identity-creation race adopts the winner's paired identity instead of clobbering it",
);

// --- invalid persisted identity ------------------------------------------------

const corrupt = fakeKeychain();
corrupt.items.set("device-identity", Buffer.from("not json").toString("base64"));
assert.throws(
  () => darwinStore(corrupt).loadOrCreateDeviceIdentity(),
  /invalid OpenClaw device identity/,
  "a corrupted identity fails loudly",
);
assert.equal(
  corrupt.items.get("device-identity"),
  Buffer.from("not json").toString("base64"),
  "a corrupted paired identity is never silently replaced — replacement would unpair the device",
);

const mismatched = fakeKeychain();
const otherIdentity = darwinStore(fakeKeychain()).loadOrCreateDeviceIdentity();
mismatched.items.set(
  "device-identity",
  Buffer.from(
    JSON.stringify({ version: 1, ...otherIdentity, deviceId: "f".repeat(64) }),
    "utf8",
  ).toString("base64"),
);
assert.throws(
  () => darwinStore(mismatched).loadOrCreateDeviceIdentity(),
  /invalid OpenClaw device identity/,
  "an identity whose deviceId does not match its key material is rejected",
);

// --- device token lifecycle ------------------------------------------------------

const tokenParams = { deviceId: identity.deviceId, role: "operator" };
assert.equal(store.loadDeviceAuthToken(tokenParams), null, "no stored token yields null, not a fabricated record");
store.storeDeviceAuthToken({ ...tokenParams, token: "minted-token", scopes: ["operator.read", "operator.write"] });
assert.deepEqual(
  store.loadDeviceAuthToken(tokenParams),
  { token: "minted-token", scopes: ["operator.read", "operator.write"] },
  "a minted device token round-trips through the keychain",
);
assert.equal(
  store.loadDeviceAuthToken({ deviceId: identity.deviceId, role: "node" }),
  null,
  "tokens are scoped per role",
);
store.storeDeviceAuthToken({ ...tokenParams, token: "rotated-token", scopes: ["operator.read"] });
assert.deepEqual(
  store.loadDeviceAuthToken(tokenParams),
  { token: "rotated-token", scopes: ["operator.read"] },
  "storing again updates the existing item",
);
store.clearDeviceAuthToken(tokenParams);
assert.equal(store.loadDeviceAuthToken(tokenParams), null, "cleared tokens stay cleared");
store.clearDeviceAuthToken(tokenParams); // idempotent: a missing item is not an error

// The token hooks swallow store errors by contract (a keychain hiccup on the
// connect path degrades to fresh pairing); a hostile role must therefore be
// rejected silently, and above all must never reach a keychain command line.
store.storeDeviceAuthToken({ deviceId: identity.deviceId, role: 'operator" -w "x', token: "t", scopes: [] });
assert.equal(
  [...keychain.items.keys()].some((account) => account.includes('"')),
  false,
  "no keychain account may embed quoting metacharacters",
);
assert.equal(
  store.loadDeviceAuthToken({ deviceId: identity.deviceId, role: 'operator" -w "x' }),
  null,
  "hostile role strings resolve to no stored token",
);

// A keychain failure while the connect path loads tokens degrades to
// "no stored token" instead of throwing into the Gateway client.
const failing = createOpenClawDeviceCredentialStore({
  platform: "darwin",
  securityBinaryExists: () => true,
  runSecurity: () => ({ status: 51, stdout: "" }),
});
assert.equal(failing.loadDeviceAuthToken(tokenParams), null);
failing.storeDeviceAuthToken({ ...tokenParams, token: "t", scopes: [] });
failing.clearDeviceAuthToken(tokenParams);

console.log("openclaw device credential store tests passed");
