# Repository Guidelines

## Project Structure & Module Organization

This repository contains the VocaForm Build Week rebuild and the proven local Node.js prototype it is replacing.

- `app/client/` contains the accessible React/Vite experience.
- `app/domain/` contains provider-independent TypeScript and Zod contracts and session behavior.
- `app/adapters/` wraps proven legacy document and form-state functions.
- `app/server/` contains the TypeScript HTTP API and server-only configuration.
- `app/shared/` contains serialized API contracts shared with the client.
- `app/evals/` contains deterministic golden-form evaluators and synthetic fixtures.
- `src/` contains the legacy server, importers, Realtime connection, and DOCX implementation. Preserve it until equivalent adapter tests pass.
- `public/` contains the legacy browser UI and shared brand assets.
- `data/` contains reusable schemas and example profile data.
- `work/` contains local runtime state, copied templates, generated demo state, and private profile files. Treat it as local working data.
- `BUILD_WEEK_ROADMAP.md`, `IMPORT_MATRIX.md`, and `README.md` document goals, supported formats, and usage.

## Build, Test, and Development Commands

Use Node.js `>=20`.

- `npm run dev` starts the Vite client at `http://127.0.0.1:5173` and the API at `http://127.0.0.1:5177`.
- `npm run build` creates the production client bundle.
- `npm start` serves the production bundle and API at `http://127.0.0.1:5177`.
- `npm run check` runs type checking, linting, tests, and legacy smoke checks.
- `npm run serve:legacy` starts the original prototype.
- `npm run check:legacy` validates the reviewed legacy schema and checks the legacy JavaScript syntax.
- `npm.cmd run check-anchors` verifies DOCX render anchors against the source template.
- `npm.cmd run check-session -- data\example_entreeformulier.schema.json work\session_state.json` reviews a saved session.
- `npm.cmd run seed-example-profile` writes a generic local example profile into `work/`.
- `npm.cmd run import-docx -- <input.docx> <out.schema.json>` creates a draft schema from a DOCX.
- `npm.cmd run render-docx -- <template.docx> <schema.json> <state.json> <out.docx> in-place` renders a filled DOCX.

On Windows, prefer `npm.cmd` over `npm` to avoid PowerShell execution-policy issues.

## Coding Style & Naming Conventions

Use TypeScript ES modules, two-space indentation, semicolons, and explicit named functions for reusable logic. Keep domain code free of browser, server, and provider dependencies. Use lowercase underscore filenames for adapters and legacy modules; use PascalCase for React component files. Do not put OpenAI or HTTP logic in React components.

## Testing Guidelines

Vitest is the focused test framework. Run `npm run check` before handing off changes. Run `npm run eval:compiler` after changing compiler schemas, prompts, or normalization, and run `npm run eval:renderer` after changing document placement or fallback behavior. Add fixture tests for domain behavior and adapter parity, and preserve the legacy schema and syntax checks. Run `npm run build` for UI or bundling changes.

## Commit & Pull Request Guidelines

Use concise Conventional Commit-style messages such as `feat: add pdf importer` or `fix: serve svg assets with correct mime type`. Pull requests should include a short summary, commands run, screenshots for UI changes, and any privacy or key-handling implications.

## Security & Configuration Tips

Never commit API keys, real family profiles, uploaded forms, or completed form exports. Configure `OPENAI_API_KEY`, model IDs, and legacy paths through environment variables. Keep all keys server-side and expose only boolean readiness to the client. Keep `data/family_profile.example.json` generic and store real values in an ignored local path.
