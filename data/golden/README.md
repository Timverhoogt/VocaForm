# Golden form set

All fixtures are synthetic and redistributable. They contain no real patient, child, family, or identity data.

The Goal 2 regression set represents three document shapes:

1. `medical-intake.txt` is the canonical source for the medical intake PDF fixture. PDF rendering is kept outside the answer key so page appearance can evolve without silently changing expected fields.
2. `../example_entreeformulier.schema.json` is the reviewed elementary-school DOCX answer key retained from the proven prototype.
3. `activity-permission.txt` is a permission form with a conditional transport question.

`npm run eval:compiler` evaluates the reviewed compiler outputs against 53 expected fields, 25 explicitly required fields, and the two conditional dependencies. It fails below 95% aggregate recall, below 100% required-field recall, on any fabricated field ID, or on a missing dependency.

This deterministic suite is the offline regression baseline. A live GPT-5.6 Sol replay must be recorded separately with `OPENAI_API_KEY` configured before submission; offline approved outputs must not be represented as a live-model score.

Goal 5 adds programmatic verification fixtures in `app/evals/verification_fixtures.ts`. `npm run eval:verifier` checks five deterministic failure classes and final-export gating without an API call. `npm run eval:verifier:live` separately compares standard/high and Pro on synthetic contradiction, unsupported-claim, and ambiguity cases and asserts that the supplied sessions remain unchanged.

Goal 6 adds generated school DOCX and medical AcroForm PDF sources in `app/evals/rendering_fixtures.ts`. `npm run eval:renderer` verifies 45/45 native answer placements, source-byte preservation, explicit non-writable-source fallback, and the absence of an injected completion summary. `npm run fixtures:rendering` writes the synthetic sources to ignored local storage for manual viewer testing.
