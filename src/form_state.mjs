import { readFile } from "node:fs/promises";

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function getAllInterviewFields(formSchema) {
  return formSchema.sections.flatMap((section) =>
    section.fields.map((field) => ({
      ...field,
      section_id: section.id,
      section_title: section.title
    }))
  );
}

export function getByPath(value, dotPath) {
  return dotPath.split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, value);
}

export function hasUsableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && !trimmed.startsWith("<") && !trimmed.endsWith(">");
  }
  if (Array.isArray(value)) return value.some((item) => hasUsableValue(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasUsableValue(item));
  return true;
}

export function createInitialState(formSchema, familyProfile) {
  const profileAnswers = {};

  for (const field of formSchema.profile_fields) {
    const value = getByPath(familyProfile, field.profile_key);
    const hasValue = hasUsableValue(value);
    profileAnswers[field.id] = {
      field_id: field.id,
      label: field.label,
      status: hasValue ? "prefilled" : "missing",
      source: "family_profile",
      value: hasValue ? value : null,
      confidence: hasValue ? 1 : 0
    };
  }

  const interviewAnswers = {};
  for (const field of getAllInterviewFields(formSchema)) {
    interviewAnswers[field.id] = {
      field_id: field.id,
      label: field.label,
      section_id: field.section_id,
      status: "unanswered",
      raw_answer: null,
      normalized_answer: null,
      confidence: 0,
      follow_up_question: null
    };
  }

  return {
    form_id: formSchema.form_id,
    form_version: formSchema.version,
    language: formSchema.language,
    profile_answers: profileAnswers,
    interview_answers: interviewAnswers
  };
}

export function listOpenFields(formSchema, state, { includeOptional = true } = {}) {
  return getAllInterviewFields(formSchema).filter((field) => {
    const answer = state.interview_answers[field.id];
    if (!includeOptional && !field.required) return false;
    return answer.status === "unanswered" || answer.status === "needs_followup";
  });
}

export function recordAnswer(state, record) {
  const current = state.interview_answers[record.field_id];
  if (!current) {
    throw new Error(`Unknown field_id: ${record.field_id}`);
  }

  state.interview_answers[record.field_id] = {
    ...current,
    status: record.status,
    raw_answer: record.raw_answer,
    normalized_answer: record.normalized_answer,
    confidence: record.confidence,
    follow_up_question: record.follow_up_question ?? null
  };

  return state;
}

export function summarizeState(formSchema, state) {
  const openRequired = listOpenFields(formSchema, state, { includeOptional: false });
  const openAll = listOpenFields(formSchema, state, { includeOptional: true });
  const prefilledCount = Object.values(state.profile_answers).filter((item) => item.status === "prefilled").length;

  return {
    form_id: state.form_id,
    profile_fields_prefilled: prefilledCount,
    required_fields_open: openRequired.length,
    total_interview_fields_open: openAll.length
  };
}

export function reviewSession(formSchema, state, { lowConfidenceThreshold = 0.7 } = {}) {
  const fields = getAllInterviewFields(formSchema);
  const blockers = [];
  const warnings = [];
  const counts = {
    total_fields: fields.length,
    answered: 0,
    skipped: 0,
    unanswered: 0,
    needs_followup: 0,
    low_confidence: 0,
    required_missing: 0,
    required_skipped: 0
  };

  for (const field of fields) {
    const answer = state.interview_answers?.[field.id];
    const status = answer?.status || "unanswered";
    const base = {
      field_id: field.id,
      label: field.label,
      section_id: field.section_id,
      section_title: field.section_title,
      required: Boolean(field.required),
      status
    };

    if (status === "answered") {
      counts.answered += 1;
      if ((answer.confidence ?? 0) < lowConfidenceThreshold) {
        counts.low_confidence += 1;
        warnings.push({
          ...base,
          kind: "low_confidence",
          confidence: answer.confidence ?? 0,
          message: "Answer is present but confidence is low; review wording before final export."
        });
      }
      continue;
    }

    if (status === "skipped") {
      counts.skipped += 1;
      if (field.required) {
        counts.required_skipped += 1;
        blockers.push({
          ...base,
          kind: "required_skipped",
          message: "Required field was skipped."
        });
      } else {
        warnings.push({
          ...base,
          kind: "optional_skipped",
          message: "Optional field was skipped."
        });
      }
      continue;
    }

    if (status === "needs_followup") {
      counts.needs_followup += 1;
      blockers.push({
        ...base,
        kind: "needs_followup",
        follow_up_question: answer?.follow_up_question || null,
        message: "Field needs a follow-up answer."
      });
      continue;
    }

    counts.unanswered += 1;
    if (field.required) {
      counts.required_missing += 1;
      blockers.push({
        ...base,
        kind: "required_missing",
        message: "Required field is not answered."
      });
    }
  }

  return {
    ready_for_final_export: blockers.length === 0,
    can_export_draft: true,
    low_confidence_threshold: lowConfidenceThreshold,
    counts,
    blockers,
    warnings
  };
}

export function validateFormSchema(formSchema) {
  const errors = [];
  const seen = new Set();

  if (!formSchema.form_id) errors.push("form_id is required");
  if (!Array.isArray(formSchema.profile_fields)) errors.push("profile_fields must be an array");
  if (!Array.isArray(formSchema.sections)) errors.push("sections must be an array");

  for (const field of getAllInterviewFields(formSchema)) {
    if (!field.id) errors.push(`Field without id in section ${field.section_id}`);
    if (seen.has(field.id)) errors.push(`Duplicate interview field id: ${field.id}`);
    seen.add(field.id);
    if (!field.label) errors.push(`Field ${field.id} missing label`);
    if (!field.interview_prompt) errors.push(`Field ${field.id} missing interview_prompt`);
    if (!field.type) errors.push(`Field ${field.id} missing type`);
    if (field.render_anchor && typeof field.render_anchor !== "string") {
      errors.push(`Field ${field.id} render_anchor must be a string`);
    }
  }

  return errors;
}
