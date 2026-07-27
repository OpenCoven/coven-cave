// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The app test runner strips TypeScript but does not transform TSX. Load the
 * real host through the repo's existing Sucrase dependency, teaching CommonJS
 * the same extensionless + `@/` resolution that TypeScript uses.
 */
const require = createRequire(import.meta.url);
const originalSucraseOptions = process.env.SUCRASE_OPTIONS;
process.env.SUCRASE_OPTIONS = JSON.stringify({ jsxRuntime: "automatic" });
require("sucrase/register/tsx");
if (originalSucraseOptions === undefined) delete process.env.SUCRASE_OPTIONS;
else process.env.SUCRASE_OPTIONS = originalSucraseOptions;
const Module = require("node:module");
const originalResolveFilename = Module._resolveFilename;
const suffixes = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  let base = null;
  if (request.startsWith("@/")) {
    base = path.join(process.cwd(), "src", request.slice(2));
  } else if ((request.startsWith("./") || request.startsWith("../")) && parent?.filename) {
    base = path.resolve(path.dirname(parent.filename), request);
  }
  if (base) {
    for (const suffix of suffixes) {
      if (existsSync(base + suffix)) return base + suffix;
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { RoleSurfaceHost } = require("./role-surface-host.tsx");
const {
  clearRoleSurfacesForTest,
  registerRoleSurface,
} = require("../lib/role-surfaces.ts");
const {
  clearRoleSurfaceStateForTest,
  readRoleSurfaceState,
  useRoleSurfaceState,
} = require("../lib/role-surface-state.ts");
Module._resolveFilename = originalResolveFilename;

test("a child state patch refreshes host status without a context-owner rerender", async () => {
  clearRoleSurfacesForTest();
  clearRoleSurfaceStateForTest();

  const familiarId = "reactive-familiar";
  const surfaceId = "reactive-room";
  let patchChildState = null;
  let contextOwnerRenders = 0;
  const storage = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    },
  };

  function ChildRoom() {
    const [, patch] = useRoleSurfaceState(familiarId, surfaceId, { liveRuns: 0 });
    patchChildState = patch;
    return createElement("child-room");
  }

  const surface = {
    id: surfaceId,
    role: "researcher",
    title: "Reactive room",
    iconName: "ph:detective",
    description: "Reactive contribution test",
    priority: 1,
    shouldDisplay: () => true,
    getContributions() {
      const state = readRoleSurfaceState(familiarId, surfaceId);
      const liveRuns = state?.liveRuns ?? 0;
      return {
        statusIndicators: [{
          id: "reactive.status",
          label: `${liveRuns} run${liveRuns === 1 ? "" : "s"} live`,
          tone: liveRuns > 0 ? "busy" : "muted",
        }],
      };
    },
    render: () => createElement(ChildRoom),
  };
  const unregister = registerRoleSurface(surface);
  const context = {
    activeFamiliar: { id: familiarId, display_name: "Reactive", role: "Researcher" },
    activePerson: null,
    currentThread: null,
    runtimeState: { daemonRunning: true, sessions: [], activeSessionId: null },
    memory: { listEntries: async () => [], readFile: async () => null },
    tools: { listTools: async () => [] },
    plugins: { listPlugins: async () => [] },
    openUrl() {},
    openSession() {},
    focusCard() {},
    refreshTasks() {},
  };

  function ContextOwner() {
    contextOwnerRenders += 1;
    return createElement(RoleSurfaceHost, {
      surfaceId,
      context,
      visibleSurfaces: [surface],
      rolesLoaded: true,
      onLeave() {},
    });
  }

  let renderer = null;
  try {
    await act(async () => {
      renderer = create(createElement(ContextOwner));
    });
    const hostStatus = () => renderer.root.findByProps({ className: "role-surface-status" });
    assert.equal(hostStatus().props["aria-label"], "0 runs live");
    assert.equal(contextOwnerRenders, 1);

    await act(async () => {
      patchChildState({ liveRuns: 2 });
    });

    assert.equal(hostStatus().props["aria-label"], "2 runs live");
    assert.equal(
      contextOwnerRenders,
      1,
      "the external store should update the host contribution directly, not depend on a shell context rerender",
    );
  } finally {
    await act(async () => renderer?.unmount());
    unregister();
    clearRoleSurfacesForTest();
    clearRoleSurfaceStateForTest();
    globalThis.window = originalWindow;
  }
});
