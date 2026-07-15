# Export Accessibility Review

**Recorded:** July 15, 2026<br>
**Scope:** completed synthetic PDF, completed in-place DOCX, and generated DOCX answer packet<br>
**Decision:** accept the native PDF's source-bound tagging limitation and narrow the submission claim

## Result

VocaForm can claim accessible application interaction and structurally improved exports, but it must not claim that every completed source document is a certified accessible document.

| Output | Result | Evidence |
| --- | --- | --- |
| Completed medical AcroForm PDF | Accepted limitation | All eight values are visibly placed, source bytes remain unchanged, document language is `en-US`, the document title is preferred in the viewer, and every field has a human-readable alternate name. The source and completed PDF are still untagged: `pdfinfo` reports `Tagged: no`, and there is no structure tree. |
| Completed school DOCX | Pass for reviewed structure | The completed file retains a linear question/answer order, eight real Heading 1 section paragraphs with outline level 0, and a `nl-NL` document language default. The bundled DOCX accessibility audit reports zero high, medium, or low findings. |
| Generated DOCX answer packet | Pass for reviewed structure | The application-owned packet uses real Heading 1 sections, linear label/value paragraphs, an `en-US` language default and core-language property, descriptive metadata, and no tables, images, or ambiguous links. The bundled audit reports zero findings. |
| Visual rendering | Pass | The medical PDF page, all four school DOCX pages, and the answer-packet page were rendered and inspected at full resolution with no clipping, overlap, missing glyphs, or broken reading sequence. |

## Improvements made during review

- Completed PDFs now receive the canonical form language.
- Completed PDFs now request the document title in the viewer title bar.
- Every successfully filled PDF field now receives the compiled human-readable field label as its alternate name/tooltip.
- Completed DOCX files receive the canonical form language when the retained source has no language default.
- Application-owned answer packets include language metadata and explicit Heading 1 outline levels.

These additions improve assistive-technology context without modifying the retained source file or pretending to create a tag tree that does not exist.

## Reproduction

Generate the reviewed files:

```bash
npm run eval:renderer -- --out work/goal6-qa
```

Audit the DOCX files with the bundled document-skill runtime:

```bash
python scripts/a11y_audit.py work/goal6-qa/elementary-school-intake-completed.docx
python scripts/a11y_audit.py work/goal6-qa/riverside_family_practice_new_patient_intake-verified-answer-packet.docx
```

Render each DOCX with `render_docx.py`, and inspect the completed PDF with `pdfinfo`, `pypdf`, and a full-page PNG render.

## Submission boundary

Use this claim: **VocaForm preserves the source, exposes exact placement coverage, adds form-language and field-label metadata where safe, and produces a structured DOCX answer packet when a source cannot be filled. Export accessibility remains source-dependent; native PDFs are not claimed to be tagged or accessibility-certified.**

Do not claim universal accessible-document output, tagged-PDF remediation, PDF/UA conformance, or a completed assistive-technology certification for arbitrary uploaded sources.
