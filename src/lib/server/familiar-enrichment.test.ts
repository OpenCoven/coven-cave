// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichFamiliar } from "./familiar-enrichment.ts";

const config = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: {
    sage: {
      display_name: "Sage Local",
      role: "Researcher",
      pronouns: "they/them",
      description: "Finds and verifies evidence.",
      familiarType: "researcher",
      color: "violet",
      harness: "codex",
      model: "gpt-5.3-codex",
      note: "Prefer primary sources.",
      voiceProvider: "elevenlabs",
      voiceModel: "multilingual-v2",
      voiceName: "Sage",
      imageProvider: "openai",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high",
      autoSelfReport: true,
      asanaEnabled: false,
      xResearchEnabled: true,
      xPublishEnabled: false,
    },
  },
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

test("enrichFamiliar applies config overrides and stable avatar revision", async () => {
  const enriched = await enrichFamiliar(
    {
      id: "sage",
      display_name: "Sage Daemon",
      role: "Generalist",
      status: "online",
      active_sessions: 2,
    },
    config,
    {
      resolveFamiliarAvatar: async () => ({
        absPath: "/workspace/sage/avatars/avatar.png",
        fileName: "avatar.png",
        contentType: "image/png",
        mtimeMs: 1_723_456_789.4,
      }),
    },
  );

  assert.equal(enriched.display_name, "Sage Local");
  assert.equal(enriched.role, "Researcher");
  assert.equal(enriched.defaultHarness, "claude");
  assert.equal(enriched.harness, "codex");
  assert.equal(enriched.harnessOverride, "codex");
  assert.equal(enriched.model, "gpt-5.3-codex");
  assert.equal(enriched.autoSelfReport, true);
  assert.equal(
    enriched.avatarUrl,
    "/api/familiars/sage/avatar?v=1723456789&format=png",
  );
});

test("enrichFamiliar preserves daemon fields and emits null override without an avatar", async () => {
  const enriched = await enrichFamiliar(
    { id: "moss", display_name: "Moss", role: "Builder", pronouns: "she/her" },
    {
      version: 1,
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: {},
      roles: [],
      marketplace: { installed: {} },
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
      omnigent: {
        enabled: false,
        baseUrl: "",
        defaultAgentId: "",
        defaultHostId: "",
        defaultWorkspace: "",
        hostMap: {},
        hostWorkspaceMap: {},
        exposeHostsInComposer: false,
      },
      remoteHosts: [],
    },
    { resolveFamiliarAvatar: async () => null },
  );

  assert.equal(enriched.display_name, "Moss");
  assert.equal(enriched.pronouns, "she/her");
  assert.equal(enriched.defaultHarness, "claude");
  assert.equal(enriched.harnessOverride, null);
  assert.equal(enriched.autoSelfReport, false);
  assert.equal(enriched.avatarUrl, undefined);
});
