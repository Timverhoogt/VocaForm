# Import Matrix

The preserved legacy CLI normalizes every imported form into the same draft schema:

- `profile_fields`
- `sections`
- `fields`
- `render_anchor`
- `interview_prompt`

Every imported schema is a draft. Review section grouping, field wording, required flags, and profile-field mapping before using it for a real interview.

The Build Week application instead uploads `.docx`, `.pdf`, `.txt`, `.text`, or `.md` through the TypeScript API, compiles a canonical schema with source evidence and rendering targets, and retains a private byte copy only for the active compilation and session. The legacy browser app still uses the importers below and stores its local state under `work\forms\<import-id>\`.

## DOCX

Command:

```powershell
npm run import-docx -- path\to\form.docx work\form.schema.json
```

Status: implemented.

Method: reads `word/document.xml` from the DOCX package, extracts paragraph text, infers sections and fields, and copies exact paragraph text into `render_anchor`.

Best use: Word forms and Google Docs exported as DOCX.

Build Week export behavior: places verified answers into a new copy of the source DOCX. Any unmatched `append_answer_packet` field appears in a clearly labeled fallback section; a `manual_review` field blocks export instead of disappearing.

## Plain Text

Command:

```powershell
npm run import-text -- path\to\form.txt work\form.schema.json
```

Status: implemented.

Method: splits text into paragraphs/lines, then applies the shared section/question inference.

Best use: manually exported Google Docs, OCR output, email forms, copied web forms.

Build Week export behavior: generates a polished, section-matched DOCX answer packet that references the text source.

## PDF

Command:

```powershell
npm run import-pdf -- path\to\form.pdf work\form.schema.json
```

Status: implemented with caveats.

Method:

- Tries Poppler `pdftotext -layout` when available.
- Falls back to a limited built-in extractor for literal PDF text operations.

Limitations:

- Scanned PDFs need OCR.
- Encoded/compressed PDFs may need `pdftotext` or manual export.
- Always review output carefully.

Build Week export behavior: fills exact named AcroForm fields in a new PDF. Individual unmatched answers receive a clearly labeled fallback PDF page. A PDF without compatible writable fields receives a polished, section-matched DOCX answer packet that is never presented as a filled original.

## Google Docs

Command:

```powershell
npm run import-google-doc -- "https://docs.google.com/document/d/<doc-id>/edit" work\form.schema.json
```

Status: implemented for export-accessible documents.

Method: downloads Google Docs plain-text export and applies the shared importer.

Limitations:

- Private docs need manual export, public/export access, or an authenticated connector.
- For best rendering back to DOCX, export the Google Doc as DOCX and use `import-docx`.
