# VocaForm HeyGen and YouTube Demo Plan

**Prepared:** July 15, 2026<br>
**Final master:** 2:27, landscape 16:9, 1080p; local upload package: `work/video/iterations/v6-submission-final/vocaform-submission-final-demo.mp4`<br>
**Final YouTube upload:** [youtu.be/Dh-6t_kKioM](https://youtu.be/Dh-6t_kKioM)<br>
**Hard submission constraint:** under three minutes, showing the working project with narration explaining VocaForm, Codex, and GPT-5.6

**Final revision:** The complete web-form workflow in roadmap Goals 1–6A was built after the original submission video and first published through Devpost's **Add feature** entry. The corrected final demo now covers the document journey and the public Google and Microsoft Forms workflow together. Goal 6B remains long term and is not represented.

The final narration and scene plan are in [`demo/HEYGEN_SCRIPT.md`](./demo/HEYGEN_SCRIPT.md). Upload the reviewed [`vocaform-demo.en.srt`](./demo/vocaform-demo.en.srt) as the YouTube caption track.

## Recommended HeyGen workflow

Use **HeyGen AI Studio**, not a fully generated marketing video, as the final editor. The proof must be the real VocaForm product journey.

1. Record the working VocaForm flow in landscape with synthetic data. HeyGen's Screen Recorder can capture a tab, window, or full screen with optional microphone audio, then turn the capture into editable scenes that can be trimmed or split. An existing MP4 can also be uploaded if a local recorder produces a cleaner take. [Official Screen Recorder guide](https://help.heygen.com/en/articles/14251628-how-to-use-screen-recorder-in-ai-studio)
2. Keep the actual app full-screen through the core demo. Use an avatar only for the 10–15 second introduction and optional closing so it does not cover product evidence. AI Studio supports landscape projects, scene scripts, uploaded video, text, and per-scene media. [Official AI Studio overview](https://help.heygen.com/en/articles/11049655-overview-our-new-ai-studio)
3. Use either the original recorded voice, a public HeyGen voice, or a personal voice clone. Voice Mirroring is useful if the original performance has the right emphasis but needs a cleaner generated voice. Preview every scene's audio before rendering and split long narration into short scenes. [Voice options](https://help.heygen.com/en/articles/11202248-using-voices-in-the-ai-studio), [Voice Mirroring guide](https://help.heygen.com/en/articles/11408956-how-to-use-voice-mirroring-and-voice-director)
4. Write one script segment per scene. HeyGen supports explicit pauses in 0.5-second increments, which is useful before visual transitions and proof metrics. [AI Studio script guide](https://help.heygen.com/en/articles/11381771-how-to-write-scripts-in-the-ai-studio)
5. Add restrained, high-contrast captions. Stylized AI Studio captions are rendered into avatar videos; HeyGen also permits downloading an SRT file. Upload the reviewed SRT separately to YouTube so viewers can toggle accessible captions. [Caption guide](https://help.heygen.com/en/articles/8305536-how-to-use-captions), [download/export guide](https://help.heygen.com/en/articles/9834825-how-to-download-or-export-a-video)
6. Export at 1080p. Download the MP4 from HeyGen, upload it to YouTube, and set visibility to **Public**. HeyGen documents distribution to other platforms but does not document direct YouTube publishing, so plan on the manual upload. 4K is unnecessary and plan-limited. [Download/export guide](https://help.heygen.com/en/articles/9834825-how-to-download-or-export-a-video)

### Optional Video Agent use

Video Agent can generate a landscape video up to three minutes from a full script and supplied screenshots or clips. It may make small script edits and initially controls visuals automatically, so use it only for a first storyboard. Tell it to use the supplied VocaForm recordings, use no avatar or limit the avatar to intro/outro after opening the result in AI Studio, and replace any generated product imagery with the real screencast. [Video Agent overview](https://help.heygen.com/en/articles/12402907-how-to-get-started-with-video-agent), [prompting guide](https://help.heygen.com/en/articles/13566094-video-agent-prompting-guide)

## Capture preparation

- Use only the reviewed synthetic medical, permission, and school fixtures.
- Start from an empty Memory Vault and a clean browser window.
- Set the browser to a readable 1440×900 or 1920×1080 capture size and increase pointer visibility if needed.
- Close personal tabs, notifications, password managers, `.env` files, API dashboards, terminal history, and any screen containing keys or private identifiers.
- Preload the medical fixture or uploaded synthetic PDF, but capture the real upload/compilation transition.
- Rehearse the voice answers so the interview reaches verification without dead time.
- Pre-create the three approved guardian contact claims needed for the second-form reuse beat, or include the short consent interaction if timing permits.
- Open the completed PDF once before recording to confirm the viewer and zoom level are stable.
- Keep each raw capture several seconds longer than needed at both ends for trimming.

HeyGen is an external cloud service. Upload only synthetic screen recordings, scripts, images, and audio that are safe to share with that service.

## Pre-production timing budget

This table records the original timing budget, not the final chapter markers. The final 2:27 scene timings and narration are recorded in [`demo/HEYGEN_SCRIPT.md`](./demo/HEYGEN_SCRIPT.md). Do not target exactly 3:00; YouTube and export timing need margin.

| Time | Visual | Narration must establish |
| --- | --- | --- |
| 0:00–0:15 | Clean title card; optional small HeyGen avatar | Paperwork is difficult for people who find forms, typing, or administrative language inaccessible. VocaForm turns a form into one calm conversation and a completed document. |
| 0:15–0:40 | Upload the synthetic medical PDF; show the grounded readiness result | GPT-5.6 Sol reads text and layout, returns strict structured fields, dependencies, source evidence, and render targets. No manual schema mapping. |
| 0:40–1:35 | Start voice; show Listening/Thinking/Speaking/Saving states and answers appearing | This is a real Realtime conversation. Versioned application tools save grounded answers atomically; interrupted or duplicated calls cannot silently double-write. Text remains an equal fallback. |
| 1:35–2:05 | Review, run final verification, then download and briefly open the completed PDF | Deterministic checks and a non-mutating GPT-5.6 Sol review catch missing, contradictory, ambiguous, or unsupported answers. The copied AcroForm PDF is filled only after the current session passes. |
| 2:05–2:25 | Open the school form; show three suggestions and confirm one or all | Memory is application-owned and opt-in. Only three approved contact facts are suggested; each is confirmed before reuse. Medical and sensitive answers were not stored. |
| 2:25–2:42 | Brief architecture/quality card over the app or repository | Codex with GPT-5.6 accelerated the TypeScript rebuild, adapter parity, accessibility work, golden evaluations, and resilience automation. Human decisions defined privacy, consent, model roles, and scope cuts. |
| 2:42–2:50 | Product closing frame and URL | VocaForm: upload, talk, review, download—paperwork made human. |

## Required wording checkpoints

The narration must say all of the following clearly; on-screen labels alone are insufficient:

- **What was built:** “VocaForm turns an uploaded everyday form into a voice-guided interview and returns a verified completed document.”
- **How GPT-5.6 is used in the product:** “GPT-5.6 Sol compiles unfamiliar forms into an evidence-backed schema and performs a separate non-mutating semantic verification before final export.”
- **How Codex was used to build it:** “I used Codex with GPT-5.6 to rebuild the prototype as a modular TypeScript application, preserve the proven document logic through adapters, and create the accessibility, evaluation, and resilience gates.”
- **Where human judgment remained:** “I kept consent, memory, validation, application state, and rendering authoritative in code; the models cannot silently save memory or change an answer.”
- **Why it matters:** name the audience and the concrete reduction in form burden rather than describing it as a generic AI assistant.

Do not imply that Realtime is GPT-5.6 Sol. Realtime conducts the low-latency conversation; GPT-5.6 Sol owns form compilation and final semantic review; application code owns state, consent, validation, and rendering.

## HeyGen editing notes

- Prefer hard cuts or short dissolves; avoid stock footage during product proof.
- Keep the avatar below 15–20% of total screen time.
- Use the VocaForm green only for small accents and use the existing logo asset rather than regenerating the brand.
- Freeze the app frame briefly when showing the compiler result, verified export state, memory suggestions, and proof metrics.
- Use audio preview before full rendering; avatar animation requires a rendered preview and may consume plan credits.
- Add pronunciation guidance for “VocaForm,” “Codex,” “GPT-5.6 Sol,” “Realtime,” “AcroForm,” and “WCAG.”
- Keep narration calm and slightly brisk. Remove filler words, but retain natural pauses around the model-role explanation.
- Avoid background music. If music is used, keep it very low and retain its license: HeyGen warns that Pixabay or Storyblocks tracks can trigger YouTube Content ID claims. [HeyGen YouTube Content ID guidance](https://help.heygen.com/en/articles/8986144-content-id-claims-on-youtube)

## Suggested YouTube metadata

**Title**

> VocaForm — Accessible Forms by Voice | Final Build Week Demo

**Description draft**

> VocaForm turns uploaded documents and public web forms into a calm, accessible voice conversation. It returns a reviewed completed document or prepares a supported Google or Microsoft Form for the user's final submission.
>
> GPT-5.6 Sol compiles unfamiliar forms and performs a separate, non-mutating semantic review. OpenAI Realtime conducts the voice interview. Deterministic application code owns answers, validation, consent, memory, rendering, and the final submission boundary.
>
> Built with Codex and GPT-5.6 for OpenAI Build Week — Apps for Your Life.
>
> Code: https://github.com/Timverhoogt/VocaForm<br>
> Demo: https://vocaform-build-week.onrender.com/

**Optional chapters**

```text
0:00 Why VocaForm
0:22 Documents and public responder links
0:40 Realtime voice demonstration
1:03 Verification and completed PDF
1:24 Safe Memory Vault reuse
1:40 Google and Microsoft Forms
1:58 How I used Codex and GPT-5.6
```

## Final YouTube and Devpost checklist

- [x] Final runtime is below 2:55 and definitely below 3:00 before YouTube processing (2:27).
- [x] Upload the 2:27 final master for final review.
- [x] Visibility is **Public** after the final unlisted review (verified signed out on July 18, 2026).
- [x] 1080p processing has completed.
- [x] The video visibly shows the real application working.
- [x] Spoken narration explicitly covers VocaForm, how Codex was used, and how GPT-5.6 was used.
- [x] Captions are proofread and the final English SRT is available on YouTube as a toggleable caption track.
- [x] No keys, private identifiers, real family/medical data, or private browser UI appear.
- [x] The completed PDF is opened briefly and is legible.
- [x] The repository link is correct and publicly accessible.
- [ ] The description contains no placeholders.
- [ ] YouTube reports no blocking Content ID or copyright issue.
- [x] The public URL works without an authenticated YouTube session.
- [x] The final URL is recorded in the repository submission documents.
- [x] The same final URL is saved in the published Devpost project (verified through Devpost on July 18, 2026).

Final URL: https://youtu.be/Dh-6t_kKioM
