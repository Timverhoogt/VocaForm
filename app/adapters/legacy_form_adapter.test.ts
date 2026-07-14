import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFormSession, listFields, saveTextAnswer, summarizeSession, verifySession } from "../domain/session";
import { buildDraftDocx, reviewWithLegacyState } from "./legacy_document_adapter";
import { fromLegacyForm } from "./legacy_form_adapter";

const fixturePath = path.resolve("data/example_entreeformulier.schema.json");

async function loadFixture() {
  return fromLegacyForm(JSON.parse(await readFile(fixturePath, "utf8")) as unknown);
}

describe("legacy form adapter", () => {
  it("maps the reviewed school fixture into the canonical domain", async () => {
    const form = await loadFixture();
    const fields = listFields(form);

    expect(form.id).toBe("entreeformulier_dit_ben_ik");
    expect(fields).toHaveLength(37);
    expect(fields.filter((field) => field.required)).toHaveLength(15);
    expect(fields[0]?.evidence[0]?.text).toBe("Hoe was het kind als baby/peuter?");
  });

  it("creates and advances a typed form session", async () => {
    const form = await loadFixture();
    const session = createFormSession(form, new Date("2026-07-14T10:00:00.000Z"));
    const next = saveTextAnswer(
      session,
      "life_baby_toddler",
      "A calm baby who slept well.",
      new Date("2026-07-14T10:01:00.000Z")
    );

    expect(summarizeSession(session)).toMatchObject({
      totalFields: 37,
      answeredFields: 0,
      requiredOpen: 15
    });
    expect(summarizeSession(next)).toMatchObject({
      answeredFields: 1,
      requiredOpen: 14
    });
    expect(verifySession(next).readyForFinalExport).toBe(false);
  });

  it("keeps the proven legacy review and DOCX adapter path working", async () => {
    const session = createFormSession(await loadFixture());
    const report = buildDraftDocx(session);
    const review = await reviewWithLegacyState(session);

    expect(review.readyForFinalExport).toBe(false);
    expect(review.blockerCount).toBe(15);
    expect(report.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(report.length).toBeGreaterThan(1_000);
  });
});
