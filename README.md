# VocaForm Scaffold

Small provider-neutral core for a reusable voice-assisted form filler. The app can import a DOCX, PDF, or text form, convert it into the shared VocaForm schema, interview for the detected fields, and export either back into the uploaded DOCX or into a generated answers DOCX.

The browser UI includes optional OpenAI Realtime WebRTC voice mode for a live, low-latency interview. The reusable core still stays provider-neutral:

- imported form schema
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

OpenRouter also documents request-style STT/TTS and audio-capable chat paths, which can be useful for bounded utterances or generated prompts. VocaForm keeps live speech in a separate adapter. OpenRouter is the right abstraction for model routing, structured outputs, and optional request-style audio, not for browser microphone capture, realtime turn-taking, barge-in, and playback control.

For the lowest-latency voice experience, the included adapter uses OpenAI Realtime when `OPENAI_API_KEY` is set and falls back to browser speech hooks when it is not.

## Files

- `data/example_entreeformulier.schema.json` - bundled example schema derived from a school intake form.
- `data/family_profile.example.json` - placeholder profile shape; put real values in a private local copy.
- `src/form_state.mjs` - prefill and interview-state helpers.
- `src/check_session.mjs` - reviews an interview session for final-export readiness.
- `src/openrouter.mjs` - OpenRouter structured-output call.
- `src/prompts.mjs` - prompt and JSON schema for answer normalization.
- `src/form_importers.mjs` - shared DOCX, PDF, and text import functions used by CLI and browser upload.
- `src/demo.mjs` - local demo; optional live OpenRouter normalization.
- `src/make_demo_state.mjs` - generates a complete `[DEMO]` answer state for renderer testing.
- `src/render_docx.mjs` - renders collected answers to a DOCX in append or in-place mode.
- `src/docx_report.mjs` - creates a generated answers DOCX when the imported source is PDF/text or has no DOCX template.
- `src/docx_package.mjs` - tiny dependency-free ZIP utility used by the DOCX renderer.
- `src/docx_text.mjs` - paragraph text and anchor-matching helpers for DOCX files.
- `src/check_docx_anchors.mjs` - verifies that schema `render_anchor` values match the DOCX.
- `src/import_docx_schema.mjs` - creates a draft schema from DOCX paragraph text.
- `src/import_text_schema.mjs` - creates a draft schema from plain text.
- `src/import_pdf_schema.mjs` - creates a draft schema from PDF text extraction.
- `src/import_google_doc_schema.mjs` - creates a draft schema from an accessible Google Docs text export.
- `src/schema_importer.mjs` - shared conservative section/question inference for imported text.
- `src/seed_example_profile.mjs` - writes a generic local profile for testing.
- `src/server.mjs` - local browser interview server with text input, browser speech hooks, answer save, and DOCX export.
- `public/` - browser UI for the local interview loop.
- `public/assets/vocaform-mark.svg` - VocaForm logo mark.
- `src/check.mjs` - basic schema sanity checks.

## Codex, ChatGPT Pro, And API Keys

Codex can use built-in OpenAI-powered tools while developing this scaffold, including image generation for brand exploration. The local VocaForm app is a separate runtime, though. It cannot borrow a ChatGPT Plus/Pro or Codex subscription silently for unattended calls.

For the app itself, use an API-backed provider such as OpenRouter or the OpenAI API. Keep runtime keys in environment variables and do not commit them to this scaffold.

## Setup

```powershell
cd path\to\VocaForm
node src/check.mjs
node src/demo.mjs
npm run check-anchors
```

Optional live OpenRouter test:

```powershell
$env:OPENROUTER_API_KEY = "your_key_here"
$env:OPENROUTER_MODEL = "~openai/gpt-latest"
node src/demo.mjs --live "Het kind speelt graag buiten met andere kinderen, maar kijkt bij onbekende volwassenen eerst even af."
```

The live test only sends the selected field, the sample answer, and a short prompt. It does not send a full family profile.

## Run The Local Interview UI

Start the app:

```powershell
npm.cmd run serve
```

Open `http://127.0.0.1:5177`.

Use the `Importeren` control in the sidebar to upload a `.docx`, `.pdf`, `.txt`, `.text`, or `.md` form. Examples that should follow the same path:

- dentist intake forms
- doctor or clinic intake forms
- school intake forms
- activity, permission, or registration forms
- copied/OCR text forms

The uploaded source, generated draft schema, and session state are stored under `work\forms\<import-id>\`. The active form pointer is `work\active_form.json`. Generated exports are written to `work\exports\`.

Set `VOCAFORM_WORK_DIR` if you want those runtime files somewhere other than the repository `work\` folder.

For DOCX imports, VocaForm keeps the uploaded DOCX as the render template and tries in-place answer placement using imported anchors. For PDF/text imports, VocaForm interviews against the imported schema and exports a generated answers DOCX because there is no editable DOCX template to place answers into.

Optional for the bundled example profile:

```powershell
npm.cmd run seed-example-profile
```

By default the server binds to localhost only. To make it reachable from another device on the same home network or through Tailscale, set:

```powershell
$env:HOST = "0.0.0.0"
npm.cmd run serve
```

Then open the machine's LAN or Tailscale address, for example `http://<your-lan-ip>:5177` or `http://100.x.y.z:5177`. This local app has no login layer, so only expose it on networks you trust.

The browser UI keeps imported sessions in each active form folder under `work\forms\`. The bundled default example still uses `work\session_state.json`. It reads `work\family_profile.local.json` when present, otherwise it falls back to `data\family_profile.example.json`. The profile panel writes back to the local profile path and resets the current interview state so profile-derived fields are recalculated. It uses local answer cleanup when `OPENROUTER_API_KEY` is not set, and uses OpenRouter structured output when the key is available.

Optional OpenAI Realtime voice mode:

```powershell
$env:OPENAI_API_KEY = "your_openai_api_key_here"
$env:OPENAI_REALTIME_MODEL = "gpt-realtime-2"
$env:OPENAI_REALTIME_VOICE = "marin"
$env:OPENAI_REALTIME_SPEED = "0.95"
npm.cmd run serve
```

With `OPENAI_API_KEY` set, the `Live AI` button starts a WebRTC conversation through the local server endpoint at `/api/realtime/call`. The model is prompted to act as a relaxed Dutch interviewer: one question at a time, short rephrasing, examples when useful, and a short summary before the user clicks `Opslaan`.

The UI has two interview modes:

- `Per veld` keeps the original loop: ask or record one field, then save or skip it.
- `Hele formulier` runs a continuous interview over all open fields. The transcript is collected in the same text box, and `Verwerken` sends the full transcript to `/api/interview/transcript` so OpenRouter can extract answers into the existing session state.

Whole-form extraction requires `OPENROUTER_API_KEY`. OpenAI Realtime can conduct and transcribe the interview when `OPENAI_API_KEY` is set, but OpenRouter still handles the transcript-to-fields reasoning pass. Without OpenAI Realtime, browser speech recognition or pasted text can still provide the transcript.

The `Concept` button renders a downloadable draft DOCX. The `Finale DOCX` button is disabled until the review has no blockers. Output filenames are based on the active form id, for example `work\exports\<form-id>_session_draft_inplace.docx` for DOCX-source forms or `work\exports\<form-id>_session_draft_answers.docx` for PDF/text-source forms.

The review panel distinguishes draft export from final readiness. Missing required answers, skipped required fields, and follow-up-needed answers are blockers. Low confidence answers are warnings.

Use `Save` for model/local normalization, `Save text` to accept the text area exactly as written, and `Skip field` to mark the current field as skipped. Review items are clickable and jump to the affected field.

CLI readiness check:

```powershell
npm run check-session -- data\example_entreeformulier.schema.json work\session_state.json
```

Add `--require-final` to return a non-zero exit code when blockers remain:

```powershell
npm run check-session -- data\example_entreeformulier.schema.json work\session_state.json --require-final
```

Optional:

```powershell
$env:OPENROUTER_API_KEY = "your_key_here"
$env:OPENROUTER_MODEL = "~openai/gpt-latest"
$env:FORM_TEMPLATE_PATH = "path\to\school-intake.docx"
npm run serve
```

If you set `FORM_SCHEMA_PATH`, `FORM_TEMPLATE_PATH`, or `SESSION_STATE_PATH`, the server runs that fixed configured form and browser imports cannot replace the active form until those variables are removed.

## Import A DOCX Draft Schema

For a new DOCX form, generate a draft schema first:

```powershell
npm run import-docx -- `
  "path\to\school-intake.docx" `
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
  "path\to\school-intake.docx" `
  data\example_entreeformulier.schema.json `
  work\demo_state.json `
  ..\example_entreeformulier_demo_filled.docx
```

For a real session, replace `work\demo_state.json` with the interview state produced by the voice/text interview loop.

## Render A DOCX: In-Place Mode

For the example school intake form, the schema includes `render_anchor` metadata copied from the source DOCX questions. Check anchor coverage before using in-place rendering:

```powershell
npm run check-anchors
```

Render answers directly below matched questions:

```powershell
npm run render-docx -- `
  "path\to\school-intake.docx" `
  data\example_entreeformulier.schema.json `
  work\demo_state.json `
  ..\example_entreeformulier_demo_inplace.docx `
  in-place
```

If any answer cannot be anchored, the renderer appends those unmatched answers in a `Niet geplaatste antwoorden` fallback section.

## Next Renderer Upgrade

Generate `render_anchor` candidates automatically during import and require human confirmation when confidence is low.
