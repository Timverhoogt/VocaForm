import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const apiBaseUrl = "https://api.heygen.com";
const pollIntervalMs = 5_000;
const timeoutMs = 15 * 60_000;

function readEnvValue(contents, name) {
  const prefix = `${name}=`;
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? "";
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

function validateManifest(manifest) {
  if (!manifest?.scene || !manifest?.output_filename || !manifest?.idempotency_key) {
    throw new Error("Scene manifest is missing required metadata");
  }
  if (manifest?.request?.type !== "avatar" || !manifest?.request?.avatar_id) {
    throw new Error("Scene manifest must contain an avatar video request");
  }
}

async function main() {
  const manifestArgument = process.argv[2];
  if (!manifestArgument) {
    throw new Error("Usage: node scripts/heygen_render_scene.mjs <scene-manifest.json>");
  }

  const manifestPath = resolve(manifestArgument);
  const [secretContents, manifestContents] = await Promise.all([
    readFile("work/secrets/heygen.env", "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const apiKey = readEnvValue(secretContents, "HEYGEN_API_KEY");
  if (!apiKey.startsWith("sk_") || /\s/.test(apiKey)) {
    throw new Error("work/secrets/heygen.env does not contain a valid HeyGen key");
  }

  const manifest = JSON.parse(manifestContents);
  validateManifest(manifest);
  const outputDirectory = dirname(manifestPath);
  await mkdir(outputDirectory, { recursive: true });

  const created = await requestJson("/v3/videos", apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": manifest.idempotency_key,
    },
    body: JSON.stringify(manifest.request),
  });
  const videoId = created?.data?.video_id;
  if (!videoId) {
    throw new Error("HeyGen did not return a video ID");
  }

  await writeFile(
    join(outputDirectory, `${manifest.scene}-job.json`),
    `${JSON.stringify(created, null, 2)}\n`,
  );
  console.log(`Submitted ${manifest.scene}: ${videoId}`);

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
      join(outputDirectory, `${manifest.scene}-result.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );

    if (status === "completed") {
      if (!video.video_url) {
        throw new Error("Completed video has no download URL");
      }
      const outputPath = join(outputDirectory, basename(manifest.output_filename));
      await downloadFile(video.video_url, outputPath);
      if (video.subtitle_url) {
        await downloadFile(video.subtitle_url, join(outputDirectory, `${manifest.scene}.srt`));
      }
      console.log(`Downloaded ${outputPath}`);
      return;
    }

    if (status === "failed") {
      const reason = video.failure?.message ?? video.error?.message ?? "unknown failure";
      throw new Error(`HeyGen render failed: ${reason}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for ${manifest.scene}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
