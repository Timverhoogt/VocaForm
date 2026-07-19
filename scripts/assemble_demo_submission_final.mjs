import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const v2Root = path.resolve("work/video/iterations/v2");
const v3Root = path.resolve("work/video/iterations/v3-webform-update");
const v5Root = path.resolve("work/video/iterations/v5-final");
const root = path.resolve("work/video/iterations/v6-submission-final");
const sceneDirectory = path.join(root, "scenes");
const productDirectory = path.join(v5Root, "product");
const heygenDirectory = path.join(v5Root, "heygen");
const submissionHeygenDirectory = path.join(root, "heygen");
const assetDirectory = path.resolve("work/video/heygen-assets");
const outputStem = "vocaform-submission-final-demo";
const realtimeMetadata = JSON.parse(await readFile(
  path.join(productDirectory, "scene-03-realtime-live.json"),
  "utf8"
));

const scene02Path = path.join(v5Root, "scenes", "scene-02-final.mp4");
const scene02Captions = path.join(v5Root, "scene-02-final-corrected.srt");
const scene03Path = path.join(v5Root, "scenes", "scene-03-final-realtime.mp4");
const scene03Captions = path.join(v5Root, "scene-03-final-realtime.srt");
const scene06Path = path.join(v5Root, "scenes", "scene-06-webform-final.mp4");
const scene07Path = path.join(sceneDirectory, "scene-07-codex-gpt-final.mp4");
const scene07Captions = path.join(root, "scene-07-codex-gpt-final.srt");
const scene08Path = path.join(v5Root, "scenes", "scene-08-close-final.mp4");

await mkdir(sceneDirectory, { recursive: true });
buildEvidenceScene();
await writeEvidenceCaptions();

const scenes = [
  legacyScene("intro", "scenes-inclusive-commercial/scene-01.mp4", "heygen/scene-01-inclusive-commercial.srt"),
  {
    id: "document",
    file: scene02Path,
    captions: scene02Captions
  },
  {
    id: "interview",
    file: scene03Path,
    captions: scene03Captions
  },
  legacyScene("review", "scenes-inclusive-commercial/scene-04.mp4", "heygen/scene-04-v2.srt"),
  legacyScene("memory", "scenes-inclusive-commercial/scene-05.mp4", "heygen/scene-05-v2.srt"),
  {
    id: "webform",
    file: scene06Path,
    captions: path.join(heygenDirectory, "scene-06-webform-final.srt")
  },
  {
    id: "evidence",
    file: scene07Path,
    captions: scene07Captions
  },
  {
    id: "close",
    file: scene08Path,
    captions: path.join(heygenDirectory, "scene-08-close-explicit-pauses.srt")
  }
];
const transitions = [0.55, 0.25, 0.25, 0.25, 0.35, 0.5, 0.45];
const durations = scenes.map((item) => readDurationSeconds(item.file));
const starts = [0];
for (let index = 1; index < scenes.length; index += 1) {
  starts.push(starts[index - 1] + durations[index - 1] - transitions[index - 1]);
}

const noMusicPath = path.join(root, `${outputStem}-nomusic.mp4`);
assembleScenes(scenes.map((item) => item.file), durations, transitions, noMusicPath);

const finalDuration = readDurationSeconds(noMusicPath);
const finalPath = path.join(root, `${outputStem}.mp4`);
addMusic(noMusicPath, finalPath, finalDuration, starts);
await assembleCaptions(scenes, starts, path.join(root, `${outputStem}.en.srt`));

await writeFile(path.join(root, "timeline.json"), `${JSON.stringify({
  scenes: scenes.map((item, index) => ({
    id: item.id,
    file: path.relative(root, item.file),
    start: starts[index],
    duration: durations[index],
    transitionToNext: transitions[index] ?? 0
  })),
  duration: readDurationSeconds(finalPath),
  editorial: {
    originalOpeningReviewMemoryAndClosePreserved: true,
    bothInputModesEstablishedInScene02: true,
    documentNarrationGptPronunciationCorrected: true,
    documentSecondParagraphRegeneratedInContext: true,
    documentMedicalPdfSpokenAsSinglePhrase: true,
    realtimeCaptureEnvironment: "local private-mode production build",
    realtimeToolWaitRemoved: true,
    liveVoiceFadeSeconds: 0.8,
    postSavedHoldSeconds: 0.53,
    webformCaptureReusedAndCompressed: true,
    evidenceUpdatedForGoals1Through6A: true,
    engineeringNarrationExplicitlyCoversCodexAndGpt56: true,
    codexUseIncludesApiResearchTypescriptBrowserAccessibilityAndRemoteWork: true,
    gpt56UseIncludesCompilationAndSeparateSemanticReview: true,
    evidenceAvatarRunsAtNativeTimingWithoutFrozenPadding: true,
    closingAvatarRegeneratedForContinuousMotion: true,
    closingAvatarShortPauseCadence: true,
    closingAudioUsesExplicitMeasuredPauses: true,
    closingAvatarMotionInterpolatedAcrossPauses: true
  },
  heygen: {
    apiVersion: "v3",
    engine: "avatar_v",
    narrationResolution: "1080p",
    visibleAvatarResolution: "4k",
    changedScenesFromPreviousUpload: ["evidence"],
    idempotencyProtected: true
  },
  music: {
    artist: "Alejandro Magaña (A. M.)",
    title: "Forest Mist Whispers",
    realtimeMusicReturnSeconds: 1.2
  }
}, null, 2)}\n`);

process.stdout.write(`${finalPath}\n`);

function legacyScene(id, videoPath, captionPath) {
  return {
    id,
    file: path.join(v2Root, videoPath),
    captions: path.join(v2Root, captionPath)
  };
}

function buildScene02() {
  const duration = 18.52;
  const firstParagraphEnd = 5.36;
  const paragraphPause = 0.25;
  const documentTermBreakStart = 2.295;
  const documentTermBreakEnd = 2.65;
  const documentSentenceBreak = 3.31;
  const documentSentencePause = 0.24;
  runFfmpeg([
    "-i", path.join(productDirectory, "scene-02-final-start.webm"),
    "-i", path.join(heygenDirectory, "scene-02-final-narration.mp4"),
    "-i", path.join(heygenDirectory, "scene-02-corrected-paragraph.mp4"),
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},zoompan=z='1+0.012*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]atrim=start=0:end=${firstParagraphEnd},asetpts=PTS-STARTPTS,aresample=48000,afade=t=out:st=${firstParagraphEnd - 0.04}:d=0.04[a0]`,
      `anullsrc=r=48000:cl=stereo:d=${paragraphPause}[pause]`,
      `[2:a]atrim=start=0:end=${documentTermBreakStart},asetpts=PTS-STARTPTS,aresample=48000,volume=1.15,afade=t=in:st=0:d=0.02[a1a]`,
      `[2:a]atrim=start=${documentTermBreakEnd}:end=${documentSentenceBreak},asetpts=PTS-STARTPTS,aresample=48000,volume=1.15[a1b]`,
      `anullsrc=r=48000:cl=stereo:d=${documentSentencePause}[sentencepause]`,
      `[2:a]atrim=start=${documentSentenceBreak},asetpts=PTS-STARTPTS,aresample=48000,volume=1.15[a1c]`,
      `[a0][pause][a1a][a1b][sentencepause][a1c]concat=n=6:v=0:a=1,apad=whole_dur=${duration},atrim=duration=${duration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), scene02Path
  ]);
}

async function writeDocumentCaptions() {
  await writeFile(scene02Captions, `1
00:00:00,000 --> 00:00:01,930
VocaForm can start from either an

2
00:00:02,000 --> 00:00:03,960
uploaded document or a public Google or

3
00:00:04,000 --> 00:00:05,210
Microsoft responder link.

4
00:00:05,610 --> 00:00:07,800
Here I choose a synthetic medical intake

5
00:00:07,825 --> 00:00:08,415
PDF.

6
00:00:08,945 --> 00:00:10,895
GPT-5.6 Sol

7
00:00:10,965 --> 00:00:12,175
identifies every question and

8
00:00:12,225 --> 00:00:14,095
requirement, while evidence checks block

9
00:00:14,155 --> 00:00:15,885
unsupported fields before the interview

10
00:00:15,925 --> 00:00:16,315
begins.
`);
}

function buildRealtimeScene() {
  const videoOffset = Number(realtimeMetadata.videoOffsetSeconds);
  const oldScene = path.join(v2Root, "scenes-inclusive-commercial", "scene-03.mp4");
  const liveVideo = path.join(productDirectory, "scene-03-realtime-live.webm");
  const liveAudio = path.join(productDirectory, "scene-03-realtime-live-audio.webm");
  const introEnd = 4.25;
  const liveAStart = 6.0;
  const liveAEnd = 13.2;
  const liveBStart = 20.75;
  const liveBEnd = 26.05;
  const outroStart = 14.06;
  const targetDuration = 23.52;
  const firstTransition = 0.65;
  const secondTransition = 0.25;
  const thirdTransition = 0.8;
  const firstOffset = 3.6;
  const secondOffset = 10.55;
  const thirdOffset = 15.05;

  runFfmpeg([
    "-i", oldScene,
    "-i", liveVideo,
    "-i", liveAudio,
    "-filter_complex",
    [
      `[0:v]trim=start=0:end=${introEnd},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v0]`,
      `[0:a]atrim=start=0:end=${introEnd},asetpts=PTS-STARTPTS[a0]`,
      `[1:v]trim=start=${videoOffset + liveAStart}:end=${videoOffset + liveAEnd},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v1]`,
      `[2:a]atrim=start=${liveAStart}:end=${liveAEnd},asetpts=PTS-STARTPTS,volume=0.58[a1]`,
      `[1:v]trim=start=${videoOffset + liveBStart}:end=${videoOffset + liveBEnd},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v2]`,
      `[2:a]atrim=start=${liveBStart}:end=${liveBEnd},asetpts=PTS-STARTPTS,volume=0.83,afade=t=out:st=4.5:d=${thirdTransition}[a2]`,
      `[0:v]trim=start=${outroStart}:end=${targetDuration},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v3]`,
      `[0:a]atrim=start=${outroStart}:end=${targetDuration},asetpts=PTS-STARTPTS,volume=1.2[a3]`,
      `[v0][v1]xfade=transition=fade:duration=${firstTransition}:offset=${firstOffset}[vx1]`,
      `[a0][a1]acrossfade=d=${firstTransition}:c1=tri:c2=tri[ax1]`,
      `[vx1][v2]xfade=transition=fade:duration=${secondTransition}:offset=${secondOffset}[vx2]`,
      `[ax1][a2]acrossfade=d=${secondTransition}:c1=tri:c2=tri[ax2]`,
      `[vx2][v3]xfade=transition=fade:duration=${thirdTransition}:offset=${thirdOffset},trim=duration=${targetDuration}[v]`,
      `[ax2][a3]acrossfade=d=${thirdTransition}:c1=tri:c2=tri,apad=whole_dur=${targetDuration},atrim=duration=${targetDuration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(targetDuration),
    ...encodeArgs(), scene03Path
  ]);
}

async function writeRealtimeCaptions() {
  await writeFile(scene03Captions, `1
00:00:00,000 --> 00:00:02,370
Now OpenAI Realtime guides the same

2
00:00:02,420 --> 00:00:03,810
medical interview by voice.

3
00:00:03,840 --> 00:00:05,260
VocaForm: What brings you in today?

4
00:00:05,900 --> 00:00:08,960
VocaForm: Just a brief description of
your main reason for the visit.

5
00:00:09,780 --> 00:00:10,440
User: Recurring headaches.

6
00:00:10,740 --> 00:00:13,600
VocaForm: Thanks. Let me record that,
and then we'll keep going.

7
00:00:14,300 --> 00:00:14,520
VocaForm: Saved.

8
00:00:15,050 --> 00:00:16,580
Every write passes through versioned

9
00:00:16,630 --> 00:00:17,480
application tools.

10
00:00:17,770 --> 00:00:19,670
Code—not the model—decides what is

11
00:00:19,690 --> 00:00:21,530
stored, and the keyboard path remains

12
00:00:21,590 --> 00:00:21,870
equal.
`);
}

function buildWebformScene() {
  const duration = 17.9;
  runFfmpeg([
    "-i", path.join(v3Root, "product", "scene-webform-update.webm"),
    "-i", path.join(heygenDirectory, "scene-06-webform-final-narration.mp4"),
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=0.8563*PTS,tpad=stop_mode=clone:stop_duration=1,trim=duration=${duration},format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), scene06Path
  ]);
}

function buildEvidenceScene() {
  const avatarPath = path.join(submissionHeygenDirectory, "scene-07-codex-gpt-final-avatar.mp4");
  const duration = readDurationSeconds(avatarPath);
  const circleMask = "if(lte((X-208)*(X-208)+(Y-208)*(Y-208),43264),255,0)";
  runFfmpeg([
    "-loop", "1", "-i", path.join(productDirectory, "scene-07-evidence-final.png"),
    "-i", avatarPath,
    "-filter_complex",
    [
      "[0:v]fps=25,scale=1920:1080[bg]",
      `[1:v]setpts=PTS-STARTPTS,crop=2160:2160:840:0,scale=416:416,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circleMask}'[avatar]`,
      `[bg][avatar]overlay=1318:226:shortest=1,trim=duration=${duration},zoompan=z='1+0.008*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]aresample=48000,atrim=duration=${duration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), scene07Path
  ]);
}

async function writeEvidenceCaptions() {
  await writeFile(scene07Captions, `1
00:00:00,000 --> 00:00:01,990
Codex became my build partner.

2
00:00:02,210 --> 00:00:04,610
I used it to research APIs, rebuild my

3
00:00:04,660 --> 00:00:06,270
prototype in modular TypeScript, and

4
00:00:06,320 --> 00:00:07,800
test browser and accessibility

5
00:00:07,850 --> 00:00:09,850
flows—even continuing remotely from my

6
00:00:09,900 --> 00:00:10,250
phone.

7
00:00:10,560 --> 00:00:13,200
Inside VocaForm, I used GPT-5.6 Sol

8
00:00:13,240 --> 00:00:15,300
to compile unfamiliar forms

9
00:00:15,350 --> 00:00:17,070
and run a separate semantic

10
00:00:17,110 --> 00:00:17,380
review.

11
00:00:17,590 --> 00:00:19,140
Together, they gave me speed without

12
00:00:19,190 --> 00:00:20,200
giving up human control.
`);
}

function buildCloseScene() {
  const duration = 8.52;
  const transition = 0.55;
  const transitionOffset = 3.05;
  runFfmpeg([
    "-i", path.join(heygenDirectory, "scene-08-close-explicit-pauses-retimed.mp4"),
    "-loop", "1", "-t", "5.8", "-i", path.join(assetDirectory, "scene-07-close.png"),
    "-loop", "1", "-t", "5.8", "-i", path.join(assetDirectory, "vocaform-mark.png"),
    "-filter_complex",
    [
      "[0:v]fps=25,scale=1920:1080,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[avatar]",
      "[1:v]fps=25,scale=1920:1080,format=yuv420p[closebase]",
      "[2:v]fps=25,scale=220:220,format=rgba[mark]",
      "[closebase][mark]overlay=850:106:shortest=1,zoompan=z='1+0.012*on/(5.8*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[close]",
      `[avatar][close]xfade=transition=fade:duration=${transition}:offset=${transitionOffset},tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration}[v]`,
      `[0:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), scene08Path
  ]);
}

function assembleScenes(files, sceneDurations, sceneTransitions, destination) {
  const args = [];
  for (const file of files) args.push("-i", file);
  const filters = [];
  for (let index = 0; index < files.length; index += 1) {
    filters.push(`[${index}:v]fps=25,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
  }

  let videoLabel = "v0";
  let audioLabel = "a0";
  let cumulativeDuration = sceneDurations[0];
  for (let index = 1; index < files.length; index += 1) {
    const transition = sceneTransitions[index - 1];
    const offset = cumulativeDuration - transition;
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    filters.push(`[${videoLabel}][v${index}]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}[${nextVideo}]`);
    filters.push(`[${audioLabel}][a${index}]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`);
    videoLabel = nextVideo;
    audioLabel = nextAudio;
    cumulativeDuration += sceneDurations[index] - transition;
  }

  runFfmpeg([
    ...args,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    ...encodeArgs(), destination
  ]);
}

function addMusic(source, destination, duration, sceneStarts) {
  const fadeOutStart = Math.max(0, duration - 1.2);
  const realtimeStart = sceneStarts[2];
  const liveMusicFadeStart = realtimeStart + 2.8;
  const liveMusicQuiet = realtimeStart + 3.6;
  const musicReturnStart = realtimeStart + 15.05;
  const musicReturnEnd = musicReturnStart + 1.2;
  const evidenceStart = sceneStarts[6];
  const normalMusic = 0.065;
  const volume = [
    `if(lt(t,${sceneStarts[1].toFixed(3)}),0.09,`,
    `if(between(t,${liveMusicFadeStart.toFixed(3)},${liveMusicQuiet.toFixed(3)}),${normalMusic}*(${liveMusicQuiet.toFixed(3)}-t)/0.8,`,
    `if(between(t,${liveMusicQuiet.toFixed(3)},${musicReturnStart.toFixed(3)}),0,`,
    `if(between(t,${musicReturnStart.toFixed(3)},${musicReturnEnd.toFixed(3)}),${normalMusic}*(t-${musicReturnStart.toFixed(3)})/1.2,`,
    `if(gte(t,${evidenceStart.toFixed(3)}),0.085,${normalMusic})))))`
  ].join("");
  runFfmpeg([
    "-i", source,
    "-i", path.join(v2Root, "music", "forest-mist-whispers.mp3"),
    "-filter_complex",
    [
      "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[voice]",
      `[1:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume='${volume}':eval=frame,afade=t=in:st=0:d=0.9,afade=t=out:st=${fadeOutStart}:d=1.2[music]`,
      "[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]"
    ].join(";"),
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-ar", "48000", "-movflags", "+faststart", destination
  ]);
}

async function assembleCaptions(sceneDefinitions, sceneStarts, destination) {
  const blocks = [];
  for (let index = 0; index < sceneDefinitions.length; index += 1) {
    const contents = await readFile(sceneDefinitions[index].captions, "utf8");
    const cues = parseSrt(contents);
    correctEditorialCaptions(sceneDefinitions[index].id, cues);
    for (const cue of cues) {
      blocks.push({
        startMs: cue.startMs + Math.round(sceneStarts[index] * 1000),
        endMs: cue.endMs + Math.round(sceneStarts[index] * 1000),
        lines: cue.lines
      });
    }
  }
  blocks.sort((left, right) => left.startMs - right.startMs);
  const output = [];
  for (let index = 0; index < blocks.length; index += 1) {
    output.push(String(index + 1));
    output.push(`${formatTime(blocks[index].startMs)} --> ${formatTime(blocks[index].endMs)}`);
    output.push(...blocks[index].lines, "");
  }
  await writeFile(destination, `${output.join("\n").trim()}\n`);
}

function correctEditorialCaptions(id, cues) {
  if (id === "document" && cues.length >= 7) {
    cues[4].lines = ["PDF."];
    cues[5].lines = ["GPT-5.6 Sol"];
  }
  if (id === "review" && cues.length >= 5) {
    cues[2].lines = ["I correct it inline, then GPT-5.6 Sol"];
    cues[3].lines = ["runs a separate, non-mutating"];
    cues[4].lines = ["semantic review."];
  }
  if (id === "close") {
    const lines = ["VocaForm.", "One form.", "One conversation.", "Done."];
    for (let index = 0; index < Math.min(cues.length, lines.length); index += 1) {
      cues[index].lines = [lines[index]];
    }
  }
}

function parseSrt(contents) {
  return contents.trim().split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const timing = lines[1]?.match(/^(.+?) --> (.+)$/);
    if (!timing) throw new Error(`Invalid SRT block: ${block}`);
    return {
      startMs: parseTime(timing[1]),
      endMs: parseTime(timing[2]),
      lines: lines.slice(2)
    };
  });
}

function parseTime(value) {
  const match = value.match(/^(\d+):(\d+):(\d+),(\d+)$/);
  if (!match) throw new Error(`Invalid SRT time: ${value}`);
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000)
    + Number(match[4]);
}

function formatTime(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function encodeArgs() {
  return [
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart"
  ];
}

function readDurationSeconds(filePath) {
  return Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath
  ], { encoding: "utf8" }).trim());
}

function runFfmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit"
  });
}
