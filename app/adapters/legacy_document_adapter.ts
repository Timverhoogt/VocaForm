import type { FormSession } from "../domain/schemas";
import { buildAnswerPacketDocx } from "./answer_packet_renderer";
import { toLegacyForm } from "./legacy_form_adapter";

interface LegacyStateModule {
  reviewSession(schema: object, state: object): {
    ready_for_final_export: boolean;
    blockers: unknown[];
    warnings: unknown[];
  };
}

export function buildDraftDocx(session: FormSession): Buffer {
  return buildAnswerPacketDocx(session, {
    title: "VocaForm draft answers",
    status: "draft"
  });
}

export function buildVerifiedDocx(session: FormSession): Buffer {
  return buildAnswerPacketDocx(session, {
    title: "VocaForm verified answer packet",
    status: "verified"
  });
}

export async function reviewWithLegacyState(session: FormSession): Promise<{
  readyForFinalExport: boolean;
  blockerCount: number;
  warningCount: number;
}> {
  const legacy = await import("../../src/form_state.mjs") as LegacyStateModule;
  const review = legacy.reviewSession(toLegacyForm(session.form), toLegacyState(session));
  return {
    readyForFinalExport: review.ready_for_final_export,
    blockerCount: review.blockers.length,
    warningCount: review.warnings.length
  };
}

function toLegacyState(session: FormSession): object {
  const interviewAnswers = Object.fromEntries(
    Object.values(session.answers).map((answer) => [answer.fieldId, {
      field_id: answer.fieldId,
      status: answer.status,
      raw_answer: answer.rawAnswer,
      normalized_answer: answer.normalizedAnswer,
      confidence: answer.confidence,
      follow_up_question: answer.followUpQuestion
    }])
  );
  const profileAnswers = Object.fromEntries(
    Object.values(session.prefillAnswers).map((answer) => [answer.fieldId, {
      field_id: answer.fieldId,
      status: answer.status === "answered" ? "prefilled" : "missing",
      source: answer.source === "memory" ? "memory_vault" : answer.source,
      value: answer.value,
      confidence: answer.confidence,
      memory_claim_id: answer.memoryClaimId
    }])
  );

  return {
    form_id: session.form.id,
    form_version: session.form.version,
    language: session.form.locale,
    profile_answers: profileAnswers,
    interview_answers: interviewAnswers,
    metadata: {
      source: "vocaform_typescript_foundation",
      created_at: session.createdAt
    }
  };
}
