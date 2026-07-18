# VocaForm Build Week Roadmap

## Mission

Build the most humane way to complete paperwork:

> Upload any everyday form, answer it through a calm voice conversation, and receive a verified completed document. VocaForm can remember reusable facts only with the user's permission.

**Build Week track:** Apps for Your Life

**Submission deadline:** July 22, 2026 at 00:00 UTC (July 22 at 02:00 CEST)

**Internal ship deadline:** July 21 at 20:00 CEST, leaving a six-hour submission buffer

## North-star demo

The product is ready when a judge can watch this single coherent journey:

1. A user uploads an unfamiliar medical intake PDF.
2. GPT-5.6 Sol identifies the document structure, questions, required fields, conditional questions, and answer locations without manual setup.
3. VocaForm proposes only safe, previously approved facts and asks the user to confirm them.
4. The user completes the form in one natural speech-to-speech conversation.
5. Answers appear in the form state while the conversation is happening; there is no separate "process transcript" step.
6. GPT-5.6 Sol verifies completeness, contradictions, and grounding before allowing final export.
7. The user reviews a short, understandable summary and downloads the completed document.
8. A second school form demonstrates that approved contact details can be reused while sensitive answers are not silently remembered.

The complete demo must fit comfortably inside a three-minute narrated video.

## Product principles

- **Conversation first:** after upload, the primary interface is one large voice control and a calm progress view.
- **No invented answers:** every value must be grounded in the document, the current conversation, or explicitly confirmed memory.
- **User-owned memory:** remembering and forgetting are visible product actions. Sensitive facts are never stored by default.
- **Accessible by design:** the essential journey works with keyboard navigation, screen readers, high zoom, high contrast, and voice.
- **Trust through transparency:** show what was understood, what remains uncertain, and why a follow-up is necessary.
- **Graceful degradation:** writable source documents are filled directly; unsupported documents receive a polished completed answer packet with a clear explanation.
- **One excellent journey:** features that do not strengthen the north-star demo wait until after Build Week.

## UI design north star

Use OpenAI product design cues as the north star: quiet, direct, highly legible, and useful before decorative. Adapt the principles to VocaForm rather than copying OpenAI branding.

- Use the platform-native system font stack for structural UI and keep the type scale compact.
- Prefer neutral, solid surfaces; remove decorative gradients, patterns, oversized display typography, and heavy shadows where they compete with the task.
- Reserve VocaForm green for the logo, primary action, selected state, and small trust accents—not body text or large background fields.
- Use a consistent spacing grid, restrained corner radii, thin dividers, and a clear headline → supporting text → primary action hierarchy.
- Prefer monochrome outlined icons with text labels. Never require users to infer meaning from color or iconography alone.
- Treat WCAG AA contrast, text resizing, keyboard use, screen-reader clarity, and reduced motion as design inputs from the first implementation.
- Keep one obvious primary action on each screen and reveal detail progressively.
- Optimize the active-form experience over landing-page presentation. Once a form is open, the form and conversation own the visual hierarchy.

## Target architecture

| Component | Responsibility | Model or technology |
| --- | --- | --- |
| Form Compiler | Convert an uploaded document into the canonical VocaForm schema with source evidence and rendering targets | Responses API with `gpt-5.6-sol`, strict Structured Outputs, high-detail PDF input |
| Interview Conductor | Hold the natural speech conversation, ask follow-ups, and call application tools | OpenAI Realtime over WebRTC with function calling |
| Form State | Store deterministic questions, answers, provenance, confidence, dependencies, and completion status | Application-owned TypeScript domain layer |
| Memory Vault | Store user-approved reusable claims with subject, scope, sensitivity, source, and confirmation date | Application-owned local store; never model reasoning state |
| Final Verifier | Check missing answers, conflicts, unsupported claims, and render readiness | Responses API with `gpt-5.6-sol`; evaluate standard versus Pro mode |
| Document Renderer | Fill supported originals and produce a high-quality fallback answer packet | Reused DOCX primitives plus a fillable-PDF adapter |
| Experience Layer | Deliver the upload, interview, review, consent, and export experience | TypeScript web UI with accessible semantic components |

GPT-5.6 Sol is deliberately used for the two hard, quality-sensitive tasks: compiling arbitrary forms and verifying the final result. Realtime owns low-latency conversation. Application code remains authoritative for state, validation, consent, and rendering.

## Goal 0 — Establish the build contract

**Outcome:** everyone builds toward the same product and demo.

### Work

- Keep all rebuild work on `codex/build-week-rebuild`.
- Preserve proven legacy modules until their replacements pass equivalent tests.
- Select three synthetic, redistributable golden forms:
  - medical intake PDF;
  - elementary-school DOCX;
  - activity or permission form with conditional questions.
- Create answer keys for detected fields, requiredness, dependencies, and rendering positions.
- Record architectural decisions and explicit cut lines in the repository.

### Acceptance criteria

- The north-star demo and judging track are fixed.
- No real medical, child, family, or identity data is committed.
- Every later goal has a measurable exit condition.

### Judge signal

Quality of the idea and evidence of deliberate product judgment.

## Goal 1 — Build a trustworthy product foundation

**Outcome:** a modular, testable application shell replaces the current prototype structure without breaking proven document logic.

**Status:** Complete — July 14, 2026. The typed domain, legacy adapters, fixture flow, production API, journey shell, DOCX export, and complete quality gate are in place on `codex/build-week-rebuild`.

### Work

- Move runtime code to TypeScript and separate UI, API adapters, domain logic, and document adapters.
- Define the canonical `FormDefinition`, `FormField`, `AnswerRecord`, `MemoryClaim`, and `VerificationResult` schemas.
- Wrap the existing DOCX package, text extraction, anchor matching, and rendering functions behind tested adapters.
- Add fixture-based tests, linting, type checking, and one command that runs the complete quality gate.
- Build a calm three-stage shell: **Understand → Talk → Review**.

### Acceptance criteria

- `npm run check` runs type checking, tests, and linting.
- Domain logic has no browser or provider dependencies.
- The application loads a fixture form, displays progress, and exports through the legacy DOCX adapter.
- The initial screen contains one obvious primary action.

### Cut line

Do not build accounts, organizations, billing, or production deployment infrastructure during this goal.

### Judge signal

Technological implementation and a coherent product foundation.

## Goal 2 — Compile arbitrary forms with GPT-5.6 Sol

**Outcome:** upload a form and receive an evidence-backed, interview-ready schema without manual mapping.

**Status:** Complete — July 14, 2026; live baseline refreshed July 15. The upload pipeline, explicit Sol Responses client, high-detail PDF/DOCX visual input, strict schema, readiness gate, conditional session behavior, deterministic memory-safety guard, and three-form regression suite are complete. The historical two-pass evaluation against the then-current 52-field baseline recalled 104/104 field instances and 50/50 required instances. The current 53-field live replay recalled 53/53 expected fields and 25/25 required fields, with zero fabricated fields and no missing dependencies; its separate evidence is recorded in `SUBMISSION_EVIDENCE.md`.

### Work

- Implement a Responses API client using the explicit `gpt-5.6-sol` model.
- Send PDFs as high-detail file inputs so both extracted text and page imagery inform the result.
- Convert DOCX to a visual PDF companion when layout is required, while retaining the original for rendering.
- Produce strict structured output containing:
  - sections and fields;
  - field type and requiredness;
  - conditional dependencies;
  - human interview wording;
  - validation constraints;
  - safe memory-key candidates;
  - source page, source text, and confidence;
  - renderer targets and fallback strategy.
- Present low-confidence findings as an understandable readiness check, not raw JSON.
- Build regression fixtures for all three golden forms.

### Acceptance criteria

- At least 95% field recall across the three golden forms.
- 100% recall for fields marked required in the golden answer keys.
- No fabricated fields in the final accepted schema.
- Each detected field contains inspectable source evidence.
- Re-running the same fixture produces a schema that passes deterministic validation.

### Cut line

Do not add GPT-5.6 multi-agent or Programmatic Tool Calling merely for novelty. Adopt them only if an evaluation demonstrates a clear quality or latency gain.

### Judge signal

The clearest demonstration of GPT-5.6 Sol's multimodal reasoning and structured-output capabilities.

## Goal 3 — Conduct a real voice interview with live tool calls

**Outcome:** the conversation itself updates form state reliably.

**Status:** Complete — July 14, 2026. VocaForm now uses the unified Realtime WebRTC endpoint with six version-aware application tools, atomic multi-field voice saves, server and client call-ID idempotency, exact spoken provenance, automatic interruption safety, bounded reconnect recovery, live progress, and an equal text fallback. The deterministic suite exercises a complete permission-form interview, unsafe-call rejection, reconnect state recovery, and cancelled-response write suppression.

### Work

- Reuse the proven WebRTC connection and interruption handling.
- Replace browser-injected field prompts with Realtime function tools:
  - `get_interview_context`;
  - `save_answers`;
  - `mark_unknown_or_skipped`;
  - `request_memory_confirmation`;
  - `get_remaining_questions`;
  - `finish_interview`.
- Make tool handlers validate field IDs, value types, provenance, and session version before writing state.
- Support one answer satisfying multiple related fields when appropriate.
- Persist after each successful tool call and recover cleanly after reconnecting.
- Show live, non-distracting progress without forcing the user to inspect a transcript.

### Acceptance criteria

- A scripted interview completes without clicking a per-field save or transcript-processing button.
- Every accepted spoken answer is represented in state with provenance.
- Interrupting the assistant does not duplicate, lose, or prematurely save answers.
- A disconnected session resumes at the first unresolved question.
- Tool calls with unknown fields or invalid values are rejected safely.

### Judge signal

A non-trivial, visible integration that makes VocaForm feel like a finished product rather than an AI wrapper.

## Goal 4 — Make memory safe, useful, and visible

**Outcome:** a second form is meaningfully faster without making the user wonder what was stored.

**Status:** Complete — July 14, 2026. VocaForm now has a durable local Memory Vault with typed claim provenance, explicit UI and verbal consent, safe contact-only proposals, per-value confirmation before reuse, visible memory attribution, and correct/forget controls. The deterministic permission-to-school journey reuses three approved guardian contact facts while medical, child-identity, support, consent, and free-form answers remain excluded by default.

### Work

- Store reusable information as typed claims with:
  - subject and canonical key;
  - value and original wording;
  - sensitivity class;
  - source form and provenance;
  - consent state;
  - confirmation timestamp;
  - optional expiry.
- Default stable contact facts to "ask to remember."
- Default medical, financial, identity-document, and free-form sensitive answers to "do not remember."
- Ask for confirmation before applying a remembered claim to a new form.
- Add a simple memory view with remember, correct, and forget actions.
- Keep model conversation state separate from application memory.

### Acceptance criteria

- No claim is stored without an explicit user action or verbal confirmation.
- Sensitive fixture answers are absent from memory by default.
- The second golden form reuses at least three approved facts after confirmation.
- Forgetting a claim removes it from future suggestions.
- Every prefilled value remains visibly attributable to memory until confirmed.

### Judge signal

Potential impact, trust, and genuine understanding of the target audience.

## Goal 5 — Verify before finalizing

**Outcome:** VocaForm can explain why a document is ready—or exactly what still needs attention.

**Status:** Complete — July 14, 2026. Deterministic checks now cover requiredness, canonical values, dependencies, renderer readiness, confidence, and answer provenance. A strict, non-mutating GPT-5.6 Sol pass reports semantic contradictions, ambiguity, and unsupported claims as user-owned actions, while final export remains locked until the exact current session is clear. All five seeded deterministic failures were detected and gated. In the live semantic comparison, standard/high and Pro each detected 3/3 cases with zero extras and no session mutation; Pro offered no correctness gain while using substantially more tokens and latency, so standard/high remains selected.

**Product-testing note:** Requiring the Sol semantic pass for verified export is provisional, not a permanent product decision. Proper user testing must establish whether people find the additional review understandable and valuable, and whether its error prevention outweighs waiting time, false positives, privacy concerns, and extra steps. Deterministic validation remains mandatory; based on user feedback, the Sol review may become optional, default-on but skippable, or required only for selected high-risk forms.

### Work

- Add deterministic validation for requiredness, type, dependencies, and renderer readiness.
- Add a GPT-5.6 Sol verification pass for semantic contradictions, ambiguity, and unsupported claims.
- Require each answer to reference conversation evidence, confirmed memory, or explicit user correction.
- Turn verifier findings into concise user actions: confirm, correct, answer, or intentionally leave blank.
- Evaluate standard high reasoning against Pro mode on the golden fixtures; use Pro only if it materially improves correctness.

### Acceptance criteria

- All seeded missing-required, contradiction, and unsupported-answer cases are caught.
- No final export is enabled while a blocking issue remains.
- The user can resolve every finding without editing JSON or restarting the interview.
- The verifier never silently changes an answer.

### Judge signal

Technical depth and a credible answer to hallucination and trust concerns.

## Goal 6 — Return a genuinely useful completed document

**Outcome:** the result can be sent to the organization that requested the form.

**Status:** Complete — July 14, 2026. Verified export now fills copied DOCX and AcroForm PDF sources, preserves every original byte, and exposes exact placement and fallback coverage. The deterministic renderer evaluation placed 45/45 demo answers in native targets. Missing writable targets receive an explicit in-document fallback, while non-writable PDFs receive a polished section-matched DOCX answer packet. Every generated page was rendered and visually inspected without clipping or overlap.

### Work

- Reuse and harden the DOCX in-place renderer with append fallback.
- Add support for AcroForm/fillable PDF fields.
- Preserve original documents and generate new output files.
- For scanned or non-writable documents, generate a polished answer packet that mirrors the source sections and clearly references the original.
- Include a completion summary that is useful to the user but not inserted into the submitted form unless requested.

### Acceptance criteria

- The school DOCX and medical fillable PDF round-trip with all demo answers in the expected locations.
- Original source files remain byte-for-byte unchanged.
- Every field either renders to a verified target or appears in the explicit fallback section.
- Generated files open successfully in standard Word and PDF viewers.

### Cut line

Pixel-perfect overlay onto every arbitrary scanned PDF is a stretch goal, not a release blocker. Never disguise an answer packet as a filled original.

### Judge signal

The concrete payoff: VocaForm finishes the task instead of stopping at a chatbot response.

## Goal 7 — Deliver an accessibility-led product experience

**Outcome:** the interface feels calmer than the paperwork and remains usable without relying on sight or technical knowledge.

**Status:** Complete — July 14, 2026. The product now follows Upload → Talk → Review → Download with plain-language cards and no user-facing model, provider, key, or configuration controls. New stage/question focus management, semantic landmarks, action-specific live announcements, retryable alerts, 44-pixel targets, AA contrast, forced-color support, reduced motion, and 200% text reflow close the audit findings. A role/name-only, keyboard walkthrough completes all eight prepared-form questions and downloads the draft on desktop and mobile; axe reports no serious or critical WCAG A/AA violations across Upload, prepared-form, Talk, Review, Download, and error states. The scripted Realtime tool journey continues to prove voice completion while the UI exposes listening, thinking, speaking, saving, reconnecting, error, and complete states in text.

### Work

- Reduce the main journey to upload, talk, review, and download.
- Replace the profile JSON editor and field-management dashboard with human-readable cards.
- Provide strong focus states, semantic landmarks, status announcements, large targets, high contrast, and 200% zoom support.
- Ensure every action works by keyboard and is understandable through a screen reader.
- Add text input as an equal fallback, not a hidden recovery path.
- Show listening, thinking, saving, reconnecting, and complete states without relying on color alone.
- Run accessibility checks and at least one eyes-closed, screen-reader-assisted walkthrough.

### Acceptance criteria

- No essential action requires a pointer device.
- Automated accessibility checks have no critical violations.
- The entire prepared-form interview can be completed using voice plus keyboard.
- Error and recovery states are announced and actionable.
- The interface exposes no model/provider switches to the target user.

### Judge signal

Design, completeness, and a credible connection to the stated audience.

## Goal 8 — Prove quality and resilience

**Outcome:** the demo is backed by repeatable evidence rather than a single lucky run.

**Status:** Complete — July 15, 2026. `npm run check:resilience` now unifies type checking, linting, unit and adapter tests, compiler/verifier/renderer evaluations, a five-pass isolated north-star resilience evaluation, legacy checks, the production build, and desktop/mobile Playwright accessibility and visual coverage. All five consecutive passes completed without a blocker, with Realtime tool replay deduplicated, reconnect state recovered, the medical PDF rendered at 100% coverage with its source preserved, exactly three explicitly approved safe contact facts stored and reused, and zero sensitive claims retained. Strict local traces record compiler, verifier, Realtime connection/first-response, tool, and export metrics without accepting form content or user identifiers. The complete evidence and loading/recovery matrix are recorded in `RESILIENCE_REPORT.md`.

### Work

- Add golden evaluations for compiler recall, requiredness, dependencies, memory safety, verifier findings, and rendering coverage.
- Add scripted Realtime tool-call scenarios and reconnect tests.
- Track compiler latency, first voice response latency, tool errors, and token usage.
- Add privacy-safe structured traces that make failures diagnosable without recording sensitive demo content.
- Test the complete demo flow repeatedly on a clean environment.

### Acceptance criteria

- All golden evaluations and smoke tests run through one documented command.
- Five consecutive north-star demo runs finish without a blocking failure.
- The prepared demo has no network call or manual step that lacks a visible loading or recovery state.
- Sample data and setup instructions are sufficient for a judge to run the project.

### Judge signal

Genuine engineering effort and confidence that the application is real.

## Goal 9 — Package the story and submit early

**Outcome:** judges understand the problem, experience the solution, and can verify how it was built.

**Status:** Pre-submission experience review PASS on candidate `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf` — July 16, 2026. The current live `gpt-5.6-sol` compiler replay passed 53/53 expected fields and 25/25 required fields with zero fabrication and no missing dependencies. The repository now includes a non-root Docker release with LibreOffice, a manually frozen Render Blueprint, isolated expiring public-demo state, bounded model-backed routes, an explicit release audit and single `npm run check:submission` gate, submission evidence, an unsubmitted Devpost draft, an exact 2:50 narration script, reviewed caption timings, and a deadline-driven handoff checklist. The experience review resolved mobile task order, Dutch language boundaries, public-demo disclosure, forced-colors rendering, the manual VoiceOver findings, choice-question handling, contradictory completion progress, and narrow-screen heading overflow at 200% text. The complete manual VoiceOver journey is a carried-forward baseline; the new choice-dialog/progress delta passed exact-candidate keyboard, accessibility-tree, Axe, and desktop/mobile regression review. The candidate also removes a Render free-tier-incompatible shutdown option without changing application behavior. Export structure was audited and improved; the remaining untagged native-PDF boundary is accepted with a narrowed claim. The exact candidate passed the complete deterministic, build, resilience, and 16-journey desktop/mobile suite before sign-off. External account actions remain intentionally open: push and deploy the frozen commit with a dashboard-supplied key, record and publish the public video, confirm the core task with `/feedback`, add the verified links and legal residence field, and submit by the internal deadline.

### Work

- Deploy a judge-accessible demo using synthetic data and clear privacy messaging.
- Write a concise README covering:
  - the user problem;
  - architecture and model roles;
  - how GPT-5.6 Sol is used;
  - how Codex accelerated development and where human decisions mattered;
  - setup, sample data, tests, limitations, and privacy boundaries.
- Add an explicit **Prior work vs. Build Week work** section to the README before submission. Use `cd2b782` as the pre-event baseline and `ca05d21..HEAD` as the Build Week range, distinguish the preserved `src/` and `public/` prototype from the new `app/` rebuild, and preserve the dated commit history as eligibility evidence.
- Record a narrated video under three minutes, following the HeyGen capture, edit, and YouTube QA notes in `DEMO_VIDEO_PLAN.md`:
  - problem and user: 20 seconds;
  - upload and Sol compilation: 35 seconds;
  - live voice interview: 65 seconds;
  - verification and completed document: 30 seconds;
  - memory reuse on a second form: 20 seconds;
  - architecture, Codex, and close: 10 seconds.
- Save the required `/feedback` Codex Session ID.
- Complete the Devpost project description and required submission fields.
- Present the complete Web Forms Goals 1–6A workflow as a clearly labelled additive Devpost **new feature** completed after the original video was finalized. Link the feature claim to its deployed flow and deterministic evaluation evidence, and use the final 2:27 demo to show the document and web-form journeys together while explicitly explaining how Codex and GPT-5.6 were used.
- Submit by the internal deadline, then use the remaining buffer only for verification or a safe resubmission.

### Acceptance criteria

- The public video is below three minutes and includes narration about both GPT-5.6 and Codex.
- The repository is licensed, documented, and runnable from a clean clone.
- The demo link works without private credentials from the judge.
- The Devpost submission is complete by July 21 at 20:00 CEST.
- The Devpost copy and corrected demo preserve the provider hand-off boundary: supported answers may be prepared and verified, but VocaForm stops before Submit and the final click stays with the user.

### Judge signal

All four criteria are easy to recognize without requiring judges to infer the product's value.

## Daily execution schedule

| Date | Primary goals | End-of-day proof |
| --- | --- | --- |
| July 14 | Goals 0–1 | Rebuild branch, canonical schemas, test harness, accessible journey shell |
| July 15 | Goal 2 | All three forms compile through GPT-5.6 Sol and produce evidence-backed schemas |
| July 16 | Goal 3 | One uninterrupted Realtime interview writes live answers through tools |
| July 17 | Goals 3–4 | Robust full interview plus opt-in memory demonstrated on a second form |
| July 18 | Goals 5–6 | Verified final state produces completed DOCX and fillable PDF outputs |
| July 19 | Goals 7–8 | Accessibility pass, golden evals, recovery behavior, repeated full-flow runs |
| July 20 | Goal 9 | Feature freeze, deployed demo, README, first complete video recording |
| July 21 | Goal 9 | Final video, submission QA, submit by 20:00 CEST |

## Priority and cut policy

### Must ship

- GPT-5.6 Sol form compilation with evidence-backed structured output.
- One natural Realtime interview with live function calls.
- User-controlled memory demonstrated across two forms.
- Deterministic plus semantic final verification.
- Completed DOCX and fillable PDF for the prepared demo fixtures.
- Accessible, coherent upload-to-download experience.
- Golden tests, README, deployed demo, narrated video, and complete submission.

### Ship if stable

- Scanned-PDF answer packet.
- Multiple languages beyond Dutch and English.
- Editable review of compiler uncertainty before starting the interview.
- Local encrypted memory storage and export/import.

### Defer until after Build Week

- User accounts, teams, organizations, subscriptions, and billing.
- EHR, school system, email, Google Drive, or government portal integrations.
- Legal claims of medical compliance or production handling of real patient data.
- Pixel-perfect overlays for every non-fillable scanned PDF.
- Organization-specific form libraries and admin dashboards.
- Multi-agent, Programmatic Tool Calling, or Pro mode without evaluation evidence.
- Native mobile applications.

## Winning scorecard

| Dimension | Target |
| --- | --- |
| Form understanding | ≥95% field recall and 100% required-field recall on golden forms |
| Grounding | Every accepted field has document, conversation, memory, or correction provenance |
| Voice reliability | No per-field save step; five consecutive complete scripted demo runs |
| Memory safety | Zero silent memory writes; sensitive fixture answers excluded by default |
| Verification | 100% of seeded blocking issues detected |
| Rendering | 100% demo-field coverage in DOCX and fillable PDF outputs |
| Accessibility | No critical automated violations; essential flow works by voice and keyboard |
| Demo clarity | Complete story in less than three minutes |
| Submission safety | Submitted six hours before the official deadline |

## Immediate next action

Freeze and push the passing release-candidate commit, import `render.yaml`, verify the public demo signed out, then record the scripted product video before copying the final URLs into Devpost.

## Source references

- [OpenAI Build Week on Devpost](https://openai.devpost.com/)
- [Current GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Realtime function calling](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling)
- [OpenAI UI guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines#visual-design-guidelines)
