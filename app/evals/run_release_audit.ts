import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };

const resultSchema = z.object({
  detectedExpectedFields: z.number().int().nonnegative(),
  detectedRequiredFields: z.number().int().nonnegative(),
  expectedFields: z.number().int().nonnegative(),
  fabricatedFieldIds: z.array(z.string()),
  missingDependencies: z.array(z.string()),
  missingFieldIds: z.array(z.string()),
  missingRequiredFieldIds: z.array(z.string()),
  requiredFields: z.number().int().nonnegative()
});

const liveCompilerEvidenceSchema = z.object({
  model: z.string(),
  sourceCommit: z.string(),
  results: z.array(resultSchema),
  aggregate: resultSchema.extend({
    fieldRecallPercent: z.number(),
    requiredRecallPercent: z.number()
  })
});

const requiredFiles = [
  ".dockerignore",
  ".env.example",
  "DEMO_VIDEO_PLAN.md",
  "DEVPOST_SUBMISSION.md",
  "Dockerfile",
  "EXPORT_ACCESSIBILITY_REVIEW.md",
  "LICENSE",
  "PRE_SUBMISSION_REVIEW.md",
  "README.md",
  "SCREEN_READER_REVIEW.md",
  "SUBMISSION_CHECKLIST.md",
  "SUBMISSION_EVIDENCE.md",
  "app/server/public_demo_rate_limit.ts",
  "app/server/visitor_state.ts",
  "app/evals/capture_forced_colors.ts",
  "data/golden/live_compiler_2026-07-15.json",
  "demo/DEMO_SCRIPT.md",
  "demo/vocaform-demo.en.srt",
  "render.yaml"
];

const postCandidateMetadataFiles = new Set([
  "BUILD_WEEK_ROADMAP.md",
  "DEMO_VIDEO_PLAN.md",
  "DEVPOST_SUBMISSION.md",
  "PRE_SUBMISSION_REVIEW.md",
  "SCREEN_READER_REVIEW.md",
  "SUBMISSION_CHECKLIST.md",
  "SUBMISSION_EVIDENCE.md"
]);

const files = new Map(await Promise.all(requiredFiles.map(async (filePath) => [
  filePath,
  await readFile(filePath, "utf8")
] as const)));
const parsedEvidence: unknown = JSON.parse(file("data/golden/live_compiler_2026-07-15.json"));
const evidence = liveCompilerEvidenceSchema.parse(parsedEvidence);
const finalSubmissionAudit = process.argv.includes("--final");
const finalExperienceAudit = finalSubmissionAudit || process.argv.includes("--experience-final");

assert(packageJson.private === true, "The package must remain private to prevent accidental npm publication.");
assert(packageJson.engines?.node === ">=20", "The documented Node.js floor must remain >=20.");
assert(Boolean(packageJson.scripts["check:submission"]), "package.json must expose check:submission.");
assert(Boolean(packageJson.scripts["check:experience"]), "package.json must expose check:experience.");
assert(Boolean(packageJson.scripts["check:release"]), "package.json must expose check:release.");

const readme = file("README.md");
for (const heading of [
  "## The problem",
  "## How GPT-5.6 is used",
  "## How Codex accelerated the build",
  "## Prior work vs. Build Week work",
  "## Judge quick start",
  "## Privacy and accessibility",
  "## Current limitations"
]) {
  assert(readme.includes(heading), `README is missing ${heading}.`);
}
assert(readme.includes("cd2b782"), "README must identify the pre-event baseline.");
assert(readme.includes("ca05d21"), "README must identify the Build Week range.");
assert(!/\[(?:PUBLIC|JUDGE|VIDEO|DEMO)_[A-Z_]+\]/.test(readme), "README contains a submission placeholder.");

assert(evidence.model === "gpt-5.6-sol", "Live compiler evidence must identify gpt-5.6-sol.");
assert(/^[a-f0-9]{40}$/.test(evidence.sourceCommit), "Live compiler evidence needs an exact source commit.");
assert(evidence.results.length === 3, "Live compiler evidence must cover all three golden forms.");
assert(evidence.results.every((result) =>
  result.detectedExpectedFields === result.expectedFields
  && result.detectedRequiredFields === result.requiredFields
  && result.fabricatedFieldIds.length === 0
  && result.missingFieldIds.length === 0
  && result.missingRequiredFieldIds.length === 0
  && result.missingDependencies.length === 0
), "At least one live compiler fixture does not meet the release gate.");
assert(evidence.aggregate.expectedFields === 53 && evidence.aggregate.detectedExpectedFields === 53,
  "Live compiler evidence must contain 53/53 field recall.");
assert(evidence.aggregate.requiredFields === 25 && evidence.aggregate.detectedRequiredFields === 25,
  "Live compiler evidence must contain 25/25 required-field recall.");
assert(evidence.aggregate.fieldRecallPercent === 100 && evidence.aggregate.requiredRecallPercent === 100,
  "Live compiler evidence must contain 100% field and required-field recall.");
assert([
  ...evidence.aggregate.fabricatedFieldIds,
  ...evidence.aggregate.missingFieldIds,
  ...evidence.aggregate.missingRequiredFieldIds,
  ...evidence.aggregate.missingDependencies
].length === 0, "Live compiler aggregate contains an unresolved regression.");

assert(file(".dockerignore").split("\n").includes(".env"), "The Docker build context must exclude .env.");
assert(file("Dockerfile").includes("USER node"), "The release container must not run as root.");
assert(file("Dockerfile").includes("libreoffice-writer"), "The release container must support DOCX visual compilation.");
assert(file("render.yaml").includes("healthCheckPath: /api/health"), "Deployment must use the health endpoint.");
assert(file("render.yaml").includes("autoDeployTrigger: off"), "Judge-facing deploys must be manually frozen.");
assert(/key: OPENAI_API_KEY\s+sync: false/.test(file("render.yaml")), "The deployment secret must never be committed.");
assert(/key: VOCAFORM_PUBLIC_DEMO\s+value: "true"/.test(file("render.yaml")), "The hosted build must show public-demo privacy messaging.");
assert(/key: VOCAFORM_STORAGE_MODE\s+value: ephemeral/.test(file("render.yaml")), "The hosted build must declare ephemeral storage explicitly.");
assert(file("app/server/visitor_state.ts").includes("SameSite=Strict"),
  "Public visitor state must use a same-site browser boundary.");
assert(file("app/server/visitor_state.ts").includes("createEmptyMemoryVault"),
  "Public visitors must start with isolated empty memory.");
assert(file("app/server/public_demo_rate_limit.ts").includes("addressLimit"),
  "Public model routes must include an address-level abuse budget.");
assert(file("LICENSE").includes("MIT License"), "A recognized repository license is required.");
assert(file("EXPORT_ACCESSIBILITY_REVIEW.md").includes("Tagged: no"),
  "The export review must disclose the untagged native-PDF limitation.");
assert(file("EXPORT_ACCESSIBILITY_REVIEW.md").includes("PDF/UA"),
  "The export review must prevent an unsupported PDF/UA claim.");
assert(file("app/evals/capture_forced_colors.ts").includes('forcedColors: "active"'),
  "The high-contrast visual evidence must remain reproducible.");
assert(file("SCREEN_READER_REVIEW.md").includes("## Pass criteria"),
  "The manual screen-reader review must define independently checkable pass criteria.");
assert(file("SCREEN_READER_REVIEW.md").includes("## Observations"),
  "The manual screen-reader review must retain an observations record.");
assert(file("DEVPOST_SUBMISSION.md").includes("019f5ff0-9cda-7c71-b035-9b120101b753"),
  "The core-build Codex task ID must be preserved for /feedback confirmation.");

const experienceReview = file("PRE_SUBMISSION_REVIEW.md");
for (const heading of ["## Locale inventory", "## Findings", "## Gate protocol", "## Sign-off"]) {
  assert(experienceReview.includes(heading), `Experience review is missing ${heading}.`);
}
for (const finding of ["EXP-01", "EXP-02", "EXP-03", "EXP-04", "EXP-05", "EXP-06"]) {
  assert(experienceReview.includes(finding), `Experience review is missing ${finding}.`);
}
assert(/Decision:\s*(?:`PASS \/ HOLD`|PASS|HOLD)/.test(experienceReview),
  "Experience review must contain an explicit feature-freeze decision field.");
assert(file("SUBMISSION_CHECKLIST.md").includes("## Experience review gate"),
  "Submission checklist must include the experience review gate.");

if (finalExperienceAudit) validateFinalExperience(experienceReview);
if (finalSubmissionAudit) validateFinalSubmission();

console.log(JSON.stringify({
  status: "pass",
  mode: finalSubmissionAudit ? "submission-final" : finalExperienceAudit ? "experience-final" : "structural",
  requiredFiles: requiredFiles.length,
  liveCompiler: {
    model: evidence.model,
    fields: `${evidence.aggregate.detectedExpectedFields}/${evidence.aggregate.expectedFields}`,
    required: `${evidence.aggregate.detectedRequiredFields}/${evidence.aggregate.requiredFields}`
  }
}, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Release audit failed: ${message}`);
}

function file(filePath: string): string {
  const content = files.get(filePath);
  if (content === undefined) throw new Error(`Release audit failed: ${filePath} was not loaded.`);
  return content;
}

function validateFinalExperience(experienceReview: string): void {
  assert(experienceReview.includes("**Current decision:** **PASS**"),
    "Experience review still records a HOLD decision.");
  const openP1Findings = experienceReview.split("\n").filter((line) =>
    /^\| EXP-\d+ \| P1 \| Open \|/.test(line)
  );
  assert(openP1Findings.length === 0,
    `Experience review still has open P1 findings: ${openP1Findings.map((line) => line.split("|")[1]?.trim()).join(", ")}.`);

  const candidateSha = signoffValue(experienceReview, "Candidate SHA");
  assert(/^[a-f0-9]{40}$/.test(candidateSha), "Experience review needs the exact 40-character candidate SHA.");
  validateCandidateCommit(candidateSha);
  assert(completedValue(signoffValue(experienceReview, "Reviewer")), "Experience review needs a reviewer.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(signoffValue(experienceReview, "Review date")),
    "Experience review date must use YYYY-MM-DD.");
  assert(completedValue(signoffValue(experienceReview, "Open accepted exceptions")),
    "Experience review must record accepted exceptions or None.");
  assert(signoffValue(experienceReview, "Decision") === "PASS",
    "Experience review sign-off decision must be PASS.");

  validateScreenReaderReview(file("SCREEN_READER_REVIEW.md"), candidateSha);
}

function validateCandidateCommit(candidateSha: string): void {
  const headSha = gitOutput(["rev-parse", "HEAD"]);
  assert(candidateSha !== headSha,
    "The reviewed candidate must precede the metadata-only sign-off commit.");
  try {
    execFileSync("git", ["cat-file", "-e", `${candidateSha}^{commit}`], { stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", candidateSha, headSha], { stdio: "ignore" });
  } catch {
    throw new Error("Release audit failed: The recorded candidate must be a commit ancestor of HEAD.");
  }

  const worktreeStatus = gitOutput(["status", "--porcelain"]);
  assert(worktreeStatus.length === 0,
    "The experience-final audit requires a clean worktree.");
  const changedAfterCandidate = gitOutput(["diff", "--name-only", `${candidateSha}..${headSha}`])
    .split("\n")
    .filter(Boolean);
  const codeDrift = changedAfterCandidate.filter((filePath) => !postCandidateMetadataFiles.has(filePath));
  assert(codeDrift.length === 0,
    `Non-metadata files changed after the reviewed candidate: ${codeDrift.join(", ")}.`);
}

function gitOutput(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`Release audit failed: git ${args.join(" ")} could not be verified.`);
  }
}

function validateFinalSubmission(): void {
  const checklist = file("SUBMISSION_CHECKLIST.md");
  const uncheckedItems = checklist.split("\n").filter((line) => /^- \[ \]/.test(line));
  assert(uncheckedItems.length === 0,
    `Submission checklist still has ${uncheckedItems.length} incomplete items.`);

  for (const filePath of ["DEMO_VIDEO_PLAN.md", "DEVPOST_SUBMISSION.md"]) {
    assert(!file(filePath).includes("TO_BE_ADDED_BEFORE_SUBMISSION"),
      `${filePath} still contains a submission placeholder.`);
  }
  assert(/^https:\/\/\S+$/m.test(checklistValue(checklist, "Public demo URL")),
    "Submission checklist needs a verified HTTPS public demo URL.");
  assert(/^https:\/\/\S+$/m.test(checklistValue(checklist, "Public YouTube URL")),
    "Submission checklist needs a verified HTTPS YouTube URL.");
  assert(/^[a-f0-9-]{20,}$/i.test(checklistValue(checklist, "/feedback Session ID")),
    "Submission checklist needs the Codex /feedback Session ID.");
}

function validateScreenReaderReview(content: string, candidateSha: string): void {
  assert(content.includes("**Status:** **PASS**"),
    "Manual screen-reader review has not recorded PASS.");
  const uncheckedCriteria = content.split("\n").filter((line) => /^- \[ \]/.test(line));
  assert(uncheckedCriteria.length === 0,
    `Manual screen-reader review still has ${uncheckedCriteria.length} incomplete criteria.`);
  assert(screenReaderValue(content, "Candidate") === candidateSha,
    "Manual screen-reader evidence must match the experience-review candidate SHA.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(screenReaderValue(content, "Review date")),
    "Manual screen-reader review date must use YYYY-MM-DD.");
  for (const label of ["Reviewer", "Environment"]) {
    assert(completedValue(screenReaderValue(content, label)),
      `Manual screen-reader review needs a completed ${label.toLowerCase()}.`);
  }
  for (const label of [
    "VoiceOver navigation used",
    "Forms/states reviewed",
    "Announcements and focus behavior",
    "Defects found and disposition",
    "Accepted limitations"
  ]) {
    assert(completedValue(screenReaderValue(content, label)),
      `Manual screen-reader review needs ${label.toLowerCase()}.`);
  }
  assert(screenReaderValue(content, "Decision") === "PASS",
    "Manual screen-reader decision must be PASS.");
}

function signoffValue(content: string, label: string): string {
  const prefix = `- ${label}:`;
  const line = content.split("\n").find((candidate) => candidate.startsWith(prefix));
  assert(line, `Experience review is missing ${label}.`);
  return stripMarkdownValue(line.slice(prefix.length));
}

function checklistValue(content: string, label: string): string {
  const prefix = `${label}:`;
  const line = content.split("\n").map((candidate) => candidate.replaceAll("`", "")).find((candidate) =>
    /^- \[[ x]\]/.test(candidate) && candidate.includes(prefix)
  );
  assert(line, `Submission checklist is missing ${label}.`);
  return stripMarkdownValue(line.slice(line.indexOf(prefix) + prefix.length));
}

function screenReaderValue(content: string, label: string): string {
  const prefixes = [`**${label}:**`, `- ${label}:`];
  const line = content.split("\n").find((candidate) =>
    prefixes.some((prefix) => candidate.startsWith(prefix))
  );
  assert(line, `Manual screen-reader review is missing ${label}.`);
  const prefix = prefixes.find((candidate) => line.startsWith(candidate));
  assert(prefix, `Manual screen-reader review is missing ${label}.`);
  return stripMarkdownValue(line.slice(prefix.length));
}

function completedValue(value: string): boolean {
  return Boolean(value)
    && !value.includes("________")
    && !/\b(?:PENDING|WORKTREE|PASS \/ HOLD)\b/i.test(value)
    && !/\breplace\b/i.test(value);
}

function stripMarkdownValue(value: string): string {
  return value.trim().replace(/^`|`$/g, "").trim();
}
