# VocaForm Goal 8 Resilience Report

**Recorded:** July 15, 2026<br>
**Scope:** deterministic release evidence for the Build Week north-star journey<br>
**Release command:** `npm run check:resilience`

## Result

Goal 8 is complete. The submission-grade gate passes type checking, linting, unit and adapter tests, all deterministic evaluations, five consecutive isolated north-star passes, legacy compatibility checks, the production build, and the desktop/mobile Playwright accessibility and visual suite.

The five-pass resilience evaluation produced:

| Evidence | Result |
| --- | --- |
| Type checking and linting | Passed |
| Vitest | 72/72 passed across 18 files |
| Production build | Passed |
| Desktop/mobile Playwright | 16/16 passed |
| Consecutive north-star passes | 5/5 |
| Blocking failures | 0 |
| Golden compiler baseline | 53/53 fields, 25/25 required, no fabrication or missing dependencies |
| Realtime duplicate-call suppression | 5/5 |
| Reconnect recovery from server state | 5/5 |
| Deterministic medical blockers after interview | 0 in every pass |
| Clear semantic fixture accepted by the final gate | 5/5 |
| Native medical PDF render coverage | 100% in every pass |
| Original medical source preserved | 5/5 |
| Explicitly approved safe memory claims | Exactly 3 in every pass |
| Sensitive claims stored | 0 |
| Claims individually confirmed on school form | 3/3 in every pass |

Each pass starts with new form sessions and an empty Memory Vault. It drives the medical intake through the same version-aware application tools used by Realtime, replays a completed write to prove idempotency, reconstructs interview context with a new executor to prove reconnect recovery, exercises deterministic and semantic-result gating, fills a copied AcroForm PDF, and then proves consent and memory reuse across the permission and school fixtures.

Public-demo isolation tests additionally prove that separate browser IDs receive different form, source, verification, tool-cache, and Memory Vault containers; public state starts empty even when a private local vault exists; inactive states expire; and the registry remains bounded. Request-budget tests cover per-visitor compilation limits, per-address cookie-churn limits, and window recovery.

Renderer regression coverage now also checks document-language metadata, viewer title preference, and human-readable alternate names on every filled PDF field. The separate `EXPORT_ACCESSIBILITY_REVIEW.md` records the DOCX structural audits, full-page visual inspection, and the explicit decision not to claim tagged-PDF remediation.

The semantic result in this deterministic gate is an explicit clear synthetic fixture. It verifies application gating and non-mutating orchestration without spending API credits; it does not claim to replace the separate live Sol compiler/verifier runs documented in the README.

## Privacy-safe diagnostic contract

Runtime events are written locally to the ignored `work/resilience/traces.ndjson` file with mode `0600` and a 5 MB cap. The strict schema accepts only:

- event category: compiler, final verifier, Realtime connection, first voice response, interview tool, or document export;
- success/error outcome and monotonic duration;
- compiler/verifier input and output token counts;
- a known tool name and whether its result came from the idempotency cache;
- render kind, coverage percentage, and fallback count.

The schema has no property for filenames, document text, form/session/field/claim IDs, answers, raw wording, transcripts, prompts, response IDs, model findings, or error messages. Unknown properties cause the entire event to be rejected. Trace-write failure never blocks the user's form operation.

## Network and recovery audit

| Operation | Visible pending state | Recovery behavior |
| --- | --- | --- |
| Initial health, fixture, memory, session, and compilation load | “Preparing VocaForm…” status | Alert with **Reload VocaForm** |
| Reviewed fixture open | “Opening and checking the reviewed form…” | **Try opening the form again** |
| Upload and Sol compilation | “Reading your form and checking every question…” | **Try reading the form again** |
| Start compiled interview | “Preparing the first question…” | **Try starting the conversation again** |
| Text answer and skip | Saving/marking status announced live | Action-specific retry |
| Voice connection | Requesting microphone → Connecting → Ready | Three bounded reconnect attempts, then explicit retry or equal text path |
| Voice model turn | Listening → Thinking → Speaking | Visible voice guidance and alert on failure |
| Realtime tool write | “Saving your answer” | Same call ID retried once client-side and deduplicated server-side |
| Memory remember/apply/correct/forget | Action-specific pending status | Action-specific retry; no silent write |
| Final verification | “Checking your saved answers without changing them…” | **Try the final check again**; current form remains unchanged |
| Draft and verified export | Action-specific preparation status | Action-specific retry and draft fallback where permitted |
| Close session/document | Explicit clearing status | **Try closing this form again** |

All application actions that issue network requests use the shared busy/status/error/retry path. Realtime owns its own explicit state machine because microphone, WebRTC, model response, tool execution, reconnect, and completion require distinct user-facing states. The Playwright suite verifies loading completion, actionable errors, focus recovery, keyboard operation, and the equal text path.

## Reproduction

```bash
npm install
npx playwright install chromium
npm run check:resilience
```

For only the fast five-pass deterministic resilience evaluation:

```bash
npm run eval:resilience
```

The repository contains reviewed synthetic sample data; no private profile or API key is needed for this gate.
