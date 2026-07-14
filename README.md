# VocaForm

VocaForm turns everyday paperwork into a calm conversation. It understands a form, interviews the user for the information it needs, verifies the answers, and returns a completed document. Reusable facts are remembered only with explicit permission.

This repository is being rebuilt for OpenAI Build Week on the `codex/build-week-rebuild` branch. The detailed execution contract lives in [BUILD_WEEK_ROADMAP.md](./BUILD_WEEK_ROADMAP.md).

## Current vertical slice

Goals 1–6 provide the trustworthy foundation, AI form compiler, live voice interview, user-owned memory, guarded final verification, and useful completed documents:

- a React/Vite experience organized around **Understand → Talk → Review**;
- canonical TypeScript and Zod contracts for forms, answers, sessions, memory, and verification;
- deterministic session progress and required-field validation;
- a small TypeScript HTTP API with optimistic session-version checks;
- fixture-driven tests;
- adapters around the proven DOCX package, anchor matching, report, and legacy review code;
- polished draft answer packets plus format-aware verified export from the new application;
- PDF, DOCX, TXT, and Markdown upload through the server;
- explicit `gpt-5.6-sol` compilation through the Responses API;
- strict Zod-derived Structured Outputs for fields, dependencies, validation, evidence, memory candidates, and render targets;
- high-detail PDF inputs, a retained DOCX plus visual PDF companion, and an exact AcroForm field inventory;
- a human-readable readiness check that blocks unsupported evidence and unsafe schemas;
- three synthetic golden-form evaluations for recall, requiredness, dependencies, and fabrication;
- a recorded two-pass live Sol result of 104/104 expected field instances against the then-current 52-field baseline, 50/50 required instances, zero fabricated fields, and zero missing dependencies; the current 53-field set must be replayed before submission;
- a browser WebRTC conversation through the unified Realtime endpoint, with the API key kept on the server;
- eight Realtime function tools for context, atomic answer saves, unknown/skip handling, explicit memory checks, remember/apply consent, remaining questions, and safe completion;
- exact voice provenance, canonical value validation, optimistic session versions, and idempotent tool-call retries;
- automatic interruption handling plus bounded reconnect recovery from the first unresolved question;
- visible listening, thinking, speaking, saving, reconnecting, error, and complete states, with an equal keyboard-accessible text path.
- a typed, application-owned Memory Vault persisted in the ignored local `work/` directory;
- explicit UI and verbal approval before a claim is stored, with source form, source answer, original wording, consent channel, and confirmation time;
- safe contact-only remember prompts, while sensitive, medical, identity, consent, support, and long free-form answers are excluded by default;
- a visible Memory view with remember, correct, and forget controls;
- per-value confirmation before an approved claim is applied to another form, with the claim ID retained on every reused answer;
- a deterministic three-fact handoff from the activity-permission sample to the school sample;
- deterministic final checks for required answers, canonical types and constraints, dependencies, renderer readiness, confidence, and provenance;
- a non-mutating `gpt-5.6-sol` verifier for contradictions, ambiguous answers, and unsupported normalized claims;
- inline confirm, correct, answer, and intentionally-leave-blank actions with explicit user-correction provenance;
- separate draft and verified export routes, with final export locked until a current semantic pass has no unresolved blocker;
- five seeded deterministic verifier cases at 100% recall and 100% final-export gating;
- a live standard/high versus Pro comparison in which both modes caught 3/3 semantic cases with zero extras, so the faster, lower-token standard mode remains selected;
- in-place answer placement into copied DOCX sources and named fields in copied AcroForm PDFs;
- explicit append fallbacks for individual unmatched targets and a polished, section-matched DOCX answer packet for non-writable sources;
- exact renderer coverage and source-preservation reports, with 45/45 native demo answers placed and every output page visually inspected.

The included activity-permission, school-intake, and medical-intake fixtures are synthetic and reviewed. The school form contains 37 interview questions, including 15 required fields, plus profile fields that can receive individually confirmed memory. The medical fixture is a fillable PDF with eight named AcroForm fields. Upload remains the primary path; the fixtures provide deterministic offline testing and complete local Goal 4, Goal 5, and Goal 6 demonstrations.

## OpenAI API configuration

VocaForm uses the OpenAI API directly. It does not use a ChatGPT or Codex subscription as an application credential.

Copy the environment template and set your key locally:

```bash
cp .env.example .env
```

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=high
OPENAI_VERIFICATION_MODEL=gpt-5.6-sol
OPENAI_VERIFICATION_REASONING_MODE=standard
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_SPEED=0.95
OPENAI_REALTIME_REASONING_EFFORT=low
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

Never commit `.env` or expose the API key to browser code. The server reports only whether a key is configured. Uploaded source bytes are copied into process memory only for the active compilation and session so the renderer can preserve the original; they are never returned through the JSON API or written to the repository. Compiler and verifier responses use `store: false`. The reviewed samples remain available without a key so deterministic domain and document paths can be tested independently. Without a key, draft export stays available and verified export remains explicitly unavailable.

DOCX visual compilation uses LibreOffice in headless mode. If `soffice` is not on `PATH`, set `SOFFICE_BIN` to its absolute path.

By default, approved memory is stored at `work/memory_vault.local.json`, which is ignored by Git and written with user-only file permissions. Set `VOCAFORM_WORK_DIR` to place all local Memory Vault state in another private directory. This Build Week local store is not encrypted, so it is not a production store for sensitive personal data.

## Run locally

Requirements:

- Node.js 20 or newer
- npm

Install and start the development servers:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite serves the client and proxies `/api` requests to the TypeScript API on port `5177`.

To exercise memory without an API call:

1. Open the reviewed Community Garden Day permission sample.
2. Answer the parent or guardian name, phone, and email fields, then choose **Remember** for each in Review or Memory.
3. Close the form and open the elementary-school sample.
4. Confirm each of the three Memory Vault suggestions. No value is applied before that confirmation.
5. Open **Memory** to correct or forget a fact; a forgotten fact will not appear in a new school session.

To build and serve the production bundle:

```bash
npm run build
npm start
```

Then open `http://127.0.0.1:5177`.

## Quality gate

Run the complete verification suite:

```bash
npm run check
```

It runs:

- TypeScript type checking;
- ESLint with type-aware rules and React hooks checks;
- Vitest fixture and legacy-adapter tests;
- compiler golden-form evaluation;
- deterministic final-verifier evaluation and export-gate checks;
- deterministic DOCX, fillable-PDF, and answer-packet rendering evaluation;
- the original schema validator;
- syntax checks for the legacy server and browser application.

Useful individual commands:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:visual
npm run build
npm run eval:compiler
npm run eval:verifier
npm run eval:renderer
npm run check:legacy
```

To write the synthetic school DOCX and medical AcroForm PDF sources into ignored local storage for manual testing:

```bash
npm run fixtures:rendering
```

## Visual browser testing

Playwright covers the complete Goal 4 memory journey, Goal 5 verification correction flow, and Goal 6 output-format messaging in Chromium at desktop and Pixel 7 viewports. The suite verifies explicit memory consent, correction, forgetting, keyboard focus, traceable reused answers, final-export gating, inline blocker resolution, correction provenance, format-aware downloads, and mobile overflow. Each checkpoint is compared with committed baselines beside its `*.visual.spec.ts` file.

Install the browser once, then run the visual suite:

```bash
npx playwright install chromium
npm run test:visual
```

For interactive debugging or an intentional baseline refresh:

```bash
npm run test:visual:headed
npm run test:visual:update
```

Playwright starts isolated client and API processes on ports `5183` and `5187`, disables OpenAI calls, and stores its private Memory Vault, traces, videos, screenshots, and HTML report under ignored `work/playwright/`. Baselines are platform-specific; review every changed image before committing an update. The visual suite remains separate from `npm run check` so the standard quality gate does not require a downloaded browser binary.

Before submission, record a live two-pass Sol score against the rendered golden documents:

```bash
npm run eval:compiler:live -- \
  --medical /path/to/medical-intake.pdf \
  --school /path/to/school-intake.docx \
  --permission /path/to/activity-permission.txt \
  --repeats 2
```

The live command uses source-evidence identity, the same readiness checks, and the same answer keys as the offline gate. It reports per-run progress and token usage, and fails the process when Goal 2 thresholds are missed.

To replay the Goal 5 standard/high versus Pro comparison against the synthetic semantic cases:

```bash
npm run eval:verifier:live
```

The command runs contradiction, unsupported-claim, and ambiguity cases in both modes; rejects unknown field IDs; verifies that every session remains unchanged; and reports recall, extra findings, latency, and tokens. On July 14, 2026, both modes detected 3/3 cases with zero extras. Standard averaged 8.7 seconds and used 3,078 input plus 783 output tokens; Pro averaged 14.3 seconds and used 17,940 input plus 2,458 output tokens. Because Pro produced no correctness improvement, `standard` remains the default.

## Architecture

```text
app/client/                 Accessible React experience
app/domain/                 Provider-independent form and session contracts
app/adapters/               Verified DOCX/PDF renderers and proven-code adapters
app/server/                 TypeScript API, fixture registry, and runtime config
app/shared/                 Serialized API contracts
app/evals/                  Golden compiler, verifier, and renderer fixtures and metrics
app/e2e/                    Playwright journeys and visual-regression baselines
src/                        Proven legacy import, state, Realtime, and DOCX modules
public/                     Legacy browser interface and shared VocaForm mark
data/                       Synthetic reviewed fixture data
```

The domain layer does not import browser, server, or OpenAI code. Provider integrations will translate their output into the canonical schemas before application state changes.

## Application API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Runtime readiness without exposing secrets |
| `GET` | `/api/fixtures` | Available reviewed sample forms |
| `POST` | `/api/forms/compile` | Compile an uploaded base64 file with GPT-5.6 Sol |
| `GET` | `/api/compilation` | Read the current readiness result |
| `DELETE` | `/api/compilation` | Discard the current compilation |
| `POST` | `/api/session/fixture` | Start a typed session from a fixture |
| `POST` | `/api/session/compiled` | Start a session after readiness passes |
| `GET` | `/api/session` | Read the active session, progress, and verification |
| `POST` | `/api/session/answer` | Save a text answer with a session-version guard |
| `POST` | `/api/session/skip` | Mark the current question for later review |
| `POST` | `/api/session/verify` | Run deterministic checks and, when unblocked, the non-mutating Sol verifier |
| `POST` | `/api/session/verification/issues/:id/resolve` | Explicitly answer, confirm, correct, or leave blank one active finding |
| `POST` | `/api/realtime/call` | Exchange a browser WebRTC offer through the server-side unified Realtime endpoint |
| `POST` | `/api/interview/tool` | Execute a validated, idempotent Realtime interview tool call |
| `GET` | `/api/memory` | Read approved local claims; proposals are never persisted |
| `POST` | `/api/memory/remember` | Store one eligible answered contact fact after an explicit UI action |
| `POST` | `/api/memory/apply` | Apply one approved claim to one form field after confirmation |
| `PATCH` | `/api/memory/claims/:id` | Correct an approved remembered value for future forms |
| `DELETE` | `/api/memory/claims/:id` | Forget a claim and remove it from future suggestions |
| `DELETE` | `/api/session` | Close the local in-memory session |
| `POST` | `/api/export/draft` | Generate a polished draft DOCX answer packet |
| `POST` | `/api/export/final` | Fill a copied DOCX/PDF source or generate an explicit answer packet after the current final gate passes |

## Privacy boundaries

- API keys and real form data must never be committed.
- The repository contains only synthetic example profiles and form data.
- Uploaded source bytes, compilations, and active sessions stay in process memory and are discarded when their associated state is cleared or the server exits.
- Rendering always works on copied bytes and verifies that the retained source is byte-for-byte unchanged.
- OpenAI API keys remain server-side.
- The browser sends its WebRTC offer to VocaForm; only the server authenticates the Realtime call.
- Spoken writes are accepted only through validated application tools and retain the user's exact wording as provenance.
- Cancelled or interrupted model responses do not execute pending client-side tool calls.
- Responses API compilation uses `store: false`.
- Responses API final verification also uses `store: false` and cannot write application state.
- Model findings are advisory objects; only a user action can confirm, correct, answer, or intentionally blank a value.
- Any answer change invalidates the prior semantic pass, and verified export requires a pass for the exact current session version.
- Application memory is durable local application state, separate from model conversation or reasoning state.
- Merely answering a field or generating a proposal never writes a memory claim.
- Medical, financial, identity-document, child-identity, support, consent, and long free-form answers are not remembered by default.
- Remembered values are suggestions only; each value must be confirmed before it becomes a form answer.
- Forgetting physically removes the claim from the local vault and future suggestions, while already confirmed answers on the active form are not silently rewritten.

This Build Week project is not represented as production medical software or as satisfying any particular healthcare compliance regime.

## Legacy compatibility

The original local prototype remains available while its proven behavior is wrapped and replaced:

```bash
npm run serve:legacy
```

The legacy CLI import and rendering commands are also preserved. See [IMPORT_MATRIX.md](./IMPORT_MATRIX.md) for their current format support and limitations.

## Current limitations

- Active sessions are intentionally process-local during Build Week. Realtime reconnects survive a browser transport interruption, but not an API server restart.
- A text interview remains available when microphone access, WebRTC, or the AI service is unavailable.
- Compilation-readiness blockers still require a clearer source file; field-level editing of a compiled schema remains deferred.
- Arbitrary scanned or non-AcroForm PDFs receive a clearly identified DOCX answer packet; pixel-perfect scanned-page overlays remain out of scope.
- PDF fields that cannot represent an answer safely fall back to the answer packet instead of silently altering or omitting the value.

These limitations are explicit cut points, not hidden product claims.
