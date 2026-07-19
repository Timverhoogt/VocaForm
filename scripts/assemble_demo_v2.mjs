import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("work/video/iterations/v2");
const introVariant = process.env.VOCAFORM_INTRO_VARIANT ?? "standard";
const accessibilityCommercial = introVariant === "accessibility-commercial";
const inclusiveCommercial = introVariant === "inclusive-commercial";
const commercialIntro = accessibilityCommercial || inclusiveCommercial;
const outputStem = inclusiveCommercial
  ? "vocaform-demo-v2-inclusive-commercial"
  : accessibilityCommercial
    ? "vocaform-demo-v2-accessibility-commercial"
    : "vocaform-demo-v2";
const sceneDirectory = path.join(
  root,
  commercialIntro ? `scenes-${introVariant}` : "scenes",
);
const heygenDirectory = path.join(root, "heygen");
const productDirectory = path.join(root, "product");
const assetDirectory = path.resolve("work/video/heygen-assets");
const legacyProductDirectory = path.resolve("work/video/product");

await mkdir(sceneDirectory, { recursive: true });

const sceneTargets = [
  inclusiveCommercial ? 22.7 : accessibilityCommercial ? 20.5 : 15.5,
  18.5,
  23.5,
  21.5,
  16.2,
  19,
  8.5,
];
const transitions = [0.55, 0.25, 0.25, 0.25, 0.55, 0.45];

buildScene01();
buildScene02();
buildScene03();
buildScene04();
buildScene05();
buildScene06();
buildScene07();

const sceneFiles = sceneTargets.map((_, index) => path.join(
  sceneDirectory,
  `scene-${String(index + 1).padStart(2, "0")}.mp4`,
));
const actualDurations = sceneFiles.map(readDurationSeconds);
const starts = [0];
for (let index = 1; index < actualDurations.length; index += 1) {
  starts.push(starts[index - 1] + actualDurations[index - 1] - transitions[index - 1]);
}

const noMusicPath = path.join(root, `${outputStem}-nomusic.mp4`);
assembleScenes(sceneFiles, actualDurations, noMusicPath);

const finalDuration = readDurationSeconds(noMusicPath);
const finalPath = path.join(root, `${outputStem}.mp4`);
addMusic(noMusicPath, finalPath, finalDuration, starts);
await assembleCaptions(starts, path.join(root, `${outputStem}.en.srt`));

await writeFile(path.join(root, commercialIntro
  ? `timeline-${introVariant}.json`
  : "timeline.json"), `${JSON.stringify({
  scenes: sceneFiles.map((file, index) => ({
    file: path.relative(root, file),
    start: starts[index],
    duration: actualDurations[index],
    transitionToNext: transitions[index] ?? 0,
  })),
  duration: readDurationSeconds(finalPath),
  music: {
    artist: "Alejandro Magaña (A. M.)",
    title: "Forest Mist Whispers",
    file: "music/forest-mist-whispers.mp3",
  },
}, null, 2)}\n`);

process.stdout.write(`${finalPath}\n`);

function buildScene01() {
  const duration = sceneTargets[0];
  const circleMask = "if(lte((X-344)*(X-344)+(Y-344)*(Y-344),118336),255,0)";
  const backgroundFilename = inclusiveCommercial
    ? "scene-01-inclusive-commercial.png"
    : accessibilityCommercial
      ? "scene-01-accessibility-commercial.png"
      : "scene-01-intro.png";
  const avatarFilename = inclusiveCommercial
    ? "scene-01-inclusive-commercial.mp4"
    : accessibilityCommercial
      ? "scene-01-accessibility-commercial.mp4"
      : "scene-01-avatar-v2.mp4";
  runFfmpeg([
    "-loop", "1", "-i", path.join(assetDirectory, backgroundFilename),
    "-i", path.join(heygenDirectory, avatarFilename),
    "-filter_complex",
    [
      "[0:v]fps=25,scale=1920:1080[bg]",
      `[1:v]crop=1080:1080:420:0,scale=688:688,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circleMask}'[avatar]`,
      `[bg][avatar]overlay=1166:182:shortest=1,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},zoompan=z='1+0.015*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-01.mp4"),
  ]);
}

function buildScene02() {
  const duration = sceneTargets[1];
  runFfmpeg([
    "-i", path.join(productDirectory, "scene-02-upload-understand.webm"),
    "-i", path.join(heygenDirectory, "scene-02-narration-v2.mp4"),
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},zoompan=z='1+0.012*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-02.mp4"),
  ]);
}

function buildScene03() {
  const duration = sceneTargets[2];
  runFfmpeg([
    "-i", path.join(productDirectory, "scene-03-voice-interview.webm"),
    "-i", path.join(heygenDirectory, "scene-03-narration-v2.mp4"),
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=PTS-STARTPTS,trim=duration=${duration},format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-03.mp4"),
  ]);
}

function buildScene04() {
  const duration = sceneTargets[3];
  runFfmpeg([
    "-i", path.join(productDirectory, "scene-04-review-verify-download.webm"),
    "-i", path.join(legacyProductDirectory, "scene-04-pdf-proof.mp4"),
    "-i", path.join(heygenDirectory, "scene-04-narration-v2-corrected.m4a"),
    "-filter_complex",
    [
      "[0:v]fps=25,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[review]",
      "[1:v]fps=25,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[proof]",
      `[review][proof]xfade=transition=fade:duration=0.42:offset=16.5,trim=duration=${duration}[v]`,
      `[2:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-04.mp4"),
  ]);
}

function buildScene05() {
  const duration = sceneTargets[4];
  runFfmpeg([
    "-i", path.join(productDirectory, "scene-05-memory.webm"),
    "-i", path.join(heygenDirectory, "scene-05-narration-v2.mp4"),
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},zoompan=z='1+0.008*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-05.mp4"),
  ]);
}

function buildScene06() {
  const duration = sceneTargets[5];
  const circleMask = "if(lte((X-208)*(X-208)+(Y-208)*(Y-208),43264),255,0)";
  runFfmpeg([
    "-loop", "1", "-i", path.join(assetDirectory, "scene-06-evidence.png"),
    "-i", path.join(heygenDirectory, "scene-06-avatar-v2.mp4"),
    "-filter_complex",
    [
      "[0:v]fps=25,scale=1920:1080[bg]",
      `[1:v]crop=1080:1080:420:0,scale=416:416,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circleMask}'[avatar]`,
      `[bg][avatar]overlay=1318:226:shortest=1,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},zoompan=z='1+0.008*on/(${duration}*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-06.mp4"),
  ]);
}

function buildScene07() {
  const duration = sceneTargets[6];
  runFfmpeg([
    "-i", path.join(heygenDirectory, "scene-07-avatar-v2-paced.mp4"),
    "-loop", "1", "-t", "5.8", "-i", path.join(assetDirectory, "scene-07-close.png"),
    "-loop", "1", "-t", "5.8", "-i", path.join(assetDirectory, "vocaform-mark.png"),
    "-filter_complex",
    [
      "[0:v]fps=25,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[avatar]",
      "[1:v]fps=25,scale=1920:1080,format=yuv420p[closebase]",
      "[2:v]fps=25,scale=220:220,format=rgba[mark]",
      "[closebase][mark]overlay=850:106:shortest=1,zoompan=z='1+0.012*on/(5.8*25)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=25,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[close]",
      `[avatar][close]xfade=transition=fade:duration=0.6:offset=2.7,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration}[v]`,
      `[0:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`,
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), path.join(sceneDirectory, "scene-07.mp4"),
  ]);
}

function assembleScenes(files, durations, destination) {
  const args = [];
  for (const file of files) args.push("-i", file);
  const filters = [];
  for (let index = 0; index < files.length; index += 1) {
    filters.push(`[${index}:v]fps=25,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
  }

  let videoLabel = "v0";
  let audioLabel = "a0";
  let cumulativeDuration = durations[0];
  for (let index = 1; index < files.length; index += 1) {
    const transition = transitions[index - 1];
    const offset = cumulativeDuration - transition;
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    filters.push(`[${videoLabel}][v${index}]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}[${nextVideo}]`);
    filters.push(`[${audioLabel}][a${index}]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`);
    videoLabel = nextVideo;
    audioLabel = nextAudio;
    cumulativeDuration += durations[index] - transition;
  }

  runFfmpeg([
    ...args,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    ...encodeArgs(), destination,
  ]);
}

function addMusic(source, destination, duration, sceneStarts) {
  const fadeOutStart = Math.max(0, duration - 1.2);
  const realtimeStart = sceneStarts[2];
  const realtimeEnd = sceneStarts[3];
  const evidenceStart = sceneStarts[5];
  const volume = `if(lt(t,${sceneStarts[1].toFixed(3)}),0.09,if(between(t,${realtimeStart.toFixed(3)},${realtimeEnd.toFixed(3)}),0.035,if(gte(t,${evidenceStart.toFixed(3)}),0.085,0.065)))`;
  runFfmpeg([
    "-i", source,
    "-i", path.join(root, "music", "forest-mist-whispers.mp3"),
    "-filter_complex",
    [
      "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[voice]",
      `[1:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume='${volume}':eval=frame,afade=t=in:st=0:d=0.9,afade=t=out:st=${fadeOutStart}:d=1.2[music]`,
      "[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]",
    ].join(";"),
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", destination,
  ]);
}

async function assembleCaptions(sceneStarts, destination) {
  const blocks = [];
  for (let index = 0; index < sceneStarts.length; index += 1) {
    const sceneNumber = String(index + 1).padStart(2, "0");
    const captionFilename = index === 0 && commercialIntro
      ? `scene-01-${introVariant}.srt`
      : index === 6
        ? "scene-07-v2-paced.srt"
        : `scene-${sceneNumber}-v2.srt`;
    const contents = await readFile(path.join(heygenDirectory, captionFilename), "utf8");
    const cues = parseSrt(contents);
    correctModelNameCaptions(index, cues);
    for (const cue of cues) {
      blocks.push({
        startMs: cue.startMs + Math.round(sceneStarts[index] * 1000),
        endMs: cue.endMs + Math.round(sceneStarts[index] * 1000),
        lines: cue.lines,
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

function correctModelNameCaptions(index, cues) {
  if (index === 1) {
    cues[3].lines = ["VocaForm uses GPT-5.6 Sol"];
    cues[4].lines = ["to understand what the form asks,"];
  }
  if (index === 3) {
    cues[2].lines = ["I correct it inline, then GPT-5.6 Sol"];
    cues[3].lines = ["runs a separate, non-mutating"];
    cues[4].lines = ["semantic review."];
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
      lines: lines.slice(2),
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
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
  ];
}

function readDurationSeconds(filePath) {
  return Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { encoding: "utf8" }).trim());
}

function runFfmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
}
