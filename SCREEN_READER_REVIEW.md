# VocaForm Manual Screen-reader Review

**Status:** **PASS**

**Candidate:** `249c4de0965477445ec8b43bf0ffd989f09d6835`

**Review date:** `2026-07-15`

**Reviewer:** `Codex Computer Use review with VoiceOver focus and accessibility output inspected after each transition`

**Environment:** `macOS 26.6 (25G5065a); VoiceOver 10; Google Chrome 150.0.7871.116`

This record is the manual assistive-technology evidence for `EXP-03` in
`PRE_SUBMISSION_REVIEW.md`. Use only the reviewed synthetic fixtures. The review
must be completed against the same candidate recorded in the experience-review
sign-off; automated accessibility-tree, Axe, and keyboard checks do not replace
this journey.

## Pass criteria

- [x] **Entry and Upload:** VoiceOver announces the page title, public-demo
  warning, main landmark, Upload heading, step status, and named sample/open
  controls in a sensible order.
- [x] **Talk:** the prepared-form summary and Start answering control are clear;
  entering Talk moves focus to the current question; its section, required state,
  help, answer control, and numeric progress are understandable without sight.
- [x] **Typed answer and status:** a synthetic answer can be entered and submitted
  with VoiceOver commands, and the next question or completion status is announced
  without reviewing the full page again.
- [x] **Memory drawer:** the drawer has a useful name and heading, focus enters and
  returns predictably, provenance is understandable, and confirm/forget/close
  controls are distinguishable.
- [x] **Error recovery:** an application error is announced as an alert, explains
  what happened, and exposes a named keyboard-operable recovery action.
- [x] **Review:** the Review heading, answer summary, blockers, finding kind,
  affected field, and correction action are understandable in reading order.
- [x] **Verification recovery:** a reviewed synthetic finding can be corrected
  without restarting, status changes are announced, and final export remains
  unavailable until verification succeeds.
- [x] **Download:** draft versus final output is not conveyed by color alone;
  disabled/locked state is announced; the available download has a useful name.
- [x] **No critical defect:** there is no focus trap, silent stage transition,
  unnamed interactive control, misleading state, or path that requires sight.

## Observations

- VoiceOver navigation used: `Tab`, `Shift-Tab`, `Return`, `Escape`, and `Control-Option-Right` with VoiceOver active; Chrome accessibility output and the focused element were inspected after every transition.
- Forms/states reviewed: reviewed synthetic Community Garden form; entry/skip link; prepared Upload; typed Talk; empty, populated, and reuse Memory states; a recoverable save failure; clear and blocked Review; required-field correction; final verification; ready and locked Download; and draft download completion.
- Announcements and focus behavior: stage changes focused their headings; questions focused their labeled answer fields; progress exposed numeric values; save, retry, memory, verification, and download status messages appeared in live output; dialogs trapped and returned focus; disappearing Memory and verification actions now move focus to the next useful control.
- Defects found and disposition: ambiguous `Remember`, `Use this`, `Correct`, `Forget`, `Answer now`, and resolution controls were given field-specific accessible names. Focus loss after applying/removing Memory suggestions and resolving a verification finding was repaired with deterministic handoff. Browser assertions cover the names and Memory handoff, and the full VoiceOver path was repeated after the fixes.
- Accepted limitations: the microphone path was intentionally not started; this pass covers the typed-answer journey in VoiceOver 10 with Chrome 150 on macOS 26.6. Export-document limitations remain separately bounded in `EXPORT_ACCESSIBILITY_REVIEW.md`.

## Result

The manual journey passed on the recorded candidate. The full deterministic,
build, and 16-journey desktop/mobile suite was repeated successfully on that exact
commit before the overall experience-review sign-off changed to PASS.

- Decision: `PASS`
