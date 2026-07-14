import { describe, expect, it } from "vitest";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import {
  buildInterviewContext,
  InterviewValidationError,
  markVoiceUnresolved,
  saveVoiceAnswers
} from "./interview";
import { createFormSession, isFieldApplicable, listFields } from "./session";

async function permissionSession() {
  const fixtures = await loadGoldenCompilerFixtures();
  const form = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!.form;
  return createFormSession(form, new Date("2026-07-14T12:00:00.000Z"));
}

describe("voice interview domain", () => {
  it("atomically saves multiple related voice answers with one version change", async () => {
    const session = await permissionSession();
    const next = saveVoiceAnswers(session, [
      { fieldId: "will_attend", value: true, rawAnswer: "Yes, she can attend and I will pick her up.", confidence: 0.98 },
      { fieldId: "transport_home", value: "Picked up", rawAnswer: "Yes, she can attend and I will pick her up.", confidence: 0.96 }
    ], new Date("2026-07-14T12:01:00.000Z"));

    expect(next.version).toBe(1);
    expect(next.answers.will_attend).toMatchObject({ value: true, source: "voice", status: "answered" });
    expect(next.answers.transport_home).toMatchObject({ value: "Picked up", source: "voice", status: "answered" });
    const transport = listFields(next.form).find((field) => field.id === "transport_home")!;
    expect(isFieldApplicable(next, transport)).toBe(true);
  });

  it("rejects unknown fields and invalid canonical types before changing state", async () => {
    const session = await permissionSession();
    expect(() => saveVoiceAnswers(session, [{
      fieldId: "made_up",
      value: "invented",
      rawAnswer: "invented",
      confidence: 1
    }])).toThrowError(InterviewValidationError);
    expect(() => saveVoiceAnswers(session, [{
      fieldId: "will_attend",
      value: "Yes",
      rawAnswer: "Yes",
      confidence: 1
    }])).toThrow("requires true or false");
    expect(session.version).toBe(0);
  });

  it("records explicit uncertainty as voice provenance and keeps it reviewable", async () => {
    const session = await permissionSession();
    const next = markVoiceUnresolved(
      session,
      "child_name",
      "unknown",
      "I do not know which full name the school has on file.",
      new Date("2026-07-14T12:02:00.000Z")
    );
    expect(next.answers.child_name).toMatchObject({
      status: "needs_followup",
      source: "voice",
      value: null
    });
    expect(buildInterviewContext(next).nextQuestion?.fieldId).toBe("child_name");
  });
});
