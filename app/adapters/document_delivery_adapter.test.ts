import { describe, expect, it } from "vitest";
import { createFormSession } from "../domain/session";
import { buildWebFormDomainFixture } from "../evals/web_form_domain_fixture";
import { loadGoldenCompilerFixtures } from "../evals/golden_fixtures";
import {
  buildDocumentDeliveryPlan,
  deliverDraftDocument
} from "./document_delivery_adapter";
import { buildDocumentExportPlan } from "./document_renderer";

describe("document delivery compatibility adapter", () => {
  it("preserves the legacy document plan and rendering behavior behind delivery terminology", async () => {
    const fixture = (await loadGoldenCompilerFixtures())
      .find((candidate) => candidate.id === "activity-permission-conditional")!;
    const session = createFormSession(fixture.form);
    const legacyPlan = buildDocumentExportPlan(session, null);
    const deliveryPlan = buildDocumentDeliveryPlan(session, null);

    expect(deliveryPlan).toEqual({ channel: "document", ...legacyPlan });
    expect(deliverDraftDocument(session).kind).toBe("answer_packet");
  });

  it("rejects web-form sessions at the document compatibility boundary", () => {
    const session = createFormSession(buildWebFormDomainFixture());

    expect(() => buildDocumentDeliveryPlan(session, null))
      .toThrow("cannot process a web-form session");
    expect(() => deliverDraftDocument(session))
      .toThrow("cannot process a web-form session");
  });
});
