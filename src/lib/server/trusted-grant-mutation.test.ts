// @ts-nocheck
// Behavioral coverage for the desktop-opt-in mobile trust chain:
//   - requireTrustedHumanGrantMutation (grant/proposal mutation gate)
//   - requireTrustedHumanCanvasMutation (canvas write gate → iOS view mode)
//   - /api/mobile-permissions (the toggles route: GET open, PATCH loopback-only)
//   - assertProjectApiAccess human-mobile file-write branch
// The phone must never be able to widen its own authority; every mobile
// capability here is off until the desktop (loopback) enables it.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(tmpdir(), "trusted-grant-mutation-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
delete process.env.COVEN_CAVE_AUTH_TOKEN;

try {
  const { MOBILE_ACCESS_HEADER } = await import("../../proxy-helpers.ts");
  const {
    requireTrustedHumanGrantMutation,
    requireTrustedHumanCanvasMutation,
    isVerifiedMobileRequest,
  } = await import("./trusted-grant-mutation.ts");
  const { updateMobileWriteAccess } = await import("../project-permissions.ts");
  const { GET: getMobilePermissions, PATCH: patchMobilePermissions } = await import(
    "../../app/api/mobile-permissions/route.ts"
  );
  const { assertProjectApiAccess } = await import("./project-permission-requests.ts");

  const projectRoot = path.join(tmp, "registered-project");
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "cave", name: "Cave", root: projectRoot, createdAt: "now", updatedAt: "now" },
      ],
    }),
    "utf8",
  );

  const request = (headers: Record<string, string>, init: RequestInit = {}) =>
    new Request("http://example.test/api/anything", { ...init, headers });
  const loopback = (extra: Record<string, string> = {}, init: RequestInit = {}) =>
    request({ host: "127.0.0.1:3000", ...extra }, init);
  const mobile = (extra: Record<string, string> = {}, init: RequestInit = {}) =>
    request({ host: "100.101.102.103:8443", [MOBILE_ACCESS_HEADER]: "1", ...extra }, init);

  // --- the gate ---------------------------------------------------------

  assert.equal(
    await requireTrustedHumanGrantMutation(loopback()),
    null,
    "loopback desktop mutates grants with every opt-in off",
  );

  const deniedMobile = await requireTrustedHumanGrantMutation(mobile());
  assert.equal(deniedMobile?.status, 403, "verified phone is refused while the opt-in is off");
  const deniedBody = await deniedMobile.json();
  assert.match(
    deniedBody.error,
    /desktop Settings/,
    "the 403 tells the human where to enable phone changes",
  );

  const spoofed = await requireTrustedHumanGrantMutation(
    request({ host: "127.0.0.1:3000", [MOBILE_ACCESS_HEADER]: "1" }),
  );
  assert.equal(
    spoofed?.status,
    403,
    "the proxy's mobile marker outranks a loopback-looking Host",
  );

  const stranger = await requireTrustedHumanGrantMutation(request({ host: "evil.example" }));
  assert.equal(stranger?.status, 403, "non-loopback, non-mobile callers are refused");
  assert.match((await stranger.json()).error, /local desktop/);

  assert.equal(isVerifiedMobileRequest(mobile()), true);
  assert.equal(isVerifiedMobileRequest(loopback()), false);

  // --- the toggles route ------------------------------------------------

  const initial = await (await getMobilePermissions(mobile())).json();
  assert.deepEqual(
    initial,
    { ok: true, grantMutations: false, fileWrites: false, canvasWrites: false },
    "GET is readable from the phone and reports every flag off",
  );

  const phonePatch = await patchMobilePermissions(
    mobile(
      { "content-type": "application/json" },
      { method: "PATCH", body: JSON.stringify({ grantMutations: true }) },
    ),
  );
  assert.equal(phonePatch.status, 403, "the phone can never flip its own opt-ins");

  const emptyPatch = await patchMobilePermissions(
    loopback({ "content-type": "application/json" }, { method: "PATCH", body: "{}" }),
  );
  assert.equal(emptyPatch.status, 400, "a patch must address at least one flag");

  const desktopPatch = await patchMobilePermissions(
    loopback(
      { "content-type": "application/json" },
      { method: "PATCH", body: JSON.stringify({ grantMutations: true }) },
    ),
  );
  assert.equal(desktopPatch.status, 200);
  assert.deepEqual(await desktopPatch.json(), {
    ok: true,
    grantMutations: true,
    fileWrites: false,
    canvasWrites: false,
  });

  assert.equal(
    await requireTrustedHumanGrantMutation(mobile()),
    null,
    "once the desktop opts in, the verified phone may mutate grants",
  );
  const relockedSpoof = await requireTrustedHumanGrantMutation(
    request({ host: "evil.example" }),
  );
  assert.equal(relockedSpoof?.status, 403, "the opt-in trusts only proxy-verified phone requests");

  // --- the canvas gate ----------------------------------------------------

  assert.equal(
    await requireTrustedHumanCanvasMutation(loopback()),
    null,
    "loopback desktop mutates the canvas with every opt-in off",
  );
  const canvasDenied = await requireTrustedHumanCanvasMutation(mobile());
  assert.equal(canvasDenied?.status, 403, "phone canvas writes are refused while the opt-in is off");
  assert.match(
    (await canvasDenied.json()).error,
    /Allow canvas edits from phone/,
    "the 403 names the desktop toggle to flip",
  );
  const canvasStranger = await requireTrustedHumanCanvasMutation(request({ host: "evil.example" }));
  assert.equal(canvasStranger?.status, 403, "non-loopback, non-mobile canvas writers are refused");

  // The canvas opt-in is its own flag — the grant opt-in flipped above must
  // not leak canvas authority, and vice versa.
  assert.equal((await requireTrustedHumanCanvasMutation(mobile()))?.status, 403);
  const canvasPatch = await patchMobilePermissions(
    loopback(
      { "content-type": "application/json" },
      { method: "PATCH", body: JSON.stringify({ canvasWrites: true }) },
    ),
  );
  assert.equal(canvasPatch.status, 200);
  assert.deepEqual(await canvasPatch.json(), {
    ok: true,
    grantMutations: true,
    fileWrites: false,
    canvasWrites: true,
  });
  assert.equal(
    await requireTrustedHumanCanvasMutation(mobile()),
    null,
    "once the desktop opts in, the verified phone may mutate the canvas",
  );
  const phoneCanvasPatch = await patchMobilePermissions(
    mobile(
      { "content-type": "application/json" },
      { method: "PATCH", body: JSON.stringify({ canvasWrites: true }) },
    ),
  );
  assert.equal(phoneCanvasPatch.status, 403, "the phone can never flip the canvas opt-in itself");
  // Relock for the file-write section below (its flag must start clean).
  await updateMobileWriteAccess({ allowMobileCanvasWrites: false });
  assert.equal((await requireTrustedHumanCanvasMutation(mobile()))?.status, 403, "relocked");

  // --- human mobile file writes -----------------------------------------

  const filePath = path.join(projectRoot, "notes.md");
  const writeArgs = (req) => ({
    familiarId: null,
    path: filePath,
    surface: "file-write",
    request: req,
  });

  await assert.rejects(
    () => assertProjectApiAccess(writeArgs(mobile())),
    /missing familiarId/,
    "phone file writes stay blocked while allowMobileFileWrites is off",
  );

  await updateMobileWriteAccess({ allowMobileFileWrites: true });

  await assertProjectApiAccess(writeArgs(mobile()));

  await assert.rejects(
    () => assertProjectApiAccess(writeArgs(loopback())),
    /missing familiarId/,
    "the branch trusts the proxy marker, not Host — desktop no-familiar writes unchanged",
  );
  await assert.rejects(
    () => assertProjectApiAccess({ ...writeArgs(mobile()), surface: "shell" }),
    /missing familiarId/,
    "the opt-in covers file-write only; shell keeps the familiar requirement",
  );
  await assert.rejects(
    () => assertProjectApiAccess({ ...writeArgs(mobile()), path: path.join(tmp, "elsewhere/x.md") }),
    /not registered/,
    "unregistered paths stay unwritable from the phone even with the opt-in on",
  );

  console.log("trusted-grant-mutation.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  await rm(tmp, { recursive: true, force: true });
}
