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

The detailed five-pass evidence and loading/recovery matrix are in `RESILIENCE_REPORT.md`. Renderer source preservation and fallback behavior are exercised by `npm run eval:renderer`.

The release container was also built and smoke-tested locally on July 15. It served a healthy public-demo response, ran as the unprivileged `node` user, found LibreOffice at `/usr/bin/soffice`, and contained no `.env` file. The smoke run intentionally omitted an API key and confirmed that the health response exposed only `configured: false`, never a credential.

## Evidence boundaries

These results apply to the reviewed synthetic fixture set. They are not claims of clinical accuracy, universal form support, healthcare compliance, or production durability. The hosted public demo explicitly asks visitors to use synthetic data. Each browser receives an isolated, expiring in-memory form and Memory Vault container, while model-backed routes have bounded anonymous request budgets; this is judge-preview isolation, not production authentication or durable encrypted storage.
