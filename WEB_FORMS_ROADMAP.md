# VocaForm Web Forms Roadmap

This roadmap extends VocaForm from uploaded documents to live web forms while preserving its existing trust model: provider-independent domain state remains authoritative, models cannot silently change answers, and no external submission happens without explicit user control.

The intended product journey is:

`Paste link -> Inspect -> Talk -> Review -> Prepare native form -> User submits`

Google Forms and Microsoft Forms are the first provider targets. Literal Google Docs remain document imports through the existing text/DOCX paths.

## Devpost submission positioning

The complete web-form workflow in Goals 1–6A is an additive **new feature** for the Devpost submission. It was completed after the original submission video and its supporting assets were frozen, and it extends the submitted product without reopening the recorded demo narrative.

Published submission treatment:

- keep the existing submission video, narration, captions, demo script, and previously reviewed core-flow assets unchanged;
- publish one clearly labelled [“New feature: live web-form interviews and consented native hand-off”](https://devpost.com/software/vocaform/updates/797250) update covering Goals 1–6A through Devpost's feature-update UI;
- describe the entire web-form workflow as an extension beyond the flow shown in the video, so judges are not led to believe the recording demonstrates link inspection, web-form interviews, or native provider preparation;
- link the written claim to the deployed experience, this roadmap, the repository implementation, the supported-control matrix, and the deterministic web-form evaluation evidence;
- state the supported boundary precisely: public responder links can enter the interview, while native preparation is limited to complete single-page Google or Microsoft forms with deterministic ordinary controls; all other cases retain the guided manual hand-off;
- state that sign-in-required forms keep authentication entirely on the provider page and use the reviewed manual hand-off;
- do not re-record or re-edit the submission video for this feature. Reopen video work only if an unrelated submission requirement makes the existing recording invalid.

This keeps the original submission story stable while giving the completed Goals 1–6A release one distinct, verifiable new-feature callout. Goal 6B remains a long-term option and is not part of the feature claim.

## Goal 1: Read-only provider inspection spike

Status: implemented and verified on July 17, 2026

Prove that public responder pages can be inspected safely and measurably before any production session integration.

Scope:

- recognize supported Google Forms and Microsoft Forms responder URLs;
- strip prefilled answer parameters before navigation;
- allow only provider-owned navigation and asset hosts;
- run Chromium in an isolated, non-persistent context;
- block every request except `GET`, `HEAD`, and `OPTIONS`;
- disable form submission and browser beacons in the page before provider scripts run;
- extract only structure: title, sections, question labels, requiredness, types, options, and locator candidates;
- never read entered values, fill controls, click navigation, authenticate, or submit;
- report field-count, type, provider-ID, and locator coverage metrics;
- validate the adapters against synthetic provider-shaped fixtures and optional public live smoke checks.

Acceptance criteria:

- both provider fixtures achieve 100% label, recognized-type, provider-ID, and usable-locator coverage;
- pagination is detected and reported as an explicit current-page limitation;
- unsafe, editing, credential-bearing, non-HTTPS, and unknown-provider URLs are rejected;
- Google prefill parameters and unrecognized Microsoft query parameters are removed;
- no production API route, session contract, or browser UI is changed;
- `npm run eval:webforms` passes without network access;
- `npm run check` continues to pass.

Non-goals:

- complete multi-page or branch traversal;
- Google or Microsoft OAuth;
- browser streaming;
- answer filling or response submission;
- undocumented Microsoft Forms APIs;
- model-driven computer use.

Verification evidence:

- `npm run eval:webforms` passes network-free Google and Microsoft provider-shaped fixtures;
- Google: 7/7 labels, recognized types, provider IDs, and usable locators;
- Microsoft: 9/9 labels, recognized types, provider IDs, and usable locators;
- read-only live smoke checks passed on one public responder page from each provider;
- the Google live sample extracted 3/3 provider IDs and recognized types;
- the Microsoft live sample extracted 3/3 provider IDs and recognized types and reported its next page without navigating to it;
- `npm run check` passes 19 Vitest files and 85 tests, plus the existing compiler, verifier, renderer, resilience, and legacy gates.

## Goal 2: Provider-independent web-form domain

Status: implemented and verified on July 17, 2026

Generalize the canonical contracts without weakening the document workflow.

Scope:

- introduce document and web-form source variants;
- add rating, scale, ranking, matrix, time, and file-upload field types;
- represent provider question IDs, page/section flow, branching edges, and source revisions;
- replace document-only render/export terminology with delivery targets and delivery plans;
- keep the current DOCX/PDF renderer behind a compatibility delivery adapter.

Exit criteria:

- all existing document fixtures retain identical behavior;
- provider imports can be expressed without browser or provider dependencies in `app/domain/`;
- unsupported web controls remain explicit blockers rather than silent omissions.

Verification evidence:

- document and web-form definitions are separate canonical variants while existing document objects retain their exact serialized shape;
- canonical web-form sources carry responder origins, URL and revision fingerprints, observation time, question count, and page count;
- canonical fields cover time, scale, rating, ranking, matrix, file upload, and explicitly unsupported controls;
- provider field IDs, stable locator candidates, page membership, complete/current-page coverage, and conditional/next/submit/unknown edges are represented without browser objects;
- field-level delivery targets and document/web delivery plans replace render/export terminology at the canonical boundary;
- the existing DOCX/PDF renderer remains unchanged behind `document_delivery_adapter.ts`;
- `npm run eval:webform-domain` reports 100% delivery-target coverage for six supported controls and 100% blocker coverage for two unsupported controls;
- all three existing document fixtures pass exact structural parity checks;
- `npm run check` passes 21 Vitest files and 93 tests, all existing compiler/verifier/renderer/resilience/legacy gates, and the new web-form-domain gate;
- `npm run build` produces the production client successfully after the delivery-plan API migration.

## Goal 3: Public web-form interview MVP

Status: implemented and verified on July 17, 2026

Turn public Google Forms and Microsoft Forms links into VocaForm interview sessions.

Scope:

- inspect public, anonymous responder pages through deterministic provider adapters;
- compile the inspection into the canonical web-form schema;
- support ordinary text, choice, date, rating/scale, and forward-only branching cases;
- reuse the existing voice, text, memory-consent, and verification paths;
- provide guided/manual fallback when adapter coverage is incomplete.

Exit criteria:

- synthetic provider forms meet the same field-recall and no-fabrication bar as document fixtures;
- authenticated forms, file uploads, quizzes, CAPTCHA, and unsupported branching are visibly out of scope;
- no response is submitted.

Verification evidence:

- the production choose-form screen accepts public Google Forms and Microsoft Forms responder links without requiring an OpenAI API key;
- the server applies the existing read-only browser policy, compiles the inspection into a canonical `WebFormDefinition`, creates the normal versioned session, and retains only a sanitized hand-off URL outside canonical state;
- ordinary text, choice, date, rating, and scale controls use the existing text and Realtime interview tools, Memory Vault consent, deterministic verification, and non-mutating semantic verification paths;
- the domain session engine follows deterministic forward-only conditional edges and excludes unselected pages from the interview and completion count;
- current-page-only inspection, missing stable locators, ranking, matrix, file upload, unknown controls, and backward or unresolved complete flows remain explicit blockers with a guided manual hand-off;
- authenticated responder redirects, quizzes, and CAPTCHA-protected pages return explicit out-of-scope errors;
- the hand-off screen exposes the reviewed canonical answer list beside a user-opened original form and states that VocaForm has not filled, transmitted, or submitted provider answers;
- `npm run eval:webform-interview` reports 100% recall for 8/8 ordinary controls across synthetic Google and Microsoft fixtures with zero fabricated fields and zero deterministic blockers;
- `npm run eval:webforms` retains 100% label, type, provider-ID, and usable-locator coverage across the 16 provider-shaped inspection controls;
- `npm run check` passes 23 Vitest files and 100 tests, including the new compilation, branching, delivery, and inspection-rate-limit cases;
- `npm run build` succeeds and the 18-test Playwright accessibility/visual/web-form suite passes with reviewed desktop and mobile landing snapshots.

## Goal 4: Visible fill, verification, and hand-off

Status: implemented and verified on July 17, 2026

Prepare the native provider form in an isolated browser while keeping the user in control.

Scope:

- add a browser-session boundary with a remote Playwright implementation;
- stream or otherwise expose an accessible, interactive review surface;
- obtain specific consent before transmitting answers into provider controls;
- fill through deterministic provider locators;
- compare every populated control against the exact canonical session version;
- stop at `awaiting_user_submit` and let the user perform the final Submit action.

Exit criteria:

- zero unintended submissions across deterministic and resilience evaluations;
- every placed answer has a verified provider control and current-session fingerprint;
- interruption and expiry result in an explicit recoverable state.

Verification evidence:

- complete single-page public forms with ordinary deterministic controls use a remote Playwright browser-session boundary; incomplete, multi-page, ranking, matrix, file-upload, unknown, and unstable-locator cases retain the guided manual hand-off;
- each preparation uses a new non-persistent context with downloads and service workers disabled, provider-host request allowlisting, submission DOM guards, and all write methods blocked until the user-authorized Submit action;
- the hand-off screen requires a fresh, specific transmission-consent checkbox before preparation and never treats inspection, interview, memory consent, or review as provider-transmission consent;
- deterministic Google and Microsoft locator strategies place text, choice, multi-choice, date, time, number, scale, rating, and boolean answers, then re-read each control and store its answer and control fingerprints;
- the prepared copy is bound to the exact canonical session ID, version, answer fingerprint, URL fingerprint, and inspected source-revision fingerprint; answer changes invalidate and tear down the copy;
- the accessible review surface pairs the current provider screenshot with a text list of every verified control, its provider ID, value, expiry, and shortened fingerprints;
- the boundary stops at `awaiting_user_submit`; only the explicit provider-labelled Submit button opens the write gate for one click, after which the context closes and cannot replay the action; an indeterminate post-click provider result becomes a non-replayable `submission_uncertain` state to prevent duplicates;
- interruption, stale answers, provider drift, verification failure, and 15-minute expiry become visible `recoverable` states that require a fresh consented preparation;
- `npm run eval:webform-delivery` reports 30/30 verified placements, 100/100 blocked pre-submit writes, zero unintended submissions, current-session fingerprint invalidation, and explicit expiry recovery;
- `npm run check` passes 25 Vitest files and 108 tests plus every compiler, verifier, renderer, resilience, web-form, and legacy gate;
- `npm run build` succeeds, the full 20-test desktop/mobile Playwright suite passes, and the Goal 4 journey verifies disabled-before-consent preparation, the accessible native-control review, exact consent/session request binding, and the final user-only Submit action.

## Goal 5: Authenticated and private forms

Status: implemented and verified on July 17, 2026

Support sign-in-required forms without asking users to reconstruct provider identity inside VocaForm.

Decision and implementation:

- open authentication on the provider's own page in the user's browser;
- never render VocaForm inputs for provider usernames, passwords, MFA codes, or passkeys;
- inspect only question structure visible before authentication;
- keep the external browser session separate instead of reading or transferring cookies, local storage, profiles, or password-manager state;
- force a reviewed manual answer-list hand-off because the external authenticated session cannot be safely reused for Goal 4 native filling.

Scope:

- signed-out structural inspection when the provider exposes questions before authentication;
- a sanitized **Open provider sign-in** link after inspection;
- ordinary interview, Memory Vault consent, and verification on canonical answers;
- a final **Open signed-in form** link beside the reviewed manual answer list;
- explicit documentation for forms whose questions remain hidden until authentication.

Exit criteria:

- credentials, MFA values, cookies, and reusable browser state never enter VocaForm at all;
- externally signed-in forms cannot select native provider preparation;
- private-form limitations have a documented threat model and fail-closed behavior.

Verification evidence:

- the access contract distinguishes `external` from `public` and the server forces `guided_manual` delivery for external sessions;
- the production server exposes no credential-action or authentication-screenshot routes;
- the client has no provider password, username, or one-time-code controls;
- the Goal 5 Playwright journey verifies the external link, zero provider requests before a user opens it, no password field, accessible signed-in guidance, and the final manual answer-list hand-off;
- delivery adapter tests verify that even a complete single-page deterministic form cannot enter native preparation when its authenticated session is external;
- the residual-risk boundary is documented in `WEB_FORM_AUTHENTICATION_THREAT_MODEL.md`.

## Long-term goal: authenticated native filling through a companion extension

Status: planned; no target release

Remove the manual answer transfer for sign-in-required forms without moving provider identity into VocaForm. One allowlisted browser extension should support both Google Forms and Microsoft Forms in the user's normal authenticated browser session.

Intended journey:

`Inspect -> VocaForm interview -> Review -> Sign in on provider -> Fill with VocaForm -> User submits`

Scope:

- keep Google or Microsoft sign-in entirely on the provider page and never run on identity, password, MFA, CAPTCHA, or account-recovery screens;
- activate only after an explicit **Fill with VocaForm** action in the current responder tab, using the narrowest temporary page permission available;
- transfer only the reviewed answer packet bound to the exact canonical session version, answer fingerprint, responder URL fingerprint, and inspected source revision;
- use the existing deterministic Google Forms and Microsoft Forms locator strategies to populate, re-read, and visibly highlight changed controls;
- preserve the existing accessible provider-control review and require the user to perform the provider's final Submit action;
- retain the reviewed manual answer-list hand-off whenever the extension is absent, the form revision changed, a locator is unstable, or a control is unsupported;
- evaluate official provider prefilled-link features as an optional zero-install optimization, not as the authenticated filling foundation.

Microsoft Forms path:

- anonymous **Anyone can respond** forms continue to use Goal 4 native preparation without an extension;
- organization- or person-restricted forms use Goal 5's external sign-in and manual answer list today;
- the companion extension will fill supported controls directly in the signed-in `forms.office.com` or `forms.cloud.microsoft` responder tab;
- Microsoft OAuth and the Microsoft Forms connector are not treated as a submission solution because the exposed connector actions retrieve form and response details but do not create a respondent response;
- tenant policy, conditional access, guest access, and Microsoft Entra authentication remain entirely inside the user's provider tab.

Exit criteria:

- the ordinary VocaForm interview, Memory Vault consent, deterministic verification, and final review remain unchanged for authenticated forms;
- the extension cannot access provider credentials, broad browsing history, unrelated tabs, or provider submission controls outside a user-authorized responder tab;
- zero unintended submissions across deterministic Google and Microsoft extension evaluations;
- every populated value is re-read from the provider control and bound to the current VocaForm answer fingerprint;
- extension absence, permission denial, provider drift, and unsupported controls fail safely to the existing manual hand-off.

## Goal 6: Production hardening and evidence-gated computer use

Status: production hardening implemented and verified on July 17, 2026; computer use remains experimental

Goal 6 is intentionally split. Production hardening is required before broader use. Agentic computer use is not assumed to be necessary and must earn its place through evidence collected after public-form pilots and the companion extension.

### Goal 6A: Production hardening

Status: implemented and verified on July 17, 2026

Scope:

- run live Google Forms and Microsoft Forms contract checks separately from deterministic pull-request checks;
- detect provider markup, control, navigation, and submission-flow drift before attempting native preparation;
- retain explicit recovery for stale answers, changed form revisions, expired sessions, interrupted preparation, and indeterminate submission results;
- add privacy-safe operational telemetry for inspection coverage, unsupported controls, fallback reasons, preparation verification, latency, and failures;
- redact answer values, screenshots, responder identifiers, URLs, and tenant information from logs and diagnostics by default;
- harden provider rate limits, browser resource limits, timeouts, cleanup, abuse controls, and public-demo isolation;
- exercise accessibility, mobile layout, low-vision reflow, and keyboard-only recovery against each supported provider path;
- publish a supported-control matrix and fail safely to the reviewed manual answer list whenever confidence is insufficient.

Exit criteria:

- provider drift produces a safe fallback instead of silent misplacement;
- no sensitive answer or identity data appears in operational logs or retained diagnostics;
- every prepared answer remains bound to the current canonical session version and is re-read from its provider control;
- interruption, expiry, provider throttling, and partial failure have tested recovery paths;
- live checks can be disabled or isolated without weakening deterministic pull-request gates.

Verification evidence:

- provider inspections now carry explicit markup, question, Next, and Submit boundary signals; preparation re-runs the contract check and exact source-revision comparison before any answer is transmitted;
- insufficient locator confidence, provider drift, throttling, verification failure, and browser resource exhaustion persist a privacy-safe reason and switch delivery to the reviewed manual answer list instead of leaving native preparation selectable;
- every placed control is re-read after filling and again immediately before the user-authorized Submit click; a changed value prevents the click, while missing provider confirmation becomes a non-replayable `submission_uncertain` result;
- operational telemetry uses a strict aggregate-only schema for provider, coverage percentages, unsupported counts, fallback categories, verified placement counts, latency, and bounded failure codes; extra URL, answer, screenshot, identifier, or free-form diagnostic properties are rejected;
- operational diagnostic redaction removes URLs, email-like responder values, UUIDs, fingerprints, Google entry IDs, Microsoft question IDs, and tenant-like identifiers before unexpected web-form errors reach server logs;
- isolated browser contexts have bounded concurrency, request counts, navigation/action timeouts, a maximum 15-minute lifetime, no permissions, no downloads or service workers, blocked font/media resources, dismissed dialogs, closed popups, and cleanup on visitor discard or server shutdown;
- public-demo limits independently bound inspection, native preparation, and Submit attempts per visitor and address, while visitor state, browser sessions, and Memory Vault data remain isolated;
- `WEB_FORM_SUPPORTED_CONTROLS.md` publishes the shared code-backed Google/Microsoft matrix, `0.85` native-confidence threshold, manual fallback rules, and disposable live-check operation;
- `check:webforms:live`, `check:webform:live:google`, and `check:webform:live:microsoft` are separate from `npm run check`, accept no live URLs unless explicitly configured, and can be disabled with `VOCAFORM_WEBFORM_LIVE_CHECKS=false`;
- Goal 6A tests cover markup/Submit drift, low-confidence locators, pre-Submit control changes, expiry, interruption, provider throttling, browser resource limits, and indeterminate submission without unintended replay;
- the Google and Microsoft fallback journeys pass Axe WCAG A/AA checks, keyboard-only recovery, forced-colors rendering, and 320 CSS-pixel reflow on both desktop and mobile Playwright projects; the full 26-test Playwright suite passes;
- `npm run check` passes 27 Vitest files and 122 tests plus every deterministic compiler, verifier, renderer, resilience, web-form, and legacy gate; `npm run build` succeeds.

### Goal 6B: Experimental computer-use fallback

Priority: deferred until evidence shows a material unresolved user need

Decision sequence:

1. Pilot the existing deterministic Google Forms and Microsoft Forms support.
2. Deliver and pilot the companion extension for authenticated responder tabs.
3. Measure unsupported layouts, controls, branching patterns, and provider changes that still force manual transfer.
4. Consider computer use only when those unresolved cases are frequent and valuable enough to justify its additional risk, latency, cost, and maintenance burden.

Entry criteria:

- production-hardening safeguards and privacy-safe fallback metrics are already operating;
- the unsupported cases cannot be handled reliably by extending deterministic adapters or provider-prefilled links;
- users experience meaningful repeated friction rather than isolated edge cases;
- a bounded experiment can be evaluated without exposing real credentials or retaining sensitive screenshots.

Experimental scope, if the entry criteria are met:

- keep computer use behind the same browser-session and action-policy boundaries;
- treat all page content as untrusted input and explicitly test prompt-injection resistance;
- restrict actions to the canonical answer map, allowlisted responder origins, and the current reviewed session version;
- require a user gesture before sensitive-data transmission and keep final provider submission exclusively user-controlled;
- redact screenshots and prohibit interaction with identity, password, MFA, CAPTCHA, account-recovery, and payment surfaces;
- measure placement accuracy, unsupported-case recovery, latency, cost, provider drift, and unintended actions against deterministic baselines.

Exit criteria for any production consideration:

- deterministic adapters and the companion extension remain the default path;
- computer use cannot invent answers, expand provider scope, read credentials, or submit independently;
- the experiment demonstrates a clear coverage benefit that outweighs measured risk, latency, cost, and maintenance;
- any uncertainty or policy violation immediately returns to the reviewed manual hand-off.

## Goal sequencing

Goals are intentionally sequential. Goal 1 produces evidence, Goal 2 creates the durable contracts, Goals 3 and 4 deliver the first public experience, and Goal 5 adds identity without credential proxying. The long-term companion extension removes manual transfer for authenticated Google and Microsoft forms while preserving that identity boundary. Goal 6A hardens those deterministic paths for broader use. Goal 6B considers computer use only after pilots and fallback metrics demonstrate a material gap that deterministic adapters, provider-prefilled links, and the companion extension cannot safely close.
