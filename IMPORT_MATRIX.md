# Import Matrix

This scaffold normalizes every imported form into the same draft schema:

- `profile_fields`
- `sections`
- `fields`
- `render_anchor`
- `interview_prompt`

Every imported schema is a draft. Review section grouping, field wording, required flags, and profile-field mapping before using it for a real interview.

The browser app uses the same importer as the CLI. Upload `.docx`, `.pdf`, `.txt`, `.text`, or `.md` from the sidebar; VocaForm stores the source and generated schema under `work\forms\<import-id>\`, records the active form and saved session in `work\vocaform_store.json`, then activates that form immediately. Browser storage is limited to unsaved draft text and UI recovery.

## DOCX

Command:

```powershell
npm run import-docx -- path\to\form.docx work\form.schema.json
```

Status: implemented.

Method: reads `word/document.xml` from the DOCX package, extracts paragraph text, infers sections and fields, and copies exact paragraph text into `render_anchor`.

Best use: Word forms and Google Docs exported as DOCX.

Export behavior: renders back into the uploaded DOCX with in-place anchors, with append fallback for unmatched fields.

## Plain Text

Command:

```powershell
npm run import-text -- path\to\form.txt work\form.schema.json
```

Status: implemented.

Method: splits text into paragraphs/lines, then applies the shared section/question inference.

Best use: manually exported Google Docs, OCR output, email forms, copied web forms.

Export behavior: exports a generated answers DOCX.

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

Export behavior: exports a generated answers DOCX because the PDF is not an editable DOCX template.

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
