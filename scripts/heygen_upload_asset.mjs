import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

function readEnvValue(contents, name) {
  const prefix = `${name}=`;
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? "";
}

async function main() {
  const assetArgument = process.argv[2];
  const resultArgument = process.argv[3];
  if (!assetArgument || !resultArgument) {
    throw new Error("Usage: node scripts/heygen_upload_asset.mjs <asset-file> <result-json>");
  }

  const assetPath = resolve(assetArgument);
  const resultPath = resolve(resultArgument);
  const [secretContents, assetContents] = await Promise.all([
    readFile("work/secrets/heygen.env", "utf8"),
    readFile(assetPath),
  ]);
  const apiKey = readEnvValue(secretContents, "HEYGEN_API_KEY");
  if (!apiKey.startsWith("sk_") || /\s/.test(apiKey)) {
    throw new Error("work/secrets/heygen.env does not contain a valid HeyGen key");
  }

  const form = new FormData();
  form.append("file", new Blob([assetContents], { type: "audio/wav" }), basename(assetPath));
  const response = await fetch("https://api.heygen.com/v3/assets", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Idempotency-Key": "vocaform-final-close-explicit-pauses-audio-20260717-v1",
    },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`;
    throw new Error(`HeyGen asset upload failed: ${message}`);
  }

  await writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
