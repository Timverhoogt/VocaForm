import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const apiBaseUrl = "https://api.heygen.com";

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
  if (!manifest?.scene || !manifest?.output_filename) {
    throw new Error("Speech manifest is missing required metadata");
  }
  if (!manifest?.request?.text || !manifest?.request?.voice_id) {
    throw new Error("Speech manifest must contain text and voice_id");
  }
}

async function main() {
  const manifestArgument = process.argv[2];
  if (!manifestArgument) {
    throw new Error("Usage: node scripts/heygen_render_speech.mjs <speech-manifest.json>");
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

  const result = await requestJson("/v3/voices/speech", apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(manifest.request),
  });
  const speech = result?.data ?? result;
  if (!speech.audio_url) {
    throw new Error("HeyGen speech generation returned no audio URL");
  }

  await writeFile(
    join(outputDirectory, `${manifest.scene}-speech-result.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const outputPath = join(outputDirectory, basename(manifest.output_filename));
  await downloadFile(speech.audio_url, outputPath);
  console.log(`Downloaded ${outputPath}`);
  console.log(`Duration: ${speech.duration}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
