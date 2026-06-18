import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load_env.mjs";
import { getConfig } from "./config.mjs";
import {
  createInitialState,
  getAllInterviewFields,
  listOpenFields,
  loadJson,
  recordAnswer,
  reviewSession,
  summarizeState,
  validateFormSchema
} from "./form_state.mjs";
import { buildReportDocx } from "./docx_report.mjs";
import { createFormStore } from "./form_store.mjs";
import {
  canUseAsDocxTemplate,
  importSchemaFromFile,
  inferImportFormat,
  summarizeSchemaImport,
  supportedImportDescription
} from "./form_importers.mjs";
import { requestStructuredJson } from "./openrouter.mjs";
import { decideInterviewOrchestration } from "./orchestrator.mjs";
import {
  answerRecordJsonSchema,
  buildAnswerNormalizerSystemPrompt,
  buildAnswerNormalizerUserPrompt,
  buildQuestionForField,
  buildTranscriptExtractorSystemPrompt,
  buildTranscriptExtractorUserPrompt,
  transcriptExtractionJsonSchema
} from "./prompts.mjs";
import { slugify } from "./schema_importer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const workDir = path.resolve(process.env.VOCAFORM_WORK_DIR || path.join(root, "work"));
const formsDir = path.join(workDir, "forms");
const outputsDir = path.join(workDir, "exports");
const orchestrationTracePath = path.join(workDir, "orchestration_events.jsonl");
const activeFormConfigPath = path.join(workDir, "active_form.json");
const formStore = createFormStore({ workDir });
const defaultSchemaPath = process.env.FORM_SCHEMA_PATH || path.join(root, "data", "example_entreeformulier.schema.json");
const exampleProfilePath = path.join(root, "data", "family_profile.example.json");
const localProfilePath = path.join(workDir, "family_profile.local.json");
const writableProfilePath = process.env.FAMILY_PROFILE_PATH || localProfilePath;
const defaultStatePath = process.env.SESSION_STATE_PATH || path.join(workDir, "session_state.json");
const defaultTemplatePath = process.env.FORM_TEMPLATE_PATH || "";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5177);
const openAiRealtimeCallUrl = "https://api.openai.com/v1/realtime/calls";
const officePathCandidates = [
  process.env.LIBREOFFICE_PATH,
  process.env.SOFFICE_PATH,
  "soffice",
  "libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
].filter(Boolean);

let activeForm = null;
let loadedSchemaPath = null;
let schema = null;
let profile = null;
let state = null;
let loadedProfilePath = null;
let officeCapability = null;

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

async function readTextBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readBufferBody(request, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`Upload is too large. Limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function usesEnvironmentFormConfig() {
  return Boolean(process.env.FORM_SCHEMA_PATH || process.env.FORM_TEMPLATE_PATH || process.env.SESSION_STATE_PATH);
}

function resolveNullablePath(value) {
  if (!value) return null;
  return path.resolve(value);
}

function defaultFormConfig() {
  return {
    form_id: null,
    schema_path: path.resolve(defaultSchemaPath),
    state_path: path.resolve(defaultStatePath),
    template_path: resolveNullablePath(defaultTemplatePath),
    source_path: resolveNullablePath(defaultTemplatePath),
    source_filename: path.basename(defaultTemplatePath || defaultSchemaPath),
    source_format: defaultTemplatePath ? "docx" : "schema",
    imported_at: null,
    is_default: true
  };
}

function normalizeFormConfig(config) {
  return {
    ...config,
    schema_path: path.resolve(config.schema_path),
    state_path: path.resolve(config.state_path),
    template_path: resolveNullablePath(config.template_path),
    source_path: resolveNullablePath(config.source_path)
  };
}

async function loadActiveFormConfig({ force = false } = {}) {
  if (!force && activeForm) return activeForm;
  if (usesEnvironmentFormConfig()) {
    activeForm = defaultFormConfig();
    return activeForm;
  }

  if (existsSync(activeFormConfigPath)) {
    activeForm = normalizeFormConfig(await loadJson(activeFormConfigPath));
    await formStore.setActiveFormConfig(activeForm);
    return activeForm;
  }

  const storedActiveForm = await formStore.getActiveFormConfig();
  if (storedActiveForm) {
    activeForm = normalizeFormConfig(storedActiveForm);
    return activeForm;
  }

  activeForm = defaultFormConfig();
  return activeForm;
}

async function saveActiveFormConfig(config) {
  if (usesEnvironmentFormConfig()) {
    throw new Error("FORM_SCHEMA_PATH/FORM_TEMPLATE_PATH/SESSION_STATE_PATH is set, so browser imports cannot replace the active form.");
  }
  activeForm = normalizeFormConfig(config);
  await formStore.setActiveFormConfig(activeForm);
  await mkdir(path.dirname(activeFormConfigPath), { recursive: true });
  await writeFile(activeFormConfigPath, `${JSON.stringify(activeForm, null, 2)}\n`, "utf8");
}

function resetLoadedForm() {
  loadedSchemaPath = null;
  schema = null;
  state = null;
}

function safeFilename(value) {
  const basename = path.basename(String(value || "form").trim() || "form");
  const cleaned = basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || "form";
}

function datedImportId(filename) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const base = slugify(path.basename(filename, path.extname(filename)));
  return `${stamp}_${base}`;
}

function outputSlug() {
  return slugify(schema?.form_id || schema?.title || "vocaform");
}

function outputSlugForSchema(formSchema) {
  return slugify(formSchema?.form_id || formSchema?.title || "vocaform");
}

function hasDocxTemplate(formConfig) {
  return Boolean(
    formConfig?.template_path &&
    path.extname(formConfig.template_path).toLowerCase() === ".docx" &&
    existsSync(formConfig.template_path)
  );
}

function spawnCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
    });
  });
}

async function getOfficeCapability() {
  if (officeCapability) return officeCapability;

  for (const candidate of officePathCandidates) {
    const isFilePath = candidate.includes("\\") || candidate.includes("/");
    if (isFilePath && !existsSync(candidate)) continue;
    try {
      const result = await spawnCapture(candidate, ["--version"]);
      officeCapability = {
        available: true,
        command: candidate,
        version: (result.stdout || result.stderr || "").trim()
      };
      return officeCapability;
    } catch {
      // Try the next candidate.
    }
  }

  officeCapability = {
    available: false,
    command: null,
    version: null,
    reason: "LibreOffice/soffice was not found. Install LibreOffice or set LIBREOFFICE_PATH/SOFFICE_PATH to enable PDF export."
  };
  return officeCapability;
}

function clampNumber(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampConfidence(value, fallback = 0.5) {
  return clampNumber(Number(value), fallback, 0, 1);
}

function buildRealtimeInstructions() {
  return [
    "Je bent de rustige Nederlandstalige voice-interviewer van VocaForm.",
    "Help iemand ontspannen een intake-, aanvraag- of activiteitenformulier invullen.",
    "Voer het gesprek als een laagdrempelig interview: warm, kort, concreet en een vraag tegelijk.",
    "Herformuleer de huidige vraag als de gebruiker aarzelt of het antwoord onduidelijk is.",
    "Geef maximaal drie voorbeelden wanneer dat helpt, maar presenteer voorbeelden nooit als feiten over de persoon of deelnemer.",
    "Vraag door op ontbrekende details die nodig zijn om het formulier goed in te vullen.",
    "Volg de actuele instructie uit de browser: soms gaat het om een veld, soms om het hele formulier.",
    "Bij een veldgesprek vat je een bruikbaar antwoord kort samen. Bij een volledig interview ga je door naar het volgende veld.",
    "Verzin geen antwoorden. Als iemand iets niet weet of later wil invullen, respecteer dat.",
    "Houd elke beurt bondig zodat het gesprek natuurlijk en rustig voelt."
  ].join("\n");
}

function buildRealtimeSessionConfig() {
  const config = getConfig();
  const sessionConfig = {
    type: "realtime",
    model: config.openAiRealtimeModel,
    instructions: buildRealtimeInstructions(),
    output_modalities: ["audio"],
    max_output_tokens: 900,
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: {
          model: config.openAiRealtimeTranscriptionModel,
          language: config.openAiRealtimeLanguage,
          prompt: [
            "Nederlandstalig intakegesprek voor een formulier.",
            "Context kan gaan over school, huisarts, tandarts, zorg, sport, activiteit, kind, ouder, deelnemer, patient, contactpersoon, toestemming of bijzonderheden."
          ].join(" ")
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: config.openAiRealtimeVoice,
        speed: clampNumber(config.openAiRealtimeSpeed, 0.95, 0.25, 1.5)
      }
    }
  };

  if (String(config.openAiRealtimeModel).includes("realtime-2")) {
    sessionConfig.reasoning = { effort: config.openAiRealtimeReasoningEffort };
  }

  return sessionConfig;
}

function hasOpenAiRealtimeKey(config) {
  const key = String(config.openAiApiKey || "").trim();
  return Boolean(key) && !key.startsWith("sk-or-");
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
  const formConfig = await loadActiveFormConfig();
  if (!schema || loadedSchemaPath !== formConfig.schema_path) {
    schema = await loadJson(formConfig.schema_path);
    loadedSchemaPath = formConfig.schema_path;
    state = null;
    if (!usesEnvironmentFormConfig() && (!formConfig.form_id || formConfig.form_id !== schema.form_id || !formConfig.title)) {
      await saveActiveFormConfig({
        ...formConfig,
        form_id: schema.form_id,
        title: schema.title
      });
    }
  }

  await loadProfile();

  if (!reset && !state) {
    const storedState = await formStore.getSession(schema.form_id);
    if (storedState?.form_id === schema.form_id) state = storedState;
  }

  if (!reset && !state && existsSync(formConfig.state_path)) {
    const loadedState = await loadJson(formConfig.state_path);
    if (loadedState.form_id === schema.form_id) {
      state = loadedState;
      await formStore.saveSession(schema.form_id, state);
    }
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
  const formConfig = await loadActiveFormConfig();
  await formStore.saveSession(schema.form_id, state);
  await mkdir(path.dirname(formConfig.state_path), { recursive: true });
  await writeFile(formConfig.state_path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function compactReviewForTrace(review) {
  return {
    ready_for_final_export: Boolean(review.ready_for_final_export),
    counts: review.counts,
    blockers: review.blockers.map((item) => ({
      field_id: item.field_id,
      kind: item.kind,
      required: Boolean(item.required),
      status: item.status
    })),
    warnings: review.warnings.map((item) => ({
      field_id: item.field_id,
      kind: item.kind,
      status: item.status
    }))
  };
}

async function appendOrchestrationTrace(event) {
  await mkdir(path.dirname(orchestrationTracePath), { recursive: true });
  const record = {
    recorded_at: new Date().toISOString(),
    ...event
  };
  await appendFile(orchestrationTracePath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function saveProfile(nextProfile) {
  await mkdir(path.dirname(writableProfilePath), { recursive: true });
  await writeFile(writableProfilePath, `${JSON.stringify(nextProfile, null, 2)}\n`, "utf8");
  profile = nextProfile;
  loadedProfilePath = writableProfilePath;
}

async function loadFormContext(formConfig, { allowInitial = false } = {}) {
  const normalizedConfig = normalizeFormConfig(formConfig);
  const formSchema = await loadJson(normalizedConfig.schema_path);
  let formState = await formStore.getSession(formSchema.form_id);

  if ((!formState || formState.form_id !== formSchema.form_id) && existsSync(normalizedConfig.state_path)) {
    const fileState = await loadJson(normalizedConfig.state_path);
    if (fileState.form_id === formSchema.form_id) {
      formState = fileState;
      await formStore.saveSession(formSchema.form_id, formState);
    }
  }

  if ((!formState || formState.form_id !== formSchema.form_id) && allowInitial) {
    await loadProfile();
    formState = createInitialState(formSchema, profile || {});
  }

  return {
    formConfig: normalizedConfig,
    schema: formSchema,
    state: formState
  };
}

function buildFormListItem({ formConfig, formSchema, formState, activeFormId, office }) {
  const summary = formState ? summarizeState(formSchema, formState) : null;
  const review = formState ? reviewSession(formSchema, formState) : null;
  const counts = review?.counts || {
    total_fields: getAllInterviewFields(formSchema).length,
    answered: 0,
    skipped: 0,
    unanswered: getAllInterviewFields(formSchema).length,
    needs_followup: 0,
    low_confidence: 0,
    required_missing: 0,
    required_skipped: 0
  };
  const totalFields = Math.max(1, counts.total_fields || 0);
  const completedFields = Math.max(0, totalFields - (summary?.total_interview_fields_open ?? counts.unanswered ?? totalFields));

  return {
    id: formSchema.form_id,
    title: formSchema.title || formConfig.title || formSchema.form_id,
    source: formSchema.source || {
      filename: formConfig.source_filename || path.basename(formConfig.schema_path),
      format: formConfig.source_format || "schema"
    },
    imported_at: formConfig.imported_at || null,
    updated_at: formConfig.updated_at || formConfig.imported_at || null,
    is_active: formSchema.form_id === activeFormId,
    is_default: Boolean(formConfig.is_default),
    progress: {
      completed_fields: completedFields,
      total_fields: counts.total_fields || 0,
      percent: counts.total_fields ? Math.round((completedFields / counts.total_fields) * 100) : 0,
      required_open: summary?.required_fields_open ?? counts.required_missing ?? 0,
      blockers: review?.blockers.length || 0,
      warnings: review?.warnings.length || 0,
      ready_for_final_export: Boolean(review?.ready_for_final_export)
    },
    exports: {
      docx: {
        available: true,
        label: hasDocxTemplate(formConfig) ? "Original DOCX" : "Answers DOCX"
      },
      pdf: {
        available: Boolean(office.available),
        label: "PDF",
        reason: office.available ? null : office.reason
      }
    }
  };
}

async function listFormLibrary() {
  const office = await getOfficeCapability();
  const stored = await formStore.listForms();
  const forms = [];

  for (const formConfig of stored.forms) {
    try {
      const context = await loadFormContext(formConfig, { allowInitial: true });
      forms.push(buildFormListItem({
        formConfig: context.formConfig,
        formSchema: context.schema,
        formState: context.state,
        activeFormId: stored.active_form_id,
        office
      }));
    } catch (error) {
      forms.push({
        id: formConfig.form_id,
        title: formConfig.title || formConfig.form_id,
        source: {
          filename: formConfig.source_filename || path.basename(formConfig.schema_path || ""),
          format: formConfig.source_format || "schema"
        },
        is_active: formConfig.form_id === stored.active_form_id,
        progress: null,
        exports: {
          docx: { available: false, label: "DOCX", reason: error.message },
          pdf: { available: false, label: "PDF", reason: error.message }
        },
        error: error.message
      });
    }
  }

  return {
    active_form_id: stored.active_form_id,
    office,
    forms
  };
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

function normalizeExtractedRecord(field, record) {
  const status = ["answered", "needs_followup", "skipped"].includes(record.status)
    ? record.status
    : "needs_followup";
  const rawAnswer = String(record.raw_answer || "").trim();
  const normalizedAnswer = status === "skipped" ? "" : String(record.normalized_answer || "").trim();
  const followUpQuestion = status === "needs_followup"
    ? String(record.follow_up_question || `Wat wil je invullen bij ${field.label}?`).trim()
    : null;

  return {
    field_id: field.id,
    status,
    raw_answer: rawAnswer,
    normalized_answer: normalizedAnswer,
    confidence: clampConfidence(record.confidence, status === "answered" ? 0.7 : 0.4),
    follow_up_question: followUpQuestion,
    source: "whole_transcript",
    updated_at: new Date().toISOString()
  };
}

async function extractTranscriptAnswers(transcript) {
  const config = getConfig();
  const targetFields = listOpenFields(schema, state);
  if (!targetFields.length) {
    return {
      answers: [],
      ignored_field_ids: []
    };
  }

  const fieldsById = new Map(targetFields.map((field) => [field.id, field]));

  const result = await requestStructuredJson({
    config,
    system: buildTranscriptExtractorSystemPrompt(),
    user: buildTranscriptExtractorUserPrompt({ fields: targetFields, transcript }),
    jsonSchema: transcriptExtractionJsonSchema,
    temperature: 0.1
  });

  const applied = [];
  const ignored = [];
  for (const record of result.data.answers || []) {
    const field = fieldsById.get(record.field_id);
    if (!field) {
      ignored.push(record.field_id);
      continue;
    }

    const answer = normalizeExtractedRecord(field, record);
    if (answer.status === "answered" && !answer.normalized_answer) {
      ignored.push(record.field_id);
      continue;
    }

    recordAnswer(state, answer);
    applied.push(answer);
  }

  return {
    answers: applied,
    ignored_field_ids: ignored
  };
}

async function runWholeFormOrchestration({ transcript, requestedAction = "process_transcript", useOpenRouter = true }) {
  const traceId = randomUUID();
  const config = getConfig();
  const beforeReview = reviewSession(schema, state);
  const beforeSummary = summarizeState(schema, state);
  const traceBase = {
    trace_id: traceId,
    type: "whole_form_interview_orchestration",
    form_id: schema.form_id,
    requested_action: requestedAction,
    model: useOpenRouter ? config.openRouterModel : "local_rules",
    use_openrouter: Boolean(useOpenRouter && config.openRouterApiKey),
    transcript_chars: String(transcript || "").length,
    before: {
      summary: beforeSummary,
      review: compactReviewForTrace(beforeReview)
    }
  };

  try {
    const orchestration = await decideInterviewOrchestration({
      config,
      formSchema: schema,
      state,
      transcript,
      requestedAction,
      useOpenRouter,
      requestStructuredJson
    });

    const execution = {
      tool: null,
      state_saved: false,
      answers_applied: 0,
      ignored_field_ids: []
    };
    let extraction = {
      answers: [],
      ignored_field_ids: []
    };

    if (orchestration.decision.action === "extract_answers") {
      extraction = await extractTranscriptAnswers(transcript);
      await saveState();
      execution.tool = "extractTranscriptAnswers";
      execution.state_saved = true;
      execution.answers_applied = extraction.answers.length;
      execution.ignored_field_ids = extraction.ignored_field_ids;
    }

    const afterReview = reviewSession(schema, state);
    const result = {
      trace_id: traceId,
      source: orchestration.source,
      model: orchestration.model || traceBase.model,
      decision: orchestration.decision,
      execution,
      extraction,
      review: afterReview
    };

    await appendOrchestrationTrace({
      ...traceBase,
      decision: orchestration.decision,
      source: orchestration.source,
      model: orchestration.model || traceBase.model,
      execution,
      after: {
        summary: summarizeState(schema, state),
        review: compactReviewForTrace(afterReview)
      }
    });

    return result;
  } catch (error) {
    await appendOrchestrationTrace({
      ...traceBase,
      error: {
        message: error.message
      }
    });
    throw error;
  }
}

function buildSessionPayload() {
  const config = getConfig();
  const openField = nextField();
  const formConfig = activeForm || defaultFormConfig();
  const canRenderOriginalDocx = hasDocxTemplate(formConfig);
  return {
    form: {
      id: schema.form_id,
      title: schema.title,
      language: schema.language,
      source: schema.source || null,
      schema_path: formConfig.schema_path,
      state_path: formConfig.state_path,
      template_path: formConfig.template_path,
      imported_at: formConfig.imported_at || null,
      is_default: Boolean(formConfig.is_default),
      can_render_original_docx: canRenderOriginalDocx
    },
    persistence: {
      server_store_path: formStore.dbPath,
      canonical: "server",
      browser_cache: "ui_and_unsaved_drafts"
    },
    orchestration: {
      trace_path: orchestrationTracePath
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
    has_openrouter_key: Boolean(config.openRouterApiKey),
    has_openai_realtime_key: hasOpenAiRealtimeKey(config),
    openai_realtime: {
      model: config.openAiRealtimeModel,
      voice: config.openAiRealtimeVoice,
      language: config.openAiRealtimeLanguage
    },
    template_exists: canRenderOriginalDocx
  };
}

async function renderDocxForContext(formSchema, formState, formConfig, mode, exportKind) {
  const canRenderOriginalDocx = hasDocxTemplate(formConfig);
  const effectiveMode = canRenderOriginalDocx ? mode : "generated";
  const suffix = effectiveMode === "in-place" ? "inplace" : effectiveMode === "append" ? "filled" : "answers";
  const outPath = path.join(outputsDir, `${outputSlugForSchema(formSchema)}_session_${exportKind}_${suffix}.docx`);
  await mkdir(outputsDir, { recursive: true });

  if (!canRenderOriginalDocx) {
    await writeFile(outPath, buildReportDocx(formSchema, formState, {
      title: exportKind === "final" ? "Finale antwoorden" : "Concept antwoorden"
    }));
    return {
      outPath,
      mode: effectiveMode
    };
  }

  const args = [
    path.join(root, "src", "render_docx.mjs"),
    formConfig.template_path,
    formConfig.schema_path,
    formConfig.state_path,
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

  return {
    outPath,
    mode: effectiveMode
  };
}

async function renderDocx(mode, exportKind) {
  const formConfig = await loadActiveFormConfig();
  return renderDocxForContext(schema, state, formConfig, mode, exportKind);
}

async function convertDocxToPdf(docxPath) {
  const office = await getOfficeCapability();
  if (!office.available) {
    throw new Error(office.reason);
  }

  await mkdir(outputsDir, { recursive: true });
  await spawnCapture(office.command, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputsDir,
    docxPath
  ], { cwd: root });

  const pdfPath = path.join(outputsDir, `${path.basename(docxPath, ".docx")}.pdf`);
  if (!existsSync(pdfPath)) {
    throw new Error("LibreOffice finished but did not produce the expected PDF file.");
  }
  return pdfPath;
}

async function renderFormExport({ formId, format = "docx", final = true, mode = "in-place" }) {
  const formConfig = await formStore.getForm(formId);
  if (!formConfig) throw new Error(`Unknown form_id: ${formId}`);

  const context = await loadFormContext(formConfig);
  if (!context.state) throw new Error("This form does not have a saved session yet.");

  const review = reviewSession(context.schema, context.state);
  const exportKind = final ? "final" : "draft";
  if (final && !review.ready_for_final_export) {
    const blockerCount = review.blockers.length;
    throw new Error(`This form is not ready for final export (${blockerCount} blocker${blockerCount === 1 ? "" : "s"}).`);
  }

  const renderedDocx = await renderDocxForContext(context.schema, context.state, context.formConfig, mode, exportKind);
  if (format === "pdf") {
    const pdfPath = await convertDocxToPdf(renderedDocx.outPath);
    return {
      mode: renderedDocx.mode,
      export_kind: exportKind,
      format: "pdf",
      output_path: pdfPath,
      output_file: path.basename(pdfPath),
      review
    };
  }

  return {
    mode: renderedDocx.mode,
    export_kind: exportKind,
    format: "docx",
    output_path: renderedDocx.outPath,
    output_file: path.basename(renderedDocx.outPath),
    review
  };
}

async function importUploadedForm(request, url) {
  if (usesEnvironmentFormConfig()) {
    throw new Error("Browser imports are disabled while FORM_SCHEMA_PATH, FORM_TEMPLATE_PATH, or SESSION_STATE_PATH is set.");
  }

  const filename = safeFilename(url.searchParams.get("filename") || request.headers["x-vocaform-filename"] || "form");
  const importFormat = inferImportFormat(filename);
  if (!importFormat) {
    throw new Error(`Unsupported import format. Supported extensions: ${supportedImportDescription()}.`);
  }

  const body = await readBufferBody(request);
  if (!body.length) throw new Error("Uploaded form file is empty.");

  const importId = datedImportId(filename);
  const formDir = path.join(formsDir, importId);
  const sourcePath = path.join(formDir, filename);
  await mkdir(formDir, { recursive: true });
  await writeFile(sourcePath, body);

  const importResult = await importSchemaFromFile(sourcePath, importFormat);
  const importedSchema = importResult.schema;
  const validationErrors = validateFormSchema(importedSchema);
  if (validationErrors.length) {
    throw new Error(`Imported schema is invalid: ${validationErrors.join("; ")}`);
  }

  const summary = summarizeSchemaImport(importedSchema);
  if (summary.fields === 0) {
    throw new Error("No form fields were detected. Try exporting the form to DOCX/text, or run OCR for scanned PDFs.");
  }

  const schemaFile = `${slugify(importedSchema.form_id)}.schema.json`;
  const importedSchemaPath = path.join(formDir, schemaFile);
  const importedStatePath = path.join(formDir, "session_state.json");
  await writeFile(importedSchemaPath, `${JSON.stringify(importedSchema, null, 2)}\n`, "utf8");

  await saveActiveFormConfig({
    form_id: importedSchema.form_id,
    title: importedSchema.title,
    schema_path: importedSchemaPath,
    state_path: importedStatePath,
    template_path: canUseAsDocxTemplate(importFormat) ? sourcePath : null,
    source_path: sourcePath,
    source_filename: filename,
    source_format: importFormat,
    imported_at: new Date().toISOString(),
    is_default: false
  });

  resetLoadedForm();
  await ensureSession({ reset: true });

  return {
    import: {
      form_id: importedSchema.form_id,
      title: importedSchema.title,
      source_filename: filename,
      source_format: importFormat,
      schema_path: importedSchemaPath,
      state_path: importedStatePath,
      template_path: canUseAsDocxTemplate(importFormat) ? sourcePath : null,
      notes: importResult.notes || []
    },
    summary,
    session: buildSessionPayload()
  };
}

async function serveDownload(url, response) {
  const requestedFile = path.basename(url.searchParams.get("file") || "");
  if (!requestedFile || !/\.(docx|pdf)$/i.test(requestedFile)) {
    sendJson(response, 400, { error: "Expected a .docx or .pdf file query parameter." });
    return;
  }

  const filePath = path.resolve(outputsDir, requestedFile);
  if (!filePath.startsWith(`${outputsDir}${path.sep}`) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "Download file not found." });
    return;
  }

  const data = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": ext === ".pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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

    if (url.pathname === "/api/forms/import" && request.method === "POST") {
      const result = await importUploadedForm(request, url);
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/api/forms" && request.method === "GET") {
      await ensureSession();
      sendJson(response, 200, await listFormLibrary());
      return;
    }

    if (url.pathname === "/api/forms/activate" && request.method === "POST") {
      if (usesEnvironmentFormConfig()) {
        sendJson(response, 400, { error: "Form switching is disabled while FORM_SCHEMA_PATH, FORM_TEMPLATE_PATH, or SESSION_STATE_PATH is set." });
        return;
      }

      const body = await readBody(request);
      const formConfig = await formStore.setActiveFormId(String(body.form_id || ""));
      if (!formConfig) {
        sendJson(response, 404, { error: `Unknown form_id: ${body.form_id}` });
        return;
      }

      activeForm = normalizeFormConfig(formConfig);
      await mkdir(path.dirname(activeFormConfigPath), { recursive: true });
      await writeFile(activeFormConfigPath, `${JSON.stringify(activeForm, null, 2)}\n`, "utf8");
      resetLoadedForm();
      await ensureSession();
      sendJson(response, 200, buildSessionPayload());
      return;
    }

    if (url.pathname === "/api/forms/export" && request.method === "POST") {
      const body = await readBody(request);
      const format = body.format === "pdf" ? "pdf" : "docx";
      const rendered = await renderFormExport({
        formId: String(body.form_id || ""),
        format,
        final: body.final !== false,
        mode: body.mode === "append" ? "append" : "in-place"
      });
      sendJson(response, 200, {
        ...rendered,
        download_url: `/api/download?file=${encodeURIComponent(rendered.output_file)}`
      });
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

    if (url.pathname === "/api/realtime/call" && request.method === "POST") {
      await ensureSession();
      const config = getConfig();
      if (!hasOpenAiRealtimeKey(config)) {
        sendJson(response, 400, { error: "OPENAI_API_KEY is not set to an OpenAI API key." });
        return;
      }

      const sdp = await readTextBody(request);
      if (!sdp.trim()) {
        sendJson(response, 400, { error: "Expected SDP offer body." });
        return;
      }

      const formData = new FormData();
      formData.set("sdp", sdp);
      formData.set("session", JSON.stringify(buildRealtimeSessionConfig()));

      const headers = {
        Authorization: `Bearer ${config.openAiApiKey}`
      };
      if (config.openAiSafetyIdentifier) {
        headers["OpenAI-Safety-Identifier"] = config.openAiSafetyIdentifier;
      }

      const upstream = await fetch(openAiRealtimeCallUrl, {
        method: "POST",
        headers,
        body: formData
      });
      const body = await upstream.text();
      if (!upstream.ok) {
        sendJson(response, upstream.status, {
          error: body || `OpenAI Realtime request failed (${upstream.status}).`
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store"
      });
      response.end(body);
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

    if (url.pathname === "/api/interview/orchestrate" && request.method === "POST") {
      await ensureSession();
      const body = await readBody(request);
      const transcript = String(body.transcript || "").trim();
      const requestedAction = String(body.requested_action || "process_transcript");
      if (!transcript && requestedAction === "process_transcript") {
        sendJson(response, 400, { error: "Expected a transcript to orchestrate." });
        return;
      }

      const config = getConfig();
      if (body.use_openrouter === false || !config.openRouterApiKey) {
        sendJson(response, 400, { error: "Whole-form orchestration requires OPENROUTER_API_KEY." });
        return;
      }

      const orchestration = await runWholeFormOrchestration({
        transcript,
        requestedAction,
        useOpenRouter: body.use_openrouter !== false
      });
      sendJson(response, 200, {
        orchestration,
        extraction: orchestration.extraction,
        session: buildSessionPayload()
      });
      return;
    }

    if (url.pathname === "/api/interview/transcript" && request.method === "POST") {
      await ensureSession();
      const body = await readBody(request);
      const transcript = String(body.transcript || "").trim();
      if (!transcript) {
        sendJson(response, 400, { error: "Expected a transcript to extract." });
        return;
      }

      const config = getConfig();
      if (body.use_openrouter === false || !config.openRouterApiKey) {
        sendJson(response, 400, { error: "Whole-form transcript extraction requires OPENROUTER_API_KEY." });
        return;
      }

      const extraction = await extractTranscriptAnswers(transcript);
      await saveState();
      sendJson(response, 200, {
        extraction,
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

      const rendered = await renderDocx(mode, exportKind);
      const outputFile = path.basename(rendered.outPath);
      sendJson(response, 200, {
        mode: rendered.mode,
        export_kind: exportKind,
        output_path: rendered.outPath,
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

server.listen(port, host, async () => {
  await ensureSession();
  const formConfig = await loadActiveFormConfig();
  console.log(`Voice form filler running at http://${host}:${port}`);
  console.log(`Schema: ${formConfig.schema_path}`);
  console.log(`Template: ${formConfig.template_path || "generated DOCX fallback"}`);
  console.log(`Store: ${formStore.dbPath}`);
  console.log(`Profile: ${loadedProfilePath}`);
  console.log(`State: ${formConfig.state_path}`);
});
