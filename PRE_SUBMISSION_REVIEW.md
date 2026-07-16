# VocaForm Pre-submission Experience Review

**Gate added:** July 15, 2026<br>
**Scope:** UI/UX, locale behavior, and accessibility<br>
**Current decision:** **PASS**

This gate sits between a passing engineering build and the final release-candidate freeze. It reviews the experience people actually receive, including people who use screen readers, keyboard navigation, text enlargement, high-contrast settings, or a narrow viewport. It does not replace the deterministic product, privacy, renderer, or submission checks.

## Evidence reviewed

| Condition | Result | Evidence |
| --- | --- | --- |
| Desktop, 1440 × 1000 | Pass | Rendered Upload, prepared-form, voice, typed-answer, and Review states |
| Mobile, 390 × 844 | Pass | No horizontal overflow; the active task precedes the full status card |
| Low-vision reflow, 320 × 800 | Pass | No horizontal overflow; task-order regression coverage is in `app/e2e/accessibility.spec.ts` |
| Keyboard-only journey | Pass | Existing Playwright journey completes form and draft download without a pointer |
| Screen-reader structure | Pass on reviewed VoiceOver baseline and targeted candidate delta | `SCREEN_READER_REVIEW.md` records the typed end-to-end journey and the exact-candidate choice-dialog/progress regression review |
| WCAG A/AA serious or critical Axe findings | Pass on reviewed states | Existing accessibility suite plus the new forced-colors/reflow state |
| 200% text resize | Pass | Existing Playwright checks cover Upload, prepared form, interview, Review, and Download |
| Forced colors and reduced motion | Pass | Automated coverage plus a rendered visual pass of focus, progress, blockers, and disabled verification/export controls; reproducible with `npm run evidence:forced-colors` |
| Public-demo privacy disclosure | Pass | Desktop/mobile test verifies isolated browser state, non-persistence, two-hour expiry, temporary host storage, reflow, and Axe results |
| English reviewed forms | Pass | English form content and English application chrome align |
| Dutch reviewed form | Pass within submission scope | Dutch titles, sections, prompts, examples, labels, and source content carry `lang="nl-NL"`; application chrome intentionally remains English |
| Exported-document accessibility | Accepted with narrowed claim | `EXPORT_ACCESSIBILITY_REVIEW.md` records the structural audits, full-page renders, metadata fixes, and the untagged-PDF limitation |

The rendered review used reviewed synthetic fixtures only. It did not start the microphone, transmit personal information, or perform a live Dutch voice interview.

## Locale inventory

VocaForm keeps interface language separate from form language. The interface has no language selector and remains English for this submission; form language uses validated, canonical BCP 47 tags.

| Surface | Current availability | Confidence |
| --- | --- | --- |
| Application chrome | English only | Verified in source and rendered UI |
| Reviewed form content | `en-US` and `nl-NL` fixtures | Verified |
| Uploaded form metadata | Canonical BCP 47 locale, with `und` fallback for uncertain compiler output | Unit tested |
| Realtime interview | Defaults to the form locale and supplies a two-letter transcription hint only when valid | Implemented; English is voice-QA verified, other languages remain best effort |
| Dates | Formatted with the browser's default locale | Implemented; no in-product locale control |
| Boolean and status labels | English (`Yes`, `No`, `Blocked`, and similar) | Verified in source |
| Right-to-left form content | `dir="auto"` on dynamic form content and answer input | Defensive support only; a full RTL journey is not submission-QA certified |

For the Build Week submission, the defensible claim is: **English application interface; language-aware form handling; reviewed English and Dutch form content; other form languages and voice are best effort unless separately verified.** Do not claim a fully localized Dutch interface, a translated multilingual UI, or certified right-to-left support.

## Findings

| ID | Priority | Status | Area | Finding | Required disposition |
| --- | --- | --- | --- | --- | --- |
| EXP-01 | P1 | Resolved | Mobile UX | The full status card previously preceded the active task below 860 pixels. | The active task now comes first; 320-pixel task-order coverage passes in desktop and mobile Chromium. |
| EXP-02 | P1 | Resolved | Language accessibility | Dutch form content previously inherited the English page language. | Canonical BCP 47 boundaries and automatic text direction now cover dynamic form content, including memory provenance; the Dutch browser journey passes. |
| EXP-03 | P1 | Resolved | Assistive technology | The manual VoiceOver pass found ambiguous repeated action names and focus loss after disappearing Memory and verification controls. | Field-specific accessible names and deterministic focus handoff were added, manually retested, and covered by browser assertions. `SCREEN_READER_REVIEW.md` records the PASS. |
| EXP-04 | P1 | Accepted scope | Output accessibility | Reviewed DOCX outputs have language metadata, linear reading order, real headings, zero structural-audit findings, and clean renders. Filled PDF fields now have alternate labels and document language, but the synthetic source and completed PDF remain untagged. | Keep the claim source-dependent: do not claim tagged PDF, PDF/UA, universal accessible exports, or assistive-technology certification. See `EXPORT_ACCESSIBILITY_REVIEW.md`. |
| EXP-05 | P2 | Accepted scope | Localization | Application-owned UI and server messages remain English; there is no translated message catalog or language switcher. | Keep the submission claim to an English UI with language-aware form handling; design translated UI localization as follow-up work. |
| EXP-06 | P2 | Resolved | Visual accessibility | Chromium forced-colors/reduced-motion renders were visually inspected for focus, disabled controls, numeric progress, blockers, and locked export. | Reproduce the five evidence views with `npm run evidence:forced-colors`; repeat on the frozen candidate if visual CSS changes. |
| EXP-07 | P1 | Resolved | Choice questions | Boolean and multiple-choice fields previously fell back to the free-text answer path. | A native modal dialog now presents radios or checkboxes, starts on a named option, supports Save, Skip, Close, and Escape, returns focus to the invoking question, and is covered by keyboard, Axe, desktop, and mobile browser journeys. |
| EXP-08 | P1 | Resolved | Progress | A session could report Finished in the left rail while the right status card remained at 88% because skipped or conclusively not-needed fields were omitted from the numerator. | Completion now uses handled fields for progress and reports answered, skipped, and not-needed counts separately; a finished eight-field journey reports 8 of 8 and 100%. |
| EXP-09 | P1 | Resolved | Text resize | At 200% text on the mobile viewport, the long landing-page heading could widen the document beyond the viewport. | Long heading words may now wrap when required; the 200% desktop/mobile overflow journey passes. |

## What is already strong

- The four-step journey is easy to understand and the writing is calm and direct.
- The active task, review blockers, and export boundary are explicit rather than implied by color alone.
- Keyboard focus is visible, moves to new stage headings, and supports an end-to-end no-pointer journey.
- Controls have accessible names, large targets, and clear disabled states.
- Progress bars expose numeric values and text alternatives.
- Errors use alerts with actionable recovery; ordinary state changes use polite live announcements.
- Reduced-motion, increased-contrast, and forced-colors styles are present.
- The 320-pixel reflow check found no horizontal scrolling.

## Gate protocol

Run this review on the exact candidate commit:

1. Run `npm run test:accessibility`; after recording the sign-off, run `npm run check:experience`.
2. Inspect Upload, Talk, Review, Download, Memory, public-demo warning, loading, error, and disabled states at desktop and mobile widths.
3. Repeat the active-question and Review states at 200% text and 320 CSS pixels wide.
4. Complete a keyboard-only journey and a manual VoiceOver or NVDA journey.
5. Check forced-colors/high-contrast and reduced-motion states.
6. Open each reviewed locale and confirm language boundaries, pronunciation, date/number behavior, and translated versus untranslated UI.
7. Inspect one completed PDF and one completed DOCX for reading order, names/labels, headings, and meaningful source structure.
8. Mark each P1 finding fixed, accepted with a submission disclosure, or moved out of scope with the claim narrowed.

Feature freeze can proceed only after the reviewer, candidate SHA, date, open exceptions, and final decision are recorded below.

## Sign-off

- Candidate SHA: `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf`
- Reviewer: `Codex pre-submission review using the prior full manual VoiceOver baseline plus an exact-candidate keyboard, accessibility-tree, Axe, desktop, and mobile delta review`
- Review date: `2026-07-16`
- Open accepted exceptions: `English-only application UI; other form languages and voice are best effort; the full manual VoiceOver typed-path baseline was not repeated after the narrowly scoped choice-dialog and progress changes, so exact-candidate assistive-technology evidence is a targeted accessibility-tree and keyboard regression plus the automated suite; microphone interaction was not covered; native PDF accessibility remains source-dependent and the reviewed PDF is untagged, so no PDF/UA or universal accessible-export claim is made.`
- Decision: PASS
