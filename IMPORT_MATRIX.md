# Import Matrix

This scaffold normalizes every imported form into the same draft schema:

- `profile_fields`
- `sections`
- `fields`
- `render_anchor`
- `interview_prompt`

Every imported schema is a draft. Review section grouping, field wording, required flags, and profile-field mapping before using it for a real interview.

## DOCX

Command:

```powershell
npm run import-docx -- path\to\form.docx work\form.schema.json
```

Status: implemented.

Method: reads `word/document.xml` from the DOCX package, extracts paragraph text, infers sections and fields, and copies exact paragraph text into `render_anchor`.

Best use: Word forms and Google Docs exported as DOCX.

## Plain Text

Command:

```powershell
npm run import-text -- path\to\form.txt work\form.schema.json
```

Status: implemented.

Method: splits text into paragraphs/lines, then applies the shared section/question inference.

Best use: manually exported Google Docs, OCR output, email forms, copied web forms.

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

