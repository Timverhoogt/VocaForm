import { readFile } from "node:fs/promises";
import path from "node:path";
import { fromLegacyForm } from "../adapters/legacy_form_adapter";
import { evaluateCompilation, toFormDefinition } from "../domain/compiler";
import {
  formCompilerOutputSchema,
  type FormCompilerOutput,
  type FormDefinition,
  type FormField
} from "../domain/schemas";
import type { GoldenAnswerKey } from "./compiler_metrics";

export interface GoldenCompilerFixture {
  id: string;
  format: "pdf" | "docx" | "text";
  sourceText: string | null;
  form: FormDefinition;
  answerKey: GoldenAnswerKey;
}

export async function loadGoldenCompilerFixtures(): Promise<GoldenCompilerFixture[]> {
  const [legacySource, medicalSource, permissionSource] = await Promise.all([
    readFile(path.resolve("data/example_entreeformulier.schema.json"), "utf8"),
    readFile(path.resolve("data/golden/medical-intake.txt"), "utf8"),
    readFile(path.resolve("data/golden/activity-permission.txt"), "utf8")
  ]);
  const legacySchema = JSON.parse(legacySource) as {
    sections: Array<{ fields: Array<{ id: string; render_anchor?: string; label: string }> }>;
  };
  const schoolForm = fromLegacyForm(legacySchema);
  const schoolSourceLabels = Object.fromEntries(
    legacySchema.sections.flatMap((section) => section.fields)
      .map((field) => [field.id, field.render_anchor ?? field.label])
  );
  const medical = compileApprovedFixture("medical-intake.pdf", "pdf", medicalOutput(), medicalSource);
  const permission = compileApprovedFixture("activity-permission.txt", "text", permissionOutput(), permissionSource);

  return [
    {
      id: "elementary-school-docx",
      format: "docx",
      sourceText: null,
      form: schoolForm,
      answerKey: answerKeyFor(schoolForm, [], schoolSourceLabels)
    },
    {
      id: "medical-intake-pdf",
      format: "pdf",
      sourceText: medicalSource,
      form: medical,
      answerKey: answerKeyFor(medical, [{ fieldId: "allergy_details", dependsOn: "has_allergies" }])
    },
    {
      id: "activity-permission-conditional",
      format: "text",
      sourceText: permissionSource,
      form: permission,
      answerKey: answerKeyFor(permission, [{ fieldId: "transport_home", dependsOn: "will_attend" }])
    }
  ];
}

function answerKeyFor(
  form: FormDefinition,
  dependencies: GoldenAnswerKey["dependencies"] = [],
  sourceLabelsById: Record<string, string> = {}
): GoldenAnswerKey {
  const fields = form.sections.flatMap((section) => section.fields);
  return {
    fieldIds: fields.map((field) => field.id),
    fieldLabelsById: Object.fromEntries(
      fields.map((field) => [field.id, sourceLabelsById[field.id] ?? field.label])
    ),
    fieldEvidenceById: Object.fromEntries(
      fields.map((field) => [field.id, field.evidence.map((evidence) => evidence.text)])
    ),
    requiredFieldIds: fields.filter((field) => field.required).map((field) => field.id),
    dependencies
  };
}

function compileApprovedFixture(
  fileName: string,
  format: "pdf" | "text",
  output: FormCompilerOutput,
  sourceText: string
): FormDefinition {
  const parsed = formCompilerOutputSchema.parse(output);
  const readiness = evaluateCompilation(parsed, sourceText);
  if (!readiness.ready) {
    throw new Error(`Golden fixture ${fileName} failed readiness: ${readiness.issues.map((item) => item.id).join(", ")}`);
  }
  return toFormDefinition(parsed, { fileName, format, searchableText: sourceText });
}

function medicalOutput(): FormCompilerOutput {
  return formCompilerOutputSchema.parse({
    document: {
      isForm: true,
      title: "Riverside Family Practice — New Patient Intake",
      locale: "en-US",
      summary: "A synthetic medical intake form covering contact details and visit context."
    },
    sections: [
      {
        id: "patient_details",
        title: "Patient details",
        fields: [
          field("patient_name", "Full legal name", "short_text", true, "What is your full legal name?", "Full legal name (required):", { sensitivity: "sensitive" }),
          field("date_of_birth", "Date of birth", "date", true, "What is your date of birth?", "Date of birth (required):", { sensitivity: "restricted" }),
          field("phone", "Phone number", "phone", true, "What phone number should the practice use?", "Phone number (required):", { sensitivity: "sensitive" }),
          field("email", "Email address", "email", false, "What email address would you like to provide?", "Email address (optional):", { sensitivity: "sensitive" })
        ]
      },
      {
        id: "visit_details",
        title: "Visit details",
        fields: [
          field("visit_reason", "Reason for today's visit", "long_text", true, "What brings you in today?", "Reason for today's visit (required):", { sensitivity: "restricted" }),
          field("current_medications", "Current medications", "long_text", false, "Are you currently taking any medications?", "List current medications, or write none:", { sensitivity: "restricted" }),
          field("has_allergies", "Known allergies", "boolean", true, "Do you have any known allergies?", "Do you have any known allergies? Yes / No (required)", { sensitivity: "restricted" }),
          field("allergy_details", "Allergy details", "long_text", false, "Please tell me which allergies you have.", "If yes, list the allergies and reactions:", {
            sensitivity: "restricted",
            dependencies: [{ fieldId: "has_allergies", operator: "equals", value: "Yes" }]
          })
        ]
      }
    ],
    warnings: []
  });
}

function permissionOutput(): FormCompilerOutput {
  return formCompilerOutputSchema.parse({
    document: {
      isForm: true,
      title: "Community Garden Day Permission Form",
      locale: "en-US",
      summary: "A synthetic child activity permission form with a transport condition."
    },
    sections: [
      {
        id: "participant",
        title: "Participant",
        fields: [
          field("child_name", "Child's full name", "short_text", true, "What is your child's full name?", "Child's full name (required):", { sensitivity: "sensitive" }),
          field("guardian_name", "Parent or guardian name", "short_text", true, "What is the parent or guardian's name?", "Parent or guardian name (required):", {
            memoryKey: "parents_or_guardians",
            memoryCandidateReason: "A parent or guardian name is a stable contact detail."
          }),
          field("guardian_phone", "Daytime phone number", "phone", true, "What daytime phone number should we use?", "Daytime phone number (required):", {
            memoryKey: "guardian.phone",
            memoryCandidateReason: "A parent or guardian phone number is a stable contact detail."
          }),
          field("guardian_email", "Parent or guardian email", "email", false, "What email address should we use for the parent or guardian?", "Parent or guardian email (optional):", {
            memoryKey: "guardian.email",
            memoryCandidateReason: "A parent or guardian email address is a stable contact detail."
          })
        ]
      },
      {
        id: "permission",
        title: "Permission",
        fields: [
          field("will_attend", "Attendance permission", "boolean", true, "May your child attend Community Garden Day?", "May the child attend Community Garden Day? Yes / No (required)", { options: ["Yes", "No"] }),
          field("transport_home", "Travel home", "single_choice", false, "How will your child travel home?", "If yes, how will the child travel home? Picked up / Walk home / School bus", {
            options: ["Picked up", "Walk home", "School bus"],
            dependencies: [{ fieldId: "will_attend", operator: "equals", value: "Yes" }]
          }),
          field("accessibility_needs", "Accessibility or support needs", "long_text", false, "Are there accessibility or support needs the organizers should know?", "Accessibility or support needs (optional):", { sensitivity: "sensitive" }),
          field("photo_consent", "Photo consent", "boolean", true, "Do you give permission for event photographs?", "I give permission for event photographs. Yes / No (required)", { options: ["Yes", "No"] })
        ]
      }
    ],
    warnings: []
  });
}

function field(
  id: string,
  label: string,
  type: FormField["type"],
  required: boolean,
  interviewPrompt: string,
  evidenceText: string,
  overrides: Partial<Pick<
    FormField,
    "dependencies" | "memoryCandidateReason" | "memoryKey" | "options" | "sensitivity"
  >> = {}
): FormField {
  return {
    id,
    label,
    type,
    required,
    interviewPrompt,
    examples: [],
    options: overrides.options ?? [],
    dependencies: overrides.dependencies ?? [],
    validation: {
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      pattern: null,
      allowedValues: overrides.options ?? []
    },
    memoryKey: overrides.memoryKey ?? null,
    memoryCandidateReason: overrides.memoryCandidateReason ?? null,
    sensitivity: overrides.sensitivity ?? "standard",
    evidence: [{ kind: "text", text: evidenceText, page: 1, confidence: 0.98 }],
    renderTargets: [{ kind: "answer_packet", locator: id, confidence: 1 }],
    renderFallback: "append_answer_packet"
  };
}
