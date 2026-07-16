# VocaForm Submission Evidence

**Recorded:** July 15, 2026<br>
**Fixture policy:** reviewed synthetic data only<br>
**Release commands:** `npm run check:submission` and the separate live compiler replay below

## Live GPT-5.6 Sol compiler replay

The current 53-field baseline was replayed against the live `gpt-5.6-sol` compiler on July 15. The replay used the generated medical AcroForm PDF, generated elementary-school DOCX, and conditional activity-permission text source. It completed successfully with the following result:

| Fixture | Readiness | Fields | Required | Fabricated | Missing dependencies |
| --- | ---: | ---: | ---: | ---: | ---: |
| Medical intake PDF | 96 | 8/8 | 5/5 | 0 | 0 |
| Elementary-school DOCX | 88 | 37/37 | 15/15 | 0 | 0 |
| Activity-permission text | 96 | 8/8 | 5/5 | 0 | 0 |
| **Aggregate** | — | **53/53** | **25/25** | **0** | **0** |

The run used 4,783 input tokens and 16,288 output tokens. The privacy-safe machine-readable result is checked in at `data/golden/live_compiler_2026-07-15.json`; it contains metrics and the source commit, not uploaded bytes, prompts, answers, filenames from a user, response IDs, or private identifiers.

The live replay ran from the working tree based on commit `c1cb255a60b5fc12b965304257822d126a3e3911`. The release-packaging changes added afterward do not alter compiler prompts, schemas, normalization, or fixture answer keys.

Reproduction after generating the reviewed rendering fixtures:

```bash
npm run fixtures:rendering
npm run eval:compiler:live -- \
  --medical work/golden/medical-intake.pdf \
  --school work/golden/elementary-school-intake.docx \
  --permission data/golden/activity-permission.txt
```

This command spends API credits and requires `OPENAI_API_KEY`. It is intentionally separate from the deterministic gate so an approved offline output cannot be mistaken for a live model result.

## Deterministic release evidence

The submission command covers:

- TypeScript checking and ESLint;
- Vitest domain, client, server, adapter, and privacy tests;
- deterministic compiler, verifier, renderer, and five-pass resilience evaluations;
- legacy schema and syntax compatibility checks;
- the production Vite build;
- desktop and mobile Playwright accessibility, keyboard, recovery, memory, verification, and visual journeys;
- a release audit for required documentation, licensing, prior-work disclosure, live evidence, secret-safe deployment, and public-demo messaging.

The experience package also includes a reproducible five-state forced-colors capture and an export accessibility audit. The export review records clean full-page renders, real DOCX headings and language metadata, human-readable PDF field labels, and the accepted limitation that the native medical PDF remains untagged.

The pre-submission experience review re-froze candidate `dd7f9f24dc337d915f62ed61cbd9b3e56e2308bf`. The earlier full manual VoiceOver 10 journey in Chrome 150 on macOS 26.6 covered the typed Upload → Talk → Review → Download path, empty/populated/reuse Memory states, an announced recoverable error, a required-field blocker and correction, final verification, and both locked and ready Download states. It found ambiguous repeated action names and focus loss after disappearing controls; those defects were fixed, manually retested, and added to the browser assertions. The candidate adds a native radio/checkbox choice dialog, corrects handled-field progress, hardens the keyboard journey across question transitions, prevents the landing heading from overflowing at 200% text on a narrow screen, and removes a free-tier-incompatible Render shutdown option without changing application behavior. The UX delta passed exact-candidate keyboard and accessibility-tree inspection plus Axe and the complete desktop/mobile browser suite; Render's Blueprint planner is the deployment-config check. The full manual VoiceOver journey was not repeated after this delta, and that limitation is recorded explicitly. `npm run check:experience` verifies candidate ancestry, a clean worktree, metadata-only post-candidate changes, completed evidence, resolved P1 findings, accepted exceptions, and the explicit PASS.

The detailed five-pass evidence and loading/recovery matrix are in `RESILIENCE_REPORT.md`. Renderer source preservation and fallback behavior are exercised by `npm run eval:renderer`.

The release container was also built and smoke-tested locally on July 15. It served a healthy public-demo response, ran as the unprivileged `node` user, found LibreOffice at `/usr/bin/soffice`, and contained no `.env` file. The smoke run intentionally omitted an API key and confirmed that the health response exposed only `configured: false`, never a credential.

## Hosted public-demo QA

The deployed public demo at `https://vocaform-build-week.onrender.com/` received a fresh anonymous-browser and independent visitor-session pass on July 16:

- `/api/health` returned HTTP 200 with public-demo mode, ephemeral storage, GPT-5.6 Sol compilation and verification, and Realtime configured; the warmed root response completed in about 0.15 seconds.
- A fresh signed-out in-app browser opened the reviewed Community Garden form, completed all eight questions through the typed path, used the native radio-choice dialogs, advanced from 88% to 100% after the final choice, reported `8 of 8 complete` and `0` required questions left on both surfaces, passed live final verification, and downloaded the verified DOCX answer packet.
- The downloaded answer packet rendered as one clean page with all eight synthetic answers, no clipping, overlap, broken layout, or missing content.
- An independent anonymous visitor uploaded the arbitrary elementary-school DOCX. The Render container successfully used the DOCX preparation path, returned a ready 37-field / 15-required form, started the compiled session, and accepted cleanup. The end-to-end compile took about 248 seconds, so cold/model compilation latency remains a demo risk even though the path passed.
- That independent visitor did not alter the browser journey: the first browser still showed the Community Garden form at 100%, which confirms the deployed cookie-isolated visitor boundary for the exercised state.
- A separate medical-fixture session completed with synthetic answers, reported 100% and zero required questions open, passed semantic verification, retained zero Memory claims, and exported a 19,370-byte native PDF. The rendered PDF preserved all fields cleanly and selected `No` for allergies.
- The completed Download view reflowed at 320 × 800 with a 320-pixel document width and no horizontal overflow.

The browser microphone was not started because doing so would transmit ambient audio and may require a browser permission grant. The live `429` ceiling was also not exhausted because that would deliberately spend the public visitor/address budgets and additional model requests; the deterministic limiter suite covers the 3-per-visitor compile and 10-per-visitor verification/Realtime rules. These two boundaries remain explicit manual/operational checks rather than claimed live passes.

## Evidence boundaries

These results apply to the reviewed synthetic fixture set. They are not claims of clinical accuracy, universal form support, healthcare compliance, or production durability. The hosted public demo explicitly asks visitors to use synthetic data. Each browser receives an isolated, expiring in-memory form and Memory Vault container, while model-backed routes have bounded anonymous request budgets; this is judge-preview isolation, not production authentication or durable encrypted storage.
