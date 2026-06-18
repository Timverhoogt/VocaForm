# Repository Guidelines

## Project Structure & Module Organization

This repository is the VocaForm scaffold, a local Node.js app for voice-assisted form filling.

- `src/` contains all server and domain logic: form state, importers, OpenRouter calls, DOCX parsing/rendering, and CLI checks.
- `public/` contains the browser UI. `public/assets/` holds brand assets such as `vocaform-mark.svg`.
- `data/` contains reusable schemas and example profile data.
- `work/` contains local runtime state, copied templates, generated demo state, and private profile files. Treat it as local working data.
- `IMPORT_MATRIX.md` and `README.md` document supported import formats and operational usage.

## Build, Test, and Development Commands

Use Node.js `>=18`. There is no build step; the app runs directly as ES modules.

- `npm.cmd run serve` starts the local web app at `http://127.0.0.1:5177`.
- `npm.cmd run check` validates the active form schema.
- `npm.cmd run check-anchors` verifies DOCX render anchors against the source template.
- `npm.cmd run check-session -- data\example_entreeformulier.schema.json work\session_state.json` reviews a saved session.
- `npm.cmd run seed-example-profile` writes a generic local example profile into `work/`.
- `npm.cmd run import-docx -- <input.docx> <out.schema.json>` creates a draft schema from a DOCX.
- `npm.cmd run render-docx -- <template.docx> <schema.json> <state.json> <out.docx> in-place` renders a filled DOCX.

On Windows, prefer `npm.cmd` over `npm` to avoid PowerShell execution-policy issues.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and explicit named functions for reusable logic. Keep filenames lowercase with underscores, for example `render_docx.mjs` and `form_state.mjs`. Keep browser code in `public/app.js`; avoid mixing UI behavior into server modules.

## Testing Guidelines

There is no dedicated test framework yet. Treat the validation scripts as the required smoke suite: run `check`, `check-anchors`, `node --check src\server.mjs`, and `node --check public\app.js` before handing off changes. Add focused CLI checks when changing importers or rendering behavior.

## Commit & Pull Request Guidelines

No Git history is present in this scaffold. Use concise Conventional Commit-style messages such as `feat: add pdf importer` or `fix: serve svg assets with correct mime type`. Pull requests should include a short summary, commands run, screenshots for UI changes, and any privacy or key-handling implications.

## Security & Configuration Tips

Never commit API keys, real family profiles, or completed form exports. Configure `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `FORM_TEMPLATE_PATH`, and `FAMILY_PROFILE_PATH` through environment variables. Keep `data/family_profile.example.json` generic and store real values in `work/family_profile.local.json` or another ignored local path.
