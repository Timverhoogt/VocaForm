import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const v2Root = path.resolve("work/video/iterations/v2");
const root = path.resolve("work/video/iterations/v3-webform-update");
const sceneDirectory = path.join(root, "scenes");
const productVideo = path.join(root, "product", "scene-webform-update.webm");
const updateNarration = path.join(root, "heygen", "scene-webform-update-narration.mp4");
const updateCaptions = path.join(root, "heygen", "scene-webform-update.srt");
const updateScene = path.join(sceneDirectory, "scene-06-webform-update.mp4");
const outputStem = "vocaform-demo-webform-update";

await mkdir(sceneDirectory, { recursive: true });

const narrationDuration = readDurationSeconds(updateNarration);
const updateDuration = Math.max(22.5, narrationDuration + 0.65);
buildUpdateScene(updateDuration);

const scenes = [
  scene("intro", "scenes-inclusive-commercial/scene-01.mp4", "heygen/scene-01-inclusive-commercial.srt"),
  scene("document", "scenes-inclusive-commercial/scene-02.mp4", "heygen/scene-02-v2.srt"),
  scene("interview", "scenes-inclusive-commercial/scene-03.mp4", "heygen/scene-03-v2.srt"),
  scene("review", "scenes-inclusive-commercial/scene-04.mp4", "heygen/scene-04-v2.srt"),
  scene("memory", "scenes-inclusive-commercial/scene-05.mp4", "heygen/scene-05-v2.srt"),
  {
    id: "webform",
    file: updateScene,
    captions: updateCaptions
  },
  scene("evidence", "scenes-inclusive-commercial/scene-06.mp4", "heygen/scene-06-v2.srt"),
  scene("close", "scenes-inclusive-commercial/scene-07.mp4", "heygen/scene-07-v2-paced.srt")
];
const transitions = [0.55, 0.25, 0.25, 0.25, 0.35, 0.55, 0.45];
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
  update: {
    narrationDuration,
    creditsProtectedByIdempotencyKey: true,
    regeneratedExistingScenes: false
  },
  music: {
    artist: "Alejandro Magaña (A. M.)",
    title: "Forest Mist Whispers",
    file: path.relative(root, path.join(v2Root, "music", "forest-mist-whispers.mp3"))
  }
}, null, 2)}\n`);

process.stdout.write(`${finalPath}\n`);

function scene(id, videoPath, captionPath) {
  return {
    id,
    file: path.join(v2Root, videoPath),
    captions: path.join(v2Root, captionPath)
  };
}

function buildUpdateScene(duration) {
  runFfmpeg([
    "-i", productVideo,
    "-i", updateNarration,
    "-filter_complex",
    [
      `[0:v]fps=25,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},format=yuv420p[v]`,
      `[1:a]aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration}[a]`
    ].join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(duration),
    ...encodeArgs(), updateScene
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
    filters.push(
      `[${videoLabel}][v${index}]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}[${nextVideo}]`
    );
    filters.push(
      `[${audioLabel}][a${index}]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`
    );
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
  const realtimeEnd = sceneStarts[3];
  const evidenceStart = sceneStarts[6];
  const volume = `if(lt(t,${sceneStarts[1].toFixed(3)}),0.09,if(between(t,${realtimeStart.toFixed(3)},${realtimeEnd.toFixed(3)}),0.035,if(gte(t,${evidenceStart.toFixed(3)}),0.085,0.065)))`;
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
    correctModelNameCaptions(sceneDefinitions[index].id, cues);
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

function correctModelNameCaptions(id, cues) {
  if (id === "document" && cues.length >= 5) {
    cues[3].lines = ["VocaForm uses GPT-5.6 Sol"];
    cues[4].lines = ["to understand what the form asks,"];
  }
  if (id === "review" && cues.length >= 5) {
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
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "25",
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
