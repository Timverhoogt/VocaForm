# VocaForm

<p align="center">
  <img src="public/assets/vocaform-mark.svg" width="96" alt="VocaForm logo mark">
</p>

<p align="center">
  Talk to boring forms. Get useful documents back.
</p>

VocaForm is a local-first, voice-assisted form filler for real-world paperwork:
school intake forms, clinic questionnaires, permission slips, registrations,
and all the other documents that somehow still arrive as DOCX, PDF, or copied
text.

Import a form, let VocaForm turn it into an interview, answer by voice or text,
review what is missing, then export a filled DOCX or a generated answers
document. It is built as a small open source Node.js app, not a hosted service,
so your working files and family profile stay on your machine by default.

## Why It Exists

Most forms ask for information you already know, but not in the order you would
say it out loud. VocaForm bridges that gap:

- It reads forms and extracts a draft schema.
- It pre-fills answers from a local profile when possible.
- It asks one clear question at a time, or runs a whole-form interview.
- It normalizes messy spoken answers into structured fields.
- It tells you what still blocks a final export.
- It renders a DOCX you can send, edit, or archive.

The goal is not to make paperwork magical. The goal is to make it less
annoying, more reusable, and easier to finish.

## What Works Today

- Browser UI at `http://127.0.0.1:5177`
- DOCX, PDF, plain text, Markdown, and export-accessible Google Docs import
- Local form library with progress, warnings, blockers, and exports
- Local profile editor for reusable family or applicant data
- Per-field interview mode for careful completion
- Whole-form interview mode for longer natural transcripts
- Optional OpenAI Realtime voice conversation
- Optional OpenRouter structured answer normalization and orchestration
- DOCX export back into imported DOCX templates when anchors are available
- Generated answers DOCX export for PDF and text sources
- Optional final PDF export through LibreOffice
- CLI tools for import, validation, session review, and DOCX rendering

## Quick Start

Use Node.js `>=18`. There is no build step.

On Windows:

```powershell
git clone <your-fork-or-repo-url>
cd VocaForm
npm.cmd run seed-example-profile
npm.cmd run serve
```

On macOS or Linux, use `npm run ...` instead of `npm.cmd run ...`.

Open:

```text
http://127.0.0.1:5177
```

Then:

1. Click the import button and choose a `.docx`, `.pdf`, `.txt`, `.text`, or
   `.md` form.
2. Review or edit the local profile in the sidebar.
3. Fill fields with typed text, browser speech input, or the optional live AI
   interview.
4. Use the review panel to clear blockers.
5. Export a draft or final DOCX.

## Optional AI Setup

VocaForm can run without API keys: you can import forms, type answers, save text
directly, and export documents locally.

For structured cleanup and whole-form orchestration, add OpenRouter:

```powershell
$env:OPENROUTER_API_KEY = "your_openrouter_key"
$env:OPENROUTER_MODEL = "minimax/minimax-m3"
$env:OPENROUTER_STRUCTURED_MODEL = "minimax/minimax-m3"
npm.cmd run serve
```

For live, low-latency voice interviews, add OpenAI Realtime:

```powershell
$env:OPENAI_API_KEY = "your_openai_key"
$env:OPENAI_REALTIME_MODEL = "gpt-realtime-2"
$env:OPENAI_REALTIME_VOICE = "marin"
$env:OPENAI_REALTIME_SPEED = "0.95"
npm.cmd run serve
```

OpenAI Realtime handles the live microphone conversation. OpenRouter handles the
structured reasoning pass that turns transcripts into form fields. They are
separate adapters so the core form state and import/export logic stay
provider-neutral.

You can also copy `.env.example` to `.env` for local configuration. Do not
commit real keys.

## Local-First Data Model

Runtime state lives under `work\` by default:

- `work\vocaform_store.json` is the local form/session index.
- `work\forms\<import-id>\` stores imported sources and draft schemas.
- `work\exports\` stores generated DOCX/PDF files.
- `work\family_profile.local.json` stores your private reusable profile when
  present.

Set `VOCAFORM_WORK_DIR` to keep runtime files outside the repository.

Browser storage is only used for UI recovery, such as selected field, interview
mode, toggles, and unsaved drafts. Saved answers, imported forms, profiles, and
exports live on the local server side.

## Import And Export

VocaForm normalizes imported forms into one schema shape, regardless of source:

- `profile_fields`
- `sections`
- `fields`
- `render_anchor`
- `interview_prompt`

DOCX imports are the best path when you want filled answers placed back into the
original document. The importer extracts paragraph text and creates
`render_anchor` values so the renderer can place answers near matching
questions, with an append fallback for unmatched fields.

PDF and text imports are useful for interviewing and answer collection, but
they export as generated answers documents because there is no editable DOCX
template to fill in place. Scanned PDFs need OCR before import.

See [IMPORT_MATRIX.md](IMPORT_MATRIX.md) for format-specific details.

## CLI Cookbook

Validate the bundled schema:

```powershell
npm.cmd run check
```

Check DOCX anchors:

```powershell
npm.cmd run check-anchors
```

Review a saved session:

```powershell
npm.cmd run check-session -- data\example_entreeformulier.schema.json work\session_state.json
```

Fail when final-export blockers remain:

```powershell
npm.cmd run check-session -- data\example_entreeformulier.schema.json work\session_state.json --require-final
```

Import a DOCX form:

```powershell
npm.cmd run import-docx -- path\to\form.docx work\form.schema.json
```

Import text, PDF, or Google Docs:

```powershell
npm.cmd run import-text -- path\to\form.txt work\form.schema.json
npm.cmd run import-pdf -- path\to\form.pdf work\form.schema.json
npm.cmd run import-google-doc -- "https://docs.google.com/document/d/<doc-id>/edit" work\form.schema.json
```

Generate demo answers and render a DOCX:

```powershell
npm.cmd run make-demo-state
npm.cmd run render-docx -- path\to\form.docx data\example_entreeformulier.schema.json work\demo_state.json work\exports\demo_filled.docx in-place
```

## Useful Environment Variables

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Enables structured answer normalization and whole-form orchestration. |
| `OPENROUTER_MODEL` | Main OpenRouter model. |
| `OPENROUTER_STRUCTURED_MODEL` | Override for strict JSON-schema calls. |
| `OPENAI_API_KEY` | Enables OpenAI Realtime voice mode. |
| `OPENAI_REALTIME_MODEL` | Realtime model name. |
| `OPENAI_REALTIME_VOICE` | Realtime voice name. |
| `FORM_SCHEMA_PATH` | Run the server against a fixed schema. |
| `FORM_TEMPLATE_PATH` | Use a fixed DOCX render template. |
| `SESSION_STATE_PATH` | Use a fixed session state file. |
| `FAMILY_PROFILE_PATH` | Use a fixed local profile file. |
| `VOCAFORM_WORK_DIR` | Move runtime state out of `work\`. |
| `LIBREOFFICE_PATH` / `SOFFICE_PATH` | Enable PDF export through LibreOffice. |
| `HOST` | Defaults to `127.0.0.1`; set to `0.0.0.0` only on trusted networks. |

## Project Layout

```text
src/       server, importers, form state, AI adapters, DOCX parsing/rendering
public/    browser UI and assets
data/      example schema and generic profile shape
work/      ignored local runtime state and generated exports
```

Important files:

- `src/server.mjs` serves the local app and API.
- `src/form_state.mjs` manages prefill and interview state.
- `src/form_importers.mjs` provides shared DOCX, PDF, and text import logic.
- `src/orchestrator.mjs` chooses whole-form interview actions.
- `src/openrouter.mjs` calls OpenRouter structured output.
- `src/render_docx.mjs` renders collected answers into DOCX files.
- `src/docx_report.mjs` creates generated answers documents.
- `public/app.js` contains the browser interview UI.

## Development Checks

Before handing off changes, run:

```powershell
npm.cmd run check
npm.cmd run check-anchors
npm.cmd run check-orchestrator
node --check src\server.mjs
node --check public\app.js
```

There is no dedicated test framework yet. Focused CLI checks are welcome when
changing importers, rendering, or interview behavior.

## Privacy And Security

VocaForm is designed for local use, but it can still handle sensitive data.

- Do not commit API keys, real family profiles, or completed form exports.
- Keep real profiles in `work\family_profile.local.json` or another ignored
  local path.
- Keep `.env` private; use `.env.example` as the public template.
- Only expose `HOST=0.0.0.0` on networks you trust. The app has no login layer.
- Review imported schemas before using them for important forms.

When API keys are enabled, only the text needed for the selected operation is
sent to the configured provider. The local app cannot use a ChatGPT Plus/Pro or
Codex subscription automatically; it needs API-backed credentials.

## Contributing

This is an early open source project with lots of practical edges to improve:

- Better import heuristics for messy forms
- OCR-friendly PDF workflows
- More languages and interview styles
- Stronger renderer anchor confirmation
- A small automated test suite
- Accessibility and keyboard-flow polish
- Example schemas for common form types

Use concise Conventional Commit-style messages, such as:

```text
feat: add pdf importer
fix: serve svg assets with correct mime type
docs: improve local setup guide
```

Pull requests should include a short summary, commands run, screenshots for UI
changes, and any privacy or key-handling implications.

## Status

VocaForm is usable as a local prototype and scaffold. Treat imported schemas as
drafts, review final answers before sending them anywhere, and expect the
project to evolve quickly.

## License

No license file is included yet. Add one before publishing the project for
external reuse or accepting community contributions.
