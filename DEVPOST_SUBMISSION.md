# VocaForm Devpost Submission Copy

**Status:** Draft project created and copy-ready except for the deployed demo and public YouTube URLs. Replace both `TO_BE_ADDED_BEFORE_SUBMISSION` values only after signed-out verification. The draft has not been entered into or submitted to the hackathon.

**Devpost draft:** [devpost.com/software/vocaform](https://devpost.com/software/vocaform) · project ID `1332705`

## Required fields

| Field | Value |
| --- | --- |
| Project name | VocaForm |
| Tagline | One form. One conversation. Done. |
| Devpost draft | https://devpost.com/software/vocaform |
| Category | Apps for Your Life |
| Repository | https://github.com/Timverhoogt/VocaForm |
| Working demo | TO_BE_ADDED_BEFORE_SUBMISSION |
| Public YouTube video | TO_BE_ADDED_BEFORE_SUBMISSION |
| Codex `/feedback` task to confirm | `019f5ff0-9cda-7c71-b035-9b120101b753` |
| License | MIT |

## Build Week submission-field map

| Field ID | Required field | Prepared value |
| ---: | --- | --- |
| 27945 | Submitter Type | Individual |
| 27946 | Country of Residence | **Confirm with the submitter before submission** |
| 27947 | Category | Apps for Your Life |
| 27948 | Code repository | https://github.com/Timverhoogt/VocaForm |
| 27949 | Judge demo and instructions | Add the signed-out-verified public demo URL; use reviewed synthetic data only |
| 27950 | `/feedback` Session ID | Run `/feedback` in task `019f5ff0-9cda-7c71-b035-9b120101b753` and paste the returned value |
| 27951 | Plugin/developer-tool instructions | Not applicable |

The recorded Codex task contains the majority of the core Build Week implementation across the typed foundation, GPT-5.6 form compiler, and Realtime interview. Open that task in Codex and run `/feedback`; paste the ID Codex returns into Devpost. Do not assume the task UUID above is accepted without that confirmation step.

## Short description

VocaForm turns PDF, Word, and text forms into a calm, accessible conversation and returns a reviewed completed document. GPT-5.6 Sol compiles unfamiliar forms and performs a separate semantic review; Realtime conducts the voice interview; deterministic application code owns answers, consent, memory, validation, and rendering.

## Project description

### Inspiration

Forms quietly assume that everyone can read dense administrative language, type repeated information, understand conditional questions, and catch omissions. That creates a disproportionate burden for people with disabilities, language barriers, low digital confidence, limited time, or simply too much paperwork.

A generic chatbot does not solve the trust problem. It can paraphrase a document, but a real form assistant has to remain tied to the source, preserve exact answers, expose uncertainty, ask before reusing personal details, and return an actual document.

### What it does

VocaForm provides one coherent **Upload → Talk → Review → Download** journey:

- upload a PDF, DOCX, TXT, or Markdown form, or open one of three reviewed synthetic samples;
- compile the document into source-grounded questions, requiredness, dependencies, validation, and rendering targets;
- answer naturally by voice through OpenAI Realtime or use the equal keyboard path;
- watch validated answers appear as application tools save them with exact provenance;
- resolve deterministic and semantic findings without allowing the verifier to mutate the form;
- download a filled copy of a supported DOCX or AcroForm PDF, with an explicit answer-packet fallback when native placement is unsafe;
- explicitly remember eligible contact facts, confirm each reuse on a later form, and correct or forget them at any time.

Medical, financial, identity-document, consent, child-identity, support, and long free-form answers are excluded from memory by default.

The application interface is English, while form content retains a validated BCP 47 language boundary for screen readers and Realtime defaults to that form language. English and Dutch form journeys are reviewed for the submission; other form languages are presented as best-effort architecture support rather than certified localization.

Export accessibility is source-dependent. VocaForm adds language metadata and human-readable PDF field labels where safe, while generated DOCX answer packets use real heading structure and linear label/value order. It does not claim to convert arbitrary uploads into tagged PDFs or PDF/UA-conformant documents.

### How it was built

The new Build Week application is a React/Vite client and TypeScript HTTP API organized around provider-independent Zod contracts. GPT-5.6 Sol receives document text plus high-detail page imagery for layout-sensitive formats and returns strict Structured Outputs. A separate Sol request performs a non-mutating final semantic review with `store: false`.

OpenAI Realtime uses WebRTC for low-latency speech-to-speech interviewing. Eight versioned application tools expose only validated operations such as saving answers, marking a question unknown, checking memory, and completing the interview. Duplicate call IDs are idempotent, stale session versions are rejected, and reconnects rebuild context from server-owned state.

Document adapters fill copied DOCX and PDF sources and report exact placement coverage. The original upload is hashed and checked for preservation. A deterministic domain layer owns requiredness, dependencies, answer validation, memory eligibility, consent, provenance, verification gates, and export readiness.

### How GPT-5.6 and Codex were used

GPT-5.6 Sol is used in the product for the two document-level reasoning tasks: compiling unfamiliar forms into an evidence-backed schema and performing a separate non-mutating semantic verification before final export. Realtime handles conversation; it is not presented as GPT-5.6 Sol.

Codex with GPT-5.6 accelerated the Build Week rebuild from a local JavaScript prototype into a modular TypeScript application. It helped create the canonical contracts, adapter parity, Realtime tool boundaries, accessible product flow, golden evaluations, renderer checks, and resilience automation.

Human judgment set the boundaries: models do not own state, memory is opt-in, sensitive information is excluded, verification cannot write answers, fallbacks are explicit, and VocaForm makes no production-healthcare or compliance claim.

### Challenges

The hardest part was not eliciting answers; it was preserving trust across document interpretation, voice retries, memory reuse, verification, and rendering. Conditional questions had to remain deterministic after compilation. Realtime tool calls needed optimistic versions and idempotency. Native outputs needed exact coverage reporting so an unmatched field could never disappear silently.

Accessibility also had to be a system property rather than a final polish pass. Voice has a complete text alternative, every async operation has a visible loading and recovery state, stage changes manage focus, controls meet target-size and contrast requirements, and the prepared journey is tested at desktop, mobile, keyboard-only, and 200% text size.

### Accomplishments

- A live GPT-5.6 Sol replay recalled 53/53 expected fields and 25/25 required fields across PDF, DOCX, and conditional text forms, with zero fabrication and no missing dependencies.
- Five consecutive isolated north-star runs completed without a blocking failure.
- The verifier gate detects every seeded blocker class, and verified export is tied to the current session version.
- Native renderer fixtures place 45/45 answers while preserving the original sources.
- Exactly three approved contact facts are reused in the memory journey; zero sensitive claims are stored.
- The production build and desktop/mobile Playwright accessibility and visual journeys pass one documented submission command.

### What I learned

The strongest model architecture was also the clearest product explanation: let models understand and converse, but keep authority in code. Structured Outputs are most valuable when paired with evidence and deterministic readiness checks. A memory feature becomes safer and easier to explain when every write and every reuse is a visible user action.

### What's next

The next step is user research on whether the mandatory semantic pass should remain required, become default-on but skippable, or be reserved for higher-risk forms. The public judge preview now isolates each browser in an expiring in-memory state and rate-limits model-backed routes; production work would replace that boundary with authenticated tenants, encrypted storage, durable sessions, and more document-layout adapters. Native overlays for arbitrary scanned PDFs remain deliberately out of scope.

## Technology list

TypeScript, React, Vite, Zod, OpenAI Responses API, GPT-5.6 Sol, OpenAI Realtime WebRTC, pdf-lib, DOCX adapters, Vitest, Playwright, axe-core, Docker, and Render Blueprint infrastructure.

## Prior-work disclosure

VocaForm had a local Node.js prototype before Build Week. Commit `cd2b782` is the dated pre-event baseline. The preserved `src/` and `public/` code is not claimed as new work. The Build Week rebuild begins at `ca05d21` and lives primarily in `app/`, with the prototype retained behind tested adapters until equivalent behavior is proven.
