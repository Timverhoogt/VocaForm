# VocaForm Pre-submission Checklist

**Official deadline:** July 22, 2026 at 00:00 UTC / 02:00 CEST<br>
**Internal submit deadline:** July 21, 2026 at 20:00 CEST<br>
**Policy:** after the internal deadline, change only a verified link or make a safe resubmission.

## Prepared in the repository

- [x] MIT license present.
- [x] README covers the problem, model roles, Codex, setup, samples, tests, limitations, privacy, and prior work.
- [x] Pre-event baseline `cd2b782` and Build Week range beginning `ca05d21` disclosed.
- [x] Live 53-field Sol replay recorded: 53/53 fields, 25/25 required, zero fabrication, no missing dependencies.
- [x] One submission command: `npm run check:submission`.
- [x] Docker image includes Node and LibreOffice and runs as the unprivileged `node` user.
- [x] Render Blueprint uses a health check, a dashboard-supplied API secret, public-demo privacy mode, and manual deploys.
- [x] Public visitors receive isolated, expiring in-memory form and Memory Vault state.
- [x] Anonymous compilation, verification, and Realtime requests have per-visitor and per-address limits.
- [x] Devpost copy drafted in `DEVPOST_SUBMISSION.md`.
- [x] Devpost project `1332705` created as an unsubmitted draft with description, technologies, and repository link.
- [x] Timed narration and capture instructions drafted in `demo/DEMO_SCRIPT.md`.
- [x] English captions drafted in `demo/vocaform-demo.en.srt`.

## Experience review gate

- [x] Add the UI/UX, locale, and accessibility protocol in `PRE_SUBMISSION_REVIEW.md`.
- [x] Review rendered desktop, 390-pixel mobile, and 320-pixel low-vision reflow states.
- [x] Confirm the current automated keyboard, Axe, 200% text, reduced-motion, and forced-colors coverage.
- [x] Resolve EXP-01: the active task now precedes the full status card on narrow screens.
- [x] Resolve EXP-02: form-derived Dutch content now has canonical Dutch language boundaries and automatic text direction.
- [x] Complete every criterion and record the manual VoiceOver journey in `SCREEN_READER_REVIEW.md`.
- [x] Inspect completed PDF and DOCX outputs; record structural improvements and the untagged-PDF accepted exception in `EXPORT_ACCESSIBILITY_REVIEW.md`.
- [x] Visually inspect focus, disabled, progress, and blocker states in Chromium forced-colors mode; retain the reproducible capture command.
- [x] Confirm the submission locale claim: English UI; language-aware form handling; reviewed English and Dutch form content; other languages and voice best effort unless separately verified.
- [x] Run `npm run check:experience` successfully for exact candidate `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf` with only metadata changes afterward.
- [x] Record candidate SHA, reviewer, accepted exceptions, and a **PASS** decision before feature freeze.

## Release candidate

- [x] Commit the final scoped changes and push `codex/build-week-rebuild`.
- [x] Run `npm ci` from a clean clone on Node 20 or newer.
- [x] Run `npx playwright install chromium` in the clean clone.
- [ ] Run `npm run check:submission` after every external evidence item below is complete.

The July 16 clean clone used Node 26.5.0 and passed `npm run check:experience`,
`npm run check:resilience`, and all 16 desktop/mobile browser journeys. The final
submission command currently stops at the intended checklist boundary with 34
external evidence items incomplete; this is not an engineering-gate failure.
- [x] Build and smoke-test the container locally:

  ```bash
  docker build -t vocaform:submission .
  docker run --rm -p 10000:10000 \
    -e OPENAI_API_KEY \
    -e VOCAFORM_PUBLIC_DEMO=true \
    vocaform:submission
  ```

- [x] Confirm `http://127.0.0.1:10000/api/health` reports `status: ok`, `publicDemo: true`, and no secret value.
- [x] Feature-freeze the exact passing commit SHA: `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf`.

## Public demo

- [ ] Import `render.yaml` as a Render Blueprint from the frozen branch.
- [ ] Supply `OPENAI_API_KEY` in the Render dashboard; never paste it into Git or this checklist.
- [ ] Confirm the service binds successfully and `/api/health` passes.
- [ ] Confirm the public synthetic-data warning is visible before opening a form.
- [ ] In a signed-out browser, complete one reviewed sample through draft download.
- [ ] In a second clean browser, upload the synthetic medical PDF, start voice, run final verification, and open the completed PDF.
- [ ] Confirm the two clean browsers cannot see or mutate each other's active form or Memory Vault.
- [ ] Confirm excessive public model requests return a recoverable `429` without affecting reviewed samples.
- [ ] Confirm arbitrary DOCX compilation can find `/usr/bin/soffice`.
- [ ] Note the free-instance cold start and warm the service before judging or recording.
- [ ] Public demo URL: `________________________________________`.

Render's free web service has an ephemeral filesystem and can spin down after 15 idle minutes. Public visitor state is not written to it and expires after at most two hours, so the deployment is intentionally temporary rather than production storage. Upgrade only if the cost and reduced cold-start risk are explicitly accepted.

## Video and captions

- [ ] Capture only reviewed synthetic fixtures at 16:9 and 1080p.
- [ ] Keep secrets, personal tabs, notifications, account pages, and terminal history out of frame.
- [ ] Follow `demo/DEMO_SCRIPT.md`; narration explicitly says VocaForm, GPT-5.6 Sol, Realtime, Codex, and the human decision boundary.
- [ ] Open the completed PDF briefly and legibly.
- [ ] Render below 2:55 and verify the final YouTube duration is below 3:00.
- [ ] Upload `demo/vocaform-demo.en.srt`, proofread it against the final edit, and correct timing drift.
- [ ] Publish on YouTube as **Public** and wait for 1080p processing.
- [ ] Verify the URL in a signed-out browser and check for copyright or Content ID blocks.
- [ ] Public YouTube URL: `________________________________________`.

## Devpost

- [x] Verify the VocaForm draft at `https://devpost.com/software/vocaform` remains in draft state.
- [ ] Confirm the submitter's legal country of residence; do not infer it from location or timezone.
- [ ] Open Codex task `019f5ff0-9cda-7c71-b035-9b120101b753`, run `/feedback`, and record the returned Session ID.
- [ ] `/feedback` Session ID: `________________________________________`.
- [ ] Replace both `TO_BE_ADDED_BEFORE_SUBMISSION` values in `DEVPOST_SUBMISSION.md`.
- [ ] Paste and proofread every field from `DEVPOST_SUBMISSION.md`.
- [ ] Select **Apps for Your Life**.
- [ ] Confirm repository visibility, MIT licensing, setup instructions, sample data, and prior-work disclosure.
- [ ] Confirm the public demo, repository, and YouTube links all work signed out.
- [ ] Preview the final project page on desktop and mobile.
- [ ] Submit by July 21 at 20:00 CEST.
- [ ] Reopen the submitted project, confirm every field and link persisted, and save a screenshot of the receipt.
