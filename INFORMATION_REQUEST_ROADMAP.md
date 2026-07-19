# VocaForm Information Request Lifecycle Roadmap

This roadmap extends VocaForm from helping one person complete an existing form to supporting the full information-request lifecycle. A requester explains what information is needed through a real-time AI-guided interview, reviews the resulting request, sends it to recipients, and receives structured responses. Each recipient can answer through an accessible form, a voice or text interview, or a combination of both, in their own time.

The intended product journey is:

`Explain need -> Design request -> Review -> Publish -> Invite -> Answer by form or interview -> Review and submit -> Receive structured response`

The key product decision is that a form is not the canonical object. VocaForm owns a versioned **information request** containing its purpose, requested data, rules, audience, handling terms, and response state. Forms and interviews are different views over that same request.

## Vision and success condition

VocaForm should make requesting information as understandable and humane as providing it. AI may help both parties express themselves, clarify questions, and identify gaps, but deterministic application code remains authoritative for scope, requiredness, consent, answers, access, publication, and submission.

The first coherent requester-to-recipient release is complete when:

1. a requester can describe a legitimate information need by voice or text;
2. VocaForm creates a structured draft in which every question is tied to a stated purpose;
3. the requester can preview, test, revise, and explicitly publish an immutable version;
4. the requester can send a revocable, expiring invitation to a recipient;
5. the recipient can answer by form, interview, or both, save progress, and return later;
6. the recipient can see who is asking, why each item is requested, and what will happen to the response;
7. the recipient explicitly submits the reviewed response;
8. the requester receives a structured, attributable response without seeing drafts, skipped optional data, or anything outside the published request; and
9. both parties can export or delete their data according to a clear retention policy.

## Product principles

- **Purpose before questions:** a requester must explain the outcome they need before asking for data.
- **Ask for the minimum:** every requested field must map to a purpose; VocaForm should challenge unnecessary, duplicate, or disproportionately sensitive questions.
- **One request, multiple interfaces:** form and interview modes operate on the same versioned definition and response state.
- **People publish and submit:** AI can draft and recommend, but cannot publish a request, invite recipients, broaden scope, or submit a response.
- **Recipient agency:** recipients can inspect the full request, switch input modes, pause, resume, correct answers, and decline optional questions.
- **No hidden inference:** the requester receives only information the recipient reviewed and submitted, not model guesses, conversation fragments, or unrequested profile data.
- **Accessible by default:** authoring and responding must work with voice, text, keyboard, screen readers, high zoom, high contrast, and reduced motion.
- **Traceable change:** request versions, invitations, answers, consent, follow-ups, and exports have explicit provenance and audit history.
- **Safe failure:** expired access, changed request versions, ambiguous answers, delivery failures, and provider outages become visible recoverable states.

## Target domain model

The current `FormDefinition` and `FormSession` remain useful respondent-side primitives. The new lifecycle should add a provider-independent aggregate above them rather than turning form sessions into requester or organization records.

| Contract | Responsibility |
| --- | --- |
| `InformationRequestDefinition` | Versioned purpose, requester identity, audience, questions, dependencies, response modes, handling terms, and publication state |
| `RequestedDatum` | One requested value with wording, rationale, requiredness, sensitivity, validation, provenance requirements, and memory eligibility |
| `RequestVersion` | Immutable published snapshot with a content fingerprint and migration/supersession state |
| `Invitation` | Recipient-scoped access, delivery state, expiry, revocation, reminders, and request-version binding |
| `ResponseSession` | Recipient-owned draft answers, selected interaction mode, progress, provenance, and current request version |
| `SubmittedResponse` | Immutable recipient-reviewed answer set, omissions, consent receipt, submission time, and request-version fingerprint |
| `ClarificationThread` | Bounded post-submission question tied to an existing requested datum without silently expanding scope |
| `RetentionPolicy` | Declared storage duration, deletion behavior, export rights, and requester/recipient responsibilities |

Models may propose changes to these objects only through versioned, validated application tools. Published requests and submitted responses are immutable; corrections create attributable revisions.

## Goal 0 — Validate the problem and define the trust boundary

**Outcome:** the requester workflow solves observed information-exchange problems without merely creating another form builder.

**Status:** Planned

### Work

- Interview a small, diverse set of requesters and recipients, including people who use assistive technology or have low digital confidence.
- Map real request journeys: why information is needed, how questions are chosen, how invitations are sent, what causes abandonment, and how responses are used.
- Identify the first low-risk use case and explicitly exclude regulated or high-consequence decisions from the initial pilot.
- Test the language used for purpose, requiredness, sensitive data, retention, consent, and requester identity.
- Establish which responsibilities belong to the requester, recipient, VocaForm, and any delivery provider.
- Define baseline measures for completion, missing data, clarification effort, accessibility, trust, and perceived burden.

### Exit criteria

- At least three requester and five recipient sessions have been observed or interviewed.
- One narrow pilot use case has repeated demand on both sides and a documented current-state journey.
- The first release has an approved threat model, data-flow diagram, non-goals, and measurable baseline.
- No implementation assumption requires VocaForm to infer legal basis, make eligibility decisions, or determine whether a person should receive a service.

## Goal 1 — Establish the canonical information-request contracts

**Outcome:** purpose, questions, rules, privacy terms, versions, invitations, and responses can be represented without UI, model, mail, or form-provider dependencies.

**Status:** Planned; depends on Goal 0

### Work

- Add Zod contracts for the target domain model and explicit draft, published, closed, superseded, and revoked states.
- Require every `RequestedDatum` to include a purpose reference and explicit required/optional status.
- Represent sensitivity, data subject, response provenance, validation, dependencies, attachments, reuse eligibility, and allowed answer modes.
- Separate requester-owned request state from recipient-owned response drafts.
- Bind invitations and responses to immutable request-version fingerprints.
- Define deterministic transitions for draft editing, publication, invitation, save/resume, submission, correction, closure, expiry, and deletion.
- Add adapters that project one request into the existing form and interview contracts without duplicating answers.

### Exit criteria

- Domain packages contain no React, HTTP, provider, email, or OpenAI dependencies.
- Invalid state transitions, stale version writes, duplicate identifiers, and questions without purposes are rejected.
- A fixture request produces equivalent form and interview projections and converges on one response state.
- Published versions and submitted responses cannot be mutated in place.
- Existing document and web-form behavior retains exact regression parity.

## Goal 2 — Conduct the requester authoring interview

**Outcome:** a requester can explain the information need naturally and receive a grounded, editable request draft.

**Status:** Planned; depends on Goal 1

### Work

- Build an accessible voice and text authoring journey that asks first about purpose, audience, intended use, deadline, and response handling.
- Give Realtime narrowly scoped tools to add, revise, reorder, and remove draft questions through the domain layer.
- Let the requester describe desired outcomes in ordinary language while VocaForm proposes field types, wording, validation, dependencies, and help text.
- Ask targeted follow-ups when purpose, requiredness, audience, sensitivity, or expected answer shape is unclear.
- Detect duplicate, leading, compound, inaccessible, or unnecessarily sensitive questions and explain suggested changes.
- Preserve the requester’s exact rationale and distinguish it from model-generated wording.
- Save after validated tool calls and support interruption, reconnect, undo, and text fallback.

### Exit criteria

- A requester can produce the complete pilot fixture without editing JSON or using a conventional form-builder palette.
- Every accepted question has requester-grounded purpose provenance.
- The model cannot publish, invite, mark its own suggestion as requester-approved, or introduce a question outside validated tools.
- Interruptions and retries cause no duplicate or lost questions.
- The same draft can be continued through voice or text with equivalent results.

## Goal 3 — Review, test, and publish a trustworthy request

**Outcome:** the requester sees exactly what recipients will experience and deliberately publishes a safe, complete version.

**Status:** Planned; depends on Goal 2

### Work

- Provide plain-language request, data-use, and sensitivity summaries before publication.
- Add deterministic checks for missing purposes, unreachable branches, invalid validation, inaccessible labels, excessive requiredness, retention conflicts, and unsupported controls.
- Add a non-mutating semantic review for ambiguity, duplication, bias, scope mismatch, and disproportionate data collection.
- Generate both form and interview previews from the same draft and provide a synthetic test-response mode.
- Require the requester to confirm identity, contact route, purpose, recipient-facing handling terms, deadline, and retention before publishing.
- Publish an immutable version; later edits create a new draft and require an explicit recipient-impact decision.

### Exit criteria

- Every blocker can be resolved without editing serialized contracts.
- Form and interview previews request the same data and follow the same dependencies.
- Automated accessibility checks find no serious or critical WCAG A/AA violations in authoring or preview.
- Publishing requires a fresh human action and records the exact version fingerprint.
- A changed published request never silently alters an active recipient response.

## Goal 4 — Deliver secure invitations and recipient access

**Outcome:** a requester can send the published request to intended recipients without exposing response data or creating ambiguous access.

**Status:** Planned; depends on Goal 3

### Work

- Start with copyable single-recipient invitation links, then add a provider-independent notification adapter for email or messaging delivery.
- Use high-entropy, recipient-scoped, expiring capability tokens; store token hashes and never put personal data in URLs.
- Support resend, delivery status, expiry, revocation, and bounded reminders without changing the request version.
- Show verified requester identity, organization when applicable, purpose, deadline, approximate effort, and support contact before a recipient starts.
- Add abuse prevention, delivery rate limits, generic invalid-link responses, and privacy-safe operational events.
- Require stronger recipient authentication only when the pilot’s risk model calls for it; never use security questions based on requested data.

### Exit criteria

- Invitations cannot be enumerated, replayed after revocation/expiry, or moved to a different request version.
- Draft responses are not visible to requesters and two recipients cannot access each other’s sessions.
- Delivery logs exclude answers, invitation secrets, request text, and recipient identifiers by default.
- Failed and expired invitations have accessible recovery paths.
- No reminder is sent after submission, revocation, closure, or opt-out.

## Goal 5 — Let recipients respond by form or interview, in their own time

**Outcome:** recipients can choose the least burdensome interaction, switch modes, pause, and resume without losing trust or progress.

**Status:** Planned; depends on Goal 4

### Work

- Project the published request into one shared response session used by both accessible form controls and the Realtime/text interview.
- Explain who is requesting the data, why each item is needed, whether it is required, and how the response will be retained.
- Support save/resume across devices when identity assurance permits it, with clear local versus server retention messaging.
- Let recipients ask for clarification, request examples, skip optional questions, mark unknown, and review answer provenance.
- Keep Memory Vault reuse recipient-controlled and scoped to the individual request; never reveal available memory to the requester.
- Make attachments, sensitive items, and third-party-subject data explicit and separately consented where required.
- Preserve the current interruption, idempotency, validation, language, and accessibility safeguards.

### Exit criteria

- A partially completed answer can switch between form, voice, and text without divergence or duplication.
- Requesters cannot observe draft values, conversation transcripts, unsubmitted progress details, or Memory Vault contents.
- The recipient can complete the pilot journey using keyboard and screen reader, text only, or voice plus keyboard.
- Returning through a valid invitation resumes the correct version and first unresolved applicable item.
- Expired sessions, request supersession, disconnects, and attachment failures are recoverable without silently discarding answers.

## Goal 6 — Review, submit, receive, and export structured responses

**Outcome:** recipients control final disclosure and requesters receive usable, attributable data rather than transcripts.

**Status:** Planned; depends on Goal 5

### Work

- Run deterministic response checks and an optional, non-mutating semantic review before submission.
- Present a complete recipient review containing submitted values, intentional omissions, memory-derived values, attachments, requester identity, purpose, and retention terms.
- Require an explicit recipient submission action bound to the exact request and response fingerprints.
- Create an immutable `SubmittedResponse` and a recipient receipt; exclude the interview transcript and abandoned draft values.
- Build a requester inbox with status, structured response review, individual export, and accessible aggregate summaries.
- Export open, documented formats such as JSON and CSV before adding system-specific integrations.
- Support recipient-initiated corrections as new revisions, never silent edits to the original submission.

### Exit criteria

- Zero submissions occur through model initiative, invitation opening, autosave, or requester action.
- The requester receives only reviewed, submitted data within the published request scope.
- Each value is attributable to recipient entry, confirmed memory, attachment extraction confirmed by the recipient, or an explicit correction.
- Export round-trips all submitted pilot fields and omissions without semantic loss.
- Duplicate clicks and uncertain delivery outcomes cannot create duplicate logical responses.

## Goal 7 — Support bounded clarification without scope creep

**Outcome:** requesters can resolve genuine ambiguity while recipients remain protected from an endless or expanding interview.

**Status:** Planned; depends on Goal 6

### Work

- Allow a requester to ask a clarification only against an existing submitted datum and state why clarification is needed.
- Show the recipient the original question, submitted answer, clarification, requester identity, and response deadline together.
- Treat new data categories or changed purposes as a new request version requiring new consent, not a clarification.
- Give recipients options to answer, correct the original response, decline, or report an inappropriate request.
- Keep all messages structured, attributable, rate-limited, and separate from AI-generated suggestions.

### Exit criteria

- Clarifications cannot introduce an unrequested field, new purpose, new recipient, or hidden requiredness.
- AI cannot send a message on behalf of either party.
- The full exchange and any correction are included in both parties’ audit views and exports.
- Closure, revocation, abuse reports, and retention expiry stop further clarification.

## Goal 8 — Add production identity, governance, and operations

**Outcome:** the lifecycle is safe enough for a bounded real-world pilot and operable without weakening privacy or accessibility.

**Status:** Planned; cross-cutting implementation begins with Goal 1 and gates the pilot

### Work

- Add requester accounts and verified organizations, recipient access appropriate to the pilot risk, and least-privilege roles.
- Encrypt data in transit and at rest, isolate tenants, rotate secrets, and separate application data from operational telemetry.
- Implement retention, deletion, export, account recovery, organization offboarding, and incident-response workflows.
- Add consent and audit receipts without logging answers, transcripts, attachments, invitation tokens, or free-form request content operationally.
- Threat-model prompt injection, malicious requesters, invitation forwarding, enumeration, cross-tenant access, bulk abuse, unsafe attachments, and denial of service.
- Run accessibility, security, recovery, backup/restore, concurrency, and deletion-verification tests.
- Document responsibilities and obtain legal/privacy review appropriate to the launch geography and use case before processing real personal data.

### Exit criteria

- Cross-tenant, revoked-user, stale-session, and privilege-escalation tests fail closed.
- Deletion and retention expiry remove or irreversibly anonymize all covered primary data and backups on a documented schedule.
- A restore exercise preserves tenant isolation, request versions, submissions, and audit integrity.
- Operational dashboards diagnose availability and aggregate workflow failures without exposing request or response content.
- The pilot has a reviewed privacy notice, terms, data-processing map, incident runbook, support route, and rollback plan.

## Goal 9 — Prove value through a bounded pilot

**Outcome:** evidence shows whether VocaForm improves information quality and ease of use for both sides.

**Status:** Planned; depends on Goals 0–8

### Work

- Run the first pilot with synthetic data, then a narrowly approved real workflow only after Goal 8 gates pass.
- Compare against the existing process on completion rate, time, missing/invalid answers, follow-up burden, abandonment, and accessibility.
- Measure authoring time, questions removed through data minimization, form-versus-interview choice, mode switching, save/resume, and support incidents.
- Collect separate requester and recipient feedback on clarity, control, trust, usefulness, and perceived effort.
- Review failures and qualitative evidence before expanding data sensitivity, organization count, delivery channels, or integrations.

### Exit criteria

- The pilot meets predeclared thresholds for completion quality and has no unresolved critical privacy, security, or accessibility issue.
- At least one full request is authored, published, delivered, completed, submitted, received, exported, and deleted through the supported lifecycle.
- The evidence supports a documented continue, revise, or stop decision for each proposed expansion.
- Product claims distinguish observed pilot results from architectural or future capability.

## Goal 10 — Move from forms toward an interoperable request protocol

**Outcome:** repeated information exchange needs fewer bespoke forms while preserving purpose, consent, and recipient control.

**Status:** Long term; begins only after Goal 9 demonstrates value

### Work

- Add reusable request templates with explicit ownership, versioning, provenance, and accessibility review.
- Let recipients satisfy eligible items from confirmed personal data while reviewing exactly what will be disclosed each time.
- Detect repeated requests for the same fact and allow purpose-specific reuse without exposing the wider Memory Vault.
- Publish a provider-independent request/response schema and scoped API for trusted integrations.
- Explore signed claims or verifiable credentials for facts that should be proven rather than repeatedly re-entered.
- Support organization-system delivery only through explicit field mappings, least-privilege authorization, and end-to-end auditability.

### Exit criteria

- A recipient can satisfy a second compatible request with materially less effort while explicitly approving every disclosed value.
- A requester learns nothing about stored data that the recipient did not choose to submit.
- Integrations cannot broaden purpose, add fields, bypass recipient review, or turn VocaForm into a background data broker.
- Forms remain available as an accessible interface, but no longer define the underlying information exchange.

## Sequencing and release gates

| Phase | Goals | Deliverable | Gate before continuing |
| --- | --- | --- | --- |
| Discovery | 0 | Validated pilot problem and trust boundary | Repeated need on both sides and a low-risk first use case |
| Domain foundation | 1 | Provider-independent request, invitation, and response contracts | Exact parity with existing respondent workflows |
| Request authoring | 2–3 | AI-guided creation, preview, validation, and versioned publication | Requester-controlled publishing and purpose coverage |
| Information exchange | 4–6 | Secure invite, asynchronous multimodal response, submission, and export | Recipient-controlled disclosure with end-to-end isolation |
| Follow-up and production | 7–8 | Bounded clarification plus identity, privacy, security, and operations | Threat model, legal/privacy review, deletion, recovery, and accessibility pass |
| Evidence | 9 | Bounded pilot and measured product decision | Predeclared value and safety thresholds met |
| Protocol direction | 10 | Reusable, interoperable information requests | Explicit recipient approval remains intact at every disclosure |

Goals are intentionally sequential even when implementation overlaps. In particular, external delivery does not begin before immutable request versions exist, real personal data does not enter the product before Goal 8 gates pass, and integrations do not precede evidence from the first end-to-end pilot.

## First-release cut line

The first requester-to-recipient release includes one verified requester, individual invitations, one low-risk request type, form and voice/text response modes, save/resume, explicit submission, a requester inbox, JSON/CSV export, expiry, revocation, deletion, and complete audit receipts.

Defer until the pilot demonstrates a need:

- bulk campaigns, public surveys, and marketing automation;
- payments, subscriptions, marketplace distribution, and template monetization;
- automated scoring, eligibility, diagnosis, ranking, or consequential decisions;
- EHR, school-information-system, CRM, government-portal, and broad cloud-drive integrations;
- AI-generated answers, inferred sensitive attributes, or requester access to respondent memory;
- arbitrary post-submission chat or agent-initiated follow-ups;
- production claims for medical, financial, employment, education, or government compliance;
- computer-use automation where a deterministic integration or reviewed hand-off is available.

## Roadmap scorecard

| Dimension | Initial target |
| --- | --- |
| Purpose coverage | 100% of published questions map to a requester-confirmed purpose |
| Scope integrity | Zero submitted values outside the published request definition |
| Publication control | Zero model-initiated publications or invitations |
| Submission control | Zero model- or requester-initiated recipient submissions |
| Version safety | Zero silent changes to active responses after publication |
| Privacy | Requesters cannot access drafts, transcripts, Memory Vault contents, or other recipients |
| Accessibility | Essential authoring and response journeys pass keyboard, screen-reader, zoom, contrast, and reduced-motion review |
| Reliability | Save/resume, expiry, revocation, reconnect, duplicate-action, and deletion paths have deterministic tests |
| Data minimization | Every sensitive or required item has an explicit rationale and reviewer-visible challenge path |
| Product value | Pilot improves response completeness or effort without reducing recipient trust or control |
