# VocaForm Devpost Submission Copy

**Status:** Submitted to OpenAI Build Week on July 16, 2026 at 18:27 CEST. Devpost submission ID: `1092030`. The deployed demo and public links passed signed-out verification before submission.

**Devpost project:** [devpost.com/software/vocaform](https://devpost.com/software/vocaform) · project ID `1332705`

**Live project verification:** On July 18, 2026, the authenticated Devpost project record was `published`, remained submitted to OpenAI Build Week, and referenced the final video URL `https://youtu.be/Dh-6t_kKioM`.

**Post-submission feature:** The complete web-form workflow (roadmap Goals 1–6A) was published through Devpost's feature-update UI on July 17, 2026: [New: live web-form interviews and consented native hand-off](https://devpost.com/software/vocaform/updates/797250). It was added after the original submission video was finalized. The updated final demo now presents the original document journey and the new public Google and Microsoft Forms workflow as one coherent product.

**Deployment evidence:** Commit [`7e9ff05`](https://github.com/Timverhoogt/VocaForm/commit/7e9ff05654a7100b0f76d1f7b5e7f293da49c83f) was pushed and promoted live on Render on July 17, 2026. A signed-out check confirmed the public responder-link field, anonymous/sign-in-required access choices, read-only inspection disclosure, and healthy public-demo API. The final 2:27 demo was uploaded on July 18, 2026 and includes the deployed web-form feature.

## Required fields

| Field | Value |
| --- | --- |
| Project name | VocaForm |
| Tagline | One form. One conversation. Done. |
| Devpost draft | https://devpost.com/software/vocaform |
| Category | Apps for Your Life |
| Repository | https://github.com/Timverhoogt/VocaForm |
| Working demo | https://vocaform-build-week.onrender.com/ |
| Final YouTube video | https://youtu.be/Dh-6t_kKioM |
| Codex `/feedback` Session ID | `019f5ff0-9cda-7c71-b035-9b120101b753` |
| License | MIT |

## Build Week submission-field map

| Field ID | Required field | Prepared value |
| ---: | --- | --- |
| 27945 | Submitter Type | Individual |
| 27946 | Country of Residence | Netherlands |
| 27947 | Category | Apps for Your Life |
| 27948 | Code repository | https://github.com/Timverhoogt/VocaForm |
| 27949 | Judge demo and instructions | https://vocaform-build-week.onrender.com/ — use reviewed synthetic data only |
| 27950 | `/feedback` Session ID | `019f5ff0-9cda-7c71-b035-9b120101b753` |
| 27951 | Plugin/developer-tool instructions | Not applicable |

The recorded Codex task contains the majority of the core Build Week implementation across the typed foundation, GPT-5.6 form compiler, and Realtime interview. Running `/feedback` in that task returned the Session ID recorded above.

## Devpost Add feature copy

**Feature title:** New: live web-form interviews and consented native hand-off

**Feature description:**

VocaForm now extends its accessible interview from uploaded documents to live Google Forms and Microsoft Forms. Paste a responder link and VocaForm performs a read-only, isolated inspection of the rendered form, compiles it into the same provider-independent session used by documents, and guides the user through voice or text answers, optional Memory Vault reuse, and final verification.

For a complete public single-page form made from supported ordinary controls, the user can give fresh, specific consent to prepare the native provider form. VocaForm fills an isolated copy, re-reads every control, shows both a screenshot and an accessible text review, and binds the prepared result to the exact session and inspected source revision. It stops before submission. Only the user can open the final write gate and click the provider-labelled Submit button.

Unsupported controls, multi-page forms, unstable locators, provider drift, resource limits, and sign-in-required forms fall back to a reviewed manual answer list. Authentication always stays on Google or Microsoft's own page: VocaForm never asks for provider passwords, MFA codes, passkeys, cookies, or reusable browser state. Pre-fill contract checks, a second pre-submit value check, bounded browser resources, rate limits, and aggregate-only telemetry make failures explicit and recoverable.

This is a new post-submission feature covering the completed web-form roadmap (Goals 1–6A). Goal 6B remains long term and is not part of this release.

**Video note:** The final 2:27 demo shows both VocaForm's original document workflow and the new public Google and Microsoft Forms workflow. It also explains how Codex was used to build VocaForm and how GPT-5.6 is used inside the product, while preserving the user-controlled submission boundary: VocaForm verifies and prepares supported provider controls, then stops before Submit so the final click remains with the user.

**Published update:** https://devpost.com/software/vocaform/updates/797250

## Short description

VocaForm turns PDF, Word, text, and public web forms into a calm, accessible conversation. It returns a reviewed completed document or prepares supported Google and Microsoft Forms for the user's final submission. GPT-5.6 Sol compiles unfamiliar forms and performs a separate semantic review; Realtime conducts the voice interview; deterministic application code owns answers, consent, memory, validation, rendering, and the final submission boundary.

## Project description

### Inspiration

Being a young father, I was surprised to be confronted with so many hard copy submission forms for my kids. The dentists office required a very long questionaire with very random questions, the same for elementary school, and with a huge overlap as well. This got me thinking: "surely AI can help with this". However, I found that chatbots are not equiped to handle the realtime speech mode - tool use LLM combination, so I decided to try and build something myself. Before I started though, I asked myself, who would stand to gain from this? What problem does it solve, beyond my annoyance? I figured, that this would also be helpful for the non-technical, and the visually impaired. Just drop in a PDF, and through natural conversation, the form gets filled, out. Users could ask clarification questions along the way, ask for examples, filled form quality goes up, user happy, form requestor happy.

### What it does

VocaForm provides one simple **Upload → Talk → Review → Download** workflow:

- upload a PDF, DOCX, TXT, or Markdown form, or fill in the webform link (Google Forms/MS Forms)
- turn the document into source-grounded questions, requiredness, dependencies, validation, and rendering targets;
- answer naturally, using your voice through OpenAI Realtime or use the equal keyboard path;
- watch validated answers appear as application tools save them (with provenance);
- resolve deterministic and semantic findings without allowing the verifier to mutate the form;
- download a filled copy of a supported DOCX or AcroForm PDF, or save the webform;
- remember eligible contact facts, confirm each reuse on a later form, and correct or forget them at any time.

Medical, financial, identity-document, etc. are excluded from memory by default.

### How it was built

Most of VocaForm was built the way I build most things: laptop open, a cup of coffee next to me, and Codex running alongside the code.

I started with a small local JavaScript prototype, just to see if the idea could work. During Build Week I used Codex to rebuild it into a proper React and TypeScript application. I would describe what I wanted, review what it produced, test it, break it, and then work through the problems together with it.

I also used Codex remote quite alot. This meant I could continue working from my phone when I was underway, away from my laptop or, honestly, sitting on the toilet. I could check progress, give it the next task and review changes whenever I had a few minutes available.

It became a constant loop of building, testing and correcting. Codex gave me a lot of speed, but I still had to decide what the product should do, where the safety boundaries belonged and whether something actually worked for a real user.

### How GPT-5.6 and Codex were used

For this project I decided to work solely through the Codex app. Normally I would use the VS Code extension and switch between different models depending on the task, but this time I wanted to really put Codex through its paces and see how far I could take one project with it.

Since this was an OpenAI Build Week, I figured that was also kind of the point: build something useful while properly testing the tools OpenAI wants developers to use. I used Codex for planning, coding, refactoring, testing and working through bugs, both from my laptop and remotely from my phone.

Inside VocaForm itself, GPT-5.6 Sol is used for understanding unfamiliar forms and checking the completed answers. This is where I noticed its real strength: structured reasoning and validation against a source document.

Ofcourse I also wanted to give the project the best possible chance of getting noticed. Not just to do well in the challenge, but to get VocaForm in front of people who might actually benefit from it. Codex helped me build and ship much faster, while I stayed responsible for the product decisions, testing and the final quality.

### Challenges

One of the major challenges was that I initially forgot about webform support. By the time I added it, most of the document flow, validation and security boundaries were already built. I had to retrofit Google Forms and Microsoft Forms into the same system without weakening any of those protections, which was quite tricky.

Forms that require sign-in were even harder. I did not want VocaForm handling passwords, MFA codes, cookies or somebody’s logged-in browser session. The final solution was to keep authentication on Google or Microsofts own page, while VocaForm provides the user with a reviewed answer list and a safe hand-off. It is less automatic, but alot safer.

Getting the voice conversation to feel natural was also much more difficult than I expected. It required a lot of Realtime API research and testing to get interruptions and barge-in working correctly. The start of the interview was especially sensitive: the assistant had to ask the first question, stop speaking, wait for a real user response and only then save an answer.

### Accomplishments

- VocaForm found all 53 expected fields and all 25 required fields in the reviewed synthetic test forms, without inventing new ones.
- Five consecutive end-to-end resilience runs completed without a blocking failure.
- The verifier detected every deliberately seeded blocker class.
- The document renderers placed all 45 test answers while preserving the original files.
- Memory reused three approved contact facts and stored no sensitive information.
- The production build and Playwright accessibility journeys pass through one documented command.

### What I learned

A big part of the project was balancing speed and accuracy. Letting AI understand documents and hold the conversation made the process much faster, but validation and final authority still needed clear rules and human decisions.

This is also where I could really see the power of GPT-5.6 Sol. It was especially strong at structured reasoning, validation, and checking its work against the source document. I also noticed that it had picked up many of the practical skills needed for vibe coding, which made Codex much more useful during the rebuild.

The clearest architecture was: let AI understand, suggest, and converse, but keep control in the application. VocaForm became stronger when the models were given well-defined jobs and the product kept ownership of answers, memory, consent, validation, and export.

### What's next

The next step is testing VocaForm with real users. I especially want to learn whether the final semantic review should always be required, be optional, or only be used for higher-risk forms.

A production version would also need user accounts, encrypted storage, durable sessions, stronger deployment boundaries, and support for more document layouts. Arbitrary scanned PDFs are still out of scope for now.

## Technology list

TypeScript, React, Vite, Zod, OpenAI Responses API, GPT-5.6 Sol, OpenAI Realtime WebRTC, pdf-lib, DOCX adapters, Vitest, Playwright, axe-core, Docker, and Render Blueprint infrastructure.

## Prior-work disclosure

VocaForm had a local Node.js prototype before Build Week. Commit `cd2b782` is the dated pre-event baseline. The preserved `src/` and `public/` code is not claimed as new work. The Build Week rebuild begins at `ca05d21` and lives primarily in `app/`, with the prototype retained behind tested adapters until equivalent behavior is proven.
