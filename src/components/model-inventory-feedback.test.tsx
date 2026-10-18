// Codex local mode (#6049): when a local server can't supply a model, the
// model menu says what to do on that server rather than offering a runtime
// default, which a local session does not have.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelInventoryFeedback } from "./model-inventory-feedback";

const inventory = (discoveryIssue: string) => ({
  loading: false,
  provenance: "unavailable",
  discoveryIssue,
  refresh: () => {},
}) as never;

const status = (runtime: string, issue: string) =>
  /<p[^>]*role="status"[^>]*>([^<]*)<\/p>/.exec(renderToStaticMarkup(
    <ModelInventoryFeedback runtime={runtime} modelInventory={inventory(issue)} modelCount={0} />,
  ))?.[1]?.replaceAll("&#x27;", "'") ?? null;

describe("ModelInventoryFeedback for local servers", () => {
  it("names how to start a stopped server", () => {
    expect(status("codex-ollama", "local-server-unavailable")).toBe(
      "Ollama isn’t answering. Start Ollama (open the app, or run `ollama serve`). Then retry model discovery.",
    );
    expect(status("codex-lmstudio", "local-server-unavailable")).toBe(
      "LM Studio isn’t answering. Start LM Studio's server (Developer tab, or run `lms server start`). Then retry model discovery.",
    );
  });

  it("names the endpoint variable and how to add a tool-capable model", () => {
    expect(status("codex-ollama", "local-endpoint-invalid")).toBe(
      "CAVE_OLLAMA_URL isn’t a usable endpoint for Ollama. Fix or unset it, then retry.",
    );
    expect(status("codex-lmstudio", "local-no-tool-models")).toBe(
      "LM Studio has no model with tool support, which Codex needs. Download a model with tool support in LM Studio, for example Qwen3 8B.",
    );
  });

  it("offers a retry, and leaves other runtimes' copy unchanged", () => {
    const markup = renderToStaticMarkup(
      <ModelInventoryFeedback runtime="codex-ollama" modelInventory={inventory("local-server-unavailable")} modelCount={0} />,
    );
    expect(markup).toContain("Retry model discovery");
    expect(status("codex", "discovery-failed")).toMatch(/^Couldn’t load Codex models\./);
  });
});
