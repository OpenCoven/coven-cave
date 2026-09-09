import { mermaidPlugin } from "@create-markdown/preview-mermaid";

window.caveMermaid = mermaidPlugin({
  theme: "dark",
  config: { securityLevel: "strict" },
});
