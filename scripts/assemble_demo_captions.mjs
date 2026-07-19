import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("work/video");
const scenes = [
  { video: "final/scenes/scene-01.mp4", captions: "heygen/scenes/scene-01-paused.srt" },
  { video: "final/scenes/scene-02.mp4", captions: "heygen/scenes/scene-02.srt" },
  { video: "final/scenes/scene-03.mp4", captions: "heygen/scenes/scene-03.srt" },
  { video: "final/scenes/scene-04.mp4", captions: "heygen/scenes/scene-04.srt" },
  { video: "final/scenes/scene-05.mp4", captions: "heygen/scenes/scene-05.srt" },
  { video: "final/scenes/scene-06.mp4", captions: "heygen/scenes/scene-06.srt" },
  { video: "final/scenes/scene-07.mp4", captions: "heygen/scenes/scene-07-final.srt" }
];

let cueNumber = 1;
let offsetMs = 0;
const output = [];

for (const scene of scenes) {
  const captionText = await readFile(path.join(root, scene.captions), "utf8");
  for (const cue of parseSrt(captionText)) {
    output.push(String(cueNumber));
    output.push(`${formatTime(cue.startMs + offsetMs)} --> ${formatTime(cue.endMs + offsetMs)}`);
    output.push(...cue.lines, "");
    cueNumber += 1;
  }
  offsetMs += Math.round(readDurationSeconds(path.join(root, scene.video)) * 1_000);
}

const destination = path.join(root, "final", "vocaform-demo.en.srt");
await writeFile(destination, `${output.join("\n").trim()}\n`);
process.stdout.write(`${destination}\n`);

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
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1_000)
    + Number(match[4]);
}

function formatTime(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function readDurationSeconds(filePath) {
  return Number(execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8" }).trim());
}
