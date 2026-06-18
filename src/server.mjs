import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.mjs";
import {
  createInitialState,
  getAllInterviewFields,
  listOpenFields,
  loadJson,
  recordAnswer,
  reviewSession,
  summarizeState
} from "./form_state.mjs";
import { requestStructuredJson } from "./openrouter.mjs";
import {
  answerRecordJsonSchema,
  buildAnswerNormalizerSystemPrompt,
  buildAnswerNormalizerUserPrompt,
  buildQuestionForField
} from "./prompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const workDir = path.join(root, "work");
const outputsDir = path.resolve(root, "..");
const schemaPath = process.env.FORM_SCHEMA_PATH || path.join(root, "data", "mees_entreeformulier.schema.json");
const exampleProfilePath = path.join(root, "data", "family_profile.example.json");
const localProfilePath = path.join(workDir, "family_profile.local.json");
const writableProfilePath = process.env.FAMILY_PROFILE_PATH || localProfilePath;
const statePath = process.env.SESSION_STATE_PATH || path.join(workDir, "session_state.json");
const templatePath = process.env.FORM_TEMPLATE_PATH || "C:\\Users\\S340\\Downloads\\Kopie van Entreeformulier leeg.docx";
const port = Number(process.env.PORT || 5177);

let schema = null;
let profile = null;
let state = null;
let loadedProfilePath = null;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getProfilePath() {
  if (process.env.FAMILY_PROFILE_PATH) return process.env.FAMILY_PROFILE_PATH;
  return existsSync(localProfilePath) ? localProfilePath : exampleProfilePath;
}

async function loadProfile({ force = false } = {}) {
  const nextProfilePath = getProfilePath();
  if (force || !profile || loadedProfilePath !== nextProfilePath) {
    profile = await loadJson(nextProfilePath);
    loadedProfilePath = nextProfilePath;
  }
  return profile;
}

async function ensureSession({ reset = false } = {}) {
  if (!schema) schema = await loadJson(schemaPath);
  await loadProfile();

  if (!reset && !state && existsSync(statePath)) {
    state = await loadJson(statePath);
  }

  if (reset || !state) {
    state = createInitialState(schema, profile);
    state.metadata = {
      created_at: new Date().toISOString(),
      source: "local_interview_server"
    };
    await saveState();
  }

  return { schema, profile, state };
}

async function saveState() {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function saveProfile(nextProfile) {
  await mkdir(path.dirname(writableProfilePath), { recursive: true });
  await writeFile(writableProfilePath, `${JSON.stringify(nextProfile, null, 2)}\n`, "utf8");
  profile = nextProfile;
  loadedProfilePath = writableProfilePath;
}

function getField(fieldId) {
  return getAllInterviewFields(schema).find((field) => field.id === fieldId);
}

function nextField() {
  return listOpenFields(schema, state)[0] || null;
}

function manualAnswerRecord(field, body) {
  const normalized = String(body.normalized_answer ?? body.transcript ?? "").trim();
  const raw = String(body.raw_answer ?? body.transcript ?? normalized).trim();
  const status = body.status === "skipped" ? "skipped" : normalized ? "answered" : "needs_followup";

  return {
    field_id: field.id,
    status,
    raw_answer: raw,
    normalized_answer: status === "skipped" ? "" : normalized,
    confidence: status === "answered" ? 1 : status === "skipped" ? 1 : 0,
    follow_up_question: status === "needs_followup" ? "Wat wil je hierover invullen?" : null,
    source: "manual",
    updated_at: new Date().toISOString()
  };
}

function normalizeLocally(field, transcript) {
  const raw = String(transcript || "").trim();
  const lower = raw.toLowerCase();
  const skipped = ["skip", "overslaan", "weet ik niet", "kom later terug", "later"].some((phrase) => lower.includes(phrase));

  if (skipped) {
    return {
      field_id: field.id,
      status: "skipped",
      raw_answer: raw,
      normalized_answer: "",
      confidence: 1,
      follow_up_question: null
    };
  }

  if (!raw) {
    return {
      field_id: field.id,
      status: "needs_followup",
      raw_answer: "",
      normalized_answer: "",
      confidence: 0,
      follow_up_question: "Wat wil je hierover invullen?"
    };
  }

  return {
    field_id: field.id,
    status: "answered",
    raw_answer: raw,
    normalized_answer: raw,
    confidence: 0.55,
    follow_up_question: null
  };
}

async function normalizeAnswer(field, transcript, useOpenRouter) {
  const config = getConfig();
  if (!useOpenRouter || !config.openRouterApiKey) return normalizeLocally(field, transcript);

  const result = await requestStructuredJson({
    config,
    system: buildAnswerNormalizerSystemPrompt(),
    user: buildAnswerNormalizerUserPrompt({ field, transcript }),
    jsonSchema: answerRecordJsonSchema
  });

  return {
    ...result.data,
    field_id: field.id
  };
}

function buildSessionPayload() {
  const openField = nextField();
  return {
    form: {
      id: schema.form_id,
      title: schema.title,
      language: schema.language
    },
    state,
    summary: summarizeState(schema, state),
    review: reviewSession(schema, state),
    next_field: openField
      ? {
          ...openField,
          spoken_question: buildQuestionForField(openField)
        }
      : null,
    fields: getAllInterviewFields(schema).map((field) => ({
      ...field,
      answer: state.interview_answers[field.id]
    })),
    profile: {
      path: loadedProfilePath,
      writable_path: writableProfilePath,
      child_name: profile?.child?.preferred_name || profile?.child?.full_name || null,
      prefilled_fields: Object.values(state.profile_answers || {}).filter((answer) => answer.status === "prefilled").length
    },
    has_openrouter_key: Boolean(getConfig().openRouterApiKey),
    template_exists: existsSync(templatePath)
  };
}

async function renderDocx(mode, exportKind) {
  const suffix = mode === "in-place" ? "inplace" : "filled";
  const outPath = path.join(outputsDir, `mees_entreeformulier_session_${exportKind}_${suffix}.docx`);
  const args = [
    path.join(root, "src", "render_docx.mjs"),
    templatePath,
    schemaPath,
    statePath,
    outPath
  ];
  if (mode === "in-place") args.push("in-place");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `Renderer exited with code ${code}`));
    });
  });

  return outPath;
}

async function serveDownload(url, response) {
  const requestedFile = path.basename(url.searchParams.get("file") || "");
  if (!requestedFile || !requestedFile.endsWith(".docx")) {
    sendJson(response, 400, { error: "Expected a .docx file query parameter." });
    return;
  }

  const filePath = path.join(outputsDir, requestedFile);
  if (!filePath.startsWith(outputsDir) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "Download file not found." });
    return;
  }

  const data = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${requestedFile}"`,
    "Cache-Control": "no-store"
  });
  response.end(data);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  };

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/session" && request.method === "GET") {
      await ensureSession();
      sendJson(response, 200, buildSessionPayload());
      return;
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      await ensureSession({ reset: true });
      sendJson(response, 200, buildSessionPayload());
      return;
    }

    if (url.pathname === "/api/profile" && request.method === "GET") {
      await ensureSession();
      sendJson(response, 200, {
        profile,
        path: loadedProfilePath,
        writable_path: writableProfilePath
      });
      return;
    }

    if (url.pathname === "/api/review" && request.method === "GET") {
      await ensureSession();
      sendJson(response, 200, reviewSession(schema, state));
      return;
    }

    if (url.pathname === "/api/profile" && request.method === "PUT") {
      await ensureSession();
      const body = await readBody(request);
      if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
        sendJson(response, 400, { error: "Expected body.profile object." });
        return;
      }
      await saveProfile(body.profile);
      state = createInitialState(schema, profile);
      state.metadata = {
        created_at: new Date().toISOString(),
        source: "local_interview_server",
        profile_updated_at: new Date().toISOString()
      };
      await saveState();
      sendJson(response, 200, {
        profile,
        session: buildSessionPayload()
      });
      return;
    }

    if (url.pathname === "/api/answer" && request.method === "POST") {
      await ensureSession();
      const body = await readBody(request);
      const field = getField(body.field_id);
      if (!field) {
        sendJson(response, 400, { error: `Unknown field_id: ${body.field_id}` });
        return;
      }

      const answer = await normalizeAnswer(field, body.transcript, body.use_openrouter !== false);
      recordAnswer(state, answer);
      await saveState();
      sendJson(response, 200, {
        answer,
        session: buildSessionPayload()
      });
      return;
    }

    if (url.pathname === "/api/answer/manual" && request.method === "POST") {
      await ensureSession();
      const body = await readBody(request);
      const field = getField(body.field_id);
      if (!field) {
        sendJson(response, 400, { error: `Unknown field_id: ${body.field_id}` });
        return;
      }

      const answer = manualAnswerRecord(field, body);
      recordAnswer(state, answer);
      await saveState();
      sendJson(response, 200, {
        answer,
        session: buildSessionPayload()
      });
      return;
    }

    if (url.pathname === "/api/render" && request.method === "POST") {
      await ensureSession();
      await saveState();
      const body = await readBody(request);
      const mode = body.mode === "append" ? "append" : "in-place";
      const exportKind = body.final === true ? "final" : "draft";
      const review = reviewSession(schema, state);
      if (exportKind === "final" && !review.ready_for_final_export) {
        sendJson(response, 409, {
          error: "Session is not final-ready.",
          review
        });
        return;
      }

      const outPath = await renderDocx(mode, exportKind);
      const outputFile = path.basename(outPath);
      sendJson(response, 200, {
        mode,
        export_kind: exportKind,
        output_path: outPath,
        output_file: outputFile,
        download_url: `/api/download?file=${encodeURIComponent(outputFile)}`,
        review
      });
      return;
    }

    if (url.pathname === "/api/download" && request.method === "GET") {
      await serveDownload(url, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", async () => {
  await ensureSession();
  console.log(`Voice form filler running at http://127.0.0.1:${port}`);
  console.log(`Template: ${templatePath}`);
  console.log(`Profile: ${loadedProfilePath}`);
  console.log(`State: ${statePath}`);
});
