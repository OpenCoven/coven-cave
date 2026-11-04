"use client";

import type { RuntimeModelInventoryResult } from "@/lib/use-runtime-model-options";
import { runtimeDisplayName } from "@/components/runtime-logo";
import { localCodexBackendInfo } from "@/lib/local-codex";
import { Button } from "@/components/ui/button";
import { PopoverItem } from "@/components/ui/popover";
import "@/styles/composer-runtime-chip.css";

export type ComposerModelInventory = Pick<RuntimeModelInventoryResult, "loading" | "provenance" | "discoveryIssue" | "refresh">;

export function ModelInventoryFeedback({ runtime, modelInventory, modelCount, menu = false }: {
  runtime: string;
  modelInventory?: ComposerModelInventory;
  modelCount: number;
  menu?: boolean;
}) {
  const loading = modelInventory?.loading ?? false;
  const issue = modelInventory?.discoveryIssue;
  const managed = issue === "runtime-managed" || (!issue && runtime === "openclaw");
  const canRefresh = Boolean(modelInventory) && !managed &&
    issue !== "remote-runtime" && issue !== "local-only" && issue !== "profile-managed";
  const name = runtimeDisplayName(runtime);
  // Local servers have no runtime default to fall back on, so their copy says what to do instead.
  const local = localCodexBackendInfo(runtime);
  const status = loading ? `Loading ${name} models…`
    : local && issue === "local-server-unavailable" ? `${local.product} isn’t answering. ${local.startHint} Then retry model discovery.`
    : local && issue === "local-endpoint-invalid" ? `${local.endpointEnv} isn’t a usable endpoint for ${local.product}. Fix or unset it, then retry.`
    : local && issue === "local-no-tool-models" ? `${local.product} has no model with tool support, which Codex needs. ${local.addModelHint}`
    : local && issue === "local-models-on-other-computers" ? `${local.product}’s tool-capable models run on another computer through LM Link. Load one on this computer, or allow servers on other computers in Settings → Local models.`
    : local && issue === "local-models-in-cloud" ? `${local.product}’s tool-capable models are all cloud models, which run off this computer. ${local.addModelHint}`
    : issue === "remote-runtime" ? "Models are managed on the remote machine. Use runtime default or set a model with /model."
    : issue === "local-only" ? "Open Cave on this computer to discover models. You can still use runtime default or /model."
    : issue === "profile-managed" ? "This profile manages its own models. Use runtime default or set a model with /model."
    : managed ? `${name} manages its own models. Use runtime default or set a model with /model.`
    : modelCount === 0 ? `Couldn’t load ${name} models. Retry discovery, or continue with runtime default. If it persists, check the runtime’s setup and sign-in in Settings.`
    : modelInventory?.provenance === "cached" ? "Showing the runtime’s cached model list."
    : null;

  const action = loading ? "Refreshing models…" : modelCount === 0 ? "Retry model discovery" : "Refresh models";
  return <>
    {status ? <p className="composer-model-inventory-status" role="status" aria-live="polite">{status}</p> : null}
    {canRefresh ? menu ? (
      <PopoverItem disabled={loading} onSelect={modelInventory?.refresh}>{action}</PopoverItem>
    ) : (
      <Button variant="ghost" size="xs" disabled={loading} onClick={modelInventory?.refresh}>{action}</Button>
    ) : null}
  </>;
}
