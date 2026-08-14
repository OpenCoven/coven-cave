---
name: recall
description: Retrieve prior Coven facts, decisions, and context from the strongest available local memory surface without inventing coverage.
---

# Recall

Use this read-only procedure when a question depends on context from earlier
sessions, promoted Coven memory, or a familiar's durable memory files.

## Retrieval order

1. Answer directly when the fact is already in the current thread.
2. Query session history with `session_store_sql` when that tool is available.
   Start with a seven-day time bound, select only needed columns, and widen the
   window only when necessary.
3. Search `MEMORY.md` and `memory/*.md` inside granted roots with the available
   file-search tools.
4. If a granted Coven promotion manifest exists, inspect it and return only
   entries permitted by its scope and attestation rules.
5. If a surface is unavailable, continue with the remaining authorized
   surfaces and state the coverage gap. Never claim that no memory exists merely
   because one entrypoint is absent.

## Output

Return the recalled fact, its source session or exact file path, and any
material uncertainty. Recall is read-only: do not promote, rewrite, or delete
memory while answering.
