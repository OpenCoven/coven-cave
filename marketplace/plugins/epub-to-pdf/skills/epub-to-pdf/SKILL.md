---
name: epub-to-pdf
description: Run ebook-convert to translate between EPUB and PDF, then validate output size and structure before saving to research/sources/.
---

# EPUB to PDF

Run ebook-convert to translate between EPUB and PDF, then validate output size and structure before saving to research/sources/.

## Use When
- Convert an EPUB to PDF with layout-preserving font and margin options for downstream rendering via pdftoppm
- Compress and reflow a PDF into a device-friendly EPUB with auto-detected chapters for ereader distribution
- Validate a conversion by checking file size ratios and inspecting content.opf for detected chapter structure

## Guardrails
- Ensure calibre is installed before converting; install via brew or apt if ebook-convert is missing
- Verify EPUB to PDF output exceeds ~100 KB, as suspiciously small files likely dropped images
- Scanned PDFs lack OCR and may fail or produce text-only output; fall back to text extraction and document the failure

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
