import { describe, expect, it } from "vitest";
import { createFormSession } from "../domain/session";
import { buildWebFormDomainFixture } from "../evals/web_form_domain_fixture";
import { buildWebFormDeliveryPlan } from "./web_form_delivery_adapter";

describe("web-form guided delivery", () => {
  it("keeps submission user-only and reports every blocked native control", () => {
    const session = createFormSession(buildWebFormDomainFixture());
    const plan = buildWebFormDeliveryPlan(session);

    expect(plan).toMatchObject({
      channel: "web_form",
      kind: "native_web_form",
      mode: "guided_manual",
      submission: "user_only",
      blockedFieldIds: ["priorities", "availability", "supporting_file", "signature_widget"]
    });
    expect(plan.description).toContain("has not filled or submitted");
  });

  it("offers isolated browser preparation only for complete deterministic forms", () => {
    const form = buildWebFormDomainFixture();
    form.sections = [form.sections[0]!];
    form.flow.pages = [form.flow.pages[0]!];
    form.flow.edges = [{
      id: "finish",
      kind: "submit",
      fromPageId: "page_1",
      toPageId: null,
      condition: null
    }];
    form.source.revision.questionCount = form.sections.flatMap((section) => section.fields).length;
    form.source.revision.pageCount = 1;

    const plan = buildWebFormDeliveryPlan(createFormSession(form));

    expect(plan).toMatchObject({
      mode: "browser_handoff",
      submission: "user_only",
      blockedFieldIds: [],
      buttonLabel: "Prepare native form"
    });
    expect(plan.description).toContain("specific consent");
  });

  it("keeps externally signed-in sessions on a manual answer-list hand-off", () => {
    const form = buildWebFormDomainFixture();
    form.sections = [form.sections[0]!];
    form.flow.pages = [form.flow.pages[0]!];
    form.flow.edges = [{
      id: "finish",
      kind: "submit",
      fromPageId: "page_1",
      toPageId: null,
      condition: null
    }];
    form.source.revision.questionCount = form.sections.flatMap((section) => section.fields).length;
    form.source.revision.pageCount = 1;

    const plan = buildWebFormDeliveryPlan(createFormSession(form), {
      nativePreparationAllowed: false
    });

    expect(plan).toMatchObject({
      mode: "guided_manual",
      buttonLabel: "Open signed-in form"
    });
    expect(plan.description).toContain("signed-in provider session stays in your browser");
  });

  it("fails provider drift and insufficient locator confidence to the manual answer list", () => {
    const form = buildWebFormDomainFixture();
    form.sections = [form.sections[0]!];
    form.flow.pages = [form.flow.pages[0]!];
    form.flow.edges = [{
      id: "finish",
      kind: "submit",
      fromPageId: "page_1",
      toPageId: null,
      condition: null
    }];
    form.source.revision.questionCount = form.sections[0]!.fields.length;
    form.source.revision.pageCount = 1;
    form.sections[0]!.fields[0]!.deliveryTargets[0]!.confidence = 0.5;

    expect(buildWebFormDeliveryPlan(createFormSession(form))).toMatchObject({
      mode: "guided_manual",
      fallbackReason: "unstable_locator",
      nativeConfidence: 0.5
    });
    expect(buildWebFormDeliveryPlan(createFormSession(form), {
      runtimeFallbackReason: "provider_drift"
    })).toMatchObject({
      mode: "guided_manual",
      fallbackReason: "provider_drift"
    });
  });
});
