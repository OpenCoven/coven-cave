// @ts-nocheck
import assert from "node:assert/strict";
import { parseMemorySourceContext } from "./memory-source-context.ts";

assert.equal(
  parseMemorySourceContext(`---
title: Nova routing
source_context: session://nova-routing-2026-06-08
---

Routing note.`),
  "session://nova-routing-2026-06-08",
  "memory frontmatter should expose source_context provenance",
);

assert.equal(
  parseMemorySourceContext(`---
title: Audit note
source_context: "audit://release-v0.0.52"
---

Audit note.`),
  "audit://release-v0.0.52",
  "memory frontmatter should allow quoted source_context values",
);

assert.equal(
  parseMemorySourceContext("# Plain memory\n\nNo provenance."),
  undefined,
  "plain memory files without frontmatter should stay untraced",
);
