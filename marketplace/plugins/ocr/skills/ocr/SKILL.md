---
name: ocr
description: Run scripts/ocr.py against a local image or PDF, choosing text/json/markdown output and --force-ocr only when a PDF is a scan, then inspect results before relying on them.
---

# OCR

Run scripts/ocr.py against a local image or PDF, choosing text/json/markdown output and --force-ocr only when a PDF is a scan, then inspect results before relying on them.

## Use When
- Transcribe a screenshot or receipt to plain text with ocr.py --format text, adding --languages for multilingual Vision OCR
- Get structured per-line confidence and bounding boxes with --format json to flag low-confidence lines
- OCR a scanned PDF to Markdown with --force-ocr --max-pages 5 when embedded pdftotext extraction is wrong

## Guardrails
- OCR can confuse punctuation, columns, totals, handwriting, and small text; say 'OCR reads…' rather than presenting output as ground truth
- For sensitive documents, summarize only what the user requested and avoid exposing unnecessary personal data
- Flag financial, legal, or medical text as needing human verification before any decision is made

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
