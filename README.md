# VocaForm Scaffold

Small provider-neutral core for a reusable voice-assisted form filler.

This scaffold does not implement live audio. It models the reusable core that should sit behind any voice front end:

- form schema
- family profile prefill
- interview state
- next-question selection
- OpenRouter structured answer normalization

## Why OpenRouter Fits Here

OpenRouter is useful for the LLM reasoning layer:

- classify fields
- normalize spoken answers
- draft final Dutch prose
- compare or swap models

OpenRouter also documents request-style STT/TTS and audio-capable chat paths, which can be useful for bounded utterances or generated prompts. Keep live speech in a separate adapter, though. OpenRouter is the right abstraction for model routing, structured outputs, and optional request-style audio, not for browser microphone capture, realtime turn-taking, barge-in, and playback control.

For the lowest-latency voice experience, use a voice adapter that can be backed by OpenAI Realtime, Gemini Live, browser speech APIs, or another realtime stack while this core keeps form state and rendering provider-neutral.

## Files

- `data/mees_entreeformulier.schema.json` - schema derived from the attached school intake form.
- `data/family_profile.example.json` - placeholder profile shape; put real values in a private local copy.
- `src/form_state.mjs` - prefill and interview-state helpers.
- `src/check_session.mjs` - reviews an interview session for final-export readiness.
- `src/openrouter.mjs` - OpenRouter structured-output call.
- `src/prompts.mjs` - prompt and JSON schema for answer normalization.
- `src/demo.mjs` - local demo; optional live OpenRouter normalization.
- `src/make_demo_state.mjs` - generates a complete `[DEMO]` answer state for renderer testing.
- `src/render_docx.mjs` - renders collected answers to a DOCX in append or in-place mode.
- `src/docx_package.mjs` - tiny dependency-free ZIP utility used by the DOCX renderer.
- `src/docx_text.mjs` - paragraph text and anchor-matching helpers for DOCX files.
- `src/check_docx_anchors.mjs` - verifies that schema `render_anchor` values match the DOCX.
- `src/import_docx_schema.mjs` - creates a draft schema from DOCX paragraph text.
- `src/import_text_schema.mjs` - creates a draft schema from plain text.
- `src/import_pdf_schema.mjs` - creates a draft schema from PDF text extraction.
- `src/import_google_doc_schema.mjs` - creates a draft schema from an accessible Google Docs text export.
- `src/schema_importer.mjs` - shared conservative section/question inference for imported text.
- `src/seed_mees_profile.mjs` - writes a local profile from the known top-section details in the attached form.
- `src/server.mjs` - local browser interview server with text input, browser speech hooks, answer save, and DOCX export.
- `public/` - browser UI for the local interview loop.
- `public/assets/vocaform-mark.svg` - VocaForm logo mark.
- `src/check.mjs` - basic schema sanity checks.

## Codex, ChatGPT Pro, And API Keys

Codex can use built-in OpenAI-powered tools while developing this scaffold, including image generation for brand exploration. The local VocaForm app is a separate runtime, though. It cannot borrow a ChatGPT Plus/Pro or Codex subscription silently for unattended calls.

For the app itself, use an API-backed provider such as OpenRouter or the OpenAI API. Keep runtime keys in environment variables and do not commit them to this scaffold.

## Setup

```powershell
cd C:\Users\S340\VocaForm
node src/check.mjs
node src/demo.mjs
npm run check-anchors
```

Optional live OpenRouter test:

```powershell
$env:OPENROUTER_API_KEY = "your_key_here"
$env:OPENROUTER_MODEL = "~openai/gpt-latest"
node src/demo.mjs --live "Mees speelt graag buiten met andere kinderen, maar kijkt bij onbekende volwassenen eerst even de kat uit de boom."
```

The live test only sends the selected field, the sample answer, and a short prompt. It does not send a full family profile.

## Run The Local Interview UI

Optional for the attached Mees form:

```powershell
npm run seed-mees-profile
```

```powershell
npm run serve
```

Open `http://127.0.0.1:5177`.

The browser UI keeps its session in `work\session_state.json`. It reads `work\family_profile.local.json` when present, otherwise it falls back to `data\family_profile.example.json`. The profile panel writes back to the local profile path and resets the current interview state so profile-derived fields are recalculated. It uses local answer cleanup when `OPENROUTER_API_KEY` is not set, and uses OpenRouter structured output when the key is available.

The `Draft DOCX` button renders a downloadable `..\mees_entreeformulier_session_draft_inplace.docx`. The `Final DOCX` button is disabled until the review has no blockers, then renders `..\mees_entreeformulier_session_final_inplace.docx`.

The review panel distinguishes draft export from final readiness. Missing required answers, skipped required fields, and follow-up-needed answers are blockers. Low confidence answers are warnings.

Use `Save` for model/local normalization, `Save text` to accept the text area exactly as written, and `Skip field` to mark the current field as skipped. Review items are clickable and jump to the affected field.

CLI readiness check:

```powershell
npm run check-session -- data\mees_entreeformulier.schema.json work\session_state.json
```

Add `--require-final` to return a non-zero exit code when blockers remain:

```powershell
npm run check-session -- data\mees_entreeformulier.schema.json work\session_state.json --require-final
```

Optional:

```powershell
$env:OPENROUTER_API_KEY = "your_key_here"
$env:OPENROUTER_MODEL = "~openai/gpt-latest"
$env:FORM_TEMPLATE_PATH = "C:\Users\S340\Downloads\Kopie van Entreeformulier leeg.docx"
npm run serve
```

## Import A DOCX Draft Schema

For a new DOCX form, generate a draft schema first:

```powershell
npm run import-docx -- `
  "C:\Users\S340\Downloads\Kopie van Entreeformulier leeg.docx" `
  work\imported_entreeformulier_draft.schema.json

npm run check -- work\imported_entreeformulier_draft.schema.json
```

The importer is intentionally conservative. It extracts paragraph text, infers likely sections and questions, and adds `render_anchor` values. Review the result before using it for a real interview.

## Import Other Formats

Plain text:

```powershell
npm run import-text -- `
  path\to\form.txt `
  work\imported_text_form.schema.json
```

PDF:

```powershell
npm run import-pdf -- `
  path\to\form.pdf `
  work\imported_pdf_form.schema.json
```

The PDF importer tries `pdftotext` first when Poppler is installed. If it is not available, it uses a limited built-in literal-text fallback. Scanned PDFs and many encoded PDFs need OCR or manual export to DOCX/text.

Google Docs:

```powershell
npm run import-google-doc -- `
  "https://docs.google.com/document/d/<doc-id>/edit" `
  work\imported_google_doc.schema.json
```

This uses the Google Docs plain-text export URL. Public/export-accessible documents work directly. Private documents need manual export to DOCX/text or an authenticated connector.

## Render A DOCX: Append Mode

The first renderer is append-mode. It keeps the original DOCX intact and appends a structured `Ingevulde antwoorden` section at the end. This is the safest reusable fallback for arbitrary forms before exact per-field placement is mapped.

Generate a complete demo answer state:

```powershell
npm run make-demo-state
```

Render against the attached DOCX:

```powershell
npm run render-docx -- `
  "C:\Users\S340\Downloads\Kopie van Entreeformulier leeg.docx" `
  data\mees_entreeformulier.schema.json `
  work\demo_state.json `
  ..\mees_entreeformulier_demo_filled.docx
```

For a real session, replace `work\demo_state.json` with the interview state produced by the voice/text interview loop.

## Render A DOCX: In-Place Mode

For the Mees form, the schema includes `render_anchor` metadata copied from the source DOCX questions. Check anchor coverage before using in-place rendering:

```powershell
npm run check-anchors
```

Render answers directly below matched questions:

```powershell
npm run render-docx -- `
  "C:\Users\S340\Downloads\Kopie van Entreeformulier leeg.docx" `
  data\mees_entreeformulier.schema.json `
  work\demo_state.json `
  ..\mees_entreeformulier_demo_inplace.docx `
  in-place
```

If any answer cannot be anchored, the renderer appends those unmatched answers in a `Niet geplaatste antwoorden` fallback section.

## Next Renderer Upgrade

Generate `render_anchor` candidates automatically during import and require human confirmation when confidence is low.
