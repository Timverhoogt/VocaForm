# VocaForm supported web-form controls

This matrix is the production boundary for the deterministic Google Forms and Microsoft Forms paths. “Native” means VocaForm can place the reviewed canonical answer in an isolated browser, re-read the provider control immediately after placement and again before Submit, and bind both checks to the current session and inspected source revision. The user remains the only party that can authorize the final Submit click.

| Control | Interview | Google native | Microsoft native | Safe fallback |
| --- | --- | --- | --- | --- |
| Short and long text | Deterministic | Supported | Supported | Reviewed answer list |
| Email and phone | Deterministic | Supported | Supported | Reviewed answer list |
| Number | Deterministic | Supported | Supported | Reviewed answer list |
| Date and time | Deterministic | Supported | Supported | Reviewed answer list |
| Single choice | Deterministic | Supported | Supported | Reviewed answer list |
| Multiple choice | Deterministic | Supported | Supported | Reviewed answer list |
| Boolean | Deterministic canonical control | Supported when a checkbox or Yes/No control is exposed | Supported when a checkbox or Yes/No control is exposed | Reviewed answer list |
| Scale and rating | Deterministic when numeric options are exposed | Supported | Supported | Reviewed answer list |
| Ranking | Manual | Not filled | Not filled | Complete directly in provider form |
| Matrix / Likert | Manual | Not filled | Not filled | Complete directly in provider form |
| File upload | Blocked | Not filled | Not filled | Provider-only file transfer; no VocaForm upload |
| Unknown provider control | Blocked | Not filled | Not filled | Re-inspect after adapter support is added |

Native preparation also requires all of the following:

- a public, anonymous, complete, single-page responder form;
- the expected provider markup, question, navigation, and Submit boundaries;
- a provider question identifier and a high- or medium-stability locator for every control;
- delivery-target confidence of at least `0.85` for every supported control;
- no form revision, responder URL, answer, session version, or control-value drift;
- an available isolated-browser request, concurrency, and time budget.

If any requirement is missing, VocaForm does not partially fill the native form. It keeps the reviewed manual answer list and records only an aggregate fallback reason. Externally authenticated forms always use that manual path because provider identity and browser state remain outside VocaForm.

## Live contract checks

Live provider checks are intentionally separate from `npm run check`, which remains deterministic and network-free. Use disposable public single-page forms containing no personal data:

```bash
VOCAFORM_WEBFORM_LIVE_CHECKS=true \
VOCAFORM_LIVE_GOOGLE_FORM_URL="https://docs.google.com/forms/d/e/.../viewform" \
VOCAFORM_LIVE_MICROSOFT_FORM_URL="https://forms.office.com/r/..." \
npm run check:webforms:live
```

Run one provider independently with `npm run check:webform:live:google` or `npm run check:webform:live:microsoft`. Set `VOCAFORM_WEBFORM_LIVE_CHECKS=false` to explicitly disable the scheduled live check. Output contains provider names, aggregate coverage, timings, and drift reason codes—never responder URLs, question labels, provider IDs, tenant values, answers, or screenshots.
