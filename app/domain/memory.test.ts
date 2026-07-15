import { describe, expect, it } from "vitest";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { saveVoiceAnswers } from "./interview";
import {
  buildSessionMemoryContext,
  confirmMemoryClaimForSession,
  correctMemoryClaim,
  createEmptyMemoryVault,
  forgetMemoryClaim,
  rememberSessionAnswer
} from "./memory";
import { createFormSession } from "./session";

async function goldenForms() {
  const fixtures = await loadGoldenCompilerFixtures();
  return {
    permission: fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!.form,
    school: fixtures.find((fixture) => fixture.id === "elementary-school-docx")!.form,
    medical: fixtures.find((fixture) => fixture.id === "medical-intake-pdf")!.form
  };
}

describe("user-owned Memory Vault", () => {
  it("stores nothing until three safe contact facts receive explicit approval", async () => {
    const { permission } = await goldenForms();
    const session = saveVoiceAnswers(
      createFormSession(permission, new Date("2026-07-14T12:00:00.000Z")),
      [
        { fieldId: "child_name", value: "Mila Hart", rawAnswer: "Her name is Mila Hart.", confidence: 1 },
        { fieldId: "guardian_name", value: "Alex Hart", rawAnswer: "I am Alex Hart.", confidence: 1 },
        { fieldId: "guardian_phone", value: "+31 6 12345678", rawAnswer: "Call me on plus 31 6 12345678.", confidence: 1 },
        { fieldId: "guardian_email", value: "alex@example.test", rawAnswer: "My email is alex at example dot test.", confidence: 1 },
        { fieldId: "accessibility_needs", value: "Quiet arrival support", rawAnswer: "A quiet arrival would help.", confidence: 1 }
      ],
      new Date("2026-07-14T12:01:00.000Z")
    );
    let vault = createEmptyMemoryVault(new Date("2026-07-14T12:00:00.000Z"));
    const proposed = buildSessionMemoryContext(vault, session);

    expect(vault.claims).toEqual([]);
    expect(proposed.rememberableAnswers.map((item) => item.fieldId)).toEqual([
      "guardian_name",
      "guardian_phone",
      "guardian_email"
    ]);
    expect(proposed.rememberableAnswers.map((item) => item.fieldId)).not.toContain("child_name");
    expect(proposed.rememberableAnswers.map((item) => item.fieldId)).not.toContain("accessibility_needs");

    for (const [index, candidate] of proposed.rememberableAnswers.entries()) {
      vault = rememberSessionAnswer(
        vault,
        session,
        candidate.fieldId,
        candidate.subject,
        { channel: "ui" },
        new Date(`2026-07-14T12:0${index + 2}:00.000Z`)
      );
    }

    expect(vault.claims).toHaveLength(3);
    expect(vault.claims.every((claim) => claim.consent === "approved")).toBe(true);
    expect(vault.claims.every((claim) => claim.consentChannel === "ui")).toBe(true);
    expect(vault.claims.every((claim) => claim.sourceSessionId === session.id)).toBe(true);
    expect(vault.claims.every((claim) => claim.sourceFormLocale === permission.locale)).toBe(true);
    expect(vault.claims.map((claim) => claim.sourceFieldId)).not.toContain("child_name");
  });

  it("offers three approved facts on the second golden form and applies none before confirmation", async () => {
    const { permission, school } = await goldenForms();
    const firstSession = saveVoiceAnswers(createFormSession(permission), [
      { fieldId: "guardian_name", value: "Alex Hart", rawAnswer: "I am Alex Hart.", confidence: 1 },
      { fieldId: "guardian_phone", value: "+31 6 12345678", rawAnswer: "Call plus 31 6 12345678.", confidence: 1 },
      { fieldId: "guardian_email", value: "alex@example.test", rawAnswer: "Use alex@example.test.", confidence: 1 }
    ]);
    let vault = createEmptyMemoryVault();
    for (const candidate of buildSessionMemoryContext(vault, firstSession).rememberableAnswers) {
      vault = rememberSessionAnswer(
        vault,
        firstSession,
        candidate.fieldId,
        candidate.subject,
        { channel: "voice", confirmationWording: "Yes, remember that." }
      );
    }

    let secondSession = createFormSession(school);
    const before = buildSessionMemoryContext(vault, secondSession);
    expect(before.suggestions.map((item) => item.fieldId)).toEqual([
      "parents_or_guardians",
      "guardian_phone",
      "guardian_email"
    ]);
    expect(before.suggestions.every((item) => item.sourceFormLocale === permission.locale)).toBe(true);
    expect(Object.values(secondSession.prefillAnswers).every((answer) => answer.status === "unanswered")).toBe(true);

    for (const suggestion of before.suggestions) {
      secondSession = confirmMemoryClaimForSession(
        secondSession,
        vault,
        suggestion.fieldId,
        suggestion.claimId,
        { channel: "ui" }
      );
    }

    const after = buildSessionMemoryContext(vault, secondSession);
    expect(after.confirmedPrefills).toHaveLength(3);
    expect(after.suggestions).toEqual([]);
    expect(after.confirmedPrefills.every((item) =>
      secondSession.prefillAnswers[item.fieldId]?.memoryClaimId === item.claimId
    )).toBe(true);
    expect(after.confirmedPrefills.every((item) =>
      secondSession.prefillAnswers[item.fieldId]?.source === "memory"
    )).toBe(true);
  });

  it("keeps sensitive medical answers out by default and removes forgotten facts from future suggestions", async () => {
    const { medical, permission, school } = await goldenForms();
    const medicalSession = saveVoiceAnswers(createFormSession(medical), [
      { fieldId: "patient_name", value: "Taylor Morgan", rawAnswer: "Taylor Morgan", confidence: 1 },
      { fieldId: "phone", value: "+1 555 0100", rawAnswer: "Call plus one five five five zero one zero zero", confidence: 1 },
      { fieldId: "visit_reason", value: "Persistent pain", rawAnswer: "I have persistent pain", confidence: 1 }
    ]);
    expect(buildSessionMemoryContext(createEmptyMemoryVault(), medicalSession).rememberableAnswers).toEqual([]);

    const firstSession = saveVoiceAnswers(createFormSession(permission), [
      { fieldId: "guardian_name", value: "Alex Hart", rawAnswer: "Alex Hart", confidence: 1 },
      { fieldId: "guardian_phone", value: "+31 6 12345678", rawAnswer: "+31 6 12345678", confidence: 1 },
      { fieldId: "guardian_email", value: "alex@example.test", rawAnswer: "alex@example.test", confidence: 1 }
    ]);
    let vault = createEmptyMemoryVault();
    for (const candidate of buildSessionMemoryContext(vault, firstSession).rememberableAnswers) {
      vault = rememberSessionAnswer(vault, firstSession, candidate.fieldId, candidate.subject, { channel: "ui" });
    }
    const phoneClaim = vault.claims.find((claim) => claim.key === "guardian.phone")!;
    const emailClaim = vault.claims.find((claim) => claim.key === "guardian.email")!;
    vault = correctMemoryClaim(vault, emailClaim.id, "new@example.test");
    vault = forgetMemoryClaim(vault, phoneClaim.id);

    const suggestions = buildSessionMemoryContext(vault, createFormSession(school)).suggestions;
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((item) => item.key)).not.toContain("guardian.phone");
    expect(suggestions.find((item) => item.key === "guardian.email")?.value).toBe("new@example.test");
  });
});
