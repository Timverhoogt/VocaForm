import { describe, expect, it } from "vitest";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { createFormSession } from "../domain/session";
import { buildSessionMemoryContext, createEmptyMemoryVault } from "../domain/memory";
import {
  buildRealtimeToolDefinitions,
  InterviewToolExecutor
} from "./interview_tools";

async function permissionSession() {
  const fixtures = await loadGoldenCompilerFixtures();
  const form = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!.form;
  return createFormSession(form, new Date("2026-07-14T12:00:00.000Z"));
}

describe("Realtime interview tools", () => {
  it("publishes the narrow interview and explicit Goal 4 memory tools", () => {
    expect(buildRealtimeToolDefinitions().map((tool) => tool.name)).toEqual([
      "get_interview_context",
      "save_answers",
      "mark_unknown_or_skipped",
      "request_memory_confirmation",
      "remember_answer",
      "confirm_memory_claim",
      "get_remaining_questions",
      "finish_interview"
    ]);
  });

  it("deduplicates a repeated completed call so an interruption cannot double-save", async () => {
    const executor = new InterviewToolExecutor();
    const session = await permissionSession();
    const request = {
      callId: "call-save-child",
      name: "save_answers",
      arguments: JSON.stringify({
        sessionVersion: 0,
        answers: [{ fieldId: "child_name", value: "Mila Hart", rawAnswer: "Her full name is Mila Hart.", confidence: 0.99 }]
      })
    };
    const first = executor.execute(request, session);
    const replay = executor.execute(request, first.session);

    expect(first.session.version).toBe(1);
    expect(replay.session.version).toBe(1);
    expect(replay.cached).toBe(true);
    expect(replay.output.ok).toBe(true);
  });

  it("rejects stale and unknown writes without changing the session", async () => {
    const executor = new InterviewToolExecutor();
    const session = await permissionSession();
    const stale = executor.execute({
      callId: "call-stale",
      name: "save_answers",
      arguments: JSON.stringify({
        sessionVersion: 4,
        answers: [{ fieldId: "child_name", value: "Mila", rawAnswer: "Mila", confidence: 1 }]
      })
    }, session);
    const unknown = executor.execute({
      callId: "call-unknown",
      name: "save_answers",
      arguments: JSON.stringify({
        sessionVersion: 0,
        answers: [{ fieldId: "invented", value: "No", rawAnswer: "No", confidence: 1 }]
      })
    }, stale.session);

    expect(stale.session.version).toBe(0);
    expect(stale.output).toMatchObject({ ok: false, error: { code: "version_conflict" } });
    expect(unknown.session.version).toBe(0);
    expect(unknown.output).toMatchObject({ ok: false, error: { code: "unknown_field" } });
  });

  it("completes a scripted form entirely through tools and resumes from server state", async () => {
    const executor = new InterviewToolExecutor();
    let session = await permissionSession();
    const saved = executor.execute({
      callId: "call-all-answers",
      name: "save_answers",
      arguments: JSON.stringify({
        sessionVersion: 0,
        answers: [
          { fieldId: "child_name", value: "Mila Hart", rawAnswer: "Mila Hart", confidence: 1 },
          { fieldId: "guardian_name", value: "Alex Hart", rawAnswer: "I am Alex Hart", confidence: 1 },
          { fieldId: "guardian_phone", value: "+31 6 12345678", rawAnswer: "My number is plus 31 6 12345678", confidence: 0.98 },
          { fieldId: "guardian_email", value: "alex@example.test", rawAnswer: "My email is alex@example.test", confidence: 1 },
          { fieldId: "will_attend", value: true, rawAnswer: "Yes, she may attend", confidence: 1 },
          { fieldId: "transport_home", value: "Picked up", rawAnswer: "I will pick her up", confidence: 1 },
          { fieldId: "photo_consent", value: false, rawAnswer: "No photographs please", confidence: 1 }
        ]
      })
    }, session);
    session = saved.session;
    const skipped = executor.execute({
      callId: "call-skip-support",
      name: "mark_unknown_or_skipped",
      arguments: JSON.stringify({
        sessionVersion: 1,
        fieldId: "accessibility_needs",
        disposition: "skipped",
        userWording: "There are no support needs I want to add."
      })
    }, session);
    session = skipped.session;
    const finish = executor.execute({
      callId: "call-finish",
      name: "finish_interview",
      arguments: JSON.stringify({ sessionVersion: 2 })
    }, session);

    expect(finish.output).toMatchObject({ ok: true, canFinish: true, requiredOpen: 0 });
    expect(Object.values(session.answers)
      .filter((answer) => answer.status === "answered")
      .every((answer) => answer.source === "voice")).toBe(true);

    const reconnected = new InterviewToolExecutor().execute({
      callId: "call-resume",
      name: "get_interview_context",
      arguments: JSON.stringify({ sessionVersion: 2 })
    }, session);
    expect(reconnected.output).toMatchObject({
      ok: true,
      context: { sessionVersion: 2, nextQuestion: null, remainingQuestions: [] }
    });
  });

  it("never stores memory through the Goal 3 confirmation check", async () => {
    const executor = new InterviewToolExecutor();
    const result = executor.execute({
      callId: "call-memory-check",
      name: "request_memory_confirmation",
      arguments: JSON.stringify({ sessionVersion: 0, fieldId: "guardian_phone" })
    }, await permissionSession());
    expect(result.output).toMatchObject({ ok: true, eligible: false, stored: false });
    expect(result.session.version).toBe(0);
  });

  it("stores a safe answer only after verbal confirmation and deduplicates the tool call", async () => {
    const executor = new InterviewToolExecutor();
    const session = await permissionSession();
    const saved = executor.execute({
      callId: "call-save-phone",
      name: "save_answers",
      arguments: JSON.stringify({
        sessionVersion: 0,
        answers: [{
          fieldId: "guardian_phone",
          value: "+31 6 12345678",
          rawAnswer: "My number is plus 31 6 12345678.",
          confidence: 1
        }]
      })
    }, session, createEmptyMemoryVault());
    const checked = executor.execute({
      callId: "call-check-phone",
      name: "request_memory_confirmation",
      arguments: JSON.stringify({ sessionVersion: 1, fieldId: "guardian_phone" })
    }, saved.session, saved.vault);
    expect(checked.output).toMatchObject({ ok: true, eligible: true, stored: false });
    expect(checked.vault.claims).toEqual([]);

    const request = {
      callId: "call-remember-phone",
      name: "remember_answer",
      arguments: JSON.stringify({
        sessionVersion: 1,
        fieldId: "guardian_phone",
        subject: "Parent or guardian",
        confirmationWording: "Yes, remember my phone number."
      })
    };
    const remembered = executor.execute(request, checked.session, checked.vault);
    const replay = executor.execute(request, remembered.session, remembered.vault);

    expect(remembered.vault.claims).toHaveLength(1);
    expect(remembered.vault.claims[0]).toMatchObject({
      key: "guardian.phone",
      consent: "approved",
      consentChannel: "voice",
      confirmationWording: "Yes, remember my phone number."
    });
    expect(replay.vault.claims).toHaveLength(1);
    expect(replay.cached).toBe(true);

    const fixtures = await loadGoldenCompilerFixtures();
    const schoolForm = fixtures.find((fixture) => fixture.id === "elementary-school-docx")!.form;
    const schoolSession = createFormSession(schoolForm);
    const suggestion = buildSessionMemoryContext(remembered.vault, schoolSession).suggestions
      .find((item) => item.fieldId === "guardian_phone")!;
    const applied = new InterviewToolExecutor().execute({
      callId: "call-confirm-phone",
      name: "confirm_memory_claim",
      arguments: JSON.stringify({
        sessionVersion: 0,
        fieldId: suggestion.fieldId,
        claimId: suggestion.claimId,
        confirmationWording: "Yes, use that number on this form."
      })
    }, schoolSession, remembered.vault);

    expect(applied.session.prefillAnswers.guardian_phone).toMatchObject({
      status: "answered",
      source: "memory",
      memoryClaimId: suggestion.claimId
    });
  });
});
