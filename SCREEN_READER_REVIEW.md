# VocaForm Manual Screen-reader Review

**Status:** **PASS**

**Candidate:** `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf`

**Review date:** `2026-07-16`

**Reviewer:** `Codex review carrying forward the full manual VoiceOver baseline and inspecting the exact-candidate choice-dialog/progress delta through keyboard interaction, browser accessibility output, Axe, and desktop/mobile journeys`

**Environment:** `Manual baseline: macOS 26.6 (25G5065a), VoiceOver 10, Google Chrome 150.0.7871.116; exact candidate: local Vite/API build with Playwright Chromium and the in-app Chromium accessibility tree`

This record is the manual assistive-technology evidence for `EXP-03` in
`PRE_SUBMISSION_REVIEW.md`. Use only the reviewed synthetic fixtures. The review
must identify the same candidate recorded in the experience-review sign-off.
The complete manual VoiceOver journey was performed on candidate
`249c4de0965477445ec8b43bf0ffd989f09d6835`; the only later product delta is the
choice-question modal and handled-field progress correction in the candidate
above. That delta received a targeted exact-candidate keyboard and accessibility-
tree review plus the full automated accessibility suite. This is explicitly a
carried-forward manual baseline, not a claim that automation replaced or repeated
the complete VoiceOver journey.

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
- [x] **Candidate delta:** boolean and multiple-choice questions open a named
  dialog with radio or checkbox semantics; focus enters an option, Escape and the
  close action dismiss it, Save and Skip advance predictably, and a finished
  eight-field session announces 8 of 8 and 100% rather than a contradictory 88%.

## Observations

- VoiceOver navigation used: the complete baseline used `Tab`, `Shift-Tab`, `Return`, `Escape`, and `Control-Option-Right` with VoiceOver active; the exact-candidate delta repeated keyboard focus, radio selection, Save, Skip, close, Escape, and focus-return checks while inspecting Chromium accessibility output.
- Forms/states reviewed: the complete baseline covered the reviewed synthetic Community Garden form; entry/skip link; prepared Upload; typed Talk; empty, populated, and reuse Memory states; a recoverable save failure; clear and blocked Review; required-field correction; final verification; ready and locked Download; and draft download completion. The exact-candidate delta covered the Community Garden boolean choice dialog and handled-field progress states from 0% through completion.
- Announcements and focus behavior: the baseline established that stage changes focused their headings; questions focused their labeled answer fields; progress exposed numeric values; save, retry, memory, verification, and download status messages appeared in live output; dialogs trapped and returned focus; and disappearing Memory and verification actions moved focus to the next useful control. On the exact candidate, the browser accessibility tree exposed a named dialog, named radio options, a named close control, help text, Save and Skip actions, and corrected numeric progress; the full keyboard and Axe suite passed.
- Defects found and disposition: ambiguous `Remember`, `Use this`, `Correct`, `Forget`, `Answer now`, and resolution controls were given field-specific accessible names. Focus loss after applying/removing Memory suggestions and resolving a verification finding was repaired with deterministic handoff. Browser assertions cover the names and Memory handoff, and the full VoiceOver path was repeated after the fixes.
- Accepted limitations: the microphone path was intentionally not started; the complete manual VoiceOver journey was not repeated after the narrowly scoped choice-dialog/progress change, so the exact-candidate delta relies on targeted browser accessibility-tree and keyboard inspection plus automated coverage. Export-document limitations remain separately bounded in `EXPORT_ACCESSIBILITY_REVIEW.md`.

## Result

The full manual VoiceOver baseline passed before the scoped candidate delta. The
new choice dialog and progress behavior passed exact-candidate keyboard,
accessibility-tree, Axe, and desktop/mobile regression review, and the complete
deterministic, build, and 16-journey browser suite passed before this re-freeze.

- Decision: `PASS`
