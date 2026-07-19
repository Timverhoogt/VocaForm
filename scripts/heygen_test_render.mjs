import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const apiBaseUrl = "https://api.heygen.com";
const outputDirectory = "work/video/heygen/test";
const idempotencyKey = "vocaform-avatar-test-c20c5cd8-v1";
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;

function readEnvValue(contents, name) {
  const prefix = `${name}=`;
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? "";
}

async function readConfiguration() {
  const [secretContents, selectionContents] = await Promise.all([
    readFile("work/secrets/heygen.env", "utf8"),
    readFile("work/video/heygen/selection.json", "utf8"),
  ]);
  const apiKey = readEnvValue(secretContents, "HEYGEN_API_KEY");
  if (!apiKey.startsWith("sk_") || /\s/.test(apiKey)) {
    throw new Error("work/secrets/heygen.env does not contain a valid HeyGen key");
  }
  return { apiKey, selection: JSON.parse(selectionContents) };
}

async function requestJson(path, apiKey, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
    throw new Error(`HeyGen request failed: ${message}`);
  }
  return payload;
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  const { apiKey, selection } = await readConfiguration();
  await mkdir(outputDirectory, { recursive: true });

  const request = {
    type: "avatar",
    avatar_id: selection.avatar_id,
    title: "VocaForm avatar API test",
    resolution: "720p",
    aspect_ratio: "16:9",
    fit: "cover",
    output_format: "mp4",
    script: "Welcome to VocaForm. Let's make complex forms feel simple.",
    voice_id: selection.voice_id,
    voice_settings: {
      speed: 1,
    },
    expressiveness: "medium",
  };

  await writeFile(
    join(outputDirectory, "request.json"),
    `${JSON.stringify(request, null, 2)}\n`,
  );

  const created = await requestJson("/v3/videos", apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(request),
  });
  const videoId = created?.data?.video_id;
  if (!videoId) {
    throw new Error("HeyGen did not return a video ID");
  }

  await writeFile(
    join(outputDirectory, "job.json"),
    `${JSON.stringify(created, null, 2)}\n`,
  );
  console.log(`Submitted test video ${videoId}`);

  const startedAt = Date.now();
  let previousStatus = "";
  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestJson(`/v3/videos/${videoId}`, apiKey);
    const video = result?.data ?? result;
    const status = video.status ?? "unknown";
    if (status !== previousStatus) {
      console.log(`Status: ${status}`);
      previousStatus = status;
    }

    await writeFile(
      join(outputDirectory, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );

    if (status === "completed") {
      if (!video.video_url) {
        throw new Error("Completed video has no download URL");
      }
      const videoPath = join(outputDirectory, "vocaform-avatar-test.mp4");
      await downloadFile(video.video_url, videoPath);
      if (video.subtitle_url) {
        await downloadFile(
          video.subtitle_url,
          join(outputDirectory, "vocaform-avatar-test.srt"),
        );
      }
      console.log(`Downloaded ${videoPath}`);
      return;
    }

    if (status === "failed") {
      const reason = video.failure?.message ?? video.error?.message ?? "unknown failure";
      throw new Error(`HeyGen render failed: ${reason}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for the HeyGen test render");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
