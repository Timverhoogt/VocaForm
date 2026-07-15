import { describe, expect, it } from "vitest";
import { aggregateCompilerMetrics, evaluateCompilerForm } from "../evals/compiler_metrics";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import { enforceCompilerSafety, evaluateCompilation, toFormDefinition } from "./compiler";
import { createFormSession, findField, isFieldApplicable, saveTextAnswer } from "./session";
import { formCompilerOutputSchema, type FormCompilerOutput } from "./schemas";

describe("form compiler validation", () => {
  it("meets the Goal 2 recall, requiredness, fabrication, and dependency gates", async () => {
    const fixtures = await loadGoldenCompilerFixtures();
    const metrics = fixtures.map((fixture) => evaluateCompilerForm(fixture.form, fixture.answerKey));
    const aggregate = aggregateCompilerMetrics(metrics);

    expect(fixtures).toHaveLength(3);
    expect(aggregate.fieldRecallPercent).toBeGreaterThanOrEqual(95);
    expect(aggregate.requiredRecallPercent).toBe(100);
    expect(aggregate.fabricatedFieldIds).toEqual([]);
    expect(aggregate.missingDependencies).toEqual([]);
  });

  it("blocks a field whose evidence quote is not in extracted text", () => {
    const output = minimalOutput();
    const readiness = evaluateCompilation(output, "Actual label: __________________");

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unsupported_evidence", fieldId: "invented_field" })
    ]));
  });

  it("falls back safely when the compiler returns an invalid locale", () => {
    const output = minimalOutput();
    output.document.locale = "not_a_locale";
    const readiness = evaluateCompilation(output, "Imaginary label");
    const form = toFormDefinition(output, {
      fileName: "test.txt",
      format: "text",
      searchableText: "Imaginary label"
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "invalid_locale", severity: "warning" })
    ]));
    expect(form.locale).toBe("und");
  });

  it("matches live compiler fields by verbatim label when valid stable IDs differ", async () => {
    const fixtures = await loadGoldenCompilerFixtures();
    const permission = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!;
    const compiled = structuredClone(permission.form);
    const idMap = new Map<string, string>();

    for (const section of compiled.sections) {
      for (const field of section.fields) {
        const replacement = `sol_${field.id}`;
        idMap.set(field.id, replacement);
        field.id = replacement;
        field.label = `Compiled ${field.id}`;
      }
    }
    for (const section of compiled.sections) {
      for (const field of section.fields) {
        field.dependencies = field.dependencies.map((dependency) => ({
          ...dependency,
          fieldId: idMap.get(dependency.fieldId) ?? dependency.fieldId
        }));
      }
    }

    const metrics = evaluateCompilerForm(compiled, permission.answerKey);
    expect(metrics.fieldRecallPercent).toBe(100);
    expect(metrics.requiredRecallPercent).toBe(100);
    expect(metrics.fabricatedFieldIds).toEqual([]);
    expect(metrics.missingDependencies).toEqual([]);
  });

  it("removes unsafe memory proposals from sensitive compiler output", () => {
    const output = minimalOutput();
    const field = output.sections[0]!.fields[0]!;
    field.sensitivity = "sensitive";
    field.memoryKey = "contact.phone";
    field.memoryCandidateReason = "Reuse this contact detail";

    const safe = enforceCompilerSafety(output);
    expect(safe.sections[0]!.fields[0]).toMatchObject({
      memoryKey: null,
      memoryCandidateReason: null
    });
    expect(output.sections[0]!.fields[0]!.memoryKey).toBe("contact.phone");
  });

  it("removes memory proposals from standard free-form answers", () => {
    const output = minimalOutput();
    const field = output.sections[0]!.fields[0]!;
    field.type = "long_text";
    field.memoryKey = "contact.address";
    field.memoryCandidateReason = "Reuse this text";

    expect(enforceCompilerSafety(output).sections[0]!.fields[0]).toMatchObject({
      memoryKey: null,
      memoryCandidateReason: null
    });
  });

  it("blocks sensitive fields proposed for memory", () => {
    const output = minimalOutput();
    output.sections[0]!.fields[0]!.evidence[0]!.text = "Imaginary label";
    output.sections[0]!.fields[0]!.sensitivity = "restricted";
    output.sections[0]!.fields[0]!.memoryKey = "health.secret";
    output.sections[0]!.fields[0]!.memoryCandidateReason = "Reuse this later";
    const readiness = evaluateCompilation(output, "Imaginary label");

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unsafe_memory_candidate" })
    ]));
  });

  it("activates conditional questions only when their dependency matches", async () => {
    const fixtures = await loadGoldenCompilerFixtures();
    const permission = fixtures.find((fixture) => fixture.id === "activity-permission-conditional")!;
    const transport = findField(permission.form, "transport_home")!;
    const initial = createFormSession(permission.form);

    expect(isFieldApplicable(initial, transport)).toBe(false);
    expect(isFieldApplicable(saveTextAnswer(initial, "will_attend", "No"), transport)).toBe(false);
    expect(isFieldApplicable(saveTextAnswer(initial, "will_attend", "Yes"), transport)).toBe(true);
  });
});

function minimalOutput(): FormCompilerOutput {
  return formCompilerOutputSchema.parse({
    document: {
      isForm: true,
      title: "Test form",
      locale: "en-US",
      summary: "A test form."
    },
    sections: [{
      id: "details",
      title: "Details",
      fields: [{
        id: "invented_field",
        label: "Imaginary label",
        type: "short_text",
        required: false,
        interviewPrompt: "What should go here?",
        examples: [],
        options: [],
        dependencies: [],
        validation: {
          minLength: null,
          maxLength: null,
          minValue: null,
          maxValue: null,
          pattern: null,
          allowedValues: []
        },
        memoryKey: null,
        memoryCandidateReason: null,
        sensitivity: "standard",
        evidence: [{ kind: "text", text: "Imaginary label", page: 1, confidence: 0.99 }],
        renderTargets: [{ kind: "answer_packet", locator: "invented_field", confidence: 1 }],
        renderFallback: "append_answer_packet"
      }]
    }],
    warnings: []
  });
}
